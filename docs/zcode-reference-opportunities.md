# ZCode Reference Opportunities

Date: 2026-07-12

Source: local packaged reference under `ref_project/Zcode`. The reference is a built Electron application, so this document treats it as product and architecture evidence, not source code to copy.

## Lens

StudiumX is a local Teaching workspace where durable files are the source of truth. ZCode is closer to a coding agent desktop shell. The useful borrowing path is therefore selective:

- Borrow features that make file-backed learning assets safer, more inspectable, and easier to resume.
- Avoid turning StudiumX into a general IDE.
- Prefer narrow Teaching-workspace workflows over broad coding workflows.
- Reuse concepts only when they fit Mission, Resources, Course, Session, Lesson, Learning record, Reference, and Agent conversation.

## Current Reference Evidence

- `ref_project/Zcode/README.md` summarizes MCP flow: config is read from several scopes, server status is listed, model-visible names are created, and each tool is wrapped with permission, timeout, cancellation, tracing, result budget, and a `callTool` handler.
- `ref_project/Zcode/Contents/Resources/app/out/host/index.js` contains runtime paths for checkpoint handling, permission requests, session compact, background task cancellation, Git diff, and AI commit message generation.
- `ref_project/Zcode/Contents/Resources/app/out/main/index.js` contains process monitor, embedded browser, remote workspace bridge, MCP config migration, and desktop command wiring.
- `ref_project/Zcode/Contents/Resources/app/out/renderer/assets/index-DUxOBods.js` contains UI concepts such as permission modes, quick pick commands, task snapshot cache, code preview settings, multi-file diff sources, and rich renderer imports.

Completed directions removed from this active opportunity list:

- Teaching asset checkpoints and diff review: implemented through Git tree checkpoints, app-data change history, and lesson diff UI.
- Tool permission and write approval: implemented through `ToolEntry.permission`, host-enforced workspace-write policy, renderer approval cards, and `scripts/check-tool-permissions.mjs`.
- Provider capability catalog: implemented through `src/shared/model-provider-catalog.ts`, settings presets, context-window inference, reasoning mapping, max-output clamping, and `scripts/check-model-provider-catalog.mjs`.

## 1. Static Lesson Rich Syntax Boundary

Recommendation: Strong, but keep the surface boundary explicit.

Current StudiumX state:

- Live Markdown preview supports KaTeX, Mermaid placeholders with strict rendering, local image rewriting, workspace Markdown links, code copy controls, and a capability check script.
- Implemented follow-up (2026-07-12): durable generated Lesson HTML now renders KaTeX-compatible inline and block math as MathML through `src/main/ai/lesson-renderer.ts`.
- Production lesson generation uses `STATIC_LESSON_RENDERER_CAPABILITIES`, so prompts advertise math but not Mermaid.
- Mermaid remains live-preview-only until a safe static rendering path exists.

ZCode behavior still worth borrowing:

- ZCode's renderer bundle shows the value of making math, diagrams, code, and diff previews first-class renderer capabilities.
- The useful lesson for StudiumX is capability gating per surface: the model should only emit syntax that the durable artifact can actually render.

StudiumX adaptation:

- Do not advertise Mermaid to generated Lessons until the static HTML renderer supports it.
- Keep live Markdown document preview and static Lesson HTML as separate capability surfaces, or intentionally share a safe renderer between them.
- Remove stale ambitions such as Shiki and broad code-viewer tabs unless a concrete Teaching workflow needs them.

Minimal next slice:

1. Decide whether Mermaid should remain live-preview-only, render as source fallback, or be converted into static SVG through a safe pipeline.
2. Add a fixture that proves unsupported Mermaid fences in generated Lesson HTML degrade to visible source rather than blank output if Mermaid is ever advertised.
3. Keep static math tests tied to `scripts/check-lesson-markdown-rendering.mjs`.

Risks:

- Advertising unsupported syntax creates durable lessons with misleading raw formulas or inert diagrams.
- Mermaid static rendering requires a DOM-like runtime or a separate render step; do not add that complexity until lesson authorship needs it.

## 2. Durable Learning Task Index

Recommendation: Strong, after checkpoint/diff and permission gates.

Current StudiumX state:

- Agent streams are still foreground and tracked by in-memory `AbortController`s in the Electron main process.
- Pending agent conversations make in-flight work visible in the sidebar while the renderer session is alive.
- Child/delegated runs have status metadata and are persisted inside completed conversation records and session audit artifacts.
- There is no durable task index for queued/running/needs-approval/completed/failed/canceled work that can survive restart independently of the current chat stream.

ZCode behavior worth borrowing:

- ZCode exposes long-running work as task/session state with snapshots, cancellation, and reopenable history.
- The useful concept is not background token-stream resume; it is durable task accounting and a visible terminal state.

StudiumX adaptation:

- Treat long lesson generation, resource digestion, web research, and review generation as learning tasks.
- Keep an append-only task index in app data or workspace metadata.
- Link completed tasks to generated assets, sources, transcript, and checkpoint diff.
- On restart, resume from persisted state only; do not attempt to resume mid-stream provider output.

Minimal vertical slice:

1. Add a `learning-tasks` index with id, workspace id, prompt, mode, status, timestamps, generated asset paths, conversation id, and checkpoint id.
2. Persist status transitions from lesson generation and agent `generate_lesson`.
3. Add a compact task drawer for recent in-flight, failed, and completed tasks.
4. Add "cancel active task" and "open result" actions.

Risks:

- Background work can hide errors. Every task needs a visible terminal state and a next action.
- Duplication with conversation history is likely; the task record should point to the conversation/audit artifacts rather than copying transcript content.

## 3. Bounded Connector Status

Recommendation: Keep scope narrow.

Current StudiumX state:

- Built-in tools already cover workspace read/write, web search, and web fetch.
- Generic MCP execution is intentionally not part of the product surface.
- Implemented follow-up (2026-07-12): added a shared connector status model, `getConnectorStatuses` IPC/preload bridge, Settings > Connectors status panel, and `scripts/check-connector-statuses.mjs`.
- The status panel reports workspace-file access, web_search backend availability or missing config, web_fetch enablement, and local `rg` availability.

ZCode behavior worth borrowing:

- ZCode lists external tool/server status and gives concrete repair paths when config or dependencies are missing.
- The useful concept for StudiumX is diagnostic visibility, not arbitrary connector execution.

Remaining adaptation:

- Keep arbitrary MCP server execution deferred until there is a clear Teaching use case.
- Reuse connector statuses in the future diagnostics snapshot.
- Add connector rows only when a real learning workflow exists, such as PDF extraction or bibliography import.

Risks:

- Generic MCP can expand the product surface too fast.
- Workspace-scoped external config should not auto-run without clear trust boundaries.

## 4. Command Palette for Learning Workflows

Recommendation: Medium.

Current StudiumX gap:

- Main workflows are discoverable through panels, but repeat actions require navigation.
- There is no global command registry or `Cmd/Ctrl+K` palette.

ZCode behavior worth borrowing:

- The renderer has quick pick commands for new task, open workspace, settings, sidebar, terminal, browser tab, review tab, theme switching, feedback, and logout.

StudiumX adaptation:

- Add a command palette for local learning actions:
  - create workspace;
  - import workspace;
  - add Resource;
  - generate next Lesson;
  - create Reference from current conversation;
  - start review;
  - open recent Lesson;
  - open settings section;
  - switch model.

Minimal vertical slice:

1. Add a keyboard shortcut and command-palette modal.
2. Implement local commands only; no agent execution at first.
3. Use existing app-store actions and navigation transitions.

Risks:

- Avoid making the command palette another source of state transitions. It should call existing app-store interfaces.

## 5. Diagnostics Snapshot

Recommendation: Medium-low.

Current StudiumX state:

- About settings already shows runtime, current workspace, log file, and app-data directory.
- Memory diagnostics exist separately.
- Connector statuses now exist as a focused status model.
- There is no single copyable diagnostics snapshot.

ZCode behavior worth borrowing:

- ZCode has process monitor, app metrics, crash capture, performance traces, and subsystem logs.
- StudiumX should borrow the repair-oriented diagnostics shape, not a developer process monitor.

StudiumX adaptation:

- Evolve About into "About / Diagnostics":
  - app version and data paths;
  - active provider/model and endpoint format;
  - connector statuses;
  - memory diagnostics;
  - recent task failures once the durable task index exists;
  - log file location;
  - copy diagnostics.

Minimal vertical slice:

1. Add `getDiagnosticsSnapshot` IPC.
2. Include app version, user data path, log path, runtime provider/model, connector statuses, and memory diagnostics.
3. Add "Copy diagnostics" as JSON/text from the About panel.

Risks:

- Full process monitoring is developer-oriented. Keep the first version user-facing and small.
- Do not include API keys or raw lesson/conversation contents in the copyable bundle.

## Not Recommended Now

These ZCode areas do not fit the current StudiumX product shape:

- Embedded terminal and shell startup.
- SSH, WSL, and remote workspace bridge.
- Android and iOS simulator automation.
- Generic IDE file explorer behavior.
- Payment, subscription, and commercial plan UI.
- Full external marketplace management.
- Web remote control.
- Arbitrary MCP execution without a Teaching-specific workflow.

## Suggested Order

1. Static Lesson rich syntax boundary.
2. Durable learning task index.
3. Command palette.
4. Diagnostics snapshot.

Connector status already has the first vertical slice. The remaining highest-leverage work is to make durable generated artifacts honest about renderer capabilities, then make long-running Teaching work reopenable after the immediate chat moment.
