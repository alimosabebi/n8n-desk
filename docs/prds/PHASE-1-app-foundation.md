# PRD: App Foundation — Ionic Vue + Electron + Capacitor Scaffold

## Overview

Bootstrap the n8n-desk application from zero to a running cross-platform shell. This PRD covers the complete project scaffold: Ionic 8 + Vue 3 with TypeScript, Electron Forge for desktop, Capacitor for mobile (iOS/Android), tab-based routing with platform-aware mode visibility, n8n design token theming with dark mode, all five Pinia store shells, the `~/.n8n-desk/` local storage service, and the Electron IPC skeleton. The result is a fully buildable, runnable app that opens on all platforms with placeholder views — ready for feature PRDs to fill in.

## Problem Statement

n8n-desk is a greenfield project with no source code. Before any feature can be built (onboarding, chat, cowork, workflow), the foundational app shell must exist: build tooling, routing, theming, state management, local persistence, and platform-specific native shells. Without this foundation, every subsequent PRD would need to repeat scaffold setup, leading to inconsistency and rework.

## Goals

- Ionic 8 + Vue 3 (`<script setup>`, Composition API) app that builds and runs in browser via `pnpm dev`
- Electron Forge desktop app that opens a window with the Ionic app via `pnpm dev:electron`
- Capacitor iOS and Android projects that build and run on simulators
- Tab-based routing: Chat, Cowork, Workflow — with platform detection (mobile shows only Chat)
- n8n design token theming (copied from n8n-master) with light/dark mode toggle synced to `prefers-color-scheme`
- All 5 Pinia stores (instances, auth, chat, workflows, settings) with typed interfaces and stub methods
- `local-storage.ts` service with `readJson`, `writeJson`, `appendJsonl`, and directory initialization for `~/.n8n-desk/`
- Electron preload script with `contextBridge` exposing typed IPC channel stubs (storage, auth, agent, keychain)
- Vite config with `<n8n-demo>` custom element support
- Vitest configured and passing with at least one smoke test
- All components use Ionic platform-adaptive components (`IonPage`, `IonContent`, `IonTabs`, etc.)

## Non-Goals

- No onboarding flow or OAuth implementation (separate PRD)
- No Chat-Hub API integration or WebSocket streaming
- No Deep Agents SDK integration or agent execution
- No MCP tool calls or workflow operations
- No AskAssistant chat component fork (separate PRD)
- No `<n8n-demo>` web component integration beyond Vite config
- No CI/CD pipeline setup
- No production packaging or code signing

## Technical Design

### Data Model Changes

No external data models. This PRD establishes the local file structures:

**`~/.n8n-desk/config.json`** (global settings):
```json
{
  "theme": "system",
  "defaultInstanceId": null,
  "lastMode": "chat"
}
```

**`~/.n8n-desk/instances/`** — empty directory, ready for instance subdirectories.

**`~/.n8n-desk/llm.json`** — empty object `{}`, ready for LLM provider config.

### Interface Changes

**New TypeScript interfaces** (in `src/types/`):

```ts
// src/types/instance.ts
interface Instance {
  id: string
  label: string
  url: string
  color: string
  addedAt: string // ISO 8601
}

// src/types/session.ts
interface SessionMeta {
  id: string
  title: string
  agentId?: string
  agentName?: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  ts: string
  meta?: Record<string, unknown>
}

// src/types/auth.ts
interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  userRole: 'owner' | 'admin' | 'member' | 'chatUser' | 'unknown'
  scopes: string[]
  expiresAt: string | null
}

// src/types/settings.ts
interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  defaultInstanceId: string | null
  lastMode: 'chat' | 'cowork' | 'workflow'
}

type AppMode = 'chat' | 'cowork' | 'workflow'
```

### New Commands / API / UI

**pnpm scripts:**
| Script | Action |
|---|---|
| `pnpm dev` | Vite dev server (browser) |
| `pnpm dev:electron` | Electron Forge dev mode |
| `pnpm build` | Vite production build |
| `pnpm build:electron` | Electron Forge package |
| `pnpm test` | Vitest run |
| `pnpm test:watch` | Vitest watch mode |

**Views (placeholder content):**
| Route | View | Description |
|---|---|---|
| `/chat` | `ChatView.vue` | "Chat mode — coming soon" placeholder with `IonPage` |
| `/cowork` | `CoworkView.vue` | "Cowork mode — coming soon" placeholder |
| `/workflow` | `WorkflowView.vue` | "Workflow mode — coming soon" placeholder |
| `/settings` | `SettingsView.vue` | Theme toggle (light/dark/system) — functional |
| `/onboarding` | `OnboardingView.vue` | "Connect to n8n" placeholder |

**Tab bar:** Bottom tabs on mobile (Chat only), top tabs on desktop (Chat, Cowork, Workflow).

### Migration Strategy

Not applicable — greenfield project, no existing data or behavior to migrate.

## Implementation Steps

1. **Initialize the project with Ionic Vue CLI** — Run `npm install -g @ionic/cli` then `ionic start n8n-desk tabs --type vue --capacitor` in a temporary location, then move the generated files into the project root. Switch package manager to pnpm. Update `package.json` name to `n8n-desk`. Ensure `ionic.config.json`, `capacitor.config.ts`, `vite.config.ts`, and `tsconfig.json` are present and configured. Add `@n8n_io/n8n-demo-component` to dependencies. Configure Vite's `vue` plugin with `isCustomElement: (tag) => tag === 'n8n-demo'`.

   **Files created:** `package.json`, `pnpm-lock.yaml`, `ionic.config.json`, `capacitor.config.ts`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `src/App.vue`

2. **Set up Electron Forge** — Install `@electron-forge/cli`, `@electron-forge/maker-zip`, `@electron-forge/plugin-vite` (or `@electron-forge/plugin-auto-unpack-natives`). Create `electron/main.ts` that creates a `BrowserWindow` loading the Vite dev server URL (dev) or the built `index.html` (production). Create `electron/preload.ts` with `contextBridge` stubs. Add `forge.config.ts` at project root. Add `pnpm dev:electron` and `pnpm build:electron` scripts to `package.json`. Ensure `nodeIntegration: false` and `contextIsolation: true` on the BrowserWindow.

   **Files created:** `electron/main.ts`, `electron/preload.ts`, `forge.config.ts`
   **Files modified:** `package.json` (scripts + devDependencies)

3. **Set up Capacitor for iOS and Android** — Ensure `capacitor.config.ts` has `appId: 'com.n8ndesk.app'`, `appName: 'n8n-desk'`, `webDir: 'dist'`. Run `npx cap add ios` and `npx cap add android`. Configure the custom URL scheme `n8ndesk://` for OAuth deep links in both platform configs. Add `npx cap sync` as a post-build step.

   **Files created:** `ios/` directory, `android/` directory
   **Files modified:** `capacitor.config.ts`

4. **Create the type definitions** — Create all TypeScript interfaces in `src/types/`. These are the shared contracts used by stores, services, and components.

   **Files created:** `src/types/instance.ts`, `src/types/session.ts`, `src/types/auth.ts`, `src/types/settings.ts`, `src/types/mcp.ts`, `src/types/agent.ts`

5. **Set up tab-based routing with platform detection** — Create `src/router/index.ts` with Vue Router + Ionic's `IonRouterOutlet`. Define routes for `/chat`, `/cowork`, `/workflow`, `/settings`, `/onboarding`. Create a `src/composables/usePlatform.ts` composable that detects whether the app is running in Capacitor native (mobile) vs Electron/web (desktop) using `Capacitor.isNativePlatform()`. In the tab layout component, conditionally render only the Chat tab on mobile, all three tabs on desktop/web. Default route: redirect `/` to `/chat`.

   **Files created:** `src/router/index.ts`, `src/composables/usePlatform.ts`

6. **Create placeholder views** — Create all five views as minimal `IonPage` + `IonHeader` + `IonContent` components with placeholder text. `SettingsView.vue` should include a working theme toggle (light/dark/system) using `IonSegment` or `IonSelect`, wired to the settings store and `useTheme` composable. Each view uses `<script setup lang="ts">`.

   **Files created:** `src/views/ChatView.vue`, `src/views/CoworkView.vue`, `src/views/WorkflowView.vue`, `src/views/SettingsView.vue`, `src/views/OnboardingView.vue`

7. **Create the tab layout component** — Create `src/App.vue` with `IonApp` wrapping `IonRouterOutlet`. Create `src/views/TabsLayout.vue` with `IonTabs`, `IonTabBar`, and `IonTabButton` for each mode. Use the `usePlatform` composable to conditionally show tabs. The tab bar should be at the bottom on mobile, and styled as a top navigation bar on desktop/web using CSS and Ionic's platform classes.

   **Files modified:** `src/App.vue`
   **Files created:** `src/views/TabsLayout.vue`

8. **Copy n8n design tokens and set up theming** — Copy `_primitives.scss` and `_tokens.scss` from `n8n-master/packages/frontend/@n8n/design-system/src/css/` into `src/theme/n8n-tokens.scss` (combine into one file or two imports). Create `src/theme/variables.scss` that maps key n8n tokens to Ionic CSS variables:
   - `--ion-color-primary: var(--color--primary)`
   - `--ion-color-success: var(--color--success)`
   - `--ion-color-warning: var(--color--warning)`
   - `--ion-color-danger: var(--color--danger)`
   - `--ion-background-color: var(--color--background)`
   - `--ion-text-color: var(--color--text)`
   - Font family: `InterVariable, sans-serif`

   Create `src/theme/global.scss` that imports tokens, variables, and sets up the `body[data-theme='dark']` / `body[data-theme='light']` selectors matching n8n's pattern. Create `src/composables/useTheme.ts` that reads the settings store's theme preference, applies the `data-theme` attribute to `<body>`, and listens to `prefers-color-scheme` changes when set to `system`.

   **Files created:** `src/theme/n8n-tokens.scss`, `src/theme/variables.scss`, `src/theme/global.scss`, `src/composables/useTheme.ts`

9. **Create all five Pinia store shells** — Install Pinia. Create each store with `defineStore` using Composition API (`setup` function style). Each store has typed state (refs), computed getters, and stub async methods (`hydrate`, `reset`). No actual implementation — just the interface contract.

   **`src/stores/instances.ts`:**
   - State: `instances: Ref<Instance[]>`, `activeInstanceId: Ref<string | null>`
   - Getters: `activeInstance`, `hasInstances`
   - Methods: `hydrate()`, `reset()`, `addInstance()`, `removeInstance()`, `setActive()`

   **`src/stores/auth.ts`:**
   - State: `accessToken`, `userRole`, `scopes`, `expiresAt`
   - Getters: `isAuthenticated`, `isFullAccess` (role !== chatUser)
   - Methods: `hydrate()`, `reset()`, `setTokens()`, `clearTokens()`

   **`src/stores/chat.ts`:**
   - State: `sessions: Ref<SessionMeta[]>`, `activeSessionId`, `messages: Ref<SessionMessage[]>`
   - Getters: `activeSession`, `sortedSessions`
   - Methods: `hydrate()`, `reset()`, `createSession()`, `deleteSession()`, `appendMessage()`

   **`src/stores/workflows.ts`:**
   - State: `workflows: Ref<any[]>`, `searchQuery`, `isLoading`
   - Getters: `filteredWorkflows`
   - Methods: `hydrate()`, `reset()`, `search()`, `invalidateCache()`

   **`src/stores/settings.ts`:**
   - State: `theme`, `defaultInstanceId`, `lastMode`
   - Methods: `hydrate()`, `save()`, `setTheme()`, `setLastMode()`

   **Files created:** `src/stores/instances.ts`, `src/stores/auth.ts`, `src/stores/chat.ts`, `src/stores/workflows.ts`, `src/stores/settings.ts`

10. **Implement the local-storage service** — Create `src/services/local-storage.ts` with:
    - `getBasePath()`: returns `~/.n8n-desk/` (resolved via `os.homedir()` in Electron main, or Capacitor Filesystem on mobile)
    - `initDirectory()`: creates the directory structure if it doesn't exist
    - `readJson<T>(relativePath: string): Promise<T | null>`: reads and parses a JSON file
    - `writeJson(relativePath: string, data: unknown): Promise<void>`: writes JSON with 2-space indent
    - `readJsonl<T>(relativePath: string): Promise<T[]>`: reads and parses a JSONL file line by line
    - `appendJsonl(relativePath: string, item: unknown): Promise<void>`: appends a single JSON line
    - `exists(relativePath: string): Promise<boolean>`: checks if a file exists

    On Electron, this service calls through IPC (`storage:read`, `storage:write`, `storage:append`). On web (dev), it uses a mock/localStorage fallback. On Capacitor mobile, it uses the Capacitor Filesystem API.

    **Files created:** `src/services/local-storage.ts`

11. **Set up Electron IPC skeleton** — Create the IPC handler registration files as stubs. Each handler file exports a `register(ipcMain, mainWindow)` function.

    **`electron/ipc/storage.ts`:** Handles `storage:read`, `storage:write`, `storage:append` — implements actual `fs` read/write to `~/.n8n-desk/`.

    **`electron/ipc/auth.ts`:** Stubs for `auth:login`, `auth:logout`, `auth:refresh` — returns `{ error: 'not implemented' }`.

    **`electron/ipc/agent.ts`:** Stubs for `agent:invoke`, `agent:stop`, `agent:approve` — returns `{ error: 'not implemented' }`. Registers `agent:event` send channel.

    **`electron/ipc/keychain.ts`:** Stubs for `keychain:get`, `keychain:set`, `keychain:delete` — returns `{ error: 'not implemented' }`.

    Update `electron/preload.ts` to expose all channels via `contextBridge.exposeInMainWorld('n8nDesk', { ... })` with full TypeScript types.

    Update `electron/main.ts` to import and register all IPC handlers.

    **Files created:** `electron/ipc/storage.ts`, `electron/ipc/auth.ts`, `electron/ipc/agent.ts`, `electron/ipc/keychain.ts`
    **Files modified:** `electron/preload.ts`, `electron/main.ts`

12. **Wire up app initialization** — Update `src/main.ts` to:
    - Create the Vue app with Ionic (`IonicVue`)
    - Install Pinia
    - Install the router
    - On app mount: call `settingsStore.hydrate()` then `useTheme().init()` to apply the saved theme
    - Register the app with `app.mount('#app')`

    **Files modified:** `src/main.ts`

13. **Add utility stubs** — Create `src/utils/markdown.ts` (stub that returns input as-is for now) and `src/utils/sanitize.ts` (stub that returns input as-is). These will be properly implemented when the chat UI PRD is executed.

    **Files created:** `src/utils/markdown.ts`, `src/utils/sanitize.ts`

14. **Configure Vitest and write smoke tests** — Install `vitest`, `@vue/test-utils`, `@ionic/vue-test-utils` (if available). Create `vitest.config.ts`. Write tests:
    - `src/stores/__tests__/settings.test.ts`: settings store hydrates and saves theme
    - `src/composables/__tests__/usePlatform.test.ts`: platform detection returns expected values
    - `src/services/__tests__/local-storage.test.ts`: readJson/writeJson round-trip (with mock fs)

    **Files created:** `vitest.config.ts`, `src/stores/__tests__/settings.test.ts`, `src/composables/__tests__/usePlatform.test.ts`, `src/services/__tests__/local-storage.test.ts`

15. **Add ESLint and TypeScript strict mode** — Install `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint-plugin-vue`. Create `.eslintrc.cjs` with Vue 3 + TypeScript recommended rules. Ensure `tsconfig.json` has `"strict": true` and `"noImplicitAny": true`. Add `pnpm lint` script.

    **Files created:** `.eslintrc.cjs`
    **Files modified:** `tsconfig.json`, `package.json`

16. **Update .gitignore** — Ensure the following are ignored: `node_modules/`, `dist/`, `n8n-master/`, `ios/`, `android/`, `.env`, `*.local`, `electron/out/`.

    **Files modified:** `.gitignore`

## Validation Criteria

- [ ] `pnpm install` completes without errors
- [ ] `pnpm dev` starts Vite dev server and loads the app in a browser at localhost
- [ ] App shows 3 tabs (Chat, Cowork, Workflow) on desktop/web
- [ ] Navigating between tabs renders the correct placeholder view
- [ ] Settings view has a working theme toggle — switching between light/dark/system applies immediately
- [ ] Dark mode correctly inverts colors using n8n design tokens
- [ ] `body[data-theme='dark']` is set when dark mode is active
- [ ] `body[data-theme='light']` is set when light mode is active
- [ ] System theme preference (`prefers-color-scheme`) is respected when theme is set to "system"
- [ ] `pnpm dev:electron` opens an Electron window with the Ionic app rendered inside
- [ ] Electron window has `nodeIntegration: false` and `contextIsolation: true`
- [ ] `window.n8nDesk` is available in the Electron renderer (exposed via contextBridge)
- [ ] `window.n8nDesk.storage.read` and `write` work end-to-end (Electron only)
- [ ] `npx cap sync` succeeds for both iOS and Android
- [ ] `npx cap open ios` opens the Xcode project (macOS only)
- [ ] On a simulated mobile device (or narrow viewport), only the Chat tab is visible
- [ ] All 5 Pinia stores can be instantiated without errors
- [ ] `settingsStore.hydrate()` reads from `~/.n8n-desk/config.json` (or creates defaults)
- [ ] `settingsStore.setTheme('dark')` persists to `config.json` and applies to the UI
- [ ] `pnpm test` runs Vitest and all smoke tests pass
- [ ] `pnpm lint` passes with no errors
- [ ] TypeScript strict mode is enabled — `pnpm build` produces no type errors
- [ ] No `any` types in any source file (excluding test mocks)
- [ ] The `<n8n-demo>` tag is registered as a custom element in Vite config (no Vue warning when used)

## Anti-Patterns to Avoid

- **Do NOT use Options API or `defineComponent()`** — All components must use `<script setup lang="ts">`. This is the project convention established in CLAUDE.md and mixing patterns causes inconsistency.

- **Do NOT build custom layout primitives** — Use Ionic components (`IonPage`, `IonContent`, `IonHeader`, `IonToolbar`, `IonTabs`, `IonTabBar`) for all layout and navigation. They handle platform-adaptive styling automatically. Building custom divs with flexbox defeats the purpose of Ionic.

- **Do NOT use Pinia persistence plugins** — The project controls its own storage format (JSONL for sessions, JSON for config). Stores hydrate from `~/.n8n-desk/` via `local-storage.ts` and flush back on mutation. Third-party persistence plugins would conflict with this design.

- **Do NOT store tokens or secrets in the local-storage service** — Tokens go in the OS keychain (Electron `safeStorage`, Capacitor secure storage). `auth.json` stores only non-secret metadata (client ID, expiry, scopes). This is a security requirement from CLAUDE.md.

- **Do NOT import from `n8n-master/` at build time** — Copy the SCSS token files into `src/theme/`. The `n8n-master/` directory is gitignored reference material, not a linked dependency. Build-time imports from it will break CI and other developers' builds.

- **Do NOT use barrel exports (`index.ts` re-exports)** — Import directly from the source file. This is a project convention that keeps imports explicit and avoids circular dependency issues.

- **Do NOT add `.then()` chains** — Use `async/await` everywhere. This is a project convention for readability and consistent error handling.

- **Do NOT hard-code platform detection** — Use the `usePlatform` composable so platform logic is centralized and testable. Scattering `Capacitor.isNativePlatform()` checks across components makes platform behavior untestable and inconsistent.

- **Do NOT create the `~/.n8n-desk/` directory with broad permissions** — On desktop, ensure file permissions are restrictive (`0700` for directories, `0600` for files containing API keys like `llm.json`).

## Patterns to Follow

- **Ionic Vue page pattern** — Every view wraps content in `<ion-page><ion-header><ion-toolbar>...</ion-toolbar></ion-header><ion-content>...</ion-content></ion-page>`. See Ionic Vue documentation for the canonical structure.

- **Pinia Composition API stores** — Use `defineStore('name', () => { ... })` with `ref()` for state, `computed()` for getters, and plain functions for actions. See `CLAUDE.md` "Pinia Stores" section for the exact pattern.

- **Service layer separation** — Components → Composables → Services → External APIs. Never put `fetch()` or `fs` calls directly in a component. See `CLAUDE.md` "Service Layer" section.

- **Electron IPC channel-per-domain** — One file per domain (`storage.ts`, `auth.ts`, `agent.ts`, `keychain.ts`). Each exports a `register` function. See `CLAUDE.md` "Electron IPC Architecture" section for the full channel list and preload pattern.

- **CSS Modules for component styles** — Use `<style lang="scss" module>` in components. Import global tokens via SCSS `@use`. See `CLAUDE.md` "Code Conventions" section.

- **n8n dark mode pattern** — `body[data-theme='light']` and `body[data-theme='dark']` selectors with the `@include theme` / `@include theme-dark` mixin pattern from `_tokens.scss`. The `useTheme` composable manages the `data-theme` attribute.
