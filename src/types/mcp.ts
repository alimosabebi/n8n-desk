export interface McpToolRequest {
  tool: string
  params: Record<string, unknown>
}

export interface McpToolResponse {
  success: boolean
  data?: unknown
  error?: string
}
