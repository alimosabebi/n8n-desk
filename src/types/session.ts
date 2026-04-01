/** A folder attached to a session for agent filesystem access. */
export interface AttachedFolder {
  /** Absolute path to the folder on the host filesystem */
  path: string
  /** Display label (typically the folder basename) */
  label: string
  /** Access mode: 'ro' for read-only, 'rw' for read-write */
  mode: 'ro' | 'rw'
}

export interface SessionMeta {
  id: string
  title: string
  agentId?: string
  agentName?: string
  agentIcon?: { type: string; value: string } | null
  createdAt: string
  updatedAt: string
  messageCount: number
  /** Folders attached to this session for agent filesystem access */
  attachedFolders?: AttachedFolder[]
}

export interface ChatSessionMeta extends SessionMeta {
  serverSessionId?: string
  model?: string
  lastSequenceNumber?: number
  syncedAt?: string
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system' | 'thinking'
  content: string
  ts: string
  meta?: Record<string, unknown>
}
