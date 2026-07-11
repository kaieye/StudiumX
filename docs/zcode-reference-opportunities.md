# ZCode Reference Opportunities

Date: 2026-07-11

Source: local packaged reference under `ref_project/Zcode`. The reference is a built Electron application, so this document treats it as product and architecture evidence, not source code to copy.

## Lens

StudiumX is a local Teaching workspace where durable files are the source of truth. ZCode is closer to a coding agent desktop shell. The useful borrowing path is therefore selective:

- Borrow features that make file-backed learning assets safer, more inspectable, and easier to resume.
- Avoid turning StudiumX into a general IDE.
- Prefer narrow Teaching-workspace workflows over broad coding workflows.
- Reuse concepts only when they fit Mission, Resources, Course, Session, Lesson, Learning record, Reference, and Agent conversation.

## Reference Evidence

- `ref_project/Zcode/README.md` identifies key runtime bundles: `out/main`, `out/host`, `out/renderer`, `glm/zcode.cjs`, and bundled `glm/packages`.
- The same README summarizes MCP flow: config is read from several scopes, server status is listed, model-visible names are created, and each tool is wrapped with permission, timeout, cancellation, tracing, result budget, and a `callTool` handler.
- `ref_project/Zcode/Contents/Resources/app/out/host/index.js` contains runtime paths for checkpoint handling, permission requests, session compact, background task cancellation, Git diff, and AI commit message generation.
- `ref_project/Zcode/Contents/Resources/app/out/main/index.js` contains process monitor, embedded browser, remote workspace bridge, MCP config migration, and desktop command wiring.
- `ref_project/Zcode/Contents/Resources/app/out/renderer/assets/index-DUxOBods.js` contains UI concepts such as permission modes, quick pick commands, task snapshot cache, code preview settings, multi-file diff sources, and rich renderer imports.
- `ref_project/Zcode/Contents/Resources/model-providers/models_catalog_china_llm_zcode_2026-06-03.json` is a provider catalog with model capabilities such as endpoint kind, context window, output limit, modalities, and reasoning configuration.

## 1. Teaching Asset Checkpoints and Diff Review

Recommendation: Strong.

Current StudiumX gap:

- `src/main/teaching-git.ts` currently focuses on Git repository inspection, worktrees, branches, switching, and branch creation.
- Lesson generation and workspace writes can change durable learning files, but the learner does not get a first-class "what changed" checkpoint.

ZCode behavior worth borrowing:

- It has a checkpoint implementation with Git author metadata such as `ZCode Checkpoint`.
- It builds affected path lists, merges checkpoint diffs, previews file diffs, and generates conventional commit messages from current branch, changed files, diff excerpts, and conversation context.

StudiumX adaptation:

- Add a Teaching checkpoint concept around generated Lessons, References, Learning records, Mission edits, Resource edits, and Agent-conversation exports.
- Before a mutating pipeline writes files, capture the previous state when possible.
- After the pipeline finishes, compute changed workspace-relative paths, file kinds, additions/deletions, and a short learner-facing change summary.
- Expose checkpoint history in the workspace UI as "Learning changes", not as raw Git plumbing.
- Allow restoring selected generated artifacts when the workspace is a Git repository. For non-Git workspaces, keep the first version limited to diff display and path list.

Minimal vertical slice:

1. Add a `TeachingWorkspaceChangeSummary` type containing timestamp, trigger, changed files, additions/deletions, and summary.
2. Wrap lesson generation with `git status --porcelain` before and after, then compute changed tracked/untracked paths.
3. Render a "Recent changes" panel after generation, with file list and a diff button for text files.
4. Add an optional AI-generated summary using the existing active provider, with a deterministic fallback summary.

Risks:

- Auto-initializing Git would be too surprising. Only use Git checkpoint features when the workspace is already in a repository, or ask explicitly.
- Binary and generated HTML diffs can be noisy. The UI should summarize HTML and CSS assets instead of always showing full text diff.

## 2. Tool Permission and Write Approval

Recommendation: Strong.

Current StudiumX gap:

- `src/main/ai/tools/ask.ts` lets the model ask the learner questions, but it is not a permission system.
- `src/main/ai/tools/registry.ts` registers read/write workspace tools according to settings and runtime options, but individual write intent is not surfaced to the learner before execution.

ZCode behavior worth borrowing:

- ZCode has permission modes such as asking before changes, automatic edits, plan mode, and broader access.
- Host code receives permission requests and sends permission events back to the renderer.

StudiumX adaptation:

- Keep permission language tied to learning artifacts: "read workspace", "write lesson/reference", "edit mission/resource", "open external link", "fetch web content".
- Before a workspace write, show a compact approval card with the target relative path, operation, reason, and whether the file is new or existing.
- Store the selected permission policy in settings. Suggested policies:
  - Ask before every workspace write.
  - Allow generated Lesson pipeline writes.
  - Allow all Teaching asset writes for this conversation.
  - Read-only mode.
- Treat temporary conversations as read-only unless the user explicitly moves them into a Teaching workspace.

Minimal vertical slice:

1. Add permission metadata to `ToolEntry`, starting with `workspace_write`.
2. Extend tool execution so a write handler can request approval before calling the underlying write.
3. Reuse the existing ask-pending style for renderer-to-main approval resolution, but keep approval payloads separate from pedagogical `ask`.
4. Add tests around cancel, deny, allow-once, and allow-for-conversation.

Risks:

- Too many prompts will make lesson generation feel broken. The first UI should group writes from the same pipeline where possible.
- Permissions must not be hidden behind model text. They should be host-enforced.

## 3. Rich Lesson Rendering and Visual Preview

Recommendation: Strong.

Current StudiumX gap:

- `src/renderer/src/markdown-preview.tsx` supports Markdown, task lists, mark, basic code blocks, local image rewriting, and workspace Markdown links.
- Lessons and resources would benefit from math, diagrams, charts, better code highlighting, and generated-change previews.

ZCode behavior worth borrowing:

- The renderer bundle imports Mermaid diagram modules, KaTeX, syntax grammars, themes, a diff worker, file icons, and code preview settings.
- It supports multi-file diff sources and code viewer tabs in the renderer.

StudiumX adaptation:

- Add math and diagram support to Markdown preview and generated Lesson HTML.
- Prefer a bounded feature set:
  - KaTeX for inline/block math.
  - Mermaid for flowchart, sequence, mindmap, timeline, and concept-map style diagrams.
  - Shiki or a small highlight layer for code examples.
  - Text diff preview for generated Markdown and HTML-adjacent source files.
- Teach the lesson generator when to emit diagrams: process, comparison, timeline, concept relationship, and retrieval-practice workflow.

Minimal vertical slice:

1. Add KaTeX rendering behind a renderer-safe Markdown plugin.
2. Add Mermaid code fence rendering for ` ```mermaid ` blocks with sanitization and error fallback.
3. Add a `LessonPreviewCapabilities` flag so generation prompts can opt into math/diagram output only when the renderer supports it.
4. Add one check script that renders a sample Markdown document with math, Mermaid, code, and a table.

Risks:

- Mermaid rendering can fail on malformed syntax. The preview must display the source block and error, not blank content.
- Generated Lessons are durable HTML artifacts. Any runtime dependency must either be embedded safely or degraded into static output.

## 4. Background Learning Tasks and Resumable Session State

Recommendation: Strong, after checkpoint/diff exists.

Current StudiumX gap:

- `src/main/ai/agent-loop.ts` already has cancellation, context hygiene, context estimates, and compaction events.
- The product shape is still mostly foreground: the user submits a task and watches the current stream.

ZCode behavior worth borrowing:

- It has background agent launch feedback, task snapshot cache, session events, background task cancellation, and session goal handling.
- It makes long-running work visible as a task that can outlive the immediate chat moment.

StudiumX adaptation:

- Treat long lesson generation, resource digestion, web research, and review generation as resumable learning tasks.
- Keep an append-only task record in app data or workspace metadata.
- Show task status in the sidebar or workbench: queued, running, needs approval, completed, failed, canceled.
- Let the learner reopen a completed task to see generated assets, transcript, sources, and checkpoint diff.

Minimal vertical slice:

1. Add a durable `learning-tasks` index with id, workspace id, prompt, mode, status, created/updated timestamps, and generated asset paths.
2. Persist task status transitions from the existing generation pipeline.
3. Add a small task drawer for in-flight and recent completed tasks.
4. Add cancellation and "open result" actions.

Risks:

- Background work can hide errors. Every task needs a visible terminal state and a clear next action.
- Resuming provider streams is hard. First version should resume from persisted state, not from mid-stream tokens.

## 5. Provider Capability Catalog

Recommendation: Worth exploring.

Current StudiumX gap:

- `src/shared/teaching-types/settings.ts` stores model provider presets as flat model-id lists.
- Capability rules exist elsewhere, but model context windows, modalities, output limits, and reasoning controls are not represented as one catalog.

ZCode behavior worth borrowing:

- Its provider catalog records provider ids, endpoint paths, model ids, supported request kinds, input/output modalities, context windows, max output tokens, and reasoning option mapping.
- Host code syncs provider registry changes into the agent runtime.

StudiumX adaptation:

- Introduce a shared provider capability catalog that drives both settings UI and request construction.
- Use the catalog for:
  - context window defaults in `ContextCompactor`;
  - hiding unsupported reasoning options;
  - warning when a model is text-only but the user selected image/resource workflows later;
  - showing model fit for Lesson generation versus short chat.

Minimal vertical slice:

1. Add `src/shared/model-provider-catalog.ts` with normalized provider/model capability types.
2. Convert current presets into catalog entries without changing settings storage yet.
3. Make the settings UI read available models from the catalog.
4. Make context-window inference use catalog data before falling back to model-name heuristics.

Risks:

- Model catalogs age quickly. Keep custom provider support and manual model ids.
- Do not couple StudiumX to ZCode's provider names or commercial plan logic.

## 6. Bounded MCP and External Connector Status

Recommendation: Worth exploring, but keep scope narrow.

Current StudiumX gap:

- Default tools are built in: workspace read/write, web search, and web fetch.
- There is no generic external tool status page.

ZCode behavior worth borrowing:

- MCP configuration is merged from several scopes, statuses are listed, servers are connected, and tool names are normalized.
- ZCode includes diagnostic skills for MCP, plugins, commands, hooks, and skills.

StudiumX adaptation:

- Do not start with open-ended MCP execution.
- Start with a "Connectors" settings section for learning-relevant integrations:
  - local filesystem/resource importer;
  - browser/web fetch;
  - PDF/text extraction;
  - bibliography or reference manager later.
- Show connector status: configured, available, missing dependency, auth needed, failed.
- Reuse the diagnostic style: symptom, likely cause, concrete repair action.

Minimal vertical slice:

1. Add a connector status type and settings panel.
2. Move current web search/fetch diagnostics into that status model.
3. Add one external dependency check, such as `rg` availability or a configured web-search backend probe.
4. Defer arbitrary MCP server execution until there is a clear Teaching use case.

Risks:

- Generic MCP can expand the product surface too fast.
- Workspace-scoped external tool config should not auto-run without clear trust boundaries.

## 7. Command Palette for Learning Workflows

Recommendation: Medium.

Current StudiumX gap:

- Main workflows are discoverable through panels, but repeat actions require navigation.

ZCode behavior worth borrowing:

- The renderer has quick pick commands for new task, open workspace, settings, sidebar, terminal, browser tab, review tab, theme switching, feedback, and logout.

StudiumX adaptation:

- Add a command palette for learning actions:
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

## 8. Diagnostics and Process Visibility

Recommendation: Medium-low.

Current StudiumX gap:

- There are many check scripts and log settings, but not much in-app runtime diagnosis.

ZCode behavior worth borrowing:

- It has a process monitor window, app metrics, crash capture, performance traces, and dedicated logs for remote/control subsystems.

StudiumX adaptation:

- Add a modest diagnostics page rather than a full process monitor:
  - app version and data paths;
  - active provider and last provider error class;
  - web search backend status;
  - recent task failures;
  - log file location;
  - copy diagnostics bundle.

Minimal vertical slice:

1. Add an About/Diagnostics settings subsection.
2. Surface existing app log settings and recent error summaries.
3. Add "Copy diagnostics" for support/debugging.

Risks:

- Full process monitoring is developer-oriented. Keep the first version user-facing and small.

## Not Recommended Now

These ZCode areas do not fit the current StudiumX product shape:

- Embedded terminal and shell startup.
- SSH, WSL, and remote workspace bridge.
- Android and iOS simulator automation.
- Generic IDE file explorer behavior.
- Payment, subscription, and commercial plan UI.
- Full external marketplace management.
- Web remote control.

## Suggested Order

1. Teaching asset checkpoints and diff review.
2. Tool permission and write approval.
3. Rich lesson rendering with math and diagrams.
4. Background learning task index.
5. Provider capability catalog.
6. Bounded connector status.
7. Command palette.
8. Diagnostics page.

The first three are the highest leverage because they directly improve trust in generated learning artifacts. They also build on existing StudiumX seams: Teaching workspace files, tool execution, settings, preview rendering, and the current Git support.
