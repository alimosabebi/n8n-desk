import { N8nApiClient } from '@/services/n8n-api'
import type {
  ChatModelsResponse,
  ChatHubConversationsResponse,
  ChatHubConversationResponse,
  ChatSendMessageResponse,
  ChatReconnectResponse,
  ChatHubSessionDto,
  ChatSessionId,
  ChatMessageId,
  ChatHubConversationModel,
  ChatAttachment,
} from '@/types/chathub'
import {
  CHAT_HUB_LLM_PROVIDERS,
  CHAT_HUB_PROVIDERS,
  PROVIDER_CREDENTIAL_TYPE_MAP,
} from '@/types/chathub'

/** Minimal credential info returned by n8n's REST API. */
interface N8nCredentialSummary {
  id: string
  name: string
  type: string
  createdAt: string
  updatedAt: string
}

/**
 * Credentials resolved per LLM provider.
 * Used internally to build the two different credential formats n8n expects.
 */
export interface ResolvedCredentials {
  /** For getModels: Record<providerName, credentialId | null> */
  byProvider: Record<string, string | null>
  /** For sendMessage: Record<credentialType, { id, name }> */
  byType: Record<string, { id: string; name: string }>
}

/**
 * Chat-Hub REST API service.
 * All calls route through N8nApiClient (which uses cookie auth for /chat/* endpoints).
 */
export class ChatHubService {
  constructor(private readonly api: N8nApiClient) {}

  /**
   * Fetch the user's credentials and build both credential map formats.
   * - byProvider: for `POST /chat/models` (Record<provider, credentialId | null>)
   * - byType: for `POST /chat/conversations/send` (Record<credType, { id, name }>)
   */
  async buildCredentialsMap(): Promise<ResolvedCredentials> {
    const byProvider: Record<string, string | null> = {}
    const byType: Record<string, { id: string; name: string }> = {}

    // Start with all providers set to null
    for (const provider of CHAT_HUB_PROVIDERS) {
      byProvider[provider] = null
    }

    try {
      const creds = await this.api.get<unknown>('/rest/credentials')
      console.log('[n8n-desk] GET /rest/credentials raw response:', JSON.stringify(creds).slice(0, 500))

      // n8n may return { data: [...] } or just [...]
      let credList: N8nCredentialSummary[]
      if (Array.isArray(creds)) {
        credList = creds
      } else if (creds && typeof creds === 'object' && 'data' in creds && Array.isArray((creds as { data: unknown }).data)) {
        credList = (creds as { data: N8nCredentialSummary[] }).data
      } else {
        console.warn('[n8n-desk] Unexpected credentials response shape:', typeof creds)
        credList = []
      }

      console.log('[n8n-desk] Found', credList.length, 'credentials:', credList.map((c) => `${c.type}:${c.id}:${c.name}`))

      // Group credentials by type
      const credsByType = new Map<string, N8nCredentialSummary[]>()
      for (const cred of credList) {
        const list = credsByType.get(cred.type) ?? []
        list.push(cred)
        credsByType.set(cred.type, list)
      }

      // Map each LLM provider to its most recently created credential
      for (const provider of CHAT_HUB_LLM_PROVIDERS) {
        const credType = PROVIDER_CREDENTIAL_TYPE_MAP[provider]
        const matching = credsByType.get(credType)
        if (matching?.length) {
          matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          const best = matching[0]
          byProvider[provider] = best.id
          byType[credType] = { id: best.id, name: best.name }
        }
      }
    } catch (err) {
      console.error('[n8n-desk] Failed to fetch credentials:', err)
    }

    console.log('[n8n-desk] byProvider:', JSON.stringify(byProvider))
    console.log('[n8n-desk] byType:', JSON.stringify(byType))
    return { byProvider, byType }
  }

  /** Fetch available chat models and agents. */
  async getModels(credentials?: Record<string, string | null>): Promise<ChatModelsResponse> {
    return this.api.post<ChatModelsResponse>('/rest/chat/models', {
      credentials: credentials ?? {},
    })
  }

  /** List conversation sessions with cursor-based pagination. */
  async listSessions(params?: {
    cursor?: string
    limit?: number
  }): Promise<ChatHubConversationsResponse> {
    const query = new URLSearchParams()
    if (params?.cursor) query.set('cursor', params.cursor)
    if (params?.limit) query.set('limit', String(params.limit))
    const qs = query.toString()
    return this.api.get<ChatHubConversationsResponse>(
      `/rest/chat/conversations${qs ? `?${qs}` : ''}`,
    )
  }

  /** Get a single conversation with all messages. */
  async getSession(sessionId: ChatSessionId): Promise<ChatHubConversationResponse> {
    return this.api.get<ChatHubConversationResponse>(
      `/rest/chat/conversations/${encodeURIComponent(sessionId)}`,
    )
  }

  /** Send a new message in a conversation (creates session if needed). */
  async sendMessage(params: {
    sessionId: ChatSessionId
    messageId: ChatMessageId
    message: string
    model: ChatHubConversationModel
    previousMessageId?: ChatMessageId
    attachments?: ChatAttachment[]
    agentName?: string
    credentials?: Record<string, { id: string; name: string }>
  }): Promise<ChatSendMessageResponse> {
    const payload = {
      sessionId: params.sessionId,
      messageId: params.messageId,
      message: params.message,
      model: params.model,
      previousMessageId: params.previousMessageId ?? null,
      credentials: params.credentials ?? {},
      attachments: params.attachments ?? [],
      agentName: params.agentName,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
    console.log('[n8n-desk] sendMessage payload:', JSON.stringify(payload, null, 2))
    return this.api.post<ChatSendMessageResponse>(
      '/rest/chat/conversations/send',
      payload,
    )
  }

  /** Edit a previously sent user message and regenerate the response. */
  async editMessage(params: {
    sessionId: ChatSessionId
    messageId: ChatMessageId
    message: string
    model: ChatHubConversationModel
    attachments?: ChatAttachment[]
    credentials?: Record<string, { id: string; name: string }>
  }): Promise<ChatSendMessageResponse> {
    return this.api.post<ChatSendMessageResponse>(
      `/rest/chat/conversations/${encodeURIComponent(params.sessionId)}/messages/${encodeURIComponent(params.messageId)}/edit`,
      {
        message: params.message,
        model: params.model,
        credentials: params.credentials ?? {},
        newAttachments: params.attachments ?? [],
        keepAttachmentIndices: [],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    )
  }

  /** Regenerate an AI response from a specific message. */
  async regenerateMessage(params: {
    sessionId: ChatSessionId
    messageId: ChatMessageId
    model: ChatHubConversationModel
    credentials?: Record<string, { id: string; name: string }>
  }): Promise<ChatSendMessageResponse> {
    return this.api.post<ChatSendMessageResponse>(
      `/rest/chat/conversations/${encodeURIComponent(params.sessionId)}/messages/${encodeURIComponent(params.messageId)}/regenerate`,
      {
        model: params.model,
        credentials: params.credentials ?? {},
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    )
  }

  /** Stop an in-progress AI generation. */
  async stopGeneration(sessionId: ChatSessionId, messageId: ChatMessageId): Promise<void> {
    await this.api.post(
      `/rest/chat/conversations/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/stop`,
    )
  }

  /** Update session metadata (e.g. title). */
  async updateSession(
    sessionId: ChatSessionId,
    updates: Partial<Pick<ChatHubSessionDto, 'title'>>,
  ): Promise<ChatHubSessionDto> {
    return this.api.patch<ChatHubSessionDto>(
      `/rest/chat/conversations/${encodeURIComponent(sessionId)}`,
      updates,
    )
  }

  /** Delete a conversation session. */
  async deleteSession(sessionId: ChatSessionId): Promise<void> {
    await this.api.delete(
      `/rest/chat/conversations/${encodeURIComponent(sessionId)}`,
    )
  }

  /** Reconnect to an active stream after a WebSocket disconnect. */
  async reconnect(sessionId: ChatSessionId): Promise<ChatReconnectResponse> {
    return this.api.post<ChatReconnectResponse>(
      `/rest/chat/conversations/${encodeURIComponent(sessionId)}/reconnect`,
    )
  }
}
