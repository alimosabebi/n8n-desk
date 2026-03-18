import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { ChatSessionMeta, SessionMessage } from '@/types/session'
import type {
  ChatModelDto,
  ChatHubStreamBegin,
  ChatHubStreamChunk,
  ChatHubStreamEnd,
  ChatHubStreamError,
  ChatHubHumanMessageCreated,
  ChatHubMessageEdited,
  ChatHubExecutionBegin,
  ChatHubExecutionEnd,
  ChatHubConversationModel,
} from '@/types/chathub'
import { localStorageService } from '@/services/local-storage'
import { ChatHubService } from '@/services/chathub'
import { createApiClient } from '@/services/n8n-api'
import { useInstancesStore } from './instances'

function sessionIndexPath(instanceId: string): string {
  return `instances/${instanceId}/sessions/chat/index.json`
}

function sessionFilePath(instanceId: string, sessionId: string): string {
  return `instances/${instanceId}/sessions/chat/${sessionId}.jsonl`
}

function archivePath(instanceId: string, sessionId: string): string {
  return `instances/${instanceId}/sessions/chat/.archive/${sessionId}.jsonl`
}

function generateId(_prefix?: string, _length?: number): string {
  // n8n Chat-Hub requires UUIDs for session and message IDs
  return crypto.randomUUID()
}

export interface StreamState {
  sessionId: string
  messageId: string
  buffer: string
  isStreaming: boolean
  sequenceNumber: number
}

export const useChatStore = defineStore('chat', () => {
  // Session state
  const sessions = ref<ChatSessionMeta[]>([])
  const activeSessionId = ref<string | null>(null)

  // Pending new chat — input is shown but no session created yet
  const pendingNewChat = ref(false)
  const pendingAgent = ref<{ agentId: string; agentName: string; model: ChatHubConversationModel } | null>(null)

  // Messages keyed by sessionId
  const messagesBySession = ref<Map<string, SessionMessage[]>>(new Map())

  // Agents/models discovered from Chat-Hub
  const agents = ref<ChatModelDto[]>([])

  // Currently selected model/agent for sending messages
  const selectedModel = ref<ChatHubConversationModel | null>(null)

  // Streaming state — active streams keyed by sessionId
  const activeStreams = ref<Map<string, StreamState>>(new Map())

  // Execution state
  const executingSessions = ref<Set<string>>(new Set())

  // Computed
  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null
  )

  const sortedSessions = computed(() =>
    [...sessions.value].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  )

  const messages = computed(() => {
    if (!activeSessionId.value) return []
    return messagesBySession.value.get(activeSessionId.value) ?? []
  })

  const isStreaming = computed(() => {
    if (!activeSessionId.value) return false
    const stream = activeStreams.value.get(activeSessionId.value)
    return stream?.isStreaming ?? false
  })

  const isExecuting = computed(() => {
    if (!activeSessionId.value) return false
    return executingSessions.value.has(activeSessionId.value)
  })

  // Helpers
  function getInstanceId(): string | null {
    const instancesStore = useInstancesStore()
    return instancesStore.activeInstanceId
  }

  async function persistSessionIndex(): Promise<void> {
    const instanceId = getInstanceId()
    if (!instanceId) return
    await localStorageService.writeJson(sessionIndexPath(instanceId), sessions.value)
  }

  function getChatHubService(): ChatHubService | null {
    const client = createApiClient()
    if (!client) return null
    return new ChatHubService(client)
  }

  // Core actions
  async function hydrate(): Promise<void> {
    const instanceId = getInstanceId()
    if (!instanceId) return

    const index = await localStorageService.readJson<ChatSessionMeta[]>(
      sessionIndexPath(instanceId)
    )
    sessions.value = index ?? []

    // Load messages for all sessions
    messagesBySession.value = new Map()
    for (const session of sessions.value) {
      const msgs = await localStorageService.readJsonl<SessionMessage>(
        sessionFilePath(instanceId, session.id)
      )
      messagesBySession.value.set(session.id, msgs)
    }

    // Set active to most recent if not set
    if (!activeSessionId.value && sessions.value.length > 0) {
      activeSessionId.value = sortedSessions.value[0].id
    }
  }

  /**
   * Sync local session list with the server.
   * Fetches all sessions from the server and merges titles, agent info, etc.
   * Called after hydrate to ensure local data has up-to-date server titles.
   */
  async function syncSessionsFromServer(): Promise<void> {
    const service = getChatHubService()
    if (!service) return

    try {
      const response = await service.listSessions({ limit: 100 })
      const serverSessions = response.data ?? []

      // Build lookup by session ID
      const serverById = new Map(serverSessions.map((s) => [s.id, s]))

      let changed = false
      for (const local of sessions.value) {
        const serverId = local.serverSessionId ?? local.id
        const server = serverById.get(serverId)
        if (!server) continue

        // Update title from server if it's a real title (not "New Chat")
        if (server.title && server.title !== 'New Chat' && server.title !== local.title) {
          local.title = server.title
          changed = true
        }
        if (server.agentName && server.agentName !== local.agentName) {
          local.agentName = server.agentName
          changed = true
        }
        if (server.agentIcon && !local.agentIcon) {
          local.agentIcon = server.agentIcon
          changed = true
        }
        if (server.updatedAt && server.updatedAt !== local.updatedAt) {
          local.updatedAt = server.updatedAt
          changed = true
        }
        local.syncedAt = new Date().toISOString()
      }

      if (changed) {
        await persistSessionIndex()
      }
    } catch {
      // Best-effort — local data is still usable
    }
  }

  function reset(): void {
    sessions.value = []
    activeSessionId.value = null
    pendingNewChat.value = false
    pendingAgent.value = null
    messagesBySession.value = new Map()
    agents.value = []
    selectedModel.value = null
    activeStreams.value = new Map()
    executingSessions.value = new Set()
  }

  /** Show input for a new chat without creating a session yet. */
  function preparePendingChat(): void {
    activeSessionId.value = null
    pendingNewChat.value = true
    pendingAgent.value = null
  }

  /** Set the agent for the pending chat (session created on first message). */
  function setPendingAgent(agentId: string, agentName: string, model: ChatHubConversationModel): void {
    pendingNewChat.value = true
    activeSessionId.value = null
    pendingAgent.value = { agentId, agentName, model }
  }

  /** Clear the pending state (called after session is actually created). */
  function clearPending(): void {
    pendingNewChat.value = false
    pendingAgent.value = null
  }

  async function createSession(
    title: string,
    agentId?: string,
    agentName?: string,
  ): Promise<string> {
    const instanceId = getInstanceId()
    if (!instanceId) throw new Error('No active instance')

    const id = generateId('session', 12)
    const now = new Date().toISOString()

    const session: ChatSessionMeta = {
      id,
      title,
      agentId,
      agentName,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    }

    sessions.value.push(session)
    messagesBySession.value.set(id, [])
    activeSessionId.value = id

    await persistSessionIndex()
    return id
  }

  async function renameSession(id: string, newTitle: string): Promise<void> {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    const session = sessions.value.find((s) => s.id === id)
    if (!session) return
    session.title = trimmed
    session.updatedAt = new Date().toISOString()
    await persistSessionIndex()

    // Sync rename to server
    const serverSessionId = session.serverSessionId ?? session.id
    try {
      const service = getChatHubService()
      if (service) {
        await service.updateSession(serverSessionId, { title: trimmed })
      }
    } catch {
      // Server sync is best-effort
    }
  }

  async function deleteSession(id: string): Promise<void> {
    const instanceId = getInstanceId()
    if (!instanceId) return

    const session = sessions.value.find((s) => s.id === id)
    const serverSessionId = session?.serverSessionId ?? id

    // Copy messages to archive
    const sourcePath = sessionFilePath(instanceId, id)
    const msgs = await localStorageService.readJsonl<SessionMessage>(sourcePath)
    if (msgs.length > 0) {
      const destPath = archivePath(instanceId, id)
      for (const msg of msgs) {
        await localStorageService.appendJsonl(destPath, msg)
      }
    }

    // Remove from state
    sessions.value = sessions.value.filter((s) => s.id !== id)
    messagesBySession.value.delete(id)

    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value.length > 0 ? sortedSessions.value[0].id : null
    }

    await persistSessionIndex()

    // Sync delete to server
    try {
      const service = getChatHubService()
      if (service) {
        await service.deleteSession(serverSessionId)
      }
    } catch {
      // Server sync is best-effort
    }
  }

  function switchSession(id: string): void {
    if (sessions.value.some((s) => s.id === id)) {
      activeSessionId.value = id
      pendingNewChat.value = false
      pendingAgent.value = null
    }
  }

  async function appendMessage(message: SessionMessage): Promise<void> {
    const instanceId = getInstanceId()
    if (!instanceId) return

    const sessionId = activeSessionId.value
    if (!sessionId) return

    const sessionMessages = messagesBySession.value.get(sessionId) ?? []
    sessionMessages.push(message)
    messagesBySession.value.set(sessionId, sessionMessages)

    await localStorageService.appendJsonl(
      sessionFilePath(instanceId, sessionId),
      message
    )

    const session = sessions.value.find((s) => s.id === sessionId)
    if (session) {
      session.updatedAt = message.ts
      session.messageCount = sessionMessages.length
      await persistSessionIndex()
    }
  }

  // Stream event handlers
  function handleStreamBegin(event: ChatHubStreamBegin): void {
    const { sessionId, messageId, sequenceNumber } = event.data
    activeStreams.value.set(sessionId, {
      sessionId,
      messageId,
      buffer: '',
      isStreaming: true,
      sequenceNumber,
    })

    const msgs = messagesBySession.value.get(sessionId) ?? []
    msgs.push({
      id: messageId,
      role: 'assistant',
      content: '',
      ts: new Date().toISOString(),
      meta: {
        previousMessageId: event.data.previousMessageId,
        retryOfMessageId: event.data.retryOfMessageId,
        executionId: event.data.executionId,
      },
    })
    messagesBySession.value.set(sessionId, msgs)
  }

  function handleStreamChunk(event: ChatHubStreamChunk): void {
    const { sessionId, content, sequenceNumber } = event.data
    const stream = activeStreams.value.get(sessionId)
    if (!stream) return

    stream.buffer += content
    stream.sequenceNumber = sequenceNumber

    const msgs = messagesBySession.value.get(sessionId)
    if (!msgs) return
    const msg = msgs.find((m) => m.id === stream.messageId)
    if (msg) {
      msg.content = stream.buffer
    }
  }

  async function handleStreamEnd(event: ChatHubStreamEnd): Promise<void> {
    const { sessionId, sequenceNumber } = event.data
    const stream = activeStreams.value.get(sessionId)
    if (!stream) return

    stream.isStreaming = false
    stream.sequenceNumber = sequenceNumber

    const instanceId = getInstanceId()
    if (instanceId) {
      const msgs = messagesBySession.value.get(sessionId)
      const msg = msgs?.find((m) => m.id === stream.messageId)
      if (msg) {
        msg.meta = { ...msg.meta, status: event.data.status }
        await localStorageService.appendJsonl(
          sessionFilePath(instanceId, sessionId),
          msg
        )
      }

      const session = sessions.value.find((s) => s.id === sessionId)
      if (session && msgs) {
        session.updatedAt = new Date().toISOString()
        session.messageCount = msgs.length
        session.lastSequenceNumber = sequenceNumber
        await persistSessionIndex()
      }
    }

    activeStreams.value.delete(sessionId)

    // After stream ends, poll for the server-generated title.
    // Title generation is a second LLM call that starts AFTER the stream ends,
    // so we need to wait and retry.
    const session = sessions.value.find((s) => s.id === sessionId)
    if (session && session.messageCount <= 2) {
      void pollForTitle(sessionId)
    }
  }

  /**
   * Poll the server for the generated title after the first response.
   * The server generates titles via a second LLM call that runs AFTER the
   * chat stream completes — typically takes 3-10 seconds.
   */
  async function pollForTitle(sessionId: string): Promise<void> {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session) return

    const service = getChatHubService()
    if (!service) return

    const serverSessionId = session.serverSessionId ?? session.id

    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000))

      try {
        const response = await service.getSession(serverSessionId)
        const serverTitle = response.session?.title
        // Accept the title only if it's not the server's "New Chat" placeholder
        if (serverTitle && serverTitle.trim().toLowerCase() !== 'new chat') {
          session.title = serverTitle
          session.updatedAt = new Date().toISOString()
          await persistSessionIndex()
          return
        }
      } catch {
        return
      }
    }
  }

  function handleStreamError(event: ChatHubStreamError): void {
    const { sessionId } = event.data
    const stream = activeStreams.value.get(sessionId)
    if (!stream) return

    const msgs = messagesBySession.value.get(sessionId)
    const msg = msgs?.find((m) => m.id === stream.messageId)
    if (msg) {
      msg.meta = { ...msg.meta, error: event.data.error, status: 'error' }
    }

    stream.isStreaming = false
    activeStreams.value.delete(sessionId)
  }

  function handleHumanMessageCreated(event: ChatHubHumanMessageCreated): void {
    const { sessionId, messageId, content } = event.data
    const msgs = messagesBySession.value.get(sessionId)
    if (!msgs) return

    if (msgs.some((m) => m.id === messageId)) return

    msgs.push({
      id: messageId,
      role: 'user',
      content,
      ts: new Date(event.data.timestamp).toISOString(),
      meta: {
        previousMessageId: event.data.previousMessageId,
        attachments: event.data.attachments,
      },
    })
  }

  function handleMessageEdited(event: ChatHubMessageEdited): void {
    const { sessionId, revisionOfMessageId, messageId, content } = event.data
    const msgs = messagesBySession.value.get(sessionId)
    if (!msgs) return

    const original = msgs.find((m) => m.id === revisionOfMessageId)
    if (original) {
      original.content = content
      original.meta = { ...original.meta, revisedBy: messageId }
    }
  }

  function handleExecutionBegin(event: ChatHubExecutionBegin): void {
    executingSessions.value.add(event.data.sessionId)
  }

  function handleExecutionEnd(event: ChatHubExecutionEnd): void {
    executingSessions.value.delete(event.data.sessionId)
  }

  function setAgents(newAgents: ChatModelDto[]): void {
    agents.value = newAgents
    // Auto-select first available model if nothing is selected yet
    if (!selectedModel.value && newAgents.length > 0) {
      const firstAvailable = newAgents.find((a) => a.metadata.available)
      if (firstAvailable) {
        selectedModel.value = firstAvailable.model
      }
    }
  }

  function selectModel(model: ChatHubConversationModel): void {
    selectedModel.value = model
  }

  /** Find the ChatModelDto for the currently selected model */
  const selectedModelDto = computed((): ChatModelDto | null => {
    if (!selectedModel.value) return null
    const sel = selectedModel.value
    return agents.value.find((a) => {
      const m = a.model
      if (m.provider !== sel.provider) return false
      if ('workflowId' in m && 'workflowId' in sel) return m.workflowId === sel.workflowId
      if ('agentId' in m && 'agentId' in sel) return m.agentId === sel.agentId
      if ('model' in m && 'model' in sel) return m.model === sel.model
      return false
    }) ?? null
  })

  function getStreamState(sessionId: string): StreamState | undefined {
    return activeStreams.value.get(sessionId)
  }

  return {
    // State
    sessions,
    activeSessionId,
    pendingNewChat,
    pendingAgent,
    messagesBySession,
    agents,
    selectedModel,
    activeStreams,
    executingSessions,

    // Computed
    activeSession,
    sortedSessions,
    messages,
    isStreaming,
    isExecuting,
    selectedModelDto,

    // Actions
    hydrate,
    syncSessionsFromServer,
    reset,
    preparePendingChat,
    setPendingAgent,
    clearPending,
    createSession,
    renameSession,
    deleteSession,
    switchSession,
    appendMessage,
    setAgents,
    selectModel,
    getStreamState,

    // Stream event handlers
    handleStreamBegin,
    handleStreamChunk,
    handleStreamEnd,
    handleStreamError,
    handleHumanMessageCreated,
    handleMessageEdited,
    handleExecutionBegin,
    handleExecutionEnd,
  }
})
