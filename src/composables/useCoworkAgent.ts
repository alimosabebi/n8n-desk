import { computed, onMounted, onUnmounted } from 'vue'
import { useCoworkSessionsStore } from '@/stores/cowork-sessions'
import type { AgentEvent } from '@/types/agent'

export function useCoworkAgent() {
  const sessionStore = useCoworkSessionsStore()

  const messages = computed(() => sessionStore.messages)
  const isRunning = computed(() => sessionStore.isAgentRunning)
  const pendingApproval = computed(() => sessionStore.pendingApproval)
  const activeSession = computed(() => sessionStore.activeSession)
  const toolCalls = computed(() => sessionStore.toolCalls)
  const previewData = computed(() => sessionStore.previewData)

  let removeEventListener: (() => void) | null = null

  function handleEvent(event: AgentEvent): void {
    // Only process events for the active session
    if (event.sessionId !== sessionStore.activeSessionId) return
    sessionStore.handleAgentEvent(event)
  }

  /**
   * Send a message to the cowork agent.
   * Creates a session if none is active.
   */
  async function sendMessage(text: string, attachedFilePaths?: string[]): Promise<void> {
    if (!window.n8nDesk) {
      throw new Error('n8nDesk bridge not available')
    }

    // Create session if needed
    if (!sessionStore.activeSessionId) {
      await sessionStore.createSession()
    }

    const sessionId = sessionStore.activeSessionId!

    // Append user message to store
    await sessionStore.appendMessage({
      id: `msg_${Date.now()}`,
      role: 'user',
      content: text,
      ts: new Date().toISOString(),
    })

    sessionStore.isAgentRunning = true

    // Pass attached folders so the agent's sandbox policy scopes file access.
    // Also pass directly attached file paths — these are individually granted
    // by the user and added as individual file mounts in the sandbox.
    const attachedFolders = sessionStore.activeSession?.attachedFolders ?? []
    const result = await window.n8nDesk.agent.invoke(sessionId, text, {
      attachedFolders: attachedFolders.map((f) => ({ path: f.path, label: f.label, mode: f.mode })),
      attachedFiles: attachedFilePaths,
      mode: 'cowork',
    })
    if (!result.success) {
      sessionStore.isAgentRunning = false
      await sessionStore.appendMessage({
        id: `msg_${Date.now()}`,
        role: 'system',
        content: result.error ?? 'Agent invocation failed',
        ts: new Date().toISOString(),
        meta: { error: true },
      })
    }
  }

  /**
   * Stop the currently running agent session.
   */
  async function stopAgent(): Promise<void> {
    if (!window.n8nDesk || !sessionStore.activeSessionId) return
    await window.n8nDesk.agent.stop(sessionStore.activeSessionId)
  }

  /**
   * Approve or reject a pending human-in-the-loop action.
   */
  async function approveAction(decision: 'approve' | 'reject'): Promise<void> {
    if (!window.n8nDesk || !sessionStore.activeSessionId) return
    await window.n8nDesk.agent.approve(sessionStore.activeSessionId, decision)
  }

  /**
   * Test the LLM connection with current settings.
   */
  async function testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!window.n8nDesk) {
      return { success: false, error: 'n8nDesk bridge not available' }
    }
    return window.n8nDesk.agent.testConnection()
  }

  onMounted(() => {
    if (window.n8nDesk) {
      removeEventListener = window.n8nDesk.agent.onEvent(handleEvent)
    }
  })

  onUnmounted(() => {
    if (removeEventListener) {
      removeEventListener()
      removeEventListener = null
    }
  })

  return {
    messages,
    isRunning,
    pendingApproval,
    activeSession,
    toolCalls,
    previewData,
    sendMessage,
    stopAgent,
    approveAction,
    testConnection,
  }
}
