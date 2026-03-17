import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatHubService } from '@/services/chathub'
import type { N8nApiClient } from '@/services/n8n-api'

function createMockApi(): N8nApiClient {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
  } as unknown as N8nApiClient
}

describe('ChatHubService', () => {
  let api: ReturnType<typeof createMockApi>
  let service: ChatHubService

  beforeEach(() => {
    api = createMockApi()
    service = new ChatHubService(api)
  })

  describe('getModels', () => {
    it('calls GET /chat/models', async () => {
      const mockResponse = { models: [], agents: [] }
      vi.mocked(api.get).mockResolvedValue(mockResponse)

      const result = await service.getModels()

      expect(api.get).toHaveBeenCalledWith('/chat/models')
      expect(result).toEqual(mockResponse)
    })
  })

  describe('listSessions', () => {
    it('calls GET /chat/conversations without params', async () => {
      await service.listSessions()
      expect(api.get).toHaveBeenCalledWith('/chat/conversations')
    })

    it('appends cursor and limit as query params', async () => {
      await service.listSessions({ cursor: 'abc', limit: 10 })
      expect(api.get).toHaveBeenCalledWith('/chat/conversations?cursor=abc&limit=10')
    })

    it('appends only cursor when limit is omitted', async () => {
      await service.listSessions({ cursor: 'xyz' })
      expect(api.get).toHaveBeenCalledWith('/chat/conversations?cursor=xyz')
    })
  })

  describe('getSession', () => {
    it('calls GET with encoded session ID', async () => {
      await service.getSession('session/123')
      expect(api.get).toHaveBeenCalledWith('/chat/conversations/session%2F123')
    })
  })

  describe('sendMessage', () => {
    it('posts message with required fields', async () => {
      await service.sendMessage({
        sessionId: 's1',
        message: 'hello',
        model: { provider: 'openai', model: 'gpt-4.1' } as never,
      })

      expect(api.post).toHaveBeenCalledWith('/chat/conversations/s1/send', {
        message: 'hello',
        model: { provider: 'openai', model: 'gpt-4.1' },
        previousMessageId: null,
        attachments: [],
      })
    })

    it('includes previousMessageId and attachments when provided', async () => {
      const attachments = [{ name: 'file.txt', mimeType: 'text/plain', url: 'http://x' }]
      await service.sendMessage({
        sessionId: 's1',
        message: 'hi',
        model: { provider: 'openai', model: 'gpt-4.1' } as never,
        previousMessageId: 'msg-1',
        attachments: attachments as never[],
      })

      expect(api.post).toHaveBeenCalledWith('/chat/conversations/s1/send', expect.objectContaining({
        previousMessageId: 'msg-1',
        attachments,
      }))
    })
  })

  describe('editMessage', () => {
    it('posts to /edit endpoint', async () => {
      await service.editMessage({
        sessionId: 's1',
        messageId: 'msg-1',
        message: 'updated',
        model: { provider: 'anthropic', model: 'claude' } as never,
      })

      expect(api.post).toHaveBeenCalledWith('/chat/conversations/s1/edit', {
        messageId: 'msg-1',
        message: 'updated',
        model: { provider: 'anthropic', model: 'claude' },
        attachments: [],
      })
    })
  })

  describe('regenerateMessage', () => {
    it('posts to /regenerate endpoint', async () => {
      await service.regenerateMessage({
        sessionId: 's1',
        messageId: 'msg-1',
        model: { provider: 'openai', model: 'gpt-4.1' } as never,
      })

      expect(api.post).toHaveBeenCalledWith('/chat/conversations/s1/regenerate', {
        messageId: 'msg-1',
        model: { provider: 'openai', model: 'gpt-4.1' },
      })
    })
  })

  describe('stopGeneration', () => {
    it('posts to /stop endpoint with no body', async () => {
      await service.stopGeneration('s1')
      expect(api.post).toHaveBeenCalledWith('/chat/conversations/s1/stop')
    })
  })

  describe('updateSession', () => {
    it('patches session with title', async () => {
      await service.updateSession('s1', { title: 'New Title' })
      expect(api.patch).toHaveBeenCalledWith('/chat/conversations/s1', { title: 'New Title' })
    })
  })

  describe('deleteSession', () => {
    it('calls DELETE on session', async () => {
      await service.deleteSession('s1')
      expect(api.delete).toHaveBeenCalledWith('/chat/conversations/s1')
    })
  })

  describe('reconnect', () => {
    it('posts to /reconnect endpoint', async () => {
      await service.reconnect('s1')
      expect(api.post).toHaveBeenCalledWith('/chat/conversations/s1/reconnect')
    })
  })
})
