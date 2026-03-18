# PRD: Phase 4 — Workflow Mode

## Overview

Implement the Workflow Mode experience: a local AI agent that can search, create, edit, validate, execute, publish, and manage n8n workflows through natural language conversation. The agent connects to n8n's MCP server via the MCP protocol client, wraps 13 workflow tools, and streams responses to a split-panel UI with an inline workflow preview. Users choose between two agent backends — **Claude Agent SDK** (best experience, Anthropic-only) or **Deep Agents** (BYOM: Anthropic, OpenAI, Ollama) — configurable in a new Settings > AI/Agent page.

**Auth architecture:** Workflow mode uses the **MCP OAuth bearer token** from Phase 2's OAuth flow. All MCP tool calls go to `/mcp-server/http` with `Authorization: Bearer` header. This requires `global:member` or higher role (chatUsers cannot use Workflow mode). The agent runs in Electron's main process (Node.js environment), streams events to the Vue renderer via IPC.

## Problem Statement

After Phase 3, users can chat with Workflow Agents and LLM models via Chat-Hub — but they cannot create, modify, or manage workflows from within n8n-desk. To build or edit a workflow, they must switch to n8n's browser-based editor. Workflow mode enables a conversational workflow builder that leverages n8n's full MCP tool suite, making n8n-desk a complete automation companion rather than just a chat client.

Additionally, the app has no local agent infrastructure — the `electron/ipc/agent.ts` handlers are stubs, no agent SDK is installed, and there is no LLM provider configuration. This phase builds the entire agent execution pipeline from scratch.

## Goals

- Users can create n8n workflows through natural language conversation ("Build me a workflow that checks Gmail every hour and posts new emails to Slack")
- Users can search, inspect, modify, execute, publish, and archive existing workflows conversationally
- Agent discovers n8n nodes via `search_workflow_nodes`, `get_workflow_node_types`, and `get_suggested_workflow_nodes` to build correct workflow code
- Agent validates workflow code before creating/updating (`validate_workflow_code`)
- **Every workflow JSON** from MCP tool results renders as an interactive `<n8n-demo>` preview — inline in the chat stream, click-to-interact, inspectable with code view. This is the primary way users "see" workflows in n8n-desk (see `WORKFLOW_EMBED.md`)
- Workflow previews appear in **two places**: inline in chat messages (compact, `clicktointeract="true"`) and in the side panel (larger, persistent, updated on each workflow-related tool result)
- Diff mode (`mode="diff"`) shows before/after when the agent modifies an existing workflow
- Two selectable agent backends: Claude Agent SDK (Anthropic-native) and Deep Agents (multi-provider)
- Multi-provider LLM configuration in Settings: Anthropic, OpenAI, Ollama (local)
- Destructive operations (create, update, publish, archive, execute) require user approval via inline cards
- Agent streams text, tool calls, and results in real-time to the chat panel
- Session history persists locally in JSONL at `~/.n8n-desk/instances/{id}/sessions/workflow/`
- Agent sessions survive app restarts (resume from JSONL history)
- Works on desktop (Electron) only — Workflow mode is not available on mobile (requires local agent + Node.js)

## Non-Goals

- No Cowork mode implementation (future phase — shares the agent infrastructure but with different tools)
- No visual workflow editor or canvas — this is conversational, not drag-and-drop
- No agent execution on mobile (Capacitor) — agent requires Electron main process
- No multi-agent orchestration (single agent per session)
- No background/autonomous agent execution — agent runs only when the user sends a message
- No workflow versioning history (diff view is supported for before/after on a single update, but no multi-version timeline)
- No custom tool definitions beyond the 13 MCP tools
- No agent memory across sessions (each session is independent, no shared context)

## Technical Design

### Data Model Changes

**Expand `src/types/agent.ts`** — Strongly type `AgentEvent` as a discriminated union:

```ts
// Agent event stream — emitted from main process to renderer via IPC
type AgentEvent =
  | { type: 'text_chunk'; sessionId: string; data: { content: string } }
  | { type: 'tool_call'; sessionId: string; data: AgentToolCall }
  | { type: 'tool_result'; sessionId: string; data: { callId: string; result: unknown; status: 'completed' | 'failed'; error?: string } }
  | { type: 'approval_required'; sessionId: string; data: { callId: string; toolName: McpToolName; args: Record<string, unknown>; description: string } }
  | { type: 'workflow_preview'; sessionId: string; data: WorkflowPreviewData }
  | { type: 'todo_update'; sessionId: string; data: { todos: AgentTodo[] } }
  | { type: 'error'; sessionId: string; data: { message: string; code?: string } }
  | { type: 'done'; sessionId: string; data: Record<string, never> }

interface AgentTodo {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
}

interface AgentToolCall {
  id: string
  name: McpToolName
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval'
  result?: unknown
  error?: string
}

// Workflow JSON as returned by MCP tools (n8n's internal format)
interface WorkflowJson {
  id?: string
  name: string
  nodes: Array<{ id: string; name: string; type: string; position: [number, number]; parameters: Record<string, unknown> }>
  connections: Record<string, unknown>
  active?: boolean
  settings?: Record<string, unknown>
}

// Workflow preview data — supports both single preview and diff comparison
// Every MCP tool result containing workflow JSON triggers this event.
// See WORKFLOW_EMBED.md for <n8n-demo> component API.
interface WorkflowPreviewData {
  workflowJson: WorkflowJson
  workflowBefore?: WorkflowJson        // present when update_workflow returns — enables diff mode
  mode: 'demo' | 'diff'                // 'diff' when workflowBefore is set
  source: McpToolName                   // which tool produced this (e.g., 'get_workflow_details', 'create_workflow_from_code')
  label?: string                        // human-readable label (e.g., "Gmail to Slack Notifier")
}
```

**Expand `src/types/mcp.ts`** — Add typed MCP tool names:

```ts
type McpToolName =
  // Always available
  | 'search_workflows'
  | 'execute_workflow'
  | 'get_execution'
  | 'get_workflow_details'
  | 'publish_workflow'
  | 'unpublish_workflow'
  // Builder mode (N8N_MCP_BUILDER_ENABLED=true)
  | 'search_workflow_nodes'
  | 'get_workflow_node_types'
  | 'get_suggested_workflow_nodes'
  | 'validate_workflow_code'
  | 'create_workflow_from_code'
  | 'update_workflow'
  | 'archive_workflow'

// Tools that require user approval before execution
const DESTRUCTIVE_TOOLS: McpToolName[] = [
  'create_workflow_from_code',
  'update_workflow',
  'publish_workflow',
  'archive_workflow',
  'execute_workflow',
]
```

**Expand `src/types/settings.ts`** — Add LLM configuration types:

```ts
type AgentBackend = 'claude-sdk' | 'deep-agents'
type LlmProvider = 'anthropic' | 'openai' | 'ollama'

interface ClaudeSdkConfig {
  apiKey: string
}

interface DeepAgentsConfig {
  provider: LlmProvider
  apiKey: string       // empty string for Ollama
  model: string        // e.g. "claude-sonnet-4-6", "gpt-4.1", "devstral-2"
  ollamaUrl?: string   // e.g. "http://localhost:11434" — only when provider is 'ollama'
}

interface LlmConfig {
  backend: AgentBackend
  claudeSdk?: ClaudeSdkConfig
  deepAgents?: DeepAgentsConfig
}
```

### Interface Changes

**New: Agent Runner interface** (Electron main process) — Common abstraction over both agent backends:

```ts
// electron/agent/types.ts
interface AgentRunnerConfig {
  llmConfig: LlmConfig
  instanceUrl: string
  getAccessToken: () => string
  onTokenRefreshNeeded: () => Promise<string>
}

interface AgentRunner {
  invoke(sessionId: string, message: string, history?: SessionMessage[]): AsyncIterable<AgentEvent>
  stop(sessionId: string): void
  approve(sessionId: string, decision: 'approve' | 'reject'): void
}
```

**New: MCP Client** (Electron main process) — Wraps `@modelcontextprotocol/sdk` client:

```ts
// electron/mcp-client.ts
class McpClient {
  constructor(instanceUrl: string, getAccessToken: () => string)

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResponse>
  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: object }>>
}
```

**New: Workflow Session Store** (Renderer):

```ts
// src/stores/workflow-sessions.ts
const useWorkflowSessionsStore = defineStore('workflow-sessions', () => {
  const sessions: Ref<SessionMeta[]>
  const activeSessionId: Ref<string | null>
  const messages: Ref<SessionMessage[]>
  const isAgentRunning: Ref<boolean>
  const pendingApproval: Ref<ApprovalRequest | null>
  const workflowPreview: Ref<WorkflowPreviewData | null>
  const toolCalls: Ref<AgentToolCall[]>

  function hydrate(instanceId: string): Promise<void>
  function createSession(title?: string): Promise<string>
  function loadSession(sessionId: string): Promise<void>
  function appendMessage(msg: SessionMessage): Promise<void>
  function deleteSession(sessionId: string): Promise<void>
  function handleAgentEvent(event: AgentEvent): void
  function reset(): void
})
```

**New: Workflow Agent Composable** (Renderer):

```ts
// src/composables/useWorkflowAgent.ts
function useWorkflowAgent() {
  const store = useWorkflowSessionsStore()

  async function sendMessage(text: string): Promise<void>
  function stopAgent(): void
  function approveAction(decision: 'approve' | 'reject'): void

  return {
    messages: computed(() => store.messages),
    isRunning: computed(() => store.isAgentRunning),
    pendingApproval: computed(() => store.pendingApproval),
    workflowPreview: computed(() => store.workflowPreview),
    toolCalls: computed(() => store.toolCalls),
    sendMessage,
    stopAgent,
    approveAction,
  }
}
```

### New Commands / API / UI

**New UI components:**

| Component | Purpose |
|---|---|
| `WorkflowEmbed.vue` | **Core inline embed** — wraps `<n8n-demo>` for rendering workflow JSON anywhere (chat messages, tool results, side panel). Supports demo + diff modes, `clicktointeract`, theme sync. See `WORKFLOW_EMBED.md`. |
| `WorkflowPreviewPanel.vue` | Side panel wrapper — renders `WorkflowEmbed` in a persistent, larger view. Shows the latest workflow from any tool result. |
| `ToolCallCard.vue` | Inline card showing MCP tool call name, args, status. **When the tool result contains workflow JSON, renders a `WorkflowEmbed` inside the card.** |
| `ApprovalCard.vue` | Inline card with Approve/Reject buttons. **Shows a compact `WorkflowEmbed` preview of the workflow about to be created/modified.** |
| `WorkflowChatPanel.vue` | Chat panel: message list with inline workflow embeds + tool cards + input bar |
| `LlmSettings.vue` | Settings section for agent backend selection + API key config |

**Updated views:**

| View | Change |
|---|---|
| `WorkflowView.vue` | Replace placeholder with split-panel: chat (left) + workflow preview (right) |
| `SettingsView.vue` | Add "AI / Agent" section with `LlmSettings` component |
| `WorkflowSidebar.vue` | Replace mock data with real `useWorkflowSessionsStore` |

**New Electron main process modules:**

| Module | Purpose |
|---|---|
| `electron/mcp-client.ts` | MCP protocol client connecting to n8n's `/mcp-server/http` |
| `electron/agent/types.ts` | Shared `AgentRunner` interface and config types |
| `electron/agent/claude-sdk-runner.ts` | Claude Agent SDK implementation |
| `electron/agent/deep-agents-runner.ts` | Deep Agents (LangChain) implementation |
| `electron/agent/tool-definitions.ts` | 13 MCP tools wrapped as LangChain `tool()` definitions |
| `electron/agent/system-prompts.ts` | System prompts for Workflow mode agent |
| `electron/agent/factory.ts` | Factory function to create the correct runner from config |

### Auth Architecture — MCP OAuth Bearer Token

Workflow mode uses the **MCP OAuth bearer token** from Phase 2. This is completely separate from the session cookie used by Chat mode.

**What the MCP bearer token covers:**
| Endpoint | Purpose |
|---|---|
| `POST /mcp-server/http` | All MCP tool calls (13 workflow tools) |

**What the MCP bearer token does NOT cover:**
| Endpoint | Auth needed |
|---|---|
| `/rest/*`, `/chat/*` | `n8n-auth` session cookie (Chat mode only) |
| `/api/v1/*` | `X-N8N-API-KEY` header (not used by n8n-desk) |

**Why `global:member` or higher is required:** The MCP OAuth flow requires the `mcp:oauth` scope, which is only available to `global:member`, `global:admin`, and `global:owner` roles. `chatUser` cannot authenticate for MCP. The UI hides Workflow mode for chatUsers (Phase 2 already detects role via scopes).

**MCP transport details:**
- n8n's MCP server uses **stateless `StreamableHTTPServerTransport`** (from `@modelcontextprotocol/sdk/server/streamableHttp.js`)
- Each POST to `/mcp-server/http` creates a fresh server + transport instance (`sessionIdGenerator: undefined`)
- The MCP client (`@modelcontextprotocol/sdk`) creates a matching `StreamableHTTPClientTransport` per invocation
- No persistent connection, no WebSocket — pure request-response over HTTP
- n8n uses `@modelcontextprotocol/sdk@1.26.0` on the server side

**Token refresh:** If a tool call returns 401, the MCP client signals token refresh needed. The `electron/ipc/auth.ts` `auth:refresh` handler exchanges the refresh token for a new access token (already implemented in Phase 2). The tool call is retried with the new token.

### Inline Workflow Embeds — `<n8n-demo>` Everywhere

**Every workflow JSON that flows through the agent is rendered visually.** This is a core UX principle — users should never see raw JSON; they see interactive workflow canvases. See `WORKFLOW_EMBED.md` for the full `<n8n-demo>` API.

**Which MCP tools produce renderable workflow JSON:**

| Tool | When to render | Mode |
|---|---|---|
| `get_workflow_details` | Agent inspects an existing workflow | `demo` — single preview |
| `search_workflows` | Agent lists workflows (each result has a summary, not full JSON — render on expand/click) | `demo` — compact thumbnails |
| `create_workflow_from_code` | Agent creates a new workflow | `demo` — show the new workflow with `frame="true"` for code view |
| `update_workflow` | Agent modifies an existing workflow | `diff` — show before/after comparison |
| `validate_workflow_code` | Agent validates before saving (if validation returns the parsed workflow) | `demo` — preview of what will be created |
| `execute_workflow` | Agent runs a workflow (show which workflow was executed) | `demo` — execution context |

**Rendering strategy — two contexts:**

1. **Inline in chat messages** (inside `ToolCallCard` or standalone):
   - Compact height (~200px), `clicktointeract="true"` (prevents scroll hijacking)
   - `disableinteractivity="true"` by default, click reveals full interaction
   - `tidyup="true"` for clean auto-layout
   - `collapseformobile="true"` for mobile-friendly behavior
   - User can click to expand to full-size modal or navigate to side panel

2. **Side panel** (persistent `WorkflowPreviewPanel`):
   - Larger canvas, fully interactive
   - `frame="true"` shows code viewer + copy JSON button
   - Updates whenever any workflow-related tool call completes
   - For `update_workflow` results: `mode="diff"` with `workflowbefore` attribute set to the previous version

**Diff mode for updates:**
When `update_workflow` returns, the agent runner captures both the previous workflow JSON (from the `get_workflow_details` call that preceded the update) and the new JSON. The `workflow_preview` event carries both as `WorkflowPreviewData` with `mode: 'diff'`. The `WorkflowEmbed` component passes `workflowbefore` to `<n8n-demo mode="diff">`.

**Performance considerations** (from `WORKFLOW_EMBED.md`):
- `<n8n-demo>` loads an iframe internally — avoid rendering more than 2-3 simultaneously in the chat stream
- Use `IntersectionObserver` (built into the component) for lazy loading — embeds only render when scrolled into view
- For long chat histories with many workflow results, replace off-screen embeds with static placeholder cards ("Click to load workflow preview")

### Two Agent Backends

#### 1. Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

**Best for:** Users with Anthropic API keys who want the best agent experience.

- Uses the `query()` function which returns an `AsyncIterable` of messages
- Has **native MCP support** — pass `mcpServers` config and the SDK handles the MCP protocol internally
- No manual tool wrapping needed — the SDK discovers and calls MCP tools directly
- Built-in context management, streaming, and tool execution loop
- Requires Anthropic API key (stored in `~/.n8n-desk/llm.json`)

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

for await (const message of query({
  prompt: userMessage,
  options: {
    mcpServers: {
      n8n: {
        type: 'http',
        url: `${instanceUrl}/mcp-server/http`,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    },
    allowedTools: ['mcp__n8n__*'],
    systemPrompt: workflowSystemPrompt,
  },
})) {
  // Normalize SDK messages into AgentEvent stream
}
```

**Approval gates for Claude SDK:** The runner intercepts tool call messages. If the tool is in `DESTRUCTIVE_TOOLS`, it emits an `approval_required` event and pauses iteration (via a deferred promise). On `approve()`, it resumes. On `reject()`, it sends a rejection message and continues the agent loop.

#### 2. Deep Agents (`deepagents` v1.8.1)

**Best for:** Users who want model independence (OpenAI, Ollama) or prefer open-source tooling.

- Uses `createDeepAgent()` from the `deepagents` package (built on LangGraph.js)
- MCP tools are wrapped as LangChain `tool()` definitions with Zod schemas
- Each tool calls `mcpClient.callTool()` internally
- Supports any LangChain-compatible model provider
- Uses `StateBackend` (ephemeral) — no filesystem needed for workflow mode
- Uses `MemorySaver` checkpointer + `interruptOn` config for approval gates

```ts
import { createDeepAgent } from 'deepagents'
import { tool } from 'langchain'
import { z } from 'zod'

const searchWorkflowsTool = tool(
  async ({ query }) => {
    const result = await mcpClient.callTool('search_workflows', { query })
    return JSON.stringify(result)
  },
  {
    name: 'search_workflows',
    description: 'Search for n8n workflows by name or description',
    schema: z.object({ query: z.string().describe('Search query') }),
  },
)

const agent = createDeepAgent({
  name: 'n8n-desk-workflow',
  model: `${provider}:${modelName}`,
  tools: [searchWorkflowsTool, /* ... all 13 tools */],
  systemPrompt: workflowSystemPrompt,
  backend: (rt) => new StateBackend(rt),
  checkpointer: new MemorySaver(),
  interruptOn: Object.fromEntries(DESTRUCTIVE_TOOLS.map((t) => [t, true])),
})
```

### Migration Strategy

No data migration needed. This is new functionality:
- Stub views/stores are replaced with real implementations
- New JSONL session directories are created on first use: `~/.n8n-desk/instances/{id}/sessions/workflow/`
- LLM config file created on first save: `~/.n8n-desk/llm.json`
- No existing user data is affected

**Dependency consideration:** New npm packages are added. The Electron main process build may need adjustment for ESM-first packages (`@modelcontextprotocol/sdk`, `@anthropic-ai/claude-agent-sdk`). The existing `scripts/build-electron.mjs` uses tsc which may not bundle ESM deps correctly — may need to switch to esbuild (already a dev dependency).

## Implementation Steps

### Step 1: Install Dependencies

Install new npm packages required for the agent infrastructure:

```bash
npm install @modelcontextprotocol/sdk @anthropic-ai/claude-agent-sdk deepagents langchain @langchain/core zod @n8n_io/n8n-demo-component
```

Verify the Electron main process build still works. If tsc fails on ESM imports from MCP SDK or Claude Agent SDK, switch the electron build to use esbuild bundling (esbuild is already a dev dependency and handles ESM→CJS seamlessly).

**Files:** `package.json`, potentially `scripts/build-electron.mjs`
**Dependencies:** `@modelcontextprotocol/sdk`, `@anthropic-ai/claude-agent-sdk`, `deepagents`, `langchain`, `@langchain/core`, `zod`, `@n8n_io/n8n-demo-component`

### Step 2: Expand Type Definitions

Expand `src/types/agent.ts` with the strongly-typed `AgentEvent` discriminated union, `AgentTodo`, and `WorkflowJson` types. Expand `src/types/mcp.ts` with `McpToolName` union and `DESTRUCTIVE_TOOLS` array. Expand `src/types/settings.ts` with `AgentBackend`, `LlmProvider`, `ClaudeSdkConfig`, `DeepAgentsConfig`, and `LlmConfig` types.

**Files:** `src/types/agent.ts`, `src/types/mcp.ts`, `src/types/settings.ts`

### Step 3: Settings Store — LLM Config Persistence

Add `llmConfig` state to `src/stores/settings.ts`. Add `hydrateLlm()` that reads from `~/.n8n-desk/llm.json` and `saveLlm()` that writes it. The LLM config is a separate file from `config.json` because it may contain API keys and should have restrictive file permissions (`0600` on desktop). On hydrate, if `llm.json` doesn't exist, use sensible defaults (`backend: 'claude-sdk'`, empty API keys).

**Files:** `src/stores/settings.ts`

### Step 4: MCP Client (Electron Main Process)

Create `electron/mcp-client.ts` — a wrapper around `@modelcontextprotocol/sdk`'s client API. The `McpClient` class:

1. Constructor takes `instanceUrl` and a `getAccessToken` callback
2. `callTool(name, args)` method:
   - Creates a `StreamableHTTPClientTransport` pointing to `{instanceUrl}/mcp-server/http`
   - Sets `Authorization: Bearer {token}` in request headers
   - Creates an MCP `Client` instance, connects, sends an `initialize` request, calls the tool, closes transport
   - Returns the structured tool result
   - On 401: signals token refresh needed, retries once with fresh token
3. `listTools()` method: connects and lists available tools (used to detect builder mode availability)

The client is **stateless** — each `callTool` creates a fresh transport because n8n's server creates a fresh instance per request (`sessionIdGenerator: undefined` in `mcp.controller.ts`).

**Files:** `electron/mcp-client.ts`

### Step 5: Agent Runner Interface and Factory

Create `electron/agent/types.ts` with the `AgentRunner` interface and `AgentRunnerConfig`. Create `electron/agent/factory.ts` with a `createAgentRunner(config)` function that reads `config.llmConfig.backend` and instantiates either the Claude SDK runner or the Deep Agents runner.

**Files:** `electron/agent/types.ts`, `electron/agent/factory.ts`

### Step 6: Workflow Mode System Prompts

Create `electron/agent/system-prompts.ts` with the system prompt for Workflow mode. The prompt should instruct the agent on:
- Its role as an n8n workflow automation expert
- The available MCP tools and when to use each
- The workflow building process: search nodes → get types → write code → validate → create
- How to read execution results and suggest fixes
- That destructive operations will be gated by user approval
- How to format responses (use markdown, show workflow names, explain what each tool call does)

Reference the MCP server instructions from `n8n-master/packages/cli/src/modules/mcp/mcp.service.ts` (the `getMcpInstructions()` function) for the canonical tool usage guide.

**Files:** `electron/agent/system-prompts.ts`

### Step 7: Claude Agent SDK Runner

Create `electron/agent/claude-sdk-runner.ts` implementing `AgentRunner`:

1. `invoke()`:
   - Calls `query()` from `@anthropic-ai/claude-agent-sdk` with `mcpServers` config pointing to n8n's MCP endpoint
   - The SDK handles MCP tool discovery and invocation natively — no manual tool wrapping
   - Maps SDK message types to `AgentEvent`:
     - `AssistantMessage` → `text_chunk` events
     - `ToolUseMessage` → `tool_call` event (check if destructive → `approval_required`)
     - `ToolResultMessage` → `tool_result` event (extract workflow JSON → `workflow_preview`)
     - `ResultMessage` → `done` event
     - Errors → `error` event
   - For approval gates: when a tool call targets a destructive tool, emit `approval_required` and wait on a deferred promise. `approve('approve')` resolves it; `approve('reject')` rejects it and sends a rejection context to the SDK
2. `stop()`: Aborts the query via `AbortController`
3. `approve()`: Resolves/rejects the pending approval promise

Track active sessions in a `Map<string, { abort: AbortController; pendingApproval?: DeferredPromise }>`.

**Files:** `electron/agent/claude-sdk-runner.ts`

### Step 8: LangChain Tool Definitions for MCP

Create `electron/agent/tool-definitions.ts` with 13 LangChain `tool()` wrappers — one per MCP tool. Each tool:
- Uses the exact tool name from n8n's MCP server
- Has a Zod input schema matching n8n's tool input schema (reference `n8n-master/packages/cli/src/modules/mcp/tools/` for exact schemas)
- Has a description matching n8n's tool description
- Implementation calls `mcpClient.callTool(name, args)` and returns `JSON.stringify(result)`

The tool definitions are exported as a function `createMcpTools(mcpClient: McpClient)` returning an array of LangChain tools.

**Files:** `electron/agent/tool-definitions.ts`

### Step 9: Deep Agents Runner

Create `electron/agent/deep-agents-runner.ts` implementing `AgentRunner`:

1. `invoke()`:
   - Creates an `McpClient` for the instance
   - Creates LangChain tools via `createMcpTools(mcpClient)`
   - Creates the agent via `createDeepAgent()` with:
     - Model string: `${provider}:${model}` (from LLM config)
     - Tools array from step above
     - System prompt from `system-prompts.ts`
     - `StateBackend` (ephemeral — workflow mode doesn't need filesystem)
     - `MemorySaver` checkpointer
     - `interruptOn` set for all `DESTRUCTIVE_TOOLS`
   - Streams agent events, normalizing to `AgentEvent`:
     - Text chunks → `text_chunk`
     - Tool calls → `tool_call` (interrupted ones → `approval_required`)
     - Tool results → `tool_result` (extract workflow JSON → `workflow_preview`)
     - Todo updates → `todo_update`
     - Completion → `done`
2. `stop()`: Cancels the agent execution
3. `approve()`: Resumes the checkpointed agent with the decision

**Files:** `electron/agent/deep-agents-runner.ts`

### Step 10: IPC Agent Handlers — Replace Stubs

Replace the stub implementation in `electron/ipc/agent.ts` with real agent execution:

**`agent:invoke` handler:**
1. Read LLM config from `~/.n8n-desk/llm.json` (via storage service)
2. Read instance URL and MCP access token from keychain
3. Create an `AgentRunner` via the factory
4. Optionally read session history from JSONL (for context continuity)
5. Iterate the `AsyncIterable<AgentEvent>` from `runner.invoke()`
6. For each event: send to renderer via `mainWindow.webContents.send('agent:event', event)`
7. Also append each event to the session JSONL file (sequential writes, no interleaving)
8. Track the active runner in `Map<string, AgentRunner>`
9. On completion or error: clean up from the active runners map

**`agent:stop` handler:** Call `activeRunners.get(sessionId)?.stop(sessionId)`

**`agent:approve` handler:** Call `activeRunners.get(sessionId)?.approve(sessionId, decision)`

Ensure JSONL writes are sequential — use a write queue or `await` each `appendFile` before the next to prevent interleaved writes during rapid streaming.

**Files:** `electron/ipc/agent.ts`

### Step 11: Workflow Session Store (Renderer)

Create `src/stores/workflow-sessions.ts` — a Pinia store that manages Workflow mode sessions. Follows the same hydration pattern as `src/stores/instances.ts`:

- `sessions` — Reactive array of `SessionMeta` (from `index.json`)
- `activeSessionId` — Currently open session
- `messages` — Array of `SessionMessage` for the active session (from JSONL)
- `isAgentRunning` — Whether the agent is currently processing
- `pendingApproval` — Current approval request (null when none)
- `workflowPreview` — Current workflow JSON for the `<n8n-demo>` panel (null when none)
- `toolCalls` — Active tool calls with their statuses
- `hydrate(instanceId)` — Read `sessions/workflow/index.json` + active session JSONL
- `createSession(title?)` — Generate session ID (`session_{nanoid}`), create JSONL file, update index
- `loadSession(id)` — Read JSONL into `messages` array
- `appendMessage(msg)` — Push to in-memory array + append to JSONL via `localStorageService.appendJsonl`
- `deleteSession(id)` — Move JSONL to `.archive/`, remove from index
- `handleAgentEvent(event)` — Dispatch incoming `AgentEvent` to the appropriate state:
  - `text_chunk` → accumulate into current assistant message
  - `tool_call` → add to `toolCalls`, update status
  - `tool_result` → update tool call status, if result contains workflow JSON → set `workflowPreview`
  - `approval_required` → set `pendingApproval`
  - `workflow_preview` → set `workflowPreview`
  - `todo_update` → update todo state (for agent progress display)
  - `error` → append error message
  - `done` → finalize current message, set `isAgentRunning = false`

**Files:** `src/stores/workflow-sessions.ts`

### Step 12: useWorkflowAgent Composable (Renderer)

Create `src/composables/useWorkflowAgent.ts` — bridges IPC to the Pinia store:

1. `sendMessage(text)`:
   - If no active session, create one via the store
   - Append user message to store
   - Set `isAgentRunning = true`
   - Call `window.n8nDesk.agent.invoke(sessionId, text)`
2. `stopAgent()`: Call `window.n8nDesk.agent.stop(sessionId)`
3. `approveAction(decision)`: Call `window.n8nDesk.agent.approve(sessionId, decision)`, clear `pendingApproval`
4. Set up `window.n8nDesk.agent.onEvent()` listener on mount:
   - Route each `AgentEvent` to `store.handleAgentEvent(event)`
   - Filter events by `sessionId` matching the active session

Returns computed refs from the store: `messages`, `isRunning`, `pendingApproval`, `workflowPreview`, `toolCalls`.

**Files:** `src/composables/useWorkflowAgent.ts`

### Step 13: WorkflowEmbed Component (Core Inline Embed)

Create `src/components/workflow/WorkflowEmbed.vue` — the **core reusable component** for rendering any workflow JSON via `<n8n-demo>`. This is used everywhere: inside tool call cards, approval cards, chat messages, and the side panel. See `WORKFLOW_EMBED.md` for the full `<n8n-demo>` API.

- Props:
  - `workflowJson: WorkflowJson` — the workflow to render (required)
  - `workflowBefore?: WorkflowJson` — previous version for diff mode (optional)
  - `mode: 'demo' | 'diff'` — single preview or before/after comparison (default: `'demo'`)
  - `theme: 'light' | 'dark'` — synced with app theme
  - `compact: boolean` — compact mode for inline chat (default: `false`). When `true`: ~200px height, `clicktointeract="true"`, `disableinteractivity="true"`
  - `showFrame: boolean` — show code viewer + copy JSON button (default: `false`)
  - `label?: string` — optional workflow name displayed above the canvas
- Behavior:
  - Always sets `tidyup="true"` for clean auto-layout
  - In compact mode: `clicktointeract="true"`, `disableinteractivity="true"`, `collapseformobile="true"`
  - In full mode: interactive, `frame` controlled by `showFrame` prop
  - In diff mode: passes `workflowbefore` attribute to `<n8n-demo mode="diff">`
  - Clicking a compact embed emits `expand` event (parent decides whether to open side panel or modal)
- Performance:
  - Uses `IntersectionObserver` to lazy-load — only renders `<n8n-demo>` when scrolled into view
  - Replaces with a static placeholder card when scrolled off-screen (to limit concurrent iframes to ~3)

**Files:** `src/components/workflow/WorkflowEmbed.vue`

### Step 14: WorkflowPreviewPanel Component (Side Panel)

Create `src/components/workflow/WorkflowPreviewPanel.vue` — the persistent side panel that shows the latest workflow:

- Uses `WorkflowEmbed` internally with `compact="false"`, `showFrame="true"`
- Props: `previewData: WorkflowPreviewData | null`, `theme: 'light' | 'dark'`
- When `previewData` is null: show empty state with dot-grid background + "Build a workflow to see it here" hint
- When `previewData` is set: render `WorkflowEmbed` with appropriate mode (`demo` or `diff`)
- Shows workflow name as a header above the embed
- "Open in n8n" link that opens the workflow in the user's n8n instance browser tab (if workflow has an `id`)

**Files:** `src/components/workflow/WorkflowPreviewPanel.vue`

### Step 15: ToolCallCard Component

Create `src/components/workflow/ToolCallCard.vue` — inline card rendered within the message stream when the agent calls an MCP tool:

- Props: `toolCall: AgentToolCall`
- Shows: tool name (human-readable, e.g., "Search Workflows" for `search_workflows`), truncated args preview, status indicator
- Status indicators: spinner (running), checkmark (completed), error icon (failed), clock icon (awaiting approval)
- Expandable: click to toggle full args and result display
- **When the tool result contains workflow JSON** (detected by checking `result.nodes` and `result.connections`): renders a compact `WorkflowEmbed` inside the expanded card. This means every `get_workflow_details`, `create_workflow_from_code`, `update_workflow`, etc. result shows the workflow visually inline.
- Styles: `--n8n-desk--surface-bg` background, subtle border, compact layout

**Files:** `src/components/workflow/ToolCallCard.vue`

### Step 16: ApprovalCard Component

Create `src/components/workflow/ApprovalCard.vue` — inline approval request card:

- Props: `toolName: McpToolName`, `args: Record<string, unknown>`, `description: string`, `workflowPreview?: WorkflowJson`
- Emits: `approve`, `reject`
- Shows: plain-language description of what the agent wants to do (e.g., "The agent wants to create a new workflow: 'Gmail to Slack Notifier'")
- **When `workflowPreview` is provided** (for `create_workflow_from_code`, `update_workflow`): renders a compact `WorkflowEmbed` showing what will be created/modified. For updates, shows diff mode.
- Two action buttons: "Approve" (`--color--primary` background) and "Reject" (outline, danger color)
- Callout-style card with info/warning icon
- After user acts, the card transitions to a read-only "Approved" or "Rejected" state in the history

**Files:** `src/components/workflow/ApprovalCard.vue`

### Step 17: WorkflowChatPanel Component

Create `src/components/workflow/WorkflowChatPanel.vue` — the chat panel for Workflow mode:

- Scrollable message list that renders:
  - User messages (right-aligned or left-aligned with user styling)
  - Assistant text messages with markdown rendering (reuse `MarkdownRenderer` from Phase 3 chat components)
  - `ToolCallCard` components inline where tool calls occurred — **with workflow embeds inside completed tool cards that returned workflow JSON**
  - `ApprovalCard` component inline when approval is pending — **with workflow preview when available**
  - Standalone `WorkflowEmbed` components for `workflow_preview` events not tied to a specific tool card
- Auto-scroll on new messages, with scroll-to-bottom button if user has scrolled up
- Input bar at the bottom:
  - Auto-expanding `<textarea>` (native, not `ion-textarea` — need precise height control)
  - Send button (Cmd/Ctrl+Enter or click)
  - Stop button when agent is running (replaces send button)
  - Disabled state when no LLM config is set (show "Configure AI in Settings" hint)
- "Agent is working..." indicator with subtle animation when `isRunning` is true
- Empty state: "Describe the workflow you want to build" with example prompts

**Files:** `src/components/workflow/WorkflowChatPanel.vue`

### Step 18: WorkflowView — Full Implementation

Replace the placeholder `src/views/WorkflowView.vue` with the full split-panel layout:

- `IonPage` wrapper
- Horizontal split: `WorkflowChatPanel` (left, flex: 1) + `WorkflowPreviewPanel` (right, flex: 1)
- Resizable divider between panels (reuse the `useSidebarResize` pattern from `src/composables/useSidebarResize.ts`)
- Preview panel collapses when no workflow is loaded (chat panel takes full width)
- Preview panel shows/animates in when `workflowPreview` becomes non-null
- Calls `useWorkflowAgent()` composable for all agent interactions
- Passes `workflowPreview` (as `WorkflowPreviewData`) to the `WorkflowPreviewPanel`
- Passes `theme` from `useTheme()` to both chat panel and preview panel
- When user clicks "expand" on a compact inline `WorkflowEmbed` in the chat, scroll the side panel to show that workflow
- No header — the header is handled by the parent `MenuLayout.vue`

**Files:** `src/views/WorkflowView.vue`

### Step 19: WorkflowSidebar — Wire to Real Data

Replace mock data in `src/components/sidebar/WorkflowSidebar.vue`:

- Import `useWorkflowSessionsStore` instead of `mockWorkflowSessions`
- Wire `newWorkflow()` → `store.createSession()` then navigate to the new session
- Wire `selectSession(id)` → `store.loadSession(id)` to load the session's JSONL
- Show active session with visual indicator (highlight in the `SessionList`)
- "New Workflow" button creates a fresh session and opens the empty chat panel
- Search bar filters sessions by title (already implemented, just needs real data)

**Files:** `src/components/sidebar/WorkflowSidebar.vue`

### Step 20: LLM Settings UI

Create `src/components/settings/LlmSettings.vue` — the AI/Agent configuration section:

- **Backend selector**: `ion-segment mode="ios"` with two pills: "Claude SDK" and "Deep Agents"
- **Claude SDK panel** (shown when Claude SDK selected):
  - `ion-input fill="outline" label-placement="stacked" type="password"` for Anthropic API key
  - Label: "Anthropic API Key"
  - Helper text: "Required for Claude Agent SDK"
- **Deep Agents panel** (shown when Deep Agents selected):
  - `ion-select fill="outline" label-placement="stacked"` for provider (Anthropic / OpenAI / Ollama)
  - `ion-input fill="outline" label-placement="stacked" type="password"` for API key (hidden when Ollama)
  - `ion-input fill="outline" label-placement="stacked"` for model name
  - `ion-input fill="outline" label-placement="stacked"` for Ollama URL (shown only when Ollama selected, placeholder: "http://localhost:11434")
- **"Test Connection" button**: Validates the API key by making a quick test call from the main process via a new IPC channel (`agent:test-connection`). Shows success/error inline.
- Save button persists to `llm.json` via settings store

Add this component to `src/views/SettingsView.vue` as a new section in the settings list.

**Files:** `src/components/settings/LlmSettings.vue`, `src/views/SettingsView.vue`

### Step 21: Preload and Window Type Updates

Update `electron/preload.ts` if additional IPC channels are needed (e.g., `agent:test-connection` for the settings test button). Update the TypeScript declaration for `window.n8nDesk` to use the properly typed `AgentEvent` instead of `unknown`.

Add a `removeEventListener` pattern for `agent:onEvent` to prevent listener leaks when switching sessions or unmounting components.

**Files:** `electron/preload.ts`, `src/env.d.ts` (or wherever `N8nDeskBridge` is declared)

### Step 22: i18n Strings

Add all new user-facing strings to `src/i18n/locales/en.json`:

- Workflow mode: "Describe the workflow you want to build", "Agent is working...", "Build a workflow to see it here"
- Tool calls: human-readable names for all 13 MCP tools (e.g., "Search Workflows", "Create Workflow", "Execute Workflow")
- Approval: "The agent wants to {action}", "Approve", "Reject", "Approved", "Rejected"
- Settings: "AI / Agent", "Agent Backend", "Claude SDK", "Deep Agents", "Anthropic API Key", "Provider", "Model", "Ollama URL", "Test Connection", "Connection successful", "Connection failed"
- Errors: "No AI provider configured. Go to Settings > AI / Agent.", "Agent execution failed", "MCP tool call failed"
- Sidebar: (existing "New Workflow" and "Search workflows" already present)

**Files:** `src/i18n/locales/en.json`

### Step 23: Tests

Write tests for the new modules:

- **Unit: MCP Client** — Mock HTTP responses from `StreamableHTTPClientTransport`, verify `callTool` returns structured data, verify 401 triggers refresh
- **Unit: Agent Runners** — Mock MCP client, verify both runners normalize events into `AgentEvent` format correctly
- **Unit: Tool Definitions** — Verify all 13 tool wrappers have correct Zod schemas and call `mcpClient.callTool` with proper args
- **Unit: Workflow Session Store** — Verify JSONL hydration, `handleAgentEvent` dispatching, session CRUD
- **Component: ToolCallCard** — Renders tool name, shows correct status icon per state
- **Component: ApprovalCard** — Renders description, emits approve/reject on button click
- **Component: WorkflowEmbed** — Renders `<n8n-demo>` in demo mode, diff mode, compact mode; lazy-loads via IntersectionObserver
- **Component: WorkflowPreviewPanel** — Shows empty state when null, renders embed when data provided
- **Integration: WorkflowView** — Send message → receive streamed events → render in chat → tool call card appears → approval card appears

**Files:** `src/__tests__/stores/workflow-sessions.test.ts`, `src/__tests__/composables/useWorkflowAgent.test.ts`, `src/__tests__/components/workflow/*.test.ts`, `electron/__tests__/mcp-client.test.ts`, `electron/__tests__/agent/*.test.ts`

## Validation Criteria

- [ ] Sending "search for workflows about email" → agent calls `search_workflows` → results render in chat with ToolCallCard
- [ ] Sending "show me my Daily Report workflow" → agent calls `get_workflow_details` → **compact `<n8n-demo>` preview renders inline in the tool call card**, side panel updates with full-size interactive preview
- [ ] Sending "create a workflow that checks Gmail hourly and posts to Slack" → agent calls `search_workflow_nodes`, `get_workflow_node_types`, `validate_workflow_code`, then `create_workflow_from_code` → approval card appears **with a compact workflow preview** before creation
- [ ] Approving the creation → workflow is created in n8n → **`<n8n-demo>` renders inline in the tool result card AND in the side panel** with `frame="true"` (code view + copy)
- [ ] Sending "update this workflow to also post to Discord" → agent calls `update_workflow` → **side panel shows `<n8n-demo mode="diff">` with before/after comparison**
- [ ] Rejecting a creation → agent acknowledges and asks for changes
- [ ] Agent streams text in real-time with tool call cards appearing inline
- [ ] **Inline workflow embeds are click-to-interact** — they don't steal scroll from the chat
- [ ] **Clicking an inline workflow embed scrolls/focuses the side panel** to show the full-size version
- [ ] **No more than 3 `<n8n-demo>` iframes render simultaneously** — off-screen embeds show placeholder cards, lazy-load on scroll via IntersectionObserver
- [ ] Switching between Claude SDK and Deep Agents in Settings → both produce valid workflows
- [ ] Deep Agents with OpenAI model → agent correctly calls MCP tools and creates workflows
- [ ] Deep Agents with Ollama (local) → agent works offline for reasoning, MCP tools still need n8n connection
- [ ] Session persistence: create a workflow session, close app, reopen → session loads from JSONL with full message history (workflow embeds reconstruct from stored JSON)
- [ ] Deleting a session → moves to `.archive/`, disappears from sidebar
- [ ] WorkflowSidebar shows real sessions, "New Workflow" creates a fresh session
- [ ] Split-panel resize works: dragging divider adjusts chat vs preview proportions
- [ ] Preview panel collapses when no workflow is loaded, expands when one appears
- [ ] Settings > AI/Agent: "Test Connection" validates API key and shows success/failure
- [ ] chatUser role → Workflow mode is hidden/disabled (cannot access MCP tools)
- [ ] MCP token expired during agent run → token refreshes transparently, tool call succeeds
- [ ] `agent:stop` → running agent stops immediately, "Agent stopped" message appears
- [ ] All 13 MCP tools work when called by the agent (search, create, validate, execute, publish, archive, etc.)
- [ ] **All workflow embeds sync theme** (light/dark) with app theme — both inline and side panel
- [ ] All existing Phase 1, 2, and 3 tests still pass
- [ ] `npm run build` and `npm run build:electron` succeed without errors

## Anti-Patterns to Avoid

- **Do NOT run the agent in the renderer process.** The Deep Agents SDK and Claude Agent SDK require Node.js APIs. The agent must run in Electron's main process with events streamed to the renderer via IPC. The preload bridge for `agent:invoke/stop/approve/onEvent` is already wired.

- **Do NOT use native `fetch()` for MCP tool calls.** MCP calls go from the Electron main process (which has no CORS restrictions), not from the renderer. The MCP client in `electron/mcp-client.ts` uses Node.js fetch directly, not the `api:fetch` IPC proxy (that's for renderer → main → n8n, but the agent already runs in main).

- **Do NOT maintain a persistent MCP connection.** n8n's MCP server is stateless (`sessionIdGenerator: undefined`). Each tool call should create a fresh `StreamableHTTPClientTransport`. Do not try to reuse connections.

- **Do NOT manually wrap MCP tools for the Claude SDK runner.** The Claude Agent SDK has native MCP support via the `mcpServers` config. Pass the server URL and auth headers — the SDK handles tool discovery and invocation internally. Only wrap tools manually for the Deep Agents runner (which needs LangChain `tool()` definitions).

- **Do NOT use the public API (`/api/v1/*`) for anything.** MCP tools go through `/mcp-server/http` with Bearer token. If you need REST API data (user profile, etc.), use `/rest/*` with session cookie. The public API requires `X-N8N-API-KEY` which n8n-desk doesn't use.

- **Do NOT use `ion-textarea` for the chat input.** Use a native `<textarea>` with custom auto-resize (same as Phase 3 ChatInput). Ionic's textarea doesn't support precise height control needed for chat inputs.

- **Do NOT block the UI during agent execution.** Agent runs async in the main process. The renderer stays responsive — the user can scroll history, resize panels, or stop the agent at any time.

- **Do NOT store API keys in `config.json` or Pinia localStorage.** API keys go in `~/.n8n-desk/llm.json` with `0600` file permissions. The settings store reads/writes this file, never exposes keys to localStorage.

- **Do NOT set `mode: 'ios'` globally on IonicVue.** Only apply `mode="ios"` on `<ion-segment>` as specified in CLAUDE.md.

- **Do NOT queue or retry failed MCP tool calls automatically.** If a tool call fails (timeout, server error), report the error to the agent and let it decide what to do. No silent retries, no offline queuing.

- **Do NOT render workflow JSON as raw text or code blocks.** Every workflow JSON from an MCP tool result must render as a `<n8n-demo>` embed — inline in the chat (compact, click-to-interact) and in the side panel (full-size, interactive). If `<n8n-demo>` fails to load, show a styled fallback card with the workflow name and node count, not a JSON dump.

- **Do NOT render more than 3 `<n8n-demo>` iframes simultaneously.** Each embed loads an iframe internally. Use `IntersectionObserver` for lazy loading and replace off-screen embeds with placeholder cards. This is a hard performance constraint from the `<n8n-demo>` architecture (see `WORKFLOW_EMBED.md`).

- **Do NOT pass workflow JSON as a string attribute.** In Vue, pass it as a property binding (`:workflow="workflowJson"`) not an HTML attribute (`workflow='{"nodes":...'`). The web component handles both, but property binding avoids attribute size limits and escaping issues.

## Patterns to Follow

- **Service layer pattern:** Follow `src/services/n8n-api.ts` — the new `electron/mcp-client.ts` follows the same auth header injection pattern. The MCP client is instance-scoped and uses the MCP OAuth bearer token (not the session cookie).

- **Composable pattern:** Follow `src/composables/useAuth.ts` — `useWorkflowAgent` is a thin orchestration layer connecting IPC to the Pinia store. It does not contain business logic, just event routing.

- **Store hydration pattern:** Follow `src/stores/instances.ts` `hydrate()` — the workflow session store reads from local storage at startup and flushes on mutation. Session JSONL follows the same `localStorageService.readJsonl()` / `appendJsonl()` pattern.

- **IPC handler pattern:** Follow `electron/ipc/auth.ts` — each handler reads config, validates inputs, calls the appropriate service, returns a typed result. The agent handlers additionally stream events via `mainWindow.webContents.send()`.

- **Ionic layout:** Follow `src/views/SettingsView.vue` — `IonPage` > content. The split-panel layout in WorkflowView uses CSS flexbox (not `IonSplitPane` which is for menu/content split).

- **Component styling:** Use `<style lang="scss" module>` with `--n8n-desk--*` surface tokens as established in existing components. Cards use `--n8n-desk--surface-bg`, raised elements use `--n8n-desk--surface-raised-bg`.

- **Error handling:** Follow the discriminated union pattern from `src/types/auth.ts` (`{ success: true, data } | { success: false, error }`) for service return types.

- **Input styling:** All inputs use `fill="outline"` and `label-placement="stacked"` as specified in CLAUDE.md.

- **Workflow embed pattern:** Always use the `WorkflowEmbed.vue` component (never raw `<n8n-demo>`). It handles theme sync, lazy loading, compact/full modes, and diff mode. See `WORKFLOW_EMBED.md` for the complete `<n8n-demo>` attribute API. Key attributes: `tidyup="true"` always, `clicktointeract="true"` for inline chat, `frame="true"` for side panel, `mode="diff"` + `workflowbefore` for update comparisons.

- **Vue 3 Composition API:** `<script setup lang="ts">` with `defineProps<T>()` and `defineEmits<T>()` — no Options API, no `defineComponent()`.
