export interface AgentEvent {
  type: 'text_chunk' | 'tool_call' | 'tool_result' | 'todo_update' | 'error' | 'done'
  sessionId: string
  data: unknown
}

export interface AgentToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: unknown
}
