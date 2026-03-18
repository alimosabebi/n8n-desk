# PRD: Chat History Management

## Overview

Add full CRUD operations for chat sessions across all modes (Chat, Cowork, Workflow) via a right-click context menu on session list items. Users can rename, delete, and manage their conversation history directly from the sidebar — replacing the current click-only session list with an interactive, manageable list. For Chat mode, rename and delete operations sync to the n8n server via `PATCH /chat/conversations/:sessionId` and `DELETE /chat/conversations/:sessionId` respectively.

## Problem Statement

The current `SessionList` component is display-only — users can click to switch sessions but have no way to rename or delete them from the list. The `deleteSession` method exists in the chat store but is not exposed through the UI in a discoverable way. There is no rename capability at all. As users accumulate sessions, they need standard list management (rename, delete) accessible via right-click (desktop) and long-press (mobile).

## Goals

- Right-click (desktop) / long-press (mobile) context menu on any session item
- Rename sessions inline (editable title)
- Delete sessions with confirmation
- Context menu works identically across Chat, Cowork, and Workflow sidebars
- Keyboard accessible (Escape to dismiss, Enter to confirm rename)

## Non-Goals

- Bulk selection / multi-delete (future enhancement)
- Archive viewing or restore UI (separate feature)
- Drag-and-drop reordering of sessions
- Session pinning or favoriting
- Cowork/Workflow store implementation (those stores are stubs — this PRD wires up the UI pattern so it works when stores are real)

## Technical Design

### Data Model Changes

Add `renameSession` action to the chat store:

```typescript
// src/stores/chat.ts — new action
async function renameSession(id: string, newTitle: string) {
  const session = sessions.value.find(s => s.id === id)
  if (!session) return
  session.title = newTitle.trim()
  session.updatedAt = new Date().toISOString()
  await persistSessionIndex()
}
```

No schema changes — `title` already exists on `SessionMeta`. The rename simply updates the title and persists.

### Interface Changes

**SessionList.vue** — new props and emits:

```typescript
// New emits
defineEmits<{
  select: [id: string]
  rename: [id: string, newTitle: string]
  delete: [id: string]
}>()
```

**New component: `SessionContextMenu.vue`**

A popover/dropdown that appears on right-click or long-press, anchored to the session item. Contains:
- Rename (Pencil icon) — switches the item into inline edit mode
- Delete (Trash icon) — shows confirmation, then emits delete

### New Commands / API / UI

**Context Menu Actions:**

| Action | Icon | Behavior |
|--------|------|----------|
| Rename | `Pencil` (lucide) | Switches session title to an inline `<input>`, auto-focused, commits on Enter/blur, cancels on Escape |
| Delete | `Trash2` (lucide) | Shows `ion-alert` confirmation dialog: "Delete this chat? It will be archived for 30 days." → on confirm, emits `delete` |

**Interaction Patterns:**

| Platform | Trigger | Component |
|----------|---------|-----------|
| Desktop | Right-click on session item | `ion-popover` anchored to click event |
| Mobile | Long-press (500ms) on session item | `ion-action-sheet` from bottom |
| Keyboard | Focus item → Shift+F10 or Menu key | Same popover as right-click |

### Migration Strategy

No data migration needed. Existing sessions already have `title` fields. The `deleteSession` store method already handles archiving. This is purely a UI addition.

## Implementation Steps

1. **Add `renameSession` to chat store** — In `src/stores/chat.ts`, add a `renameSession(id, newTitle)` action that updates the session's title and `updatedAt`, then calls `persistSessionIndex()`. Validate that `newTitle.trim()` is non-empty (fall back to previous title if empty).

2. **Add i18n keys** — In `src/i18n/locales/en.json`, add keys under `sidebar`: `"rename"`, `"delete"`, `"deleteConfirmTitle"`, `"deleteConfirmMessage"`, `"deleteConfirmButton"`, `"cancel"`.

3. **Create `SessionContextMenu.vue`** — New component at `src/components/sidebar/SessionContextMenu.vue`. Uses `ion-popover` on desktop and `ion-action-sheet` on mobile (detect via `isPlatform('mobile')` from `@ionic/vue`). Props: `sessionId`, `sessionTitle`, `isOpen`, `event` (for popover positioning). Emits: `rename`, `delete`, `dismiss`. Menu items use Lucide icons (`Pencil`, `Trash2`).

4. **Add inline rename to `SessionList.vue`** — When a session is in "editing" state, replace the `<ion-label>` with an `<input>` element (native input, not ion-input, for minimal overhead inside a list). Auto-focus on enter edit mode. Commit on Enter or blur, cancel on Escape. Emit `rename` with the new title. Track editing state with a local `editingSessionId` ref.

5. **Wire context menu into `SessionList.vue`** — Add `@contextmenu.prevent` handler on each `session-item` that opens the context menu popover. Add `@long-press` support via a `v-longpress` directive or `pointerdown`/`pointerup` timer (500ms threshold). When context menu emits `rename`, set `editingSessionId`. When it emits `delete`, emit the `delete` event upward (let the sidebar handle confirmation + store call).

6. **Add delete confirmation in sidebar components** — In `ChatSidebar.vue`, handle the `delete` event from `SessionList` by showing an `ion-alert` confirmation dialog. On confirm, call `chatStore.deleteSession(id)`. Apply the same pattern in `CoworkSidebar.vue` and `WorkflowSidebar.vue` (wired to their respective stores when available, or no-op with a TODO comment for now).

7. **Update all three sidebars to pass new events** — Update `ChatSidebar.vue`, `CoworkSidebar.vue`, and `WorkflowSidebar.vue` to bind the new `@rename` and `@delete` events from `SessionList`. Chat sidebar calls `chatStore.renameSession(id, newTitle)` on rename. Cowork/Workflow sidebars add TODO stubs.

8. **Style the context menu and inline edit** — Style the popover menu items to match n8n-desk's design tokens. The inline edit input should match the session item's font size, padding, and background. Delete action text should use `--color--danger` for the icon/text color.

## Validation Criteria

- [ ] Right-clicking a session item on desktop opens a popover with "Rename" and "Delete" options
- [ ] Long-pressing a session item on mobile opens an action sheet with the same options
- [ ] Selecting "Rename" switches the session title to an editable input, auto-focused
- [ ] Pressing Enter commits the rename; the new title persists across app restart
- [ ] Pressing Escape cancels the rename and reverts to the original title
- [ ] An empty rename (whitespace only) reverts to the original title instead of saving
- [ ] Clicking away from the rename input commits the current value (blur = save)
- [ ] Selecting "Delete" shows a confirmation alert before deleting
- [ ] Confirming delete archives the session (moves to `.archive/`) and switches to the next session
- [ ] Canceling delete dismisses the alert with no side effects
- [ ] The context menu closes when clicking outside it
- [ ] The context menu works in Chat, Cowork, and Workflow sidebars
- [ ] Keyboard: Shift+F10 on a focused session item opens the context menu
- [ ] All menu items use Lucide icons, no emojis
- [ ] Session index (`index.json`) is updated after rename with new `updatedAt`
- [ ] The context menu does not appear on the "No sessions found" empty state item

## Anti-Patterns to Avoid

- **Don't use `ion-item-sliding` for swipe-to-delete.** It conflicts with the session list's scroll behavior and doesn't provide rename. Use a context menu instead.
- **Don't create a custom dropdown from scratch.** Use `ion-popover` (desktop) and `ion-action-sheet` (mobile) — they handle positioning, backdrop dismiss, and accessibility automatically.
- **Don't rewrite the JSONL file on rename.** Rename only changes the session index (`index.json`), not the message history file. The JSONL file has no title field.
- **Don't add a visible "..." menu button on every session item.** It adds visual clutter. The context menu is triggered by right-click/long-press — discoverable but not cluttering.
- **Don't use emojis for menu icons.** CLAUDE.md rule: always use Lucide icons.

## Patterns to Follow

- **Store action pattern** — Follow the existing `deleteSession` in `src/stores/chat.ts` for how `renameSession` should update state and persist. Same `persistSessionIndex()` call at the end.
- **Component composition** — `SessionList.vue` (`src/components/sidebar/SessionList.vue`) is the shared list component. All changes go here so all three sidebars benefit automatically.
- **Ionic platform detection** — Use `isPlatform('mobile')` from `@ionic/vue` to choose between `ion-popover` and `ion-action-sheet`. See Ionic docs for the pattern.
- **i18n pattern** — Follow existing keys in `src/i18n/locales/en.json` under the `sidebar` namespace.
- **Design tokens** — Use `--n8n-desk--surface-raised-bg` for hover states, `--color--danger` for delete actions. Follow existing styles in `SessionList.vue`.
