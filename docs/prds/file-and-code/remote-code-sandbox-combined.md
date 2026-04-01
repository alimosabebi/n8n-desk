# PRD: Remote Code Sandbox

## Overview

Enable n8n-desk agents to execute JavaScript and Python code safely by using the connected n8n instance as a remote sandbox. The agent maintains a persistent "sandbox workflow" per language in the user's personal project on the n8n instance, updates its Code node with the desired code, triggers execution, and reads results. All code runs in n8n's task runner sandbox (process isolation, memory limits, timeouts, module allowlisting) — nothing executes locally. Two execution backends are supported: the internal REST API (default, faster) and MCP tools (fallback, more portable). The user chooses their preferred backend in Settings.

## Problem Statement

n8n-desk agents currently cannot execute arbitrary code. This blocks data transformation, file processing, computation, text manipulation, and code testing use cases. Running code locally in Electron would be a security risk and doesn't work on mobile. n8n already has a battle-tested sandbox (task runners with VM isolation, timeouts, memory limits, module allowlisting) — we should reuse it remotely.

## Goals

- Agents can execute JavaScript and Python code on the connected n8n instance
- Code runs in n8n's existing task runner sandbox (inherited for free)
- Two backend options: REST API (fast, default) and MCP tools (portable, fallback)
- Configurable in Settings under "Code Execution" section
- Works on desktop and mobile
- Sandbox workflows created in the user's personal project with clear naming and a Sticky Note explaining their purpose
- Human-in-the-loop approval before every code execution
- Automatic fallback from REST to MCP if REST fails (e.g., insufficient permissions)

## Non-Goals

- No local code execution — all code runs on the n8n instance
- No direct access to n8n's task broker WebSocket (no external requester API exists)
- No support for long-running code (inherits n8n task runner timeout, ~60s)
- No filesystem access from within the sandbox
- No offline code execution
- No custom module installation beyond n8n's configured allowlists

## Technical Design

### Architecture Overview

```
Agent calls run_code(language, code, inputData?)
  ↓
CodeSandboxService (src/services/code-sandbox.ts)
  ↓ checks settings
  ├── REST backend (default)
  │   ├── PATCH /rest/workflows/:id  (update Code node)
  │   ├── POST /rest/workflows/:id/run  (trigger)
  │   └── GET /rest/executions/:id  (result)
  │
  └── MCP backend (fallback)
      ├── update_workflow MCP tool  (update Code node)
      ├── execute_workflow MCP tool  (trigger)
      └── get_execution MCP tool  (result)
```

### Sandbox Workflow Structure

Each sandbox workflow is created once per language per instance and reused. The workflow contains:

1. **Sticky Note** — Explains to the user what this workflow is for
2. **Manual Trigger** — Entry point for execution
3. **Code node** — The actual sandbox (code is swapped before each execution)

**JavaScript sandbox workflow:**
```json
{
  "name": "[n8n-desk] Code Sandbox (JavaScript)",
  "nodes": [
    {
      "name": "Sticky Note",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [-200, -100],
      "parameters": {
        "content": "## n8n-desk Code Sandbox\n\nThis workflow is used by **n8n-desk** to execute JavaScript code in a safe, sandboxed environment.\n\n**Do not delete or modify this workflow** — n8n-desk will recreate it if missing, but active executions may fail.\n\nThe Code node below is automatically updated with each execution request from the n8n-desk agent. All code runs in n8n's task runner sandbox with process isolation, memory limits, and timeouts.\n\nYou can safely deactivate this workflow — it only runs via manual trigger from n8n-desk.",
        "width": 400,
        "height": 280,
        "color": 4
      }
    },
    {
      "name": "Manual Trigger",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 200],
      "parameters": {}
    },
    {
      "name": "Code",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [200, 200],
      "parameters": {
        "language": "javaScript",
        "jsCode": "// This code is replaced by n8n-desk before each execution.\n// Do not edit manually.\nreturn [{json: {ready: true}}];",
        "mode": "runOnceForAllItems"
      }
    }
  ],
  "connections": {
    "Manual Trigger": {
      "main": [[{"node": "Code", "type": "main", "index": 0}]]
    }
  },
  "settings": {}
}
```

**Python sandbox workflow:** Same structure, but with `"language": "python"` and `"pythonCode": "..."` in the Code node, and name `[n8n-desk] Code Sandbox (Python)`.

### Creating Workflows in the User's Personal Project

When creating the sandbox workflow via REST:
```http
POST /rest/workflows?projectId={personalProjectId}
```

To get the personal project ID:
```http
GET /rest/me
```
Response includes the user's `personalProjectId` (or we call `GET /rest/projects` to find the personal project).

When creating via MCP:
- The `create_workflow_from_code` MCP tool creates workflows in the user's default/personal space by default.

### Settings: Code Execution Backend

Add a new section in Settings (`src/views/SettingsView.vue` / `src/stores/settings.ts`):

```ts
interface CodeExecutionSettings {
  /** Preferred backend for code execution */
  backend: 'rest' | 'mcp'
  /** Whether code execution is enabled */
  enabled: boolean
}
```

Default: `{ backend: 'rest', enabled: true }`

Stored in `~/.n8n-desk/config.json` under `codeExecution`.

**Settings UI:**
- Section header: "Code Execution"
- Toggle: "Enable code execution" (on/off)
- Select: "Execution method" — "REST API (faster)" / "MCP Tools (more compatible)"
- Info text: "Code runs on your n8n instance in a sandboxed environment. REST API is faster but requires member access. MCP Tools work with any role that has workflow execution permissions."

### Data Model Changes

**`~/.n8n-desk/config.json`** — Add:
```json
{
  "codeExecution": {
    "backend": "rest",
    "enabled": true
  }
}
```

**`~/.n8n-desk/instances/{id}/cache/sandbox.json`:**
```json
{
  "javascript": {
    "workflowId": "abc123",
    "createdAt": "2026-03-22T10:00:00Z"
  },
  "python": {
    "workflowId": "def456",
    "createdAt": "2026-03-22T10:00:00Z"
  }
}
```

**`src/stores/settings.ts`** — Add `codeExecution` to the settings schema.

### Interface Changes

**New service: `src/services/code-sandbox.ts`**

```ts
interface CodeSandboxResult {
  success: boolean
  output: unknown
  error?: string
  executionId: string
  executionTimeMs: number
}

interface CodeSandboxService {
  execute(
    language: 'javascript' | 'python',
    code: string,
    inputData?: Record<string, unknown>,
  ): Promise<CodeSandboxResult>
}
```

**New LangChain tool: `run_code`**

```ts
schema: z.object({
  language: z.enum(['javascript', 'python']),
  code: z.string().describe('Code to execute. JS: must return [{json:{...}}]. Python: assign result to `result` variable.'),
  inputData: z.record(z.unknown()).optional().describe('Input data accessible as $input (JS) or _input (Python)'),
})
```

### REST Backend Implementation

**Update code:**
```http
PATCH /rest/workflows/:workflowId
Cookie: n8n-auth=...

{
  "nodes": [
    { "name": "Sticky Note", ... },
    { "name": "Manual Trigger", ... },
    {
      "name": "Code",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [200, 200],
      "parameters": {
        "language": "javaScript",
        "jsCode": "<USER CODE HERE>",
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

{
  "triggerToStartFrom": { "name": "Manual Trigger" }
}
```

Response: `{ "executionId": "789" }`

**Partial execution (optimization — skip trigger, pass input directly):**
```http
POST /rest/workflows/:workflowId/run

{
  "runData": {
    "Manual Trigger": [{
      "startTime": 1711000000000,
      "executionTime": 0,
      "data": { "main": [[{ "json": { ... inputData ... } }]] },
      "source": [null]
    }]
  },
  "destinationNode": { "nodeName": "Code", "mode": "inclusive" },
  "dirtyNodeNames": ["Code"]
}
```

**Get result:**
```http
GET /rest/executions/:executionId
Cookie: n8n-auth=...
```

Parse `data.resultData.runData["Code"]` for the Code node's output items.

**Streaming optimization:** The `/rest/push` WebSocket (already connected for Chat mode) delivers `nodeExecuteAfter` events. Listen for execution events matching our execution ID to get results in real-time instead of polling.

### MCP Backend Implementation

**Update code:**
```
MCP tool: update_workflow({ workflowId, code: "<Workflow SDK code with updated Code node>" })
```

**Trigger execution:**
```
MCP tool: execute_workflow({ workflowId })
```

**Get result:**
```
MCP tool: get_execution({ executionId, workflowId })
```

Note: The MCP `update_workflow` expects Workflow SDK code (not raw JSON). The service must generate SDK code that produces the correct workflow structure.

### Automatic Fallback

When the REST backend fails with 403 (insufficient permissions — e.g., chatUser role), the service automatically falls back to the MCP backend for that session:

```ts
async execute(language, code, inputData) {
  const settings = useSettingsStore().codeExecution

  if (settings.backend === 'rest') {
    try {
      return await this.executeViaRest(language, code, inputData)
    } catch (err) {
      if (err.status === 403) {
        console.warn('[code-sandbox] REST failed with 403, falling back to MCP')
        return await this.executeViaMcp(language, code, inputData)
      }
      throw err
    }
  }

  return await this.executeViaMcp(language, code, inputData)
}
```

### Security Model

All security inherited from n8n's task runners:

| Protection | Mechanism |
|---|---|
| Process isolation | Separate task runner process |
| Memory limits | 128MB per isolate (configurable on n8n side) |
| Timeout | Task runner timeout (~60s default) |
| No eval/Function | `--disallow-code-generation-from-strings` (JS) |
| Prototype freezing | All JS builtins frozen |
| Import restrictions | AST analysis + allowlist (Python) |
| Module allowlist | `NODE_FUNCTION_ALLOW_BUILTIN/EXTERNAL` (n8n server config) |

n8n-desk adds:
- **Human-in-the-loop approval** before every code execution
- **Agent never sees raw auth tokens** — `CodeSandboxService` handles auth internally
- **Sandbox workflows are inactive** — they only run via manual trigger from n8n-desk

### Error Handling

| Scenario | Behavior |
|---|---|
| Sandbox workflow deleted on n8n | Detect 404, recreate, retry once |
| Code timeout | Return timeout error with duration |
| Code runtime error | Return error message + stack trace from execution result |
| n8n instance offline | Fail with "Cannot execute code: n8n instance unreachable" |
| REST 401 (session expired) | Trigger re-login flow |
| REST 403 (insufficient role) | Auto-fallback to MCP backend |
| MCP token expired | Existing 401 refresh flow |
| Python not configured on instance | Detect task runner error, inform agent |
| chatUser role + MCP also lacks scope | Surface: "Code execution requires workflow execution permissions" |

### Migration Strategy

None. Cache is ephemeral. Sandbox workflows are created on-demand. Settings default to `{ backend: 'rest', enabled: true }`.

## Implementation Steps

1. **Create code sandbox service** — New file `src/services/code-sandbox.ts`:
   - Define `CodeSandboxResult` interface
   - `ensureSandboxWorkflow(language)` — Creates sandbox workflow if not cached. For REST: `POST /rest/workflows?projectId={personalProjectId}` with the full workflow JSON (Sticky Note + Manual Trigger + Code node). For MCP: `validate_workflow` + `create_workflow_from_code`. Cache workflow ID in `sandbox.json`.
   - `executeViaRest(language, code, inputData?)` — PATCH workflow → POST run → GET execution (or push WebSocket)
   - `executeViaMcp(language, code, inputData?)` — update_workflow → execute_workflow → get_execution
   - `execute(language, code, inputData?)` — Orchestrator: reads settings, tries preferred backend, auto-fallback on 403
   - Use `N8nApiClient` for REST calls, `callTool()` from `electron/mcp-client.ts` for MCP calls

2. **Define sandbox workflow templates** — Constants in `src/services/code-sandbox.ts`:
   - `JS_SANDBOX_WORKFLOW_JSON` — Full workflow JSON with Sticky Note, Manual Trigger, Code node (JavaScript)
   - `PYTHON_SANDBOX_WORKFLOW_JSON` — Same for Python
   - `JS_SANDBOX_SDK_CODE` — Workflow SDK code string for MCP backend
   - `PYTHON_SANDBOX_SDK_CODE` — Same for Python
   - Sticky Note content explains purpose: "This workflow is used by n8n-desk to execute code in a safe, sandboxed environment. Do not delete or modify."

3. **Add sandbox cache management** — In `src/services/code-sandbox.ts`:
   - Read/write `instances/{id}/cache/sandbox.json` via `local-storage.ts`
   - `verifySandboxExists(workflowId)` — HEAD/GET the workflow, handle 404 by clearing cache and recreating
   - Called on first execution per app session (not every call)

4. **Get personal project ID** — In `src/services/code-sandbox.ts`:
   - Call `GET /rest/me` (REST) to get user profile including personal project ID
   - Cache in memory for the session
   - Used when creating sandbox workflows to place them in the user's personal project

5. **Create `run_code` LangChain tool** — New file `electron/agent/run-code-tool.ts`:
   - Wraps `CodeSandboxService.execute()` as a LangChain `tool()`
   - Schema: `{ language, code, inputData? }`
   - Returns structured result string for the agent

6. **Register tool with agent runners**:
   - `electron/agent/tool-definitions.ts` — Export `createRunCodeTool()`
   - `electron/agent/deep-agents-runner.ts` — Add `'run_code'` to `DESTRUCTIVE_TOOLS` set (line 15)
   - `electron/agent/claude-sdk-runner.ts` — Register as approval-required tool
   - Both Cowork and Workflow modes get the tool

7. **Add settings UI** — Modify Settings view:
   - New section "Code Execution" in `src/components/settings/AppSettings.vue` (or equivalent)
   - Toggle: "Enable code execution" → `codeExecution.enabled`
   - Select: "Execution method" → `codeExecution.backend` with options "REST API (faster)" / "MCP Tools (more compatible)"
   - Update `src/stores/settings.ts` to include `codeExecution` in the settings schema
   - Persist to `~/.n8n-desk/config.json`

8. **Enhance approval dialog** — Modify the approval UI component:
   - When `toolName === 'run_code'`, render `args.code` with syntax highlighting
   - Show language badge (JavaScript / Python)
   - Show notice: "This code will execute on your n8n instance ({instanceLabel})"

9. **Add push WebSocket execution listener (optional optimization)** — In `src/services/code-sandbox.ts`:
   - When using REST backend, listen for `nodeExecuteAfter` events on the push WebSocket
   - Match by execution ID to resolve the result immediately instead of polling
   - Timeout after 5s and fall back to polling `GET /rest/executions/:id`

10. **Update system prompts** — Modify `electron/agent/system-prompts.ts`:
    - Add `run_code` tool guidance: when to use, output format, limitations
    - JS: code must return `[{json: {...}}]` (n8n output format)
    - Python: assign result to `result` variable
    - Available modules depend on n8n instance configuration

11. **Tests**:
    - `src/services/__tests__/code-sandbox.test.ts` — Mock API calls, test REST flow, MCP flow, auto-fallback, cache hit/miss, workflow recreation on 404
    - `electron/agent/__tests__/run-code-tool.test.ts` — Test tool wrapper, approval integration
    - `src/stores/__tests__/settings-code-execution.test.ts` — Test settings persistence

## Validation Criteria

- [ ] Sandbox JS workflow is created on first `run_code` call with correct name `[n8n-desk] Code Sandbox (JavaScript)`
- [ ] Sandbox workflow is placed in the user's personal project
- [ ] Sandbox workflow includes a Sticky Note explaining its purpose
- [ ] Code node is updated with user code before each execution
- [ ] Execution triggers and returns structured result (output or error)
- [ ] Python sandbox workflow works identically
- [ ] Settings UI shows "Code Execution" section with backend toggle
- [ ] REST backend is used when setting is "rest" (default)
- [ ] MCP backend is used when setting is "mcp"
- [ ] Auto-fallback from REST to MCP on 403 error
- [ ] Sandbox workflow IDs are cached in `sandbox.json` and reused
- [ ] Deleted sandbox workflow is automatically recreated
- [ ] Human-in-the-loop approval dialog shows code with syntax highlighting
- [ ] chatUser role: REST fails → MCP fallback (or clear error if MCP also lacks scope)
- [ ] Session expired (401): triggers re-login
- [ ] Code timeout returns structured error
- [ ] Code runtime error returns stack trace
- [ ] All REST calls go through `api:fetch` IPC proxy (no CORS issues)
- [ ] No code executes locally
- [ ] Push WebSocket optimization delivers results without polling (when available)
- [ ] Partial execution mode works when inputData is provided

## Anti-Patterns to Avoid

- **Don't expose auth tokens to the agent.** The `run_code` tool calls `CodeSandboxService` which handles auth internally. The agent never sees cookies or MCP tokens.

- **Don't create a new workflow per execution.** PATCH/update the existing sandbox workflow. Creating+deleting workflows per execution pollutes the user's workflow list.

- **Don't place sandbox workflows in shared projects.** Always use the user's personal project to avoid cluttering team workspaces.

- **Don't skip the Sticky Note.** Users will see these workflows in their n8n UI and need to understand what they are and why they shouldn't delete them.

- **Don't poll aggressively for results.** Use the push WebSocket when available. If polling, start at 500ms and back off to 2s.

- **Don't skip human approval.** Every code execution must be approved, even in "fast" REST mode. The approval dialog is the trust boundary.

- **Don't use this for chatUser roles without fallback.** REST requires `workflow:execute` scope. Always try MCP as fallback, and if both fail, give a clear permissions error.

## Patterns to Follow

- **N8nApiClient for REST calls**: Follow `src/services/n8n-api.ts` for authenticated REST calls through `api:fetch` IPC. Same pattern Chat-Hub uses.

- **MCP tool calls**: Follow `electron/mcp-client.ts` `callTool()` and `electron/agent/tool-definitions.ts` `mcpTool()` helper.

- **Settings persistence**: Follow existing patterns in `src/stores/settings.ts` for reading/writing `config.json`.

- **Cache management**: Follow `~/.n8n-desk/instances/{id}/cache/workflows.json` — ephemeral, recreatable.

- **Destructive tool approval**: Follow `DESTRUCTIVE_TOOLS` set in `electron/agent/deep-agents-runner.ts:15-21`.

- **Path traversal protection**: Follow `electron/skill-loader.ts:255-276` for any file path validation.

- **Push WebSocket event routing**: Follow `src/services/chathub-stream.ts` for receiving push events.
