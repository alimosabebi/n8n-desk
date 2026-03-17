import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { AgentStreamEvent, AgentRunnerConfig, LlmProviderConfig } from '../agent/types'
import { type AgentRunner } from '../agent/types'
import { createAgentRunner, resolveLlmConfig } from '../agent/factory'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

// --- Active runners ---

interface ActiveRunner {
  sessionId: string
  runner: AgentRunner
  stopped: boolean
}

const activeRunners = new Map<string, ActiveRunner>()

// --- Helpers ---

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function readActiveInstanceConfig(): Promise<{ url: string; accessToken: string } | null> {
  const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
  if (!config?.defaultInstanceId) return null

  const instanceId = config.defaultInstanceId
  const instance = await readJson<{ url: string }>(
    path.join(BASE_DIR, 'instances', instanceId, 'instance.json')
  )
  const auth = await readJson<{ accessToken?: string }>(
    path.join(BASE_DIR, 'instances', instanceId, 'auth.json')
  )

  if (!instance?.url) return null
  return {
    url: instance.url,
    accessToken: auth?.accessToken ?? '',
  }
}

async function appendToSessionJsonl(sessionId: string, event: AgentStreamEvent): Promise<void> {
  // Find the active instance to determine the JSONL path
  const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
  if (!config?.defaultInstanceId) return

  const jsonlPath = path.join(
    BASE_DIR,
    'instances',
    config.defaultInstanceId,
    'sessions',
    'workflow',
    `${sessionId}.jsonl`
  )

  // Only persist message-producing events
  let message: Record<string, unknown> | null = null

  switch (event.type) {
    case 'text_chunk':
      // Text chunks are accumulated in the renderer; we persist the final message on 'done'
      break
    case 'tool_call_start':
      message = {
        id: `msg_${Date.now()}`,
        role: 'tool',
        content: '',
        ts: new Date().toISOString(),
        meta: { toolCallId: event.data.id, toolName: event.data.name, status: 'running' },
      }
      break
    case 'tool_call_result':
      message = {
        id: `msg_${Date.now()}`,
        role: 'tool',
        content: typeof event.data.result === 'string' ? event.data.result : JSON.stringify(event.data.result),
        ts: new Date().toISOString(),
        meta: {
          toolCallId: event.data.id,
          toolName: event.data.name,
          status: event.data.success ? 'completed' : 'failed',
          error: event.data.error,
        },
      }
      break
    case 'error':
      message = {
        id: `msg_${Date.now()}`,
        role: 'system',
        content: event.data.message,
        ts: new Date().toISOString(),
        meta: { error: true, code: event.data.code },
      }
      break
  }

  if (message) {
    try {
      await fs.mkdir(path.dirname(jsonlPath), { recursive: true })
      await fs.appendFile(jsonlPath, JSON.stringify(message) + '\n', 'utf-8')
    } catch {
      // Non-fatal — session file may not exist yet
    }
  }
}

async function testLlmConnection(config: LlmProviderConfig): Promise<{ success: boolean; error?: string }> {
  const provider = config.provider

  try {
    if (provider === 'anthropic') {
      if (!config.apiKey) return { success: false, error: 'No Anthropic API key configured' }
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model || 'claude-sonnet-4-6',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
      if (res.status === 401) return { success: false, error: 'Invalid Anthropic API key' }
      return { success: res.ok }
    } else if (provider === 'openai') {
      if (!config.apiKey) return { success: false, error: 'No OpenAI API key configured' }
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      })
      if (res.status === 401) return { success: false, error: 'Invalid OpenAI API key' }
      return { success: res.ok }
    } else if (provider === 'ollama') {
      const ollamaUrl = config.baseUrl || 'http://localhost:11434'
      const res = await fetch(`${ollamaUrl}/api/tags`)
      return { success: res.ok }
    }
    return { success: false, error: `Unknown provider: ${provider}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Connection failed: ${message}` }
  }
}

// --- IPC Handlers ---

let handlersRegistered = false

export function registerAgentHandlers(mainWindow: BrowserWindow): void {
  if (handlersRegistered) return
  handlersRegistered = true

  // The workflow agent system prompt
  const workflowSystemPrompt = `You are a workflow automation assistant for n8n. You help users create, manage, and execute n8n workflows using the available MCP tools. Be concise and helpful. When creating workflows, always validate before creating. When executing workflows, explain what will happen before running.`

  ipcMain.handle('agent:invoke', async (_event, sessionId: string, message: string) => {
    try {
      const llmConfig = await resolveLlmConfig()
      if (!llmConfig) {
        const errorEvent: AgentStreamEvent = {
          sessionId,
          type: 'error',
          data: { message: 'No LLM configuration found. Please configure an LLM provider in Settings.' },
        }
        mainWindow.webContents.send('agent:event', errorEvent)
        const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
        mainWindow.webContents.send('agent:event', doneEvent)
        return { success: false, error: 'No LLM configuration' }
      }

      // Read instance config for MCP connection
      const instanceConfig = await readActiveInstanceConfig()
      if (!instanceConfig) {
        const errorEvent: AgentStreamEvent = {
          sessionId,
          type: 'error',
          data: { message: 'No active n8n instance configured. Please connect to an instance first.' },
        }
        mainWindow.webContents.send('agent:event', errorEvent)
        const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
        mainWindow.webContents.send('agent:event', doneEvent)
        return { success: false, error: 'No active instance' }
      }

      // Stop existing runner for this session if any
      const existing = activeRunners.get(sessionId)
      if (existing) {
        await existing.runner.stop(sessionId)
        activeRunners.delete(sessionId)
      }

      // Determine backend based on LLM provider
      const backend = llmConfig.provider === 'anthropic' ? 'claude-sdk' : 'deep-agents'
      const runner = createAgentRunner(backend)

      const active: ActiveRunner = {
        sessionId,
        runner,
        stopped: false,
      }
      activeRunners.set(sessionId, active)

      const runnerConfig: AgentRunnerConfig = {
        instanceUrl: instanceConfig.url,
        accessToken: instanceConfig.accessToken,
        llmConfig,
        systemPrompt: workflowSystemPrompt,
        interruptOnTools: [
          'create_workflow_from_code',
          'update_workflow',
          'publish_workflow',
          'archive_workflow',
          'execute_workflow',
        ],
      }

      // Run agent and stream events
      // Use an async IIFE so we don't block the IPC return
      void (async () => {
        try {
          for await (const event of runner.invoke(sessionId, message, runnerConfig)) {
            if (active.stopped) break
            mainWindow.webContents.send('agent:event', event)
            await appendToSessionJsonl(sessionId, event)
          }
        } catch (err) {
          const errMessage = err instanceof Error ? err.message : String(err)
          const errorEvent: AgentStreamEvent = {
            sessionId,
            type: 'error',
            data: { message: errMessage },
          }
          mainWindow.webContents.send('agent:event', errorEvent)
          const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
          mainWindow.webContents.send('agent:event', doneEvent)
        } finally {
          activeRunners.delete(sessionId)
        }
      })()

      return { success: true }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      const errorEvent: AgentStreamEvent = {
        sessionId,
        type: 'error',
        data: { message: errMessage },
      }
      mainWindow.webContents.send('agent:event', errorEvent)
      const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
      mainWindow.webContents.send('agent:event', doneEvent)
      activeRunners.delete(sessionId)
      return { success: false, error: errMessage }
    }
  })

  ipcMain.handle('agent:stop', async (_event, sessionId: string) => {
    const active = activeRunners.get(sessionId)
    if (active) {
      active.stopped = true
      await active.runner.stop(sessionId)
      activeRunners.delete(sessionId)
      const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'cancelled' } }
      mainWindow.webContents.send('agent:event', doneEvent)
    }
    return { success: true }
  })

  ipcMain.handle('agent:approve', async (_event, sessionId: string, decision: 'approve' | 'reject') => {
    const active = activeRunners.get(sessionId)
    if (!active) {
      return { success: false, error: 'No active runner for session' }
    }

    await active.runner.approve(sessionId, decision)

    const resolvedEvent: AgentStreamEvent = {
      sessionId,
      type: 'approval_resolved',
      data: { id: 'latest', decision },
    }
    mainWindow.webContents.send('agent:event', resolvedEvent)

    return { success: true }
  })

  ipcMain.handle('agent:test-connection', async () => {
    const llmConfig = await resolveLlmConfig()
    if (!llmConfig) {
      return { success: false, error: 'No LLM configuration found' }
    }
    return testLlmConnection(llmConfig)
  })
}
