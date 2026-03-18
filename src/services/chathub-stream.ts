import type { ConnectionStatus } from '@/types/connection'
import type { ChatHubPushMessage } from '@/types/chathub'

/**
 * Known Chat-Hub push event type prefixes.
 * Used to filter out non-ChatHub events from the shared /rest/push channel.
 */
const CHATHUB_EVENT_TYPES = new Set([
  'chatHubStreamBegin',
  'chatHubStreamChunk',
  'chatHubStreamEnd',
  'chatHubStreamError',
  'chatHubHumanMessageCreated',
  'chatHubMessageEdited',
  'chatHubExecutionBegin',
  'chatHubExecutionEnd',
])

/** Raw push envelope from n8n's /rest/push endpoint */
interface PushEnvelope {
  type: string
  data: unknown
}

type ChatHubEventHandler = (event: ChatHubPushMessage) => void
type StatusChangeHandler = (status: ConnectionStatus) => void

/**
 * Manages the push connection to n8n via the Electron main-process proxy.
 *
 * In Electron: uses IPC push:connect/push:event (main process opens the WebSocket
 * with the Cookie header — no CORS/SameSite issues).
 *
 * In browser dev (no Electron): falls back to direct WebSocket from the renderer.
 */
export class ChatHubStreamService {
  private eventHandlers: ChatHubEventHandler[] = []
  private statusHandlers: StatusChangeHandler[] = []
  private _status: ConnectionStatus = 'disconnected'
  private ipcListenersRegistered = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private instanceId = ''
  private instanceUrl = ''

  get status(): ConnectionStatus {
    return this._status
  }

  /**
   * Connect to a n8n instance's push endpoint.
   */
  async connect(instanceId: string, instanceUrl: string): Promise<void> {
    this.disconnect()
    this.instanceId = instanceId
    this.instanceUrl = instanceUrl

    if (window.n8nDesk?.push) {
      await this.connectViaIpc(instanceId, instanceUrl)
    }
  }

  /** Disconnect and clean up all resources. */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      window.n8nDesk?.push?.disconnect()
    } catch {
      // Bridge not available yet
    }
    this.setStatus('disconnected')
  }

  /** Register a handler for Chat-Hub push events. */
  onEvent(handler: ChatHubEventHandler): () => void {
    this.eventHandlers.push(handler)
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler)
    }
  }

  /** Register a handler for connection status changes. */
  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusHandlers.push(handler)
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler)
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status === status) return
    this._status = status
    for (const handler of this.statusHandlers) {
      handler(status)
    }
  }

  private async connectViaIpc(instanceId: string, instanceUrl: string): Promise<void> {
    // Register IPC listeners once
    if (!this.ipcListenersRegistered) {
      this.ipcListenersRegistered = true

      window.n8nDesk!.push.onEvent((raw: string) => {
        this.handleRawMessage(raw)
      })

      window.n8nDesk!.push.onStatus((status: string) => {
        if (status === 'connected') {
          this.setStatus('connected')
        } else if (status === 'disconnected') {
          this.setStatus('disconnected')
          // Auto-reconnect after 3 seconds
          this.scheduleReconnect()
        } else if (status === 'reconnecting') {
          this.setStatus('reconnecting')
        }
      })
    }

    const result = await window.n8nDesk!.push.connect(instanceId, instanceUrl)

    if (!result.success) {
      this.setStatus('disconnected')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    if (!this.instanceId || !this.instanceUrl) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connectViaIpc(this.instanceId, this.instanceUrl)
    }, 3000)
  }

  private handleRawMessage(raw: string): void {
    let envelope: PushEnvelope
    try {
      envelope = JSON.parse(raw) as PushEnvelope
    } catch {
      return
    }

    if (!CHATHUB_EVENT_TYPES.has(envelope.type)) return

    const pushMessage = envelope as unknown as ChatHubPushMessage
    for (const handler of this.eventHandlers) {
      handler(pushMessage)
    }
  }
}
