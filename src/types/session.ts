export interface SessionMeta {
  id: string
  title: string
  agentId?: string
  agentName?: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  ts: string
  meta?: Record<string, unknown>
}
