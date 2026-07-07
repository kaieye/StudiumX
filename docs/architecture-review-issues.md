# TeachOS Architecture Review Issues

Date: 2026-07-04

Source: architecture review of the TeachOS codebase. These are deepening candidates only; no module interfaces are proposed here.

## 1. Deepen Course and Session Placement

Recommendation: Strong

Files:

- `src/main/teaching-lesson-generation.ts`
- `src/main/teaching-workspace-catalog.ts`
- `src/shared/agent-conversation-catalog.ts`
- `src/shared/course-sidebar.ts`
- `src/renderer/src/App.tsx`

Problem:

Course and Session placement leaks across modules. A Lesson generation request can carry a Course name, but the implementation still derives the generated Lesson path from the default `lessons` Course. Workspace catalog, Agent conversation placement, sidebar rendering, and renderer helpers each know parts of the placement rules.

Solution direction:

Deepen placement into one module that owns default Course rules, legacy Course rules, and generated asset paths for Lessons, References, Learning records, reviews, and Agent conversations.

Benefits:

- Locality: placement bugs concentrate in one module.
- Leverage: all callers reuse the same Course and Session rules.
- Tests can use the placement interface as the test surface.
- Domain vocabulary stops leaking into unrelated modules.

Treatment:

- 2026-07-08: Added the shared placement Module and routed Lesson generation, Workspace catalog reconstruction, Agent conversation placement, sidebar folders, and renderer Course selection through it.

## 2. Collapse the IPC Capability Seam

Recommendation: Strong

Files:

- `src/main/index.ts`
- `src/preload/index.ts`
- `src/main/teaching-ipc-commands.ts`
- `src/shared/teaching-types.ts`
- `src/renderer/src/App.tsx`
- `scripts/check-provider-actions.mjs`

Problem:

One visible capability crosses several modules: shared types, payload parsing, main IPC registration, preload adapter, renderer caller, and source-text check scripts. The current seam has no concentrated interface, so tests assert implementation text instead of behavior through a module.

Solution direction:

Deepen each IPC capability into one module, then keep Electron-specific code as adapters at the main/preload seam.

Benefits:

- Locality: channel edits concentrate.
- Leverage: payload parsing and handler wiring can be tested once.
- Adapters stay thin.
- Tests can cross one interface instead of matching source text.

Treatment:

- 2026-07-08: Added a shared IPC contract Module so main and preload Adapters reuse one channel interface, with a focused contract fixture covering unique invoke/event channels.

## 3. Narrow the Teaching Workspace Module

Recommendation: Worth exploring

Files:

- `src/main/teaching-workspace.ts`
- `src/main/teaching-workspace-catalog.ts`
- `src/main/teaching-agent-conversations.ts`
- `src/main/teaching-lesson-generation.ts`
- `src/main/teaching-memory.ts`
- `src/main/teaching-git.ts`

Problem:

The Teaching workspace module has depth in places, but its public interface also exposes every asset workflow. Registry, Workspace catalog, Mission writes, Lesson generation, Agent conversation persistence, temporary conversations, path meta, review progress, preview files, memory, and Git knowledge all meet in one implementation.

Solution direction:

Keep the Teaching workspace module as orchestration, while moving durable Teaching workspace asset rules behind deeper modules named by the domain concepts.

Benefits:

- Locality: asset rules split by domain concept.
- The deletion test becomes clearer.
- Tests can target asset modules directly.
- Runtime orchestration stays smaller.

## 4. Deepen the Renderer Shell

Recommendation: Worth exploring

Files:

- `src/renderer/src/App.tsx`
- `src/renderer/src/agent-conversation-state.ts`
- `src/renderer/src/agent-process-timeline.ts`
- `src/shared/course-sidebar.ts`
- `src/shared/workspace-removal-state.ts`
- `src/renderer/src/i18n/locales/*.json`

Problem:

`App.tsx` is a shallow renderer shell. Its interface is close to the whole application state, and locality drops when settings, Agent conversation, Lesson preview, memory, Git worktree, or Workspace list behavior changes.

Solution direction:

Deepen the renderer around view modules and store slices, preserving the existing pure shared modules that already provide leverage.

Benefits:

- Locality: view changes shrink.
- Tests can hit store-slice interfaces.
- Existing pure modules remain reusable.
- `App.tsx` becomes the navigation shell.

## 5. Unify Provider Capability Rules

Recommendation: Worth exploring

Files:

- `src/shared/teaching-types.ts`
- `src/main/teaching-settings.ts`
- `src/main/ai/provider-adapter.ts`
- `src/renderer/src/App.tsx`
- `scripts/check-model-settings-custom-provider.mjs`

Problem:

Reasoning effort and provider capability rules are duplicated in renderer and main code. Provider changes can leak across the seam because UI choices and request construction derive capability rules separately.

Solution direction:

Deepen provider capability into a shared module that both UI choices and request construction read from.

Benefits:

- Locality: provider rules concentrate.
- Leverage: one capability source feeds renderer and main code.
- Adapter behavior stays aligned with settings UI.
- Tests can use the shared provider capability interface.

## Top Recommendation

Start with Course and Session placement.

It is a real domain seam, it already leaks into Lesson generation, Workspace catalog, Agent conversation placement, sidebar rendering, and renderer helpers, and it has the smallest path to better locality and test leverage.

## Follow-up Treatment: Deepen Tool Execution

Recommendation: Strong

Files:

- `src/main/ai/agent-loop.ts`
- `src/main/ai/tools/registry.ts`
- `src/main/ai/tools/web_fetch.ts`
- `src/main/ai/tools/web_search.ts`

Problem:

The Tool interface was wider than `handler(args) => string`: argument parsing, missing tool handling, thrown errors, returned `{ error }` payloads, transcript binding, and `isError` events were split between the agent loop and individual tools.

Treatment:

- 2026-07-08: Added a Tool execution Module so the agent loop receives one normalized tool result with call id, name, serialized content, and error flag.

## Follow-up Treatment: Deepen Provider Format Rules

Recommendation: Strong

Files:

- `src/shared/provider-format.ts`
- `src/main/ai/provider-adapter/request-builder.ts`
- `src/main/provider-connection.ts`
- `src/renderer/src/workflows/settings.ts`
- `src/renderer/src/views/settings/SettingsView.tsx`
- `src/renderer/src/views/settings/sections/ModelProviderSettingsSection.tsx`

Problem:

Provider format facts leaked across main and renderer modules: tool support, auth headers, model-list probing, model-id parsing, and UI affordances each carried endpoint-format rules.

Treatment:

- 2026-07-08: Added a shared Provider format Module so main provider calls, model probing, response parsing, SSE parsing, and renderer settings reuse the same format interface.
