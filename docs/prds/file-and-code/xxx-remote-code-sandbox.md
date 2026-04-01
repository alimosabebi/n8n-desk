# PRD: Remote Code Sandbox via n8n Workflows

## Overview

Enable n8n-desk agents to execute JavaScript and Python code safely by using the connected n8n instance as a remote sandbox. Instead of running code locally on the user's device, the agent creates a workflow with a Code node, executes it via the existing `execute_workflow` MCP tool, and reads the result. This provides production-grade sandboxing (n8n's task runner system with process isolation, prototype freezing, AST analysis, and module allowlisting) without any local code execution — making it safe on desktop and viable on mobile.

## Problem Statement

n8n-desk agents (Cowork and Workflow modes) currently cannot execute arbitrary code. This limits their ability to:
- Transform or analyze data (parse CSV, compute aggregations, format text)
- Process files from attached folders (read JSON, extract fields, generate reports)
- Test code snippets before embedding them in workflows
- Perform utility operations (date math, string manipulation, regex matching)

Running code locally in Electron's main process would be a security risk and doesn't work on mobile. n8n already has a battle-tested sandbox (task runners with VM isolation, timeouts, memory limits, and module allowlisting) — we should reuse it remotely rather than reimplementing it.

## Goals

- Agents can execute JavaScript and Python code on the connected n8n instance
- Code runs in n8n's existing task runner sandbox (process isolation, timeouts, memory limits)
- Works identically on desktop and mobile (no local runtime needed)
- Uses only existing MCP tools (`validate_workflow`, `create_workflow_from_code`, `execute_workflow`, `get_execution`) — no n8n server changes required
- Sandbox workflows are automatically managed (created, reused, archived)
- Agent receives structured execution results (output data, errors, logs)
- Human-in-the-loop approval before code execution (reuses existing approval system)

## Non-Goals

- Not a local code execution engine — all code runs on the n8n instance
- Not a replacement for n8n's Code node — this is agent-initiated, not user-configured
- No support for long-running code (inherits n8n's task runner timeout, typically 60s)
- No filesystem access from within the sandbox (code cannot read/write the n8n server's disk)
- No offline code execution in MVP (requires active connection to n8n instance)
- No custom module installation — limited to n8n's configured allowlist (`NODE_FUNCTION_ALLOW_BUILTIN`, `NODE_FUNCTION_ALLOW_EXTERNAL`)

## Technical Design

### How It Works

The agent gets a new high-level tool `run_code` that abstracts the workflow-based execution:

```
Agent calls run_code({ language: "javascript", code: "return items.map(...)" })
  ↓
1. Check if a reusable sandbox workflow exists for this instance+language
   - If not: create one via validate_workflow + create_workflow_from_code
   - Cache the workflow ID in session/instance metadata
  ↓
2. Execute the sandbox workflow via execute_workflow, passing the code as input data
  ↓
3. Poll via get_execution until complete (or handle streaming if available)
  ↓
4. Return structured result: { output, error, executionTime }
```

### Sandbox Workflow Templates

Two pre-built workflow templates (one per language), created programmatically via the Workflow SDK:

**JavaScript sandbox workflow:**
```
Manual Trigger → Code Node (JavaScript, runOnceForAllItems)
```
- The Code node's code is: `return eval($input.first().json.code)` — BUT this won't work because the Code node's code is static per workflow definition.

**Better approach — Dynamic code via the Code node's "tool" mode or by updating the workflow each time:**

Actually, the cleanest pattern is:

**Option 1: Update-then-execute (simple, reliable)**
1. Create a sandbox workflow once with a placeholder Code node
2. Before each execution: `update_workflow` with the actual code in the Code node
3. `execute_workflow` to run it
4. Read result via `get_execution`

**Option 2: Code-as-input (if supported)**
- Use a Code node that reads its code from the input: `const fn = new Function($input.first().json.code); return fn()`
- But n8n's sandbox blocks `new Function()` via `--disallow-code-generation-from-strings`

**Option 3: One workflow per execution (stateless)**
1. `validate_workflow` with SDK code containing the user's code in a Code node
2. `create_workflow_from_code` to create it
3. `execute_workflow` to run it
4. `get_execution` to read result
5. `archive_workflow` to clean up

**Recommended: Option 1 (update-then-execute)** — Most efficient. One workflow per language per instance, reused across sessions. The `update_workflow` call swaps the Code node's script before each execution.

### Data Model Changes

**`src/types/session.ts`** — Add optional sandbox workflow IDs to instance metadata:

```ts
// In instance config or cache
export interface SandboxWorkflowCache {
  /** Workflow ID for the JS sandbox on this instance */
  javascriptWorkflowId?: string
  /** Workflow ID for the Python sandbox on this instance */
  pythonWorkflowId?: string
  /** When the sandbox workflows were last verified to exist */
  verifiedAt?: string
}
```

This is stored in `~/.n8n-desk/instances/{id}/cache/sandbox.json` — ephemeral, can be recreated if the workflow is deleted on the n8n side.

### Interface Changes

**New LangChain tool: `run_code`**

Added to the agent's tool set in both Cowork and Workflow modes:

```ts
const runCodeTool = tool(
  async ({ language, code, inputData }) => {
    // 1. Ensure sandbox workflow exists (create or reuse)
    // 2. Update workflow with the code
    // 3. Execute workflow
    // 4. Poll for result
    // 5. Return structured output
  },
  {
    name: 'run_code',
    description: 'Execute JavaScript or Python code in a sandboxed environment on the connected n8n instance. Code runs in n8n\'s task runner with process isolation, memory limits, and timeouts. Use for data transformation, computation, text processing, and utility tasks.',
    schema: z.object({
      language: z.enum(['javascript', 'python']).describe('Programming language'),
      code: z.string().describe('Code to execute. For JS: must return a value. For Python: assign result to `result` variable.'),
      inputData: z.record(z.unknown()).optional().describe('Optional input data accessible as $input in JS or _input in Python'),
    }),
  }
)
```

**Approval gating:** `run_code` is added to the `DESTRUCTIVE_TOOLS` set in `deep-agents-runner.ts` so every code execution requires user approval. The approval dialog shows the code that will be executed.

### New Commands / API / UI

**No new UI needed.** The `run_code` tool is agent-internal. The user sees:
1. Agent proposes to run code → approval dialog shows the code
2. User approves/rejects
3. Result appears in chat as a tool result (formatted output or error)

**Approval dialog enhancement:** When the tool is `run_code`, the approval dialog should render the code with syntax highlighting (JS/Python) instead of raw JSON args. This is a UI-only enhancement in the existing approval component.

### Migration Strategy

No migration needed. Sandbox workflows are created on-demand. If a user upgrades n8n-desk, the cache is empty and workflows are recreated on first use.

### Workflow SDK Code Templates

**JavaScript sandbox workflow (created via Workflow SDK):**
```ts
const workflow = new Workflow({ name: 'n8n-desk-sandbox-js' })
  .addTrigger('manualTrigger', 'n8n-nodes-base.manualTrigger')
  .addNode('code', 'n8n-nodes-base.code', {
    language: 'javaScript',
    jsCode: '// placeholder — replaced before each execution',
    mode: 'runOnceForAllItems',
  })
  .connect('manualTrigger', 'code')
```

**Python sandbox workflow:**
```ts
const workflow = new Workflow({ name: 'n8n-desk-sandbox-python' })
  .addTrigger('manualTrigger', 'n8n-nodes-base.manualTrigger')
  .addNode('code', 'n8n-nodes-base.code', {
    language: 'python',
    pythonCode: '# placeholder — replaced before each execution',
    mode: 'runOnceForAllItems',
  })
  .connect('manualTrigger', 'code')
```

Before each execution, the agent calls `update_workflow` with the actual code inserted into the Code node's `jsCode` or `pythonCode` parameter.

### Security Model

All security is inherited from n8n's task runner:

| Protection | Mechanism | Inherited from |
|---|---|---|
| Process isolation | Code runs in separate task runner process | n8n task runner architecture |
| Memory limits | 128MB per isolate (configurable) | n8n GlobalConfig |
| Timeout | Task timeout (default ~60s) | `N8N_RUNNERS_TASK_TIMEOUT` |
| No `eval`/`Function` | `--disallow-code-generation-from-strings` | JS task runner flags |
| Prototype freezing | All builtins frozen | JS task runner security |
| Import restrictions | AST analysis + allowlist | Python task runner |
| Module allowlist | `NODE_FUNCTION_ALLOW_BUILTIN/EXTERNAL` | n8n server config |

**n8n-desk adds one layer:** human-in-the-loop approval before every code execution. The user sees the exact code and can approve or reject.

### Error Handling

| Scenario | Behavior |
|---|---|
| Sandbox workflow deleted on n8n side | Detect 404, recreate, retry once |
| Code timeout | Return timeout error with duration |
| Code runtime error | Return error message + stack trace |
| n8n instance offline | Fail with "Cannot execute code: n8n instance unreachable" |
| MCP token expired | Existing 401 → refresh flow handles this |
| Python not available on instance | Detect error, inform agent "Python task runner not configured on this instance" |

## Implementation Steps

1. **Create sandbox workflow templates** — New file `electron/agent/sandbox-workflows.ts`:
   - `JS_SANDBOX_SDK_CODE` and `PYTHON_SANDBOX_SDK_CODE` — Workflow SDK code strings for each language
   - `ensureSandboxWorkflow(language, instanceUrl, accessToken)` — Creates or verifies the sandbox workflow exists, returns workflow ID
   - `updateSandboxCode(workflowId, language, code, instanceUrl, accessToken)` — Updates the Code node with the actual code to execute
   - Uses `callTool()` from `electron/mcp-client.ts` to call `validate_workflow`, `create_workflow_from_code`, `update_workflow`

2. **Create `run_code` LangChain tool** — New file `electron/agent/run-code-tool.ts`:
   - Implements the `run_code` tool as described in Interface Changes
   - Calls `ensureSandboxWorkflow()` → `updateSandboxCode()` → `execute_workflow` → poll `get_execution`
   - Returns structured `{ output, error, executionTime, language }` result
   - Handles all error cases from the Error Handling table

3. **Add sandbox workflow cache** — Modify `electron/ipc/storage.ts`:
   - Add read/write for `instances/{id}/cache/sandbox.json`
   - Store `SandboxWorkflowCache` (workflow IDs + verification timestamp)

4. **Register `run_code` tool with agents** — Modify `electron/agent/tool-definitions.ts`:
   - Export `createRunCodeTool(ctx)` that returns the LangChain tool
   - Add to the tools array in both `createMcpTools()` return value

5. **Add to destructive tools list** — Modify `electron/agent/deep-agents-runner.ts`:
   - Add `'run_code'` to `DESTRUCTIVE_TOOLS` set (line 15)

6. **Add to Claude SDK runner** — Modify `electron/agent/claude-sdk-runner.ts`:
   - Register `run_code` as an available tool with the same approval requirement

7. **Enhance approval dialog for code** — Modify `src/components/chat/ApprovalDialog.vue` (or equivalent):
   - When `toolName === 'run_code'`, render `args.code` with syntax highlighting
   - Show the language badge (JS/Python)
   - Show a warning: "This code will execute on your n8n instance"

8. **Update system prompts** — Modify `electron/agent/system-prompts.ts`:
   - Add guidance for when to use `run_code` vs other tools
   - Include constraints: no filesystem access, timeout limits, available modules

9. **Add cleanup on instance disconnect** — Modify `electron/ipc/agent.ts`:
   - On instance switch or disconnect, optionally archive sandbox workflows
   - Or leave them (they're inactive and harmless)

10. **Tests** — New file `electron/agent/__tests__/run-code-tool.test.ts`:
    - Mock MCP tool calls
    - Test sandbox workflow creation flow
    - Test update-then-execute flow
    - Test error handling (timeout, runtime error, workflow deleted)
    - Test cache hit (workflow already exists)

## Validation Criteria

- [ ] Agent can execute JavaScript code via `run_code` and receive the output
- [ ] Agent can execute Python code via `run_code` and receive the output
- [ ] Code execution requires user approval (approval dialog appears)
- [ ] Approval dialog shows the code with syntax highlighting
- [ ] Sandbox workflow is created on first use and reused on subsequent calls
- [ ] If sandbox workflow is deleted on n8n side, it's automatically recreated
- [ ] Runtime errors in code are returned as structured error messages
- [ ] Timeout errors are handled gracefully
- [ ] Offline state blocks code execution with clear error message
- [ ] Sandbox workflow IDs are cached in `~/.n8n-desk/instances/{id}/cache/sandbox.json`
- [ ] Both Cowork and Workflow mode agents have access to `run_code`
- [ ] System prompt guides the agent on when/how to use `run_code`
- [ ] No code runs locally — all execution is on the n8n instance

## Anti-Patterns to Avoid

- **Don't execute code locally.** The entire point is remote sandboxing. Never use `eval()`, `vm`, `child_process`, or any local execution in n8n-desk for agent-generated code.

- **Don't create a new workflow per execution.** The update-then-execute pattern reuses a single workflow per language. Creating+archiving per execution would pollute the user's workflow list and be slow.

- **Don't skip approval for code execution.** Even though the code runs remotely in a sandbox, the user must see and approve every code execution. This is both a security measure and a trust-building UX pattern.

- **Don't try to pass code as input data.** n8n's sandbox blocks `new Function()` and `eval()` via `--disallow-code-generation-from-strings`. The code must be in the Code node's `jsCode`/`pythonCode` parameter, not in the input.

- **Don't assume Python is available.** Not all n8n instances have the Python task runner configured. Detect the error and fall back to JavaScript, or inform the user.

## Patterns to Follow

- **MCP tool calling**: Reuse the `callTool()` pattern from `electron/mcp-client.ts` and the `mcpTool()` wrapper from `electron/agent/tool-definitions.ts`.

- **Destructive tool approval**: Follow the existing `DESTRUCTIVE_TOOLS` set pattern in `electron/agent/deep-agents-runner.ts:15-21`.

- **Cache management**: Follow the ephemeral cache pattern at `~/.n8n-desk/instances/{id}/cache/` — treat as deletable, recreate on miss.

- **Error normalization**: Follow the error handling pattern in `mcpTool()` (`tool-definitions.ts:26-31`) — extract text from MCP content blocks, throw as Error.

- **Workflow SDK usage**: Follow the n8n MCP server instructions (see system prompt) — use `get_node_types` to get exact Code node parameters before building the SDK code, validate before creating.
