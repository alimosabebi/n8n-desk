import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { SessionMeta, SessionMessage } from '@/types/session'
import type { AgentEvent, AgentToolCall, AgentApprovalRequiredEvent } from '@/types/agent'
import { localStorageService } from '@/services/local-storage'

function sessionsDir(instanceId: string): string {
  return `instances/${instanceId}/sessions/workflow`
}

function indexPath(instanceId: string): string {
  return `${sessionsDir(instanceId)}/index.json`
}

function sessionFilePath(instanceId: string, sessionId: string): string {
  return `${sessionsDir(instanceId)}/${sessionId}.jsonl`
}

function archivePath(instanceId: string, sessionId: string): string {
  return `${sessionsDir(instanceId)}/.archive/${sessionId}.jsonl`
}

function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'session_'
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

export const useWorkflowSessionsStore = defineStore('workflow-sessions', () => {
  const sessions = ref<SessionMeta[]>([])
  const activeSessionId = ref<string | null>(null)
  const messages = ref<SessionMessage[]>([])
  const pendingApproval = ref<AgentApprovalRequiredEvent['data'] | null>(null)
  const isAgentRunning = ref(false)
  const toolCalls = ref<AgentToolCall[]>([])

  let currentInstanceId: string | null = null

  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null
  )

  /**
   * Hydrate from disk for a given instance.
   */
  async function hydrate(instanceId: string): Promise<void> {
    currentInstanceId = instanceId
    const index = await localStorageService.readJson<SessionMeta[]>(indexPath(instanceId))
    sessions.value = index ?? []

    // Load the most recent session if available
    if (sessions.value.length > 0) {
      await selectSession(sessions.value[0].id)
    } else {
      activeSessionId.value = null
      messages.value = []
    }
  }

  /**
   * Create a new session and persist it.
   */
  async function createSession(title?: string): Promise<string> {
    if (!currentInstanceId) throw new Error('No active instance')

    const now = new Date().toISOString()
    const id = generateSessionId()

    const meta: SessionMeta = {
      id,
      title: title ?? 'New workflow session',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    }

    sessions.value.unshift(meta)
    await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)
    // JSONL file will be created on first appendJsonl call — no need to pre-create

    await selectSession(id)
    return id
  }

  /**
   * Delete a session by moving it to .archive/.
   */
  async function deleteSession(sessionId: string): Promise<void> {
    if (!currentInstanceId) return

    // Read the session file and write it to archive
    const msgs = await localStorageService.readJsonl<SessionMessage>(
      sessionFilePath(currentInstanceId, sessionId)
    )
    if (msgs.length > 0) {
      for (const msg of msgs) {
        await localStorageService.appendJsonl(archivePath(currentInstanceId, sessionId), msg)
      }
    }

    // Remove from index
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)

    // If we deleted the active session, select another or clear
    if (activeSessionId.value === sessionId) {
      if (sessions.value.length > 0) {
        await selectSession(sessions.value[0].id)
      } else {
        activeSessionId.value = null
        messages.value = []
      }
    }
  }

  /**
   * Select a session and load its messages from JSONL.
   */
  async function selectSession(sessionId: string): Promise<void> {
    if (!currentInstanceId) return

    activeSessionId.value = sessionId
    messages.value = await localStorageService.readJsonl<SessionMessage>(
      sessionFilePath(currentInstanceId, sessionId)
    )
    pendingApproval.value = null
    toolCalls.value = []
  }

  /**
   * Append a message to the active session and persist it.
   */
  async function appendMessage(message: SessionMessage): Promise<void> {
    if (!currentInstanceId || !activeSessionId.value) return

    messages.value.push(message)
    await localStorageService.appendJsonl(
      sessionFilePath(currentInstanceId, activeSessionId.value),
      message
    )

    // Update session metadata
    const meta = sessions.value.find((s) => s.id === activeSessionId.value)
    if (meta) {
      meta.updatedAt = new Date().toISOString()
      meta.messageCount = messages.value.length
      await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)
    }
  }

  /**
   * Handle an agent event and dispatch by type.
   */
  function persistMessage(message: SessionMessage): void {
    if (!currentInstanceId || !activeSessionId.value) return
    void localStorageService.appendJsonl(
      sessionFilePath(currentInstanceId, activeSessionId.value),
      message
    )
  }

  function handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'text_chunk': {
        // Accumulate text into the last assistant message, or create one
        const last = messages.value[messages.value.length - 1]
        if (last && last.role === 'assistant') {
          last.content += event.data.text
        } else {
          const msg: SessionMessage = {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: event.data.text,
            ts: new Date().toISOString(),
          }
          messages.value.push(msg)
          // Persist new assistant message immediately
          persistMessage(msg)
        }
        break
      }
      case 'tool_call_start': {
        const tc: AgentToolCall = {
          id: event.data.id,
          name: event.data.name,
          args: event.data.args,
          status: 'running',
        }
        toolCalls.value.push(tc)

        // Add a tool message to the conversation and persist
        const toolMsg: SessionMessage = {
          id: `msg_${Date.now()}`,
          role: 'tool',
          content: '',
          ts: new Date().toISOString(),
          meta: { toolCallId: event.data.id, toolName: event.data.name, status: 'running' },
        }
        messages.value.push(toolMsg)
        persistMessage(toolMsg)
        break
      }
      case 'tool_call_result': {
        const tc = toolCalls.value.find((t) => t.id === event.data.id)
        if (tc) {
          tc.status = event.data.success ? 'completed' : 'failed'
          tc.result = event.data.result
        }

        // Update the tool message and persist the updated version
        const toolMsg = [...messages.value].reverse().find(
          (m) => m.meta && (m.meta as Record<string, unknown>).toolCallId === event.data.id
        )
        if (toolMsg) {
          toolMsg.content = typeof event.data.result === 'string'
            ? event.data.result
            : JSON.stringify(event.data.result)
          toolMsg.meta = {
            ...toolMsg.meta,
            status: event.data.success ? 'completed' : 'failed',
            error: event.data.error,
          }
          persistMessage(toolMsg)
        }
        break
      }
      case 'approval_required': {
        pendingApproval.value = event.data
        const tc = toolCalls.value.find((t) => t.id === event.data.id)
        if (tc) {
          tc.status = 'awaiting_approval'
        }
        break
      }
      case 'approval_resolved': {
        pendingApproval.value = null
        const tc = toolCalls.value.find((t) => t.id === event.data.id)
        if (tc) {
          tc.status = event.data.decision === 'approve' ? 'running' : 'failed'
        }
        break
      }
      case 'todo_update': {
        // Todo updates are informational — could be surfaced in UI
        break
      }
      case 'error': {
        const errorMsg: SessionMessage = {
          id: `msg_${Date.now()}`,
          role: 'system',
          content: event.data.message,
          ts: new Date().toISOString(),
          meta: { error: true, code: event.data.code },
        }
        messages.value.push(errorMsg)
        persistMessage(errorMsg)
        isAgentRunning.value = false
        break
      }
      case 'done': {
        isAgentRunning.value = false
        // Persist the final assistant message (accumulated text chunks)
        const lastMsg = messages.value[messages.value.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          // The assistant message was persisted on creation but text was accumulated,
          // so persist the final version with complete content
          persistMessage(lastMsg)
        }
        break
      }
    }
  }

  function reset(): void {
    sessions.value = []
    activeSessionId.value = null
    messages.value = []
    pendingApproval.value = null
    isAgentRunning.value = false
    toolCalls.value = []
    currentInstanceId = null
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    messages,
    pendingApproval,
    isAgentRunning,
    toolCalls,
    hydrate,
    createSession,
    deleteSession,
    selectSession,
    appendMessage,
    handleAgentEvent,
    reset,
  }
})
