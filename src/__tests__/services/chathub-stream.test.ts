import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChatHubStreamService } from '@/services/chathub-stream'

// Mock reconnecting-websocket
const mockWsInstance = {
  binaryType: '' as string,
  readyState: WebSocket.OPEN,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  close: vi.fn(),
  send: vi.fn(),
}

vi.mock('reconnecting-websocket', () => ({
  default: vi.fn(() => mockWsInstance),
}))

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })

describe('ChatHubStreamService', () => {
  let service: ChatHubStreamService
  let eventListeners: Record<string, (...args: unknown[]) => void>

  beforeEach(() => {
    vi.useFakeTimers()
    service = new ChatHubStreamService()
    eventListeners = {}

    mockWsInstance.addEventListener.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      eventListeners[event] = handler
    })
    mockWsInstance.removeEventListener.mockReset()
    mockWsInstance.close.mockReset()
    mockWsInstance.send.mockReset()
    mockWsInstance.readyState = WebSocket.OPEN
  })

  afterEach(() => {
    service.disconnect()
    vi.useRealTimers()
  })

  describe('connect', () => {
    it('creates WebSocket and sets binary type', () => {
      service.connect('https://n8n.example.com')
      expect(mockWsInstance.binaryType).toBe('arraybuffer')
    })

    it('registers open/close/error/message listeners', () => {
      service.connect('https://n8n.example.com')
      expect(mockWsInstance.addEventListener).toHaveBeenCalledWith('open', expect.any(Function))
      expect(mockWsInstance.addEventListener).toHaveBeenCalledWith('close', expect.any(Function))
      expect(mockWsInstance.addEventListener).toHaveBeenCalledWith('error', expect.any(Function))
      expect(mockWsInstance.addEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    })

    it('disconnects existing connection before reconnecting', () => {
      service.connect('https://first.com')
      const firstClose = mockWsInstance.close.mock.calls.length

      service.connect('https://second.com')
      expect(mockWsInstance.close).toHaveBeenCalledTimes(firstClose + 1)
    })
  })

  describe('status tracking', () => {
    it('starts as disconnected', () => {
      expect(service.status).toBe('disconnected')
    })

    it('transitions to connected on open', () => {
      service.connect('https://n8n.example.com')
      eventListeners['open']?.()
      expect(service.status).toBe('connected')
    })

    it('transitions to reconnecting on close when ws exists', () => {
      service.connect('https://n8n.example.com')
      eventListeners['open']?.()
      eventListeners['close']?.()
      expect(service.status).toBe('reconnecting')
    })

    it('transitions to reconnecting on error when connected', () => {
      service.connect('https://n8n.example.com')
      eventListeners['open']?.()
      eventListeners['error']?.()
      expect(service.status).toBe('reconnecting')
    })

    it('does not change status on error when not connected', () => {
      service.connect('https://n8n.example.com')
      // status is 'disconnected' initially
      eventListeners['error']?.()
      expect(service.status).toBe('disconnected')
    })

    it('notifies status change handlers', () => {
      const handler = vi.fn()
      service.onStatusChange(handler)
      service.connect('https://n8n.example.com')
      eventListeners['open']?.()

      expect(handler).toHaveBeenCalledWith('connected')
    })

    it('unsubscribes status handler on cleanup', () => {
      const handler = vi.fn()
      const unsub = service.onStatusChange(handler)
      unsub()

      service.connect('https://n8n.example.com')
      eventListeners['open']?.()
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('event handling', () => {
    it('dispatches ChatHub events to handlers', () => {
      const handler = vi.fn()
      service.onEvent(handler)
      service.connect('https://n8n.example.com')

      const messageEvent = {
        data: JSON.stringify({ type: 'chatHubStreamChunk', data: { text: 'hi' } }),
      }
      eventListeners['message']?.(messageEvent)

      expect(handler).toHaveBeenCalledWith({ type: 'chatHubStreamChunk', data: { text: 'hi' } })
    })

    it('ignores non-ChatHub events', () => {
      const handler = vi.fn()
      service.onEvent(handler)
      service.connect('https://n8n.example.com')

      eventListeners['message']?.({
        data: JSON.stringify({ type: 'workflowActivated', data: {} }),
      })

      expect(handler).not.toHaveBeenCalled()
    })

    it('handles ArrayBuffer messages', () => {
      const handler = vi.fn()
      service.onEvent(handler)
      service.connect('https://n8n.example.com')

      const encoder = new TextEncoder()
      const encoded = encoder.encode(JSON.stringify({ type: 'chatHubStreamEnd', data: {} }))
      // Create a proper ArrayBuffer copy (jsdom compatibility)
      const ab = new ArrayBuffer(encoded.byteLength)
      new Uint8Array(ab).set(encoded)

      eventListeners['message']?.({ data: ab })
      expect(handler).toHaveBeenCalledWith({ type: 'chatHubStreamEnd', data: {} })
    })

    it('ignores invalid JSON', () => {
      const handler = vi.fn()
      service.onEvent(handler)
      service.connect('https://n8n.example.com')

      eventListeners['message']?.({ data: 'not json{' })
      expect(handler).not.toHaveBeenCalled()
    })

    it('ignores non-string non-ArrayBuffer data', () => {
      const handler = vi.fn()
      service.onEvent(handler)
      service.connect('https://n8n.example.com')

      eventListeners['message']?.({ data: 12345 })
      expect(handler).not.toHaveBeenCalled()
    })

    it('unsubscribes event handler', () => {
      const handler = vi.fn()
      const unsub = service.onEvent(handler)
      unsub()

      service.connect('https://n8n.example.com')
      eventListeners['message']?.({
        data: JSON.stringify({ type: 'chatHubStreamChunk', data: {} }),
      })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('heartbeat', () => {
    it('sends heartbeat every 30s when connected', () => {
      service.connect('https://n8n.example.com')
      eventListeners['open']?.()

      vi.advanceTimersByTime(30000)
      expect(mockWsInstance.send).toHaveBeenCalledWith(JSON.stringify({ type: 'heartbeat' }))

      vi.advanceTimersByTime(30000)
      expect(mockWsInstance.send).toHaveBeenCalledTimes(2)
    })

    it('does not send heartbeat when readyState is not OPEN', () => {
      service.connect('https://n8n.example.com')
      eventListeners['open']?.()

      mockWsInstance.readyState = WebSocket.CLOSED
      vi.advanceTimersByTime(30000)
      expect(mockWsInstance.send).not.toHaveBeenCalled()
    })

    it('stops heartbeat on close', () => {
      service.connect('https://n8n.example.com')
      eventListeners['open']?.()

      eventListeners['close']?.()
      mockWsInstance.send.mockReset()

      vi.advanceTimersByTime(60000)
      expect(mockWsInstance.send).not.toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('cleans up ws and sets status to disconnected', () => {
      service.connect('https://n8n.example.com')
      eventListeners['open']?.()

      service.disconnect()
      expect(mockWsInstance.close).toHaveBeenCalled()
      expect(service.status).toBe('disconnected')
    })
  })
})
