// --- MCP Tool Names ---

export type McpToolName =
  | 'search_nodes'
  | 'get_node_types'
  | 'get_suggested_nodes'
  | 'validate_workflow'
  | 'create_workflow'
  | 'update_workflow'
  | 'search_workflows'
  | 'get_workflow_details'
  | 'execute_workflow'
  | 'get_execution'
  | 'publish_workflow'
  | 'unpublish_workflow'
  | 'archive_workflow'

/** Tools that require human-in-the-loop approval */
export const DESTRUCTIVE_TOOLS: McpToolName[] = [
  'execute_workflow',
  'create_workflow',
  'update_workflow',
  'publish_workflow',
  'archive_workflow',
]

// --- Per-Tool Param Types ---

export interface McpToolParams {
  search_nodes: { query: string; limit?: number }
  get_node_types: { nodeTypes: string[] }
  get_suggested_nodes: { category?: string }
  validate_workflow: { code: string }
  create_workflow: { name: string; code: string; tags?: string[] }
  update_workflow: { workflowId: string; code: string; name?: string }
  search_workflows: { query: string; limit?: number; active?: boolean }
  get_workflow_details: { workflowId: string }
  execute_workflow: { workflowId: string; inputData?: Record<string, unknown> }
  get_execution: { executionId: string }
  publish_workflow: { workflowId: string }
  unpublish_workflow: { workflowId: string }
  archive_workflow: { workflowId: string }
}

// --- Per-Tool Response Data Types ---

export interface NodeSearchResult {
  name: string
  displayName: string
  description: string
  group: string[]
}

export interface WorkflowSummary {
  id: string
  name: string
  active: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface WorkflowDetail extends WorkflowSummary {
  nodes: Record<string, unknown>[]
  connections: Record<string, unknown>
  settings?: Record<string, unknown>
}

export interface ExecutionResult {
  executionId: string
  status: 'success' | 'error' | 'waiting' | 'running'
  data?: unknown
  error?: string
  startedAt: string
  finishedAt?: string
}

export interface ValidationResult {
  valid: boolean
  errors?: string[]
}

export interface McpToolData {
  search_nodes: NodeSearchResult[]
  get_node_types: Record<string, unknown>[]
  get_suggested_nodes: NodeSearchResult[]
  validate_workflow: ValidationResult
  create_workflow: WorkflowDetail
  update_workflow: WorkflowDetail
  search_workflows: WorkflowSummary[]
  get_workflow_details: WorkflowDetail
  execute_workflow: ExecutionResult
  get_execution: ExecutionResult
  publish_workflow: { workflowId: string; active: boolean }
  unpublish_workflow: { workflowId: string; active: boolean }
  archive_workflow: { workflowId: string; archived: boolean }
}

// --- Tool Request/Response ---

export interface McpToolRequest<T extends McpToolName = McpToolName> {
  tool: T
  params: McpToolParams[T]
}

export interface McpToolResponse<T extends McpToolName = McpToolName> {
  success: boolean
  data?: McpToolData[T]
  error?: string
}
