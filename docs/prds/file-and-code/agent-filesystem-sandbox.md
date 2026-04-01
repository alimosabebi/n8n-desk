# PRD: Agent Filesystem Sandbox

## Overview

Give Cowork and Workflow mode agents controlled filesystem access through a sandbox policy system. Users attach folders to chat sessions via a folder picker in the chat input. The agent can only read/write within those folders, subject to file-type restrictions and a deny-list that blocks credentials, keys, and sensitive config files. Credentials are stored exclusively in the OS keychain — never on disk in plaintext.

## Problem Statement

Currently both agent modes use `StateBackend` (ephemeral/in-memory only). Agents cannot read or write any files on disk. This blocks core use cases: Cowork mode needs to operate on project files in user-chosen directories, and both modes should be able to create/modify skills in `~/.n8n-desk/skills/`. Without a sandbox, enabling filesystem access would be a security risk — agents could read `.env` files, credentials, or write executables.

## Goals

- Agents can read/write files only in explicitly allowed folders, per session
- Sensitive files (`.env`, `.pem`, `.key`, `tokens.enc`, `auth.json`, `llm.json`) are always blocked
- Only safe file types (`.md`, `.json`, `.ts`, `.vue`, etc.) can be written
- Users attach folders via a native folder picker in the chat input UI
- `~/.n8n-desk/skills/` is always writable so agents can create user skills
- `~/.n8n-desk/` data dir is always readable (minus sensitive files) for context
- Symlink escapes are detected and blocked
- Both Deep Agents and Claude SDK backends enforce identical restrictions

## Non-Goals

- No network-level sandboxing (agents already use MCP tools for n8n API access)
- No per-file approval UI (too noisy — folder-level grant is the trust boundary)
- No process-level sandboxing (e.g., seccomp, App Sandbox entitlements) in MVP
- No recursive folder watching or auto-sync — agent reads/writes on demand

## Technical Design

### Data Model Changes

**`src/types/session.ts`** — Add to `SessionMeta`:

```ts
export interface AttachedFolder {
  /** Absolute path on disk */
  path: string
  /** Display label (defaults to basename) */
  label: string
  /** When attached */
  addedAt: string
}

export interface SessionMeta {
  // ...existing fields...
  /** Folders attached for agent filesystem access */
  attachedFolders?: AttachedFolder[]
}
```

**`electron/agent/types.ts`** — Add to `AgentRunnerConfig`:

```ts
export interface SandboxFolderMount {
  /** Absolute host path */
  hostPath: string
  /** Virtual path prefix the agent sees (e.g. "/workspace/my-project") */
  virtualPrefix: string
  /** Access mode */
  mode: 'ro' | 'rw'
}

export interface FilesystemSandboxPolicy {
  mounts: SandboxFolderMount[]
  /** Extensions allowed for write (dot-prefixed) */
  writableExtensions: string[]
  /** Filenames/extensions blocked from read */
  readDenyList: string[]
  /** Filenames/extensions blocked from write */
  writeDenyList: string[]
}

export interface AgentRunnerConfig {
  // ...existing fields...
  sandboxPolicy?: FilesystemSandboxPolicy
}
```

### Interface Changes

**New IPC channel**: `dialog:open-folder`
- Direction: renderer → main
- Returns: `string | null` (selected folder path or null if cancelled)

**Modified IPC channel**: `agent:invoke`
- Add third argument: `options?: { attachedFolders?: AttachedFolder[], mode?: 'cowork' | 'workflow' }`

**Preload additions** (`electron/preload.ts`):
```ts
dialog: {
  openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
}
```

### New Commands / API / UI

**Folder picker in chat input** (`ChatInput.vue`):
- Folder icon button (Lucide `FolderPlus`) in the input toolbar
- Opens native OS folder picker via `dialog:open-folder` IPC
- Selected folders render as removable chips above the textarea
- Chips show folder basename with a remove (X) button
- Folders persist to session metadata in `index.json`

### Migration Strategy

No migration needed. `attachedFolders` is optional on `SessionMeta` — existing sessions without it continue to work (agent gets no filesystem access, same as today). The `sandboxPolicy` field on `AgentRunnerConfig` is also optional — when absent, `StateBackend` is used (current behavior).

## Implementation Steps

1. **Create sandbox policy constants** — New file `electron/agent/sandbox-policy.ts`. Define:
   - `SENSITIVE_READ_DENY` list: `.env`, `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `credentials.json`, `tokens.enc`, `llm.json`, `*.enc`, `auth.json` (when under `~/.n8n-desk/`)
   - `SENSITIVE_WRITE_DENY` list: all of the above + `.exe`, `.sh`, `.bat`, `.cmd`, `.app`, `.dmg`, `.msi`, `.dll`, `.so`, `.dylib`
   - `WRITABLE_EXTENSIONS` list: `.md`, `.json`, `.jsonl`, `.yaml`, `.yml`, `.txt`, `.js`, `.ts`, `.vue`, `.scss`, `.css`, `.html`, `.xml`, `.csv`, `.toml`, `.svg`
   - `buildCoworkPolicy(attachedFolders, n8nDeskDir)` function
   - `buildWorkflowPolicy(attachedFolders, n8nDeskDir)` function
   - Both return `FilesystemSandboxPolicy` with correct mounts: skills dir (rw), n8n-desk dir (ro, deny-listed), user folders (rw for cowork, rw for workflow)

2. **Add types to `AgentRunnerConfig`** — Modify `electron/agent/types.ts`: add `SandboxFolderMount`, `FilesystemSandboxPolicy`, `sandboxPolicy` field, and `AttachedFolder` type.

3. **Add `attachedFolders` to `SessionMeta`** — Modify `src/types/session.ts`: add `AttachedFolder` interface and optional `attachedFolders` field to `SessionMeta`.

4. **Create sandbox filter** — New file `electron/agent/sandbox-filter.ts`. Implements:
   - `isReadDenied(filePath, denyList)` — checks basename and extension against deny list
   - `isWriteAllowed(filePath, allowedExtensions, writeDenyList)` — checks extension is in allow list AND not in deny list
   - `resolveAndValidatePath(virtualPath, mount)` — resolves path, calls `fs.realpath()` to defeat symlinks, verifies result is within `mount.hostPath`
   - `createSandboxedFileTools(policy)` — wraps Deep Agents SDK's built-in `read_file`, `write_file`, `edit_file`, `ls`, `glob`, `grep` tools as LangChain tools with deny-list checks. Returns the tools array.

5. **Wire CompositeBackend in Deep Agents runner** — Modify `electron/agent/deep-agents-runner.ts`:
   - Import `CompositeBackend`, `FilesystemBackend` from `deepagents`
   - Add `buildBackend(config)` function: if `config.sandboxPolicy` has mounts, create `CompositeBackend` with `FilesystemBackend` per mount (using `virtual_mode: true`, `read_only` per mount mode). Default route = `StateBackend`.
   - Replace line 171 (`backend: (rt) => new StateBackend(rt)`) with `backend: buildBackend(config)`
   - If sandbox filter tools are used (Option A from design), prepend them to the tools array and exclude the SDK's built-in file tools.

6. **Add `dialog:open-folder` IPC** — New handler in `electron/ipc/dialog.ts`:
   - `ipcMain.handle('dialog:open-folder', async () => { ... })` using Electron's `dialog.showOpenDialog({ properties: ['openDirectory'] })`
   - Register in `electron/main.ts`
   - Add to preload bridge in `electron/preload.ts`

7. **Update chat input UI** — Modify `src/components/chat/ChatInput.vue`:
   - Add `FolderPlus` icon button in toolbar area
   - On click: call `window.n8nDesk.dialog.openFolder()`, add result to local `attachedFolders` ref
   - Render folder chips (ion-chip with folder icon + label + close button) above textarea
   - On chip remove: remove from `attachedFolders`
   - Emit attached folders with message send event
   - Also update the relevant session store to persist `attachedFolders` to index.json

8. **Update session stores** — Modify `src/stores/workflow-sessions.ts` (and create `src/stores/cowork-sessions.ts` if not existing):
   - Add `attachFolder(sessionId, folder)` and `detachFolder(sessionId, folderPath)` actions
   - Persist changes to `index.json` via `local-storage.ts`

9. **Update agent IPC handler** — Modify `electron/ipc/agent.ts`:
   - Accept `attachedFolders` and `mode` from the `agent:invoke` call
   - Import `buildCoworkPolicy` / `buildWorkflowPolicy` from `sandbox-policy.ts`
   - Build the appropriate `FilesystemSandboxPolicy` and set it on `AgentRunnerConfig.sandboxPolicy`
   - Pass to the runner

10. **Adapt Claude SDK runner** — Modify `electron/agent/claude-sdk-runner.ts`:
    - When `sandboxPolicy` is present, create a local MCP server (HTTP on localhost, random port) that exposes sandboxed file tools (`read_file`, `write_file`, `edit_file`, `ls`, `glob`, `grep`) using the same `sandbox-filter.ts` logic
    - Pass this server as an additional entry in `mcpServers` config
    - Alternatively, if the Claude Agent SDK supports `allowedDirectories`, use that + tool wrappers for deny-list

11. **Unit tests** — New file `electron/agent/__tests__/sandbox-filter.test.ts`:
    - Test `isReadDenied` blocks `.env`, `.pem`, `tokens.enc`, etc.
    - Test `isWriteAllowed` blocks non-allowlisted extensions
    - Test symlink escape detection (create a symlink pointing outside mount, verify it's blocked)
    - Test path traversal (`../../../etc/passwd`) is blocked
    - Test happy path: reading `.ts` file in allowed folder works
    - Test skills dir is writable
    - Test `auth.json` under `~/.n8n-desk/` is blocked but `auth.json` in a user project folder is allowed

## Validation Criteria

- [ ] Attaching a folder via the chat input UI works (native folder picker opens, chip appears)
- [ ] Removing a folder chip detaches it from the session
- [ ] Attached folders persist across app restarts (stored in session index.json)
- [ ] Agent can `read_file` a `.ts` file in an attached folder
- [ ] Agent can `write_file` a `.md` file in an attached folder
- [ ] Agent CANNOT `read_file` a `.env` file even in an attached folder
- [ ] Agent CANNOT `write_file` a `.exe` or `.sh` file anywhere
- [ ] Agent CANNOT access folders NOT attached to the session
- [ ] Agent CAN read files in `~/.n8n-desk/` (except deny-listed ones)
- [ ] Agent CAN write `.md` files in `~/.n8n-desk/skills/`
- [ ] Agent CANNOT read `~/.n8n-desk/tokens.enc` or `~/.n8n-desk/llm.json`
- [ ] Symlink pointing outside an allowed folder is blocked
- [ ] Path traversal (`../../../etc/passwd`) is blocked
- [ ] Workflow mode and Cowork mode both enforce the sandbox
- [ ] Both Deep Agents and Claude SDK backends enforce identical restrictions
- [ ] Sessions without attached folders still work (ephemeral-only, no regression)

## Anti-Patterns to Avoid

- **Don't rely solely on `virtual_mode` for security.** The Deep Agents SDK's `FilesystemBackend` sandboxes to a directory, but it does NOT filter by filename or extension. The deny-list layer in `sandbox-filter.ts` is essential — without it, agents could read `.env` files inside allowed folders.

- **Don't store credentials on disk in plaintext.** OAuth tokens go in `safeStorage` (OS keychain). API keys in `llm.json` should be encrypted via `safeStorage.encryptString()` before writing. The deny-list is defense-in-depth, not the primary protection.

- **Don't use `path.join()` without `path.resolve()` + `realpath()` for sandbox checks.** `path.join('/safe', '../etc/passwd')` returns `/etc/passwd`. Always resolve, then verify the resolved path starts with the allowed root. See `electron/skill-loader.ts:255-276` for the correct pattern.

- **Don't create a global singleton for the sandbox.** Each session gets its own policy and backend instance. A shared sandbox would leak folder permissions between sessions.

- **Don't block file reads with a UI prompt.** Deny-listed files should fail silently with a clear error message to the agent ("Access denied: .env files are blocked for security"). No user prompt — the policy is non-negotiable.

## Patterns to Follow

- **Path traversal protection**: Mirror the pattern in `electron/skill-loader.ts:255-276` — resolve both paths, compare with `startsWith(normalizedRoot + path.sep)`. This is the project's established sandboxing pattern.

- **IPC channel registration**: Follow the existing pattern in `electron/ipc/storage.ts` and `electron/ipc/agent.ts` — one file per domain, typed handlers, registered in `main.ts`.

- **Preload bridge**: Follow `electron/preload.ts` existing structure — one namespace per domain (`dialog: { openFolder }` alongside existing `agent`, `storage`, `auth`).

- **Session metadata persistence**: Follow `src/stores/workflow-sessions.ts` pattern for updating index.json via `local-storage.ts`.

- **LangChain tool wrapping**: Follow `electron/agent/tool-definitions.ts` pattern — each tool is a `tool()` call with a Zod schema.

- **Destructive tool approval**: The existing `DESTRUCTIVE_TOOLS` set in `deep-agents-runner.ts:15-21` shows how to gate tools. File writes in user folders should NOT require approval (the folder attachment is the trust grant), but `write_file` in `~/.n8n-desk/skills/` could optionally be approval-gated.
