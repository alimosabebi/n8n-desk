import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChatHubStreamService } from '@/services/chathub-stream'

describe('ChatHubStreamService', () => {
  let service: ChatHubStreamService
  let mockOnEvent: ReturnType<typeof vi.fn>
  let mockOnStatus: ReturnType<typeof vi.fn>
  let mockConnect: ReturnType<typeof vi.fn>
  let mockDisconnect: ReturnType<typeof vi.fn>
  let capturedEventHandler: ((raw: string) => void) | null
  let capturedStatusHandler: ((status: string) => void) | null

  beforeEach(() => {
    capturedEventHandler = null
    capturedStatusHandler = null

    mockOnEvent = vi.fn((handler: (raw: string) => void) => {
      capturedEventHandler = handler
    })
    mockOnStatus = vi.fn((handler: (status: string) => void) => {
      capturedStatusHandler = handler
    })
    mockConnect = vi.fn().mockResolvedValue({ success: true })
    mockDisconnect = vi.fn()

    // Mock window.n8nDesk.push
    Object.defineProperty(window, 'n8nDesk', {
      value: {
        push: {
          onEvent: mockOnEvent,
          onStatus: mockOnStatus,
          connect: mockConnect,
          disconnect: mockDisconnect,
        },
      },
      writable: true,
      configurable: true,
    })

    service = new ChatHubStreamService()
  })

  afterEach(() => {
    service.disconnect()
    // Clean up
    delete (window as Record<string, unknown>).n8nDesk
  })

  describe('connect', () => {
    it('calls IPC connect with instanceId and url', async () => {
      await service.connect('inst1', 'https://n8n.example.com')
      expect(mockConnect).toHaveBeenCalledWith('inst1', 'https://n8n.example.com')
    })

    it('registers IPC event and status listeners', async () => {
      await service.connect('inst1', 'https://n8n.example.com')
      expect(mockOnEvent).toHaveBeenCalledWith(expect.any(Function))
      expect(mockOnStatus).toHaveBeenCalledWith(expect.any(Function))
    })

    it('disconnects before reconnecting', async () => {
      await service.connect('inst1', 'https://first.com')
      await service.connect('inst2', 'https://second.com')
      expect(mockDisconnect).toHaveBeenCalled()
    })
  })

  describe('status tracking', () => {
    it('starts as disconnected', () => {
      expect(service.status).toBe('disconnected')
    })

    it('transitions to connected on status event', async () => {
      await service.connect('inst1', 'https://n8n.example.com')
      capturedStatusHandler?.('connected')
      expect(service.status).toBe('connected')
    })

    it('transitions to reconnecting on disconnect status', async () => {
      await service.connect('inst1', 'https://n8n.example.com')
      capturedStatusHandler?.('connected')
      capturedStatusHandler?.('reconnecting')
      expect(service.status).toBe('reconnecting')
    })

    it('notifies status change handlers', async () => {
      const handler = vi.fn()
      service.onStatusChange(handler)
      await service.connect('inst1', 'https://n8n.example.com')
      capturedStatusHandler?.('connected')
      expect(handler).toHaveBeenCalledWith('connected')
    })

    it('unsubscribes status handler on cleanup', async () => {
      const handler = vi.fn()
      const unsub = service.onStatusChange(handler)
      unsub()

      await service.connect('inst1', 'https://n8n.example.com')
      capturedStatusHandler?.('connected')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('event handling', () => {
    it('dispatches ChatHub events to handlers', async () => {
      const handler = vi.fn()
      service.onEvent(handler)
      await service.connect('inst1', 'https://n8n.example.com')

      capturedEventHandler?.(JSON.stringify({ type: 'chatHubStreamChunk', data: { text: 'hi' } }))
      expect(handler).toHaveBeenCalledWith({ type: 'chatHubStreamChunk', data: { text: 'hi' } })
    })

    it('ignores non-ChatHub events', async () => {
      const handler = vi.fn()
      service.onEvent(handler)
      await service.connect('inst1', 'https://n8n.example.com')

      capturedEventHandler?.(JSON.stringify({ type: 'workflowActivated', data: {} }))
      expect(handler).not.toHaveBeenCalled()
    })

    it('ignores invalid JSON', async () => {
      const handler = vi.fn()
      service.onEvent(handler)
      await service.connect('inst1', 'https://n8n.example.com')

      capturedEventHandler?.('not json{')
      expect(handler).not.toHaveBeenCalled()
    })

    it('unsubscribes event handler', async () => {
      const handler = vi.fn()
      const unsub = service.onEvent(handler)
      unsub()

      await service.connect('inst1', 'https://n8n.example.com')
      capturedEventHandler?.(JSON.stringify({ type: 'chatHubStreamChunk', data: {} }))
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('cleans up and sets status to disconnected', async () => {
      await service.connect('inst1', 'https://n8n.example.com')
      capturedStatusHandler?.('connected')

      service.disconnect()
      expect(mockDisconnect).toHaveBeenCalled()
      expect(service.status).toBe('disconnected')
    })
  })
})
