# PRD: Remote Code Sandbox via n8n Internal REST API

## Overview

Enable n8n-desk agents to execute JavaScript and Python code on the connected n8n instance using n8n's internal REST API (`/rest/workflows` + `/rest/executions`). This bypasses the MCP tool layer for a faster, more direct execution path. The agent maintains a persistent "sandbox workflow" per language on the n8n instance, updates its Code node with the desired code, triggers execution via `POST /rest/workflows/:id/run`, and reads results from `GET /rest/executions/:id`. All code runs in n8n's task runner sandbox (process isolation, memory limits, timeouts) — nothing executes locally.

## Problem Statement

The MCP-based approach (`remote-code-sandbox.md`) requires 4 sequential MCP tool calls per code execution: `update_workflow` → `execute_workflow` → `get_execution` (+ initial `create_workflow_from_code`). Each MCP call goes through the MCP server's HTTP transport with OAuth bearer auth, adding latency. The internal REST API (`/rest/*`) is what n8n's own editor uses — it's faster, supports richer execution payloads (partial execution, destination nodes, run data), and n8n-desk already authenticates to it via the `n8n-auth` session cookie for Chat mode.

## Goals

- Single REST call to trigger code execution (`POST /rest/workflows/:id/run`)
- Single REST call to read results (`GET /rest/executions/:id`)
- Reuse the existing `n8n-auth` session cookie (no additional auth flow)
- Same sandboxing guarantees as MCP approach (n8n's task runners)
- Support both JavaScript and Python
- Human-in-the-loop approval before every execution
- Works on desktop and mobile (all calls proxied through `api:fetch` IPC)

## Non-Goals

- Not replacing the MCP-based approach — this is a faster alternative, both can coexist
- No direct access to n8n's task broker WebSocket (it has no external requester API)
- No local code execution
- No modification of n8n's server code
- No support for streaming execution results (REST endpoint returns execution ID, result is polled)

## Technical Design

### How the Internal REST API Works

n8n's editor uses these endpoints (all authenticated via `n8n-auth` session cookie):

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /rest/workflows` | Create | Create a new workflow |
| `PATCH /rest/workflows/:id` | Update | Update workflow definition (nodes, connections, settings) |
| `POST /rest/workflows/:id/run` | Execute | Trigger manual execution |
| `GET /rest/executions/:id` | Read | Get execution result and data |
| `DELETE /rest/workflows/:id` | Delete | Remove workflow |

The key insight: `POST /rest/workflows/:id/run` **always loads the workflow from the database** (line 521 of `workflows.controller.ts`). This means:
1. We update the workflow's Code node with new code via `PATCH`
2. We trigger execution via `POST /rest/workflows/:id/run`
3. n8n loads the (just-updated) workflow and executes it
4. The Code node runs in n8n's task runner sandbox

### Execution Flow

```
Agent calls run_code({ language: "javascript", code: "..." })
  ↓
1. Ensure sandbox workflow exists on this instance
   - First time: POST /rest/workflows → create workflow with Manual Trigger + Code node
   - Cache the workflow ID in ~/.n8n-desk/instances/{id}/cache/sandbox.json
  ↓
2. Update the Code node with the actual code
   - PATCH /rest/workflows/:id → set jsCode/pythonCode in the Code node
  ↓
3. Trigger execution
   - POST /rest/workflows/:id/run
   - Body: { triggerToStartFrom: { name: "Manual Trigger" } }
   - Response: { executionId: "123" }
  ↓
4. Poll for result
   - GET /rest/executions/:executionId
   - Check status: "running" | "success" | "error"
   - Return output data or error
```

### Request/Response Shapes

**Create sandbox workflow:**
```http
POST /rest/workflows
Cookie: n8n-auth=...
Content-Type: application/json

{
  "name": "n8n-desk-sandbox-js",
  "nodes": [
    {
      "name": "Manual Trigger",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "name": "Code",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [200, 0],
      "parameters": {
        "language": "javaScript",
        "jsCode": "// placeholder",
        "mode": "runOnceForAllItems"
      }
    }
  ],
  "connections": {
    "Manual Trigger": {
      "main": [[{ "node": "Code", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

**Update code before execution:**
```http
PATCH /rest/workflows/:workflowId
Cookie: n8n-auth=...
Content-Type: application/json

{
  "nodes": [
    { "name": "Manual Trigger", ... },
    {
      "name": "Code",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [200, 0],
      "parameters": {
        "language": "javaScript",
        "jsCode": "const result = [1,2,3].map(x => x * 2);\nreturn [{json: {result}}];",
        "mode": "runOnceForAllItems"
      }
    }
  ],
  "connections": { ... }
}
```

**Trigger execution:**
```http
POST /rest/workflows/:workflowId/run
Cookie: n8n-auth=...
Content-Type: application/json

{
  "triggerToStartFrom": {
    "name": "Manual Trigger"
  }
}
```

Response: `{ "executionId": "456" }`

**Get execution result:**
```http
GET /rest/executions/456
Cookie: n8n-auth=...
```

Response includes `data.resultData.runData["Code"]` with the Code node's output items.

### Partial Execution (Optimization)

The REST API supports **partial execution with run data** — this means we can skip the Manual Trigger entirely and provide synthetic input data directly to the Code node:

```http
POST /rest/workflows/:workflowId/run
Cookie: n8n-auth=...

{
  "runData": {
    "Manual Trigger": [{
      "startTime": 1711000000000,
      "executionTime": 0,
      "data": { "main": [[{ "json": { "input": "hello" } }]] },
      "source": [null]
    }]
  },
  "destinationNode": { "nodeName": "Code", "mode": "inclusive" },
  "dirtyNodeNames": ["Code"]
}
```

This executes only the Code node with the provided input data — even faster, no trigger overhead. This is exactly what the n8n editor does when you click "Run" on a single node.

### Auth: Reusing the Session Cookie

n8n-desk already authenticates to the internal REST API for Chat mode:
- `POST /rest/login` → sets `n8n-auth` cookie
- All `/rest/*` calls include this cookie
- The `N8nApiClient` service (`src/services/n8n-api.ts`) auto-attaches the cookie
- All REST calls go through the `api:fetch` IPC proxy (CORS workaround)

No additional auth is needed. The session cookie grants access to `POST /rest/workflows/:id/run` with `workflow:execute` scope — which any non-chatUser role has.

### Data Model Changes

**`~/.n8n-desk/instances/{id}/cache/sandbox.json`:**
```ts
interface SandboxCache {
  javascript?: {
    workflowId: string
    createdAt: string
  }
  python?: {
    workflowId: string
    createdAt: string
  }
}
```

### Interface Changes

**New service: `src/services/code-sandbox.ts`**

```ts
interface CodeSandboxResult {
  success: boolean
  output: unknown        // Code node output items
  error?: string         // Error message if failed
  executionId: string
  executionTimeMs: number
}

interface CodeSandboxService {
  execute(language: 'javascript' | 'python', code: string, inputData?: Record<string, unknown>): Promise<CodeSandboxResult>
}
```

This service is called from the agent's `run_code` LangChain tool. It uses `N8nApiClient` (which routes through `api:fetch` IPC) for all REST calls.

**New LangChain tool: `run_code`** (same as in the MCP PRD, but backed by REST)

### New Commands / API / UI

**No new n8n-side changes.** All endpoints already exist.

**n8n-desk changes:**
- New `run_code` tool in agent tool set
- Approval dialog enhanced to show code with syntax highlighting when `toolName === 'run_code'`
- Sandbox workflow cache in instance cache dir

### Migration Strategy

None needed. Cache is ephemeral. Sandbox workflows are created on-demand.

### Comparison with MCP Approach

| Aspect | MCP (`remote-code-sandbox.md`) | REST (this PRD) |
|---|---|---|
| API calls per execution | 3-4 (update + execute + get_execution) | 2 (PATCH + POST run + GET execution) |
| Auth | MCP OAuth bearer token | `n8n-auth` session cookie |
| Partial execution | No | Yes — can target single node with input data |
| Input data passing | Via workflow input | Via `runData` in execution payload |
| Requires MCP scopes | Yes (`workflow:execute`, `workflow:update`) | No — uses session auth |
| Works for chatUser role | Yes (if scoped) | No — chatUsers lack `workflow:execute` |
| API stability | Stable (MCP tools are versioned) | Internal (could change between n8n versions) |
| Streaming results | No | Possible via `/rest/push` WebSocket |

### Streaming Results via Push WebSocket

The `/rest/push` WebSocket (already used for Chat-Hub streaming) also delivers execution events. When a manual execution runs, the push channel sends:

- `executionStarted` — execution begun
- `nodeExecuteBefore` — node about to run
- `nodeExecuteAfter` — node finished (includes output data)
- `executionFinished` — full result

This means we can get **real-time Code node output** without polling `GET /rest/executions/:id`. The push WebSocket is already connected for Chat mode — we just need to listen for execution events matching our execution ID.

### Security Model

Same as MCP approach — all security inherited from n8n's task runners:
- Process isolation (separate task runner process)
- Memory limits (128MB default)
- Timeout enforcement
- `--disallow-code-generation-from-strings` (JS)
- AST analysis + import allowlisting (Python)
- Prototype freezing (JS)

Plus n8n-desk's human-in-the-loop approval before every execution.

**Additional concern for REST approach:** The session cookie has broader access than MCP OAuth tokens. A compromised agent could theoretically call other `/rest/*` endpoints. Mitigation: the `run_code` tool implementation only calls the specific endpoints it needs — the agent never receives the raw cookie.

### Error Handling

| Scenario | Behavior |
|---|---|
| Sandbox workflow deleted | Detect 404 on PATCH, recreate, retry |
| Code timeout | Execution status = "error", extract timeout message |
| Code runtime error | Execution `resultData` contains error details |
| Session expired (401) | Trigger re-login flow via existing auth refresh |
| Instance offline | `api:fetch` IPC returns network error |
| Python not configured | Execution fails with task runner error, detect and inform agent |
| chatUser role | PATCH/POST returns 403 — fall back to MCP approach or inform user |

## Implementation Steps

1. **Create code sandbox service** — New file `src/services/code-sandbox.ts`:
   - `ensureSandboxWorkflow(language)` — Creates sandbox workflow via `POST /rest/workflows` if not cached, returns workflow ID
   - `updateCode(workflowId, language, code)` — PATCHes the workflow to update Code node parameters
   - `triggerExecution(workflowId, inputData?)` — `POST /rest/workflows/:id/run` with either full trigger or partial execution payload
   - `getExecutionResult(executionId)` — Polls `GET /rest/executions/:id` until complete
   - `execute(language, code, inputData?)` — Orchestrates the above, returns `CodeSandboxResult`
   - Uses `N8nApiClient` for all HTTP calls (auto-handles cookie auth + IPC proxy)

2. **Add sandbox workflow cache** — In `src/services/code-sandbox.ts`:
   - Read/write `instances/{id}/cache/sandbox.json` via `local-storage.ts`
   - Verify cached workflow still exists on first use (HEAD or GET, handle 404)

3. **Create `run_code` LangChain tool** — New file `electron/agent/run-code-tool.ts`:
   - Wraps `CodeSandboxService.execute()` as a LangChain `tool()`
   - Schema: `{ language: enum('javascript','python'), code: string, inputData?: object }`
   - Returns structured result string for the agent

4. **Register tool with agent runners** — Modify `electron/agent/tool-definitions.ts`:
   - Export `createRunCodeTool()`
   - Modify `electron/agent/deep-agents-runner.ts`: add `'run_code'` to `DESTRUCTIVE_TOOLS` (line 15)
   - Modify `electron/agent/claude-sdk-runner.ts`: register as approval-required tool

5. **Add execution event listening (optional optimization)** — Modify `src/services/chathub-stream.ts` or create new listener:
   - Listen for `nodeExecuteAfter` events on the push WebSocket
   - Match by execution ID to resolve the result immediately instead of polling
   - Falls back to polling if push event not received within timeout

6. **Enhance approval dialog** — Modify approval UI component:
   - Detect `toolName === 'run_code'`
   - Render `args.code` with syntax highlighting (use existing markdown renderer or add a minimal code block)
   - Show language badge and "Executes on your n8n instance" notice

7. **Update system prompts** — Modify `electron/agent/system-prompts.ts`:
   - Add `run_code` tool guidance: when to use, limitations, available modules
   - Note: code must return n8n-compatible output (`[{json: {...}}]` for JS)

8. **Define sandbox workflow templates** — Constants in `src/services/code-sandbox.ts`:
   - `JS_SANDBOX_WORKFLOW` — Full workflow JSON (Manual Trigger → Code node, JS mode)
   - `PYTHON_SANDBOX_WORKFLOW` — Same but Python mode
   - Include proper `typeVersion`, `position`, and connection structure

9. **Handle role-based fallback** — In `code-sandbox.ts`:
   - If `PATCH` or `POST run` returns 403, the user likely has `chatUser` role
   - Surface clear error: "Code execution requires member access or higher on your n8n instance"
   - Future: could fall back to MCP approach if MCP token has broader scopes

10. **Tests** — New files:
    - `src/services/__tests__/code-sandbox.test.ts` — Mock `N8nApiClient`, test create/update/execute/result flow
    - `electron/agent/__tests__/run-code-tool.test.ts` — Test tool wrapper and approval integration

## Validation Criteria

- [ ] Sandbox JS workflow is created on first `run_code` call via `POST /rest/workflows`
- [ ] Code node is updated with user code via `PATCH /rest/workflows/:id`
- [ ] Execution triggers via `POST /rest/workflows/:id/run` with correct payload
- [ ] Execution result is read from `GET /rest/executions/:id`
- [ ] Python sandbox workflow works identically
- [ ] Partial execution mode works (input data passed via `runData`)
- [ ] Sandbox workflow IDs are cached and reused across sessions
- [ ] 404 on cached workflow triggers recreation
- [ ] 401 triggers auth refresh
- [ ] Human-in-the-loop approval dialog shows code before execution
- [ ] chatUser role gets clear error message (not a crash)
- [ ] All REST calls go through `api:fetch` IPC proxy (no CORS issues)
- [ ] No code executes locally — all on n8n instance
- [ ] Agent receives structured output (data or error) from execution

## Anti-Patterns to Avoid

- **Don't expose the session cookie to the agent.** The `run_code` tool calls `CodeSandboxService` which uses `N8nApiClient` internally. The agent never sees or controls the cookie — it only provides `language`, `code`, and optional `inputData`.

- **Don't create a new workflow per execution.** PATCH the existing one. Creating+deleting workflows pollutes the user's workflow list and triggers unnecessary webhook/activation processing.

- **Don't skip the database workflow.** `POST /rest/workflows/:id/run` always loads from DB (enforced at line 521 of `workflows.controller.ts`). You cannot pass an arbitrary workflow definition in the request body — the workflow must exist in the database.

- **Don't poll aggressively for results.** Start with 500ms intervals, back off to 2s. Better yet, use the push WebSocket for instant notification (step 5).

- **Don't use this for chatUser roles.** The REST API requires `workflow:execute` project scope, which chatUsers don't have. Detect the 403 early and give a clear error.

## Patterns to Follow

- **N8nApiClient usage**: Follow `src/services/n8n-api.ts` for making authenticated REST calls through the `api:fetch` IPC proxy. This is how Chat-Hub already communicates with `/rest/*` endpoints.

- **Cache pattern**: Follow `~/.n8n-desk/instances/{id}/cache/workflows.json` for ephemeral, recreatable cache.

- **LangChain tool pattern**: Follow `electron/agent/tool-definitions.ts` `mcpTool()` helper for tool creation with Zod schema.

- **Approval gating**: Follow `DESTRUCTIVE_TOOLS` set in `electron/agent/deep-agents-runner.ts:15-21`.

- **Push WebSocket events**: Follow `src/services/chathub-stream.ts` for receiving and routing push events by type.
