import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore } from '@/stores/chat'
import { useInstancesStore } from '@/stores/instances'
import { localStorageService } from '@/services/local-storage'
import type { ChatSessionMeta, SessionMessage } from '@/types/session'
import type {
  ChatHubStreamBegin,
  ChatHubStreamChunk,
  ChatHubStreamEnd,
  ChatHubStreamError,
  ChatHubHumanMessageCreated,
  ChatHubMessageEdited,
  ChatHubExecutionBegin,
  ChatHubExecutionEnd,
} from '@/types/chathub'

vi.mock('@/services/local-storage', () => ({
  localStorageService: {
    readJson: vi.fn().mockResolvedValue(null),
    writeJson: vi.fn().mockResolvedValue(undefined),
    readJsonl: vi.fn().mockResolvedValue([]),
    appendJsonl: vi.fn().mockResolvedValue(undefined),
  },
}))

const INSTANCE_ID = 'inst_test123'

function setupActiveInstance(): void {
  const instancesStore = useInstancesStore()
  instancesStore.activeInstanceId = INSTANCE_ID
}

function makeMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: 'msg_1',
    role: 'user',
    content: 'hello',
    ts: '2026-03-14T10:00:00Z',
    ...overrides,
  }
}

function makeStreamMeta(sessionId: string, messageId: string, seq = 1) {
  return { sessionId, messageId, sequenceNumber: seq, timestamp: Date.now() }
}

describe('useChatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // Session CRUD
  // -----------------------------------------------------------------------
  describe('createSession', () => {
    it('creates a session and sets it active', async () => {
      setupActiveInstance()
      const store = useChatStore()

      const id = await store.createSession('Test Session', 'agent1', 'My Agent')

      expect(id).toMatch(/^session_/)
      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0].title).toBe('Test Session')
      expect(store.sessions[0].agentId).toBe('agent1')
      expect(store.sessions[0].agentName).toBe('My Agent')
      expect(store.sessions[0].messageCount).toBe(0)
      expect(store.activeSessionId).toBe(id)
      expect(store.messagesBySession.get(id)).toEqual([])
      expect(localStorageService.writeJson).toHaveBeenCalled()
    })

    it('throws if no active instance', async () => {
      const store = useChatStore()
      await expect(store.createSession('Test')).rejects.toThrow('No active instance')
    })
  })

  describe('deleteSession', () => {
    it('removes session and archives messages', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const id = await store.createSession('To Delete')

      const msgs: SessionMessage[] = [makeMessage()]
      vi.mocked(localStorageService.readJsonl).mockResolvedValueOnce(msgs)

      await store.deleteSession(id)

      expect(store.sessions).toHaveLength(0)
      expect(store.messagesBySession.has(id)).toBe(false)
      expect(store.activeSessionId).toBeNull()
      expect(localStorageService.appendJsonl).toHaveBeenCalledWith(
        expect.stringContaining('.archive/'),
        msgs[0]
      )
    })

    it('switches active session after deletion', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const id1 = await store.createSession('First')
      const id2 = await store.createSession('Second')

      vi.mocked(localStorageService.readJsonl).mockResolvedValueOnce([])
      await store.deleteSession(id2)

      expect(store.activeSessionId).toBe(id1)
    })
  })

  describe('switchSession', () => {
    it('switches to an existing session', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const id1 = await store.createSession('First')
      await store.createSession('Second')

      store.switchSession(id1)
      expect(store.activeSessionId).toBe(id1)
    })

    it('does nothing for non-existent session', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const id = await store.createSession('First')

      store.switchSession('nonexistent')
      expect(store.activeSessionId).toBe(id)
    })
  })

  // -----------------------------------------------------------------------
  // Message append
  // -----------------------------------------------------------------------
  describe('appendMessage', () => {
    it('appends message to active session and persists', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const id = await store.createSession('Test')
      const msg = makeMessage()

      await store.appendMessage(msg)

      expect(store.messages).toHaveLength(1)
      expect(store.messages[0].content).toBe('hello')
      expect(localStorageService.appendJsonl).toHaveBeenCalledWith(
        `instances/${INSTANCE_ID}/sessions/chat/${id}.jsonl`,
        msg
      )
      expect(store.sessions[0].messageCount).toBe(1)
    })

    it('does nothing without active session', async () => {
      setupActiveInstance()
      const store = useChatStore()

      await store.appendMessage(makeMessage())
      expect(localStorageService.appendJsonl).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Hydration
  // -----------------------------------------------------------------------
  describe('hydrate', () => {
    it('loads sessions and messages from storage', async () => {
      setupActiveInstance()
      const store = useChatStore()

      const sessionMeta: ChatSessionMeta[] = [
        { id: 's1', title: 'Session 1', createdAt: '2026-03-14T10:00:00Z', updatedAt: '2026-03-14T11:00:00Z', messageCount: 2 },
      ]
      const msgs: SessionMessage[] = [
        makeMessage({ id: 'msg_1' }),
        makeMessage({ id: 'msg_2', role: 'assistant', content: 'hi' }),
      ]

      vi.mocked(localStorageService.readJson).mockResolvedValueOnce(sessionMeta)
      vi.mocked(localStorageService.readJsonl).mockResolvedValueOnce(msgs)

      await store.hydrate()

      expect(store.sessions).toEqual(sessionMeta)
      expect(store.messagesBySession.get('s1')).toEqual(msgs)
      expect(store.activeSessionId).toBe('s1')
    })

    it('handles empty storage', async () => {
      setupActiveInstance()
      const store = useChatStore()

      vi.mocked(localStorageService.readJson).mockResolvedValueOnce(null)

      await store.hydrate()

      expect(store.sessions).toEqual([])
      expect(store.activeSessionId).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Server sync
  // -----------------------------------------------------------------------
  describe('syncWithServer', () => {
    it('updates existing sessions by serverSessionId', async () => {
      setupActiveInstance()
      const store = useChatStore()
      await store.createSession('Local')
      store.sessions[0].serverSessionId = 'server_1'

      await store.syncWithServer([
        {
          id: 'new_id',
          serverSessionId: 'server_1',
          title: 'Updated Title',
          createdAt: '2026-03-14T10:00:00Z',
          updatedAt: '2026-03-14T12:00:00Z',
          messageCount: 5,
          agentId: 'agent_x',
          agentName: 'Agent X',
        },
      ])

      expect(store.sessions[0].title).toBe('Updated Title')
      expect(store.sessions[0].agentId).toBe('agent_x')
      expect(store.sessions[0].syncedAt).toBeDefined()
    })

    it('adds new server sessions not found locally', async () => {
      setupActiveInstance()
      const store = useChatStore()

      await store.syncWithServer([
        {
          id: 'server_new',
          title: 'From Server',
          createdAt: '2026-03-14T10:00:00Z',
          updatedAt: '2026-03-14T10:00:00Z',
          messageCount: 0,
        },
      ])

      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0].id).toBe('server_new')
      expect(store.messagesBySession.get('server_new')).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // Stream event handlers
  // -----------------------------------------------------------------------
  describe('handleStreamBegin', () => {
    it('creates stream state and placeholder message', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const sessionId = await store.createSession('Test')

      const event: ChatHubStreamBegin = {
        type: 'chatHubStreamBegin',
        data: {
          ...makeStreamMeta(sessionId, 'msg_ai_1'),
          previousMessageId: null,
          retryOfMessageId: null,
          executionId: null,
        },
      }

      store.handleStreamBegin(event)

      const stream = store.getStreamState(sessionId)
      expect(stream).toBeDefined()
      expect(stream!.isStreaming).toBe(true)
      expect(stream!.buffer).toBe('')

      const msgs = store.messagesBySession.get(sessionId)!
      expect(msgs).toHaveLength(1)
      expect(msgs[0].id).toBe('msg_ai_1')
      expect(msgs[0].role).toBe('assistant')
      expect(msgs[0].content).toBe('')
    })
  })

  describe('handleStreamChunk', () => {
    it('accumulates content in buffer and updates message', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const sessionId = await store.createSession('Test')

      store.handleStreamBegin({
        type: 'chatHubStreamBegin',
        data: { ...makeStreamMeta(sessionId, 'msg_ai_1'), previousMessageId: null, retryOfMessageId: null, executionId: null },
      })

      store.handleStreamChunk({
        type: 'chatHubStreamChunk',
        data: { ...makeStreamMeta(sessionId, 'msg_ai_1', 2), content: 'Hello ' },
      })
      store.handleStreamChunk({
        type: 'chatHubStreamChunk',
        data: { ...makeStreamMeta(sessionId, 'msg_ai_1', 3), content: 'world!' },
      })

      const msgs = store.messagesBySession.get(sessionId)!
      expect(msgs[0].content).toBe('Hello world!')
      expect(store.getStreamState(sessionId)!.sequenceNumber).toBe(3)
    })

    it('ignores chunks for unknown sessions', () => {
      const store = useChatStore()
      // Should not throw
      store.handleStreamChunk({
        type: 'chatHubStreamChunk',
        data: { ...makeStreamMeta('unknown', 'msg_1'), content: 'data' },
      })
    })
  })

  describe('handleStreamEnd', () => {
    it('finalizes stream and persists message', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const sessionId = await store.createSession('Test')

      store.handleStreamBegin({
        type: 'chatHubStreamBegin',
        data: { ...makeStreamMeta(sessionId, 'msg_ai_1'), previousMessageId: null, retryOfMessageId: null, executionId: null },
      })
      store.handleStreamChunk({
        type: 'chatHubStreamChunk',
        data: { ...makeStreamMeta(sessionId, 'msg_ai_1', 2), content: 'Done' },
      })

      await store.handleStreamEnd({
        type: 'chatHubStreamEnd',
        data: { ...makeStreamMeta(sessionId, 'msg_ai_1', 3), status: 'success' },
      })

      expect(store.getStreamState(sessionId)).toBeUndefined()
      expect(store.isStreaming).toBe(false)
      expect(localStorageService.appendJsonl).toHaveBeenCalled()
      expect(store.sessions[0].lastSequenceNumber).toBe(3)
    })
  })

  describe('handleStreamError', () => {
    it('marks message with error and clears stream', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const sessionId = await store.createSession('Test')

      store.handleStreamBegin({
        type: 'chatHubStreamBegin',
        data: { ...makeStreamMeta(sessionId, 'msg_ai_1'), previousMessageId: null, retryOfMessageId: null, executionId: null },
      })

      store.handleStreamError({
        type: 'chatHubStreamError',
        data: { ...makeStreamMeta(sessionId, 'msg_ai_1', 2), error: 'LLM failed' },
      })

      const msgs = store.messagesBySession.get(sessionId)!
      expect(msgs[0].meta?.error).toBe('LLM failed')
      expect(msgs[0].meta?.status).toBe('error')
      expect(store.getStreamState(sessionId)).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // Other event handlers
  // -----------------------------------------------------------------------
  describe('handleHumanMessageCreated', () => {
    it('adds user message to session', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const sessionId = await store.createSession('Test')

      store.handleHumanMessageCreated({
        type: 'chatHubHumanMessageCreated',
        data: {
          sessionId,
          messageId: 'msg_human_1',
          previousMessageId: null,
          content: 'User said this',
          attachments: [],
          timestamp: Date.now(),
        },
      })

      const msgs = store.messagesBySession.get(sessionId)!
      expect(msgs).toHaveLength(1)
      expect(msgs[0].role).toBe('user')
      expect(msgs[0].content).toBe('User said this')
    })

    it('deduplicates messages by id', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const sessionId = await store.createSession('Test')

      const event: ChatHubHumanMessageCreated = {
        type: 'chatHubHumanMessageCreated',
        data: { sessionId, messageId: 'msg_1', previousMessageId: null, content: 'hi', attachments: [], timestamp: Date.now() },
      }
      store.handleHumanMessageCreated(event)
      store.handleHumanMessageCreated(event)

      expect(store.messagesBySession.get(sessionId)!).toHaveLength(1)
    })
  })

  describe('handleMessageEdited', () => {
    it('updates original message content', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const sessionId = await store.createSession('Test')
      store.messagesBySession.set(sessionId, [makeMessage({ id: 'msg_orig', content: 'old' })])

      store.handleMessageEdited({
        type: 'chatHubMessageEdited',
        data: {
          sessionId,
          revisionOfMessageId: 'msg_orig',
          messageId: 'msg_revised',
          content: 'new content',
          attachments: [],
          timestamp: Date.now(),
        },
      })

      const msgs = store.messagesBySession.get(sessionId)!
      expect(msgs[0].content).toBe('new content')
      expect(msgs[0].meta?.revisedBy).toBe('msg_revised')
    })
  })

  describe('handleExecutionBegin / handleExecutionEnd', () => {
    it('tracks execution state', async () => {
      setupActiveInstance()
      const store = useChatStore()
      const sessionId = await store.createSession('Test')

      store.handleExecutionBegin({ type: 'chatHubExecutionBegin', data: { sessionId, timestamp: Date.now() } })
      expect(store.isExecuting).toBe(true)

      store.handleExecutionEnd({ type: 'chatHubExecutionEnd', data: { sessionId, status: 'success', timestamp: Date.now() } })
      expect(store.isExecuting).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Reset & computed
  // -----------------------------------------------------------------------
  describe('reset', () => {
    it('clears all state', async () => {
      setupActiveInstance()
      const store = useChatStore()
      await store.createSession('Test')
      store.setAgents([{ name: 'Agent' } as never])

      store.reset()

      expect(store.sessions).toEqual([])
      expect(store.activeSessionId).toBeNull()
      expect(store.agents).toEqual([])
      expect(store.messagesBySession.size).toBe(0)
    })
  })

  describe('computed: sortedSessions', () => {
    it('sorts by updatedAt descending', async () => {
      setupActiveInstance()
      const store = useChatStore()
      await store.createSession('Old')
      await store.createSession('New')

      // Manually set updatedAt
      store.sessions[0].updatedAt = '2026-03-14T09:00:00Z'
      store.sessions[1].updatedAt = '2026-03-14T11:00:00Z'

      expect(store.sortedSessions[0].title).toBe('New')
      expect(store.sortedSessions[1].title).toBe('Old')
    })
  })
})
