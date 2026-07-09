# Risk Mitigation Log

This log records codebase risk reviews and the concrete treatment applied after each review batch.

## 2026-07-08: Memory IPC Workspace Guard

Review lanes:

- Renderer-facing Memory IPC handlers for list/create/update/delete.
- Workspace-scoped and project-scoped Learning memory records.
- Reuse of main-process registered-workspace access policy.

Findings:

- Memory IPC accepted optional `workspaceRoot` values from the renderer and passed them directly into the Memory store.
- The Memory store normalized paths, but it did not know which Teaching workspaces were actually registered in the app state.
- Workspace/project memory creation could therefore tag a record with an arbitrary absolute path scope if the renderer supplied one.

Treatment:

- Generalized the registered workspace access Module to `src/main/teaching-workspace-access.ts` and added optional-root resolution for capabilities that may operate globally.
- Routed Memory list/create/update/delete IPC handlers through the registered workspace guard.
- Required workspace/project memory creation to include a registered Teaching workspace root, while preserving global user memory behavior.
- Extended the Git guard fixture to cover optional registered-root resolution, so Git and Memory share the same tested access primitive.

Verification:

- `npm run check:teaching-git-guards`
- `npm run check:memory-capture`
- `npm run check:teaching-ipc-contract`
- `npx tsc --noEmit`
- `npm run build`

Residual risk:

- Memory IPC access is now guarded at the main-process handler layer. Internal Memory creation from the conversation runtime still trusts its service dependencies to pass the active Teaching workspace root; that path stays separate because it does not accept direct renderer path input.

## 2026-07-08: Git IPC Workspace and Branch Guards

Review lanes:

- Renderer-facing Git IPC handlers for branch and worktree operations.
- Main-process authority checks around `workspaceRoot`.
- Git branch argument semantics for switch/create actions.

Findings:

- Git IPC handlers accepted `workspaceRoot` from the renderer and executed Git operations without first proving that the path was an exact registered Teaching workspace root.
- Existing branch switching used `execFile`, so there was no shell injection path, but untrusted branch strings could still be interpreted by Git as option-like input or reflog shorthand before any local-branch existence check.
- There was no focused fixture covering Git IPC access policy or branch argument hardening.

Treatment:

- Added `src/main/teaching-workspace-access.ts` as the registered workspace access Module. It resolves a requested root only when it exactly matches a registered Teaching workspace root.
- Routed list/switch/create branch IPC handlers and worktree removal through the registered-root guard before calling Git helpers.
- Tightened branch switching and creation so branch input must be a canonical local branch name; switching also requires the branch to exist locally and uses `git switch --no-guess` when available.
- Added `check:teaching-git-guards`, backed by a temporary real Git repository fixture, to cover registered-root checks, option-like branch rejection, reflog shorthand rejection, missing branch rejection, and valid switch/create flows.

Verification:

- `npm run check:teaching-git-guards`
- `npm run check:teaching-ipc-contract`
- `npx tsc --noEmit`
- `npm run build`

Residual risk:

- Worktree removal still delegates final safety to Git after the app confirms the worktree is listed by the repository and under the configured worktree root. A future pass could add realpath-based worktree-root checks if symlinked worktree roots become a supported workflow.

## 2026-07-08: Office Workbench Interaction Cleanup

Review lanes:

- Workbench canvas asset loading and render complexity.
- Domain fit of the visible Workbench scene.
- Pointer and keyboard access for desk selection.

Findings:

- The Workbench scene still loaded and orchestrated a multi-role demo office that did not map cleanly to the current StudiumX Teaching workspace domain.
- The canvas loaded many sprite atlases and maintained per-role animation branches even though the first useful interaction is assigning one Study character to a desk.
- The new desk-selection interaction needed a keyboard path and visible focus state before being committed.

Treatment:

- Reduced `OfficeWorkbench` to the workstation and working-character atlases, with desk slots as the stable interaction model.
- Replaced per-role animation branches with a single StudiumX character that can be assigned to any desk by pointer.
- Added keyboard desk selection with Arrow/Home/End keys, dynamic aria labeling, and a visible focus outline for the canvas.

Verification:

- `npm run build`

Residual risk:

- This batch is verified by TypeScript and production bundling only. A future browser-level fixture should exercise canvas hit testing and keyboard desk selection if Workbench interactions continue to grow.

## 2026-07-08: Workspace Write Tool Symlink Guard

Review lanes:

- Agent-accessible `write_workspace_file` tool path containment.
- Existing workspace read/write tool boundaries.
- Regression coverage for filesystem edge cases around missing targets and symlinks.

Findings:

- `write_workspace_file` resolved relative paths and verified real paths after writes, but the pre-write existence check used `stat`.
- A dangling symlink at the target leaf could look like a missing file to `stat`, then `writeFile` could follow the symlink and create the external target before the post-write realpath guard rejected it.
- The existing workspace write fixture covered protected paths, Lesson HTML rejection, and overwrite rules, but not dangling symlink write targets.

Treatment:

- Added a pre-write `lstat` check in `src/main/ai/tools/workspace.ts` and reject symlink leaf targets before any write attempt.
- Extended the workspace write fixture with a dangling symlink regression case that proves the external target is not created.
- Added `check:workspace-write-tool` to `package.json` so the existing check script is part of the standard npm command surface.

Verification:

- `npm run check:workspace-write-tool`
- `npm run check:tool-execution`
- `npx tsc --noEmit`
- `npm run build`

Residual risk:

- The tool now rejects all symlink leaf write targets, including symlinks that resolve inside the Teaching workspace. That is intentionally conservative; a future use case that needs editable in-workspace symlinks should add an explicit policy and fixtures before relaxing it.

## 2026-07-08: Study Session Transition Module

Review lanes:

- Study timer ticking and focus/break completion.
- Room and study-mode selection while preserving running timers.
- Contract locking, host action selection, task mutation, relay and ambient state changes.
- Existing Study Space hook responsibilities.

Findings:

- `useStudySession` mixed React effects with pure Session transition rules.
- Timer completion, streak/session/XP updates, room/mode transitions, contract defaults, and task toggling were hard to verify without rendering the hook.
- The hook was acting as both Adapter for browser/presence effects and implementation for the Study Session state machine.

Treatment:

- Added `src/renderer/src/study-space/session/transitions.ts` as a pure Study Session transition Module.
- Routed `useStudySession` through that Module for timer ticks, room/mode selection, contract/task changes, host action decisions, relay changes, and ambient controls.
- Added a focused transition fixture covering timer completion, room/mode transitions, host action ordering, contract defaults, tasks, and relay normalization.

Verification:

- `npm run check:study-session-transitions`
- `npx tsc --noEmit`

Residual risk:

- Notification and room-event dedupe still live in the hook because they depend on React lifecycle and presence Adapters. A future pass could represent those as declarative effects if the notification/event ordering becomes a maintenance hotspot.

## 2026-07-08: App Shell Context Transition Module

Review lanes:

- Sidebar primary view navigation.
- Course folder, Lesson reader, Resource reader, and Agent conversation opening transitions.
- Pending Agent conversation restore and workspace removal context cleanup.
- Existing teaching-mode and pending-conversation source checks.

Findings:

- `App.tsx` still bypassed the store interface for the overview navigation path.
- Cross-field app shell invariants were repeated in store actions: `view`, `overviewDialogMode`, reader state, selected Course, active conversation, pending conversation, and task prompt were patched inline.
- Several checks asserted fragile source text instead of exercising the transition behavior through one module interface.

Treatment:

- Added `src/renderer/src/app-shell/contextTransitions.ts` as a pure App shell context transition Module. Its interface owns primary view transitions, Teaching conversation entry, Course selection, pending conversation restore, Agent conversation opening, Lesson/Resource reader entry, and removed-workspace cleanup.
- Routed `src/renderer/src/app-shell/appStore.ts` and the sidebar overview navigation through the shared transition functions.
- Routed workspace activation/reset after select, create, import, and archived-root cleanup through the same transition interface.
- Added a focused transition fixture and updated teaching-mode / pending-conversation checks to assert behavior and wiring at the new interface.

Verification:

- `npm run check:app-shell-context-transitions`
- `npm run check:teaching-mode`
- `node scripts/check-pending-conversation-return.mjs`
- `npm run check:agent-conversation-state`
- `npm run check:sidebar-ui`
- `npm run check:workspace-removal`
- `npx tsc --noEmit`
- `npm run build`

Residual risk:

- `MainArea` still derives render-time display state from several fields. The transition Module now concentrates state changes, but a future view-model pass could make render derivation similarly explicit if that code becomes a maintenance hotspot.

## 2026-07-08: IPC Contract Module

Review lanes:

- Renderer-facing Teaching system invoke channels.
- Lesson and Agent chat stream event channels.
- Existing source checks for provider actions and lesson styles.

Findings:

- Main and preload Adapters repeated the same `teach:*` channel strings.
- Source checks compensated by asserting literal channel strings in both Adapters, so channel edits had weak locality.
- Payload parsing already had a deeper Module in `teaching-ipc-commands`; the remaining shallow seam was the channel contract itself.

Treatment:

- Added `src/shared/teaching-ipc-contract.ts` as the shared IPC contract Module. Its invoke map is typed against Promise-returning `TeachingSystemApi` capabilities, while stream events are named separately.
- Routed `src/main/index.ts` and `src/preload/index.ts` through the shared invoke/event channel maps.
- Added a focused IPC contract fixture and updated provider action / lesson style checks to assert shared-contract wiring instead of duplicated literal channels.

Verification:

- `npm run check:teaching-ipc-contract`
- `npm run check:teaching-ipc-commands`
- `npm run check:provider-actions`
- `npm run check:lesson-styles`
- `npm run check:agent-chat`
- `npm run check:conversation-lesson-tool`
- `npx tsc --noEmit`

Residual risk:

- Main handler registration is still in the Electron entry Module. Moving that safely would require injected Electron/dialog/shell/window Adapters and broader behavior fixtures; the current treatment intentionally deepens only the channel seam.

## 2026-07-08: Provider Format Module

Review lanes:

- Provider request headers and auth style.
- Model-list probe support, probe URL construction, and model-id parsing.
- Tool support checks in agent loops, parsers, and renderer settings.

Findings:

- Endpoint-format rules were split between request building, provider probing, response parsing, SSE parsing, and renderer settings.
- Renderer tool-support and model-list controls hard-coded endpoint-format strings instead of using the same interface as the main provider path.
- Provider request headers depended on `provider-connection`, creating an inverted dependency between provider calls and provider probing.

Treatment:

- Added `src/shared/provider-format.ts` as the shared Provider format Module. Its interface owns auth headers, JSON request headers, tool support, model-list probe support, model-list URLs, and model-id parsing.
- Kept a thin main-side re-export for provider adapter internals while routing `provider-connection`, request building, response parsing, SSE parsing, agent loop checks, and renderer settings through the shared Module.
- Added a focused fixture for the Provider format interface.

Verification:

- `npm run check:provider-format-adapters`
- `npm run check:provider-actions`
- `npm run check:model-settings-custom-provider`
- `npm run check:agent-chat`
- `npm run check:dsml-tool-calls`
- `npm run check:conversation-lesson-tool`
- `npm run check:teaching-ipc-commands`
- `npx tsc --noEmit`

Residual risk:

- Request body construction and response text extraction are still organized by helper Modules rather than per-format Adapter objects. The shared Module now owns the cross-cutting format facts, but a future pass could move request and parse behavior behind the same Adapter interface.

## 2026-07-08: Tool Execution Module

Review lanes:

- Agent loop tool-call dispatch.
- Tool handler result serialization and error signaling.
- DSML tool-call continuation and generated Lesson tool flow.

Findings:

- The agent loop owned argument parsing, handler lookup, thrown-error serialization, transcript insertion, and `tool_result` event flags inline.
- Some tools returned model-visible `{ "error": "..." }` payloads as ordinary strings, so `tool_result.isError` could be false even when the payload represented a tool failure.

Treatment:

- Added `src/main/ai/tools/execution.ts` as the Tool execution Module. Its interface executes one tool call and returns a normalized result: tool call id, tool name, serialized content, and error flag.
- Moved argument parsing, missing-handler errors, thrown-error serialization, and returned `{ error }` detection behind that interface.
- Kept the agent loop responsible only for transcript ordering and event emission.

Verification:

- `npm run check:tool-execution`
- `npm run check:agent-loop-empty-final`
- `npm run check:dsml-tool-calls`
- `npm run check:conversation-lesson-tool`
- `npx tsc --noEmit`

Residual risk:

- Tool handlers still return strings. A future deeper interface could let tool Implementations return structured values while this Module owns all serialization.

## 2026-07-08: Course and Session Placement Module

Review lanes:

- Lesson, Reference, Learning record, and review artifact placement.
- Course and Session catalog reconstruction from disk.
- Agent conversation Course placement and sidebar Course folders.

Findings:

- Lesson generation accepted a requested Course name, but still wrote every generated Lesson and sibling artifact into the default `lessons` Course.
- Course, Session, and conversation placement rules were duplicated across Lesson generation, Workspace catalog reconstruction, Agent conversation path helpers, renderer Course selection, and sidebar folder rendering.

Treatment:

- Added `src/shared/teaching-placement.ts` as the shared placement Module. Its interface owns default Course rules, custom Course rules, Lesson folder rules, Course/Session derivation from existing paths, and generated Lesson/Reference/Learning record/review artifact paths.
- Routed Lesson generation, Workspace catalog Course summaries, Agent conversation directory selection, sidebar Course folder rendering, and renderer Course selection through the shared placement Module.
- Added a focused placement fixture so these filesystem layout invariants can be tested without constructing a full Teaching workspace.

Verification:

- `npm run check:teaching-placement`
- `npm run check:agent-conversation-catalog`
- `npm run check:course-conversations`
- `npm run check:workspace-import-course`
- `npm run check:sidebar-ui`
- `npm run check:concept-overview`
- `npm run check:conversation-lesson-tool`
- `npm run build`

Residual risk:

- Existing Lessons that used non-canonical historical Course layouts still rely on catalog reconstruction heuristics. The shared placement Module now owns the canonical rules and the currently supported legacy conversation aliases.

## 2026-07-07: Imported Workspace Disk Removal Guard

Review lanes:

- Workspace import and removal capability.
- Recursive delete safety for top-level workspace folders.
- Existing course sidebar aggregation fixture.

Findings:

- `removeWorkspace({ mode: 'disk' })` prevented deleting a filesystem root, but it allowed recursive deletion of any imported directory after `importWorkspace` registered it as a StudiumX workspace.
- `importWorkspace` intentionally supports arbitrary user-selected directories and initializes them with `.teachos` metadata, so a marker-file check alone would not prove that the whole directory is safe to remove from disk.

Treatment:

- Tightened workspace disk removal so only workspaces inside the configured StudiumX workspace root can be recursively deleted.
- Kept external imported workspaces removable from the StudiumX list while preserving their files on disk.
- Extended the workspace import fixture to cover both allowed managed-workspace disk removal and denied imported-workspace disk removal.

Verification:

- `npm run check:workspace-import-course`
- `npm run build`

Residual risk:

- The renderer still offers the disk-removal action for imported top-level workspaces and surfaces the backend denial as an error. A future UX pass should hide or disable that destructive option when the workspace root is outside the managed StudiumX root.

## 2026-07-07: External Link and web_fetch Hardening

Review lanes:

- Main-process external link capability.
- Agent web_fetch SSRF guard.
- Affected behavior checks and build tooling.

Findings:

- `BrowserWindow.webContents.setWindowOpenHandler` opened arbitrary renderer-created URLs directly through `shell.openExternal`, bypassing the `privacy.allowExternalLinks` setting used by the explicit `teach:open-external` IPC capability.
- The `web_fetch` tool rejected non-http(s), localhost names, and common private IPv4 ranges, but it did not cover IPv6 loopback, IPv6 unique-local/link-local/multicast addresses, IPv4-mapped IPv6, special IPv4 notations normalized by `URL`, or hostnames resolving to blocked addresses.
- The provider action check asserted implementation text for external links rather than the shared capability interface.

Treatment:

- Added `src/main/external-links.ts` as the shared external-link Module. Its interface validates http(s) URLs, honors `privacy.allowExternalLinks`, invokes the provided opener Adapter, and returns structured `{ ok, message }` results.
- Routed both `teach:open-external` and renderer-created window opens through the shared external-link Module. Window opens are still denied inside Electron and only opened externally after the shared checks pass.
- Deepened `web_fetch` URL validation with `assertSafePublicHttpUrl`, including IPv6 private/local ranges, IPv4-mapped IPv6, special IPv4 forms normalized by `URL`, `.local`/`.localhost` hostnames, and DNS resolution checks for hostnames before fetch.
- Added behavior fixtures and npm scripts for external link controls and web_fetch safe URL checks.
- Updated the existing provider action check to assert that the shared external-link Module is wired into IPC and window-open handling.

Verification:

- `npm run check:external-link-controls`
- `npm run check:web-fetch-safe-url`
- `npm run check:provider-actions`
- `node scripts/check-wechat-web-tools.mjs`
- `npm run build`

Residual risk:

- DNS preflight reduces hostname-to-private SSRF risk, but it does not fully eliminate DNS rebinding between resolution and the actual fetch. A stricter future treatment would use a custom lookup Adapter for direct fetches and a documented policy for proxied fetches.
