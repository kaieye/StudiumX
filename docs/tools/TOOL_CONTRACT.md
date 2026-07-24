# Tool contract

This contract is the reviewable inventory of registered teaching tools. `scripts/check-tool-contract.mjs` checks that the inventory stays synchronized with the effect-policy catalog and tool definitions. Unknown tool names are classified as `privileged` by `classifyToolEffect`; the check therefore fails closed when a new tool is not explicitly added to both code and this document.

| Tool | effectClass | snip/projection stance | Capability notes |
| --- | --- | --- | --- |
| `ask` | `privileged` | No snip; project only the question/answer interaction envelope | Requires user interaction; never silently chooses for the user. |
| `delegate_task` | `privileged` | No child prompt/provider payload projection; expose bounded child status only | Child execution is capability-gated and budgeted. |
| `generate_lesson` | `privileged` | No raw provider payload; project learner-safe lesson result | Lesson generation is an explicit teaching action, not a generic write grant. |
| `parallel_tasks` | `privileged` | No snip; project bounded child status | Delegation fan-out remains privileged and budgeted. |
| `read_only_task` | `read` | Snip to bounded read-only result; no write projection | Read-only delegated work may not invoke write or privileged effects. |
| `list_workspace` | `read` | Snip bounded directory entries; omit sensitive/protected paths | Workspace containment and protected-path checks remain mandatory. |
| `read_workspace_file` | `read` | Snip bounded line window; no unbounded file projection | Workspace containment and protected-path checks remain mandatory. |
| `search_workspace` | `read` | Snip bounded matches and paths; omit protected paths | Read-only, bounded search. |
| `glob_workspace` | `read` | Snip bounded matching relative paths; omit protected paths | Read-only, bounded glob. |
| `read_skill_resource` | `read` | Snip bounded skill-resource content | Resource access is read-only and bounded. |
| `write_workspace_file` | `workspace_write` | No content snip in policy/audit; project only safe relative artifact metadata | Durable publisher, workspace containment, approval gate, and no-clobber/restricted-overwrite rules apply. |
| `edit_workspace_file` | `workspace_write` | No content snip in policy/audit; project only safe relative artifact metadata + `matchStrategy` | Fuzzy local replace (Exact→EOL/BOM→trailing WS→indent); fail-closed on mismatch/ambiguous; same path fence, approval, write-rewind journal as write. |
| `memory_search` | `read` | Snip bounded hits (id/title/snippet/meta); never bake into system prefix | Main-only lexical search over teaching memory and authorized local notes; no SQLite FTS. |
| `remember_teaching_memory` | `workspace_write` | Project only id/scope/title metadata; body is not auto-projected | Human-approved synthetic teaching memory; prefix may index title+scope only. |
| `forget_teaching_memory` | `workspace_write` | Project only id/tombstone metadata | Human-approved soft-delete of teaching-synthetic memories only. |
| `web_search` | `external_write` | Snip bounded external results with provenance; treat content as untrusted | Network access is externally observable and provider-configured. |
| `web_fetch` | `external_write` | Snip bounded fetched text with provenance; treat content as untrusted | Public HTTP(S) safety checks and redirect/DNS validation apply. |

## Capability metadata (B-07)

Runtime capability discovery is implemented in `src/main/ai/tools/tool-capabilities.ts` via `capabilitiesForTool(toolName)`. Capabilities are **metadata only** — they do not authorize execution. The effect lattice and registry permission descriptor remain the pre-execution gates.

| Field | Meaning |
| --- | --- |
| `isReadOnly` | Pure read stance (`effectClass === read`). |
| `maxConcurrency` | Declared upper bound for concurrent instances of this tool. |
| `supportsCancel` | Whether the tool cooperates with `AbortSignal` / run cancel. |
| `effectClass` | Same lattice as the inventory table above. |

### Effect-class defaults

| effectClass | isReadOnly | maxConcurrency | supportsCancel |
| --- | --- | --- | --- |
| `read` | `true` | `4` (aligned with parallel-read default) | `true` |
| `workspace_write` | `false` | **`1` (hard)** | `true` |
| `external_write` | `false` | **`1` (hard)** | `true` |
| `privileged` (incl. unknown) | `false` | **`1` (hard)** | `true` |

**Invariant:** non-`read` tools never advertise `maxConcurrency > 1`. Declaring capability metadata does **not** open write parallelism. Bounded parallel dispatch remains limited to pure-read tools (ADR-0032).

Registry discovery: optional `ToolEntry.capabilities` overrides defaults; `resolveToolEntryCapabilities(entry)` falls back to `capabilitiesForTool(name)`.

## Permission and UI guidance

The contract does not authorize execution by itself. The effect lattice remains the pre-execution gate, and the registry permission descriptor remains the interactive gate. UI copy should describe the three states as **需批准** (approval required), **按风险** (risk-based), and **本课放行** (this lesson/run allows it). Do not expose or label a mode as “YOLO”.


## Dynamic MCP bridge rules (ADR-0128)

User-configured MCP tools are **not** listed in the static inventory above. `scripts/check-tool-contract.mjs` continues to enforce only the closed static set.

Bridge rules (product invariants):

| Rule | Contract |
| --- | --- |
| Naming | Registered tool names are `mcp__{serverId}__{rawToolName}` only. |
| Default effect | `privileged` unless an explicit per-tool override maps to `read` / `workspace_write` / `external_write` / `privileged`. |
| Permission | Non-`read` MCP tools require interactive approval (or existing risk-based/lesson grant UX). Enabling/auto-connecting a server **lists** tools for the model; it does **not** skip effect/permission for side-effecting calls (ADR-0141). |
| Provenance | UI / diagnostics should surface config **source** (user settings, import, future workspace/plugin/marketplace) when multi-source lands; provenance is display + policy input, not an effect downgrade. |
| Annotations | Remote tool annotations (`readOnlyHint`, etc.) are **display-only** metadata; they **never** downgrade registry effect or skip approval. |
| Handler stance | MCP handlers must not write workspace files, LearningSession ledger, or teaching outcomes; MCP modules must not import ledger / outcome committer. Results are data only (ADR-0134) — **not** teaching evidence. |
| Secrets | Resolved headers/env/OAuth tokens stay main-process only; never on renderer/preload IPC, Doctor, or support bundle (ADR-0128 / ADR-0135). |
| Budget | Per-server / global tool and schema budgets apply at list/register time (see ADR-0128 §5.3); result normalizer applies MCP budgets before generic tool result budgets (ADR-0134). |
| Settlement | MCP is orthogonal to settlement sole-writer (`TeachingTurnCoordinator` / host); fork paths keep `toolsReplayed: false`; MCP does not widen `expectedRevision`. |
| Workspace-root | Filesystem workspace-root injection (ADR-0138 + ADR-0141) may **default on** for recognized filesystem servers (user can disable); still not a bypass of `write_workspace_file` / teaching writers. |
| Defaults | Root switch may ship off for first-run zero-connect; once enabled, **auto-connect is a supported default** (ADR-0141). Marketplace / plugin install may connect. Tool **invocation** still uses effect lattice + approval — no YOLO. Annotations may inform UX and optional effect suggestions under policy. |
| Fingerprint | MCP tools that are registered for a run **are** included in tools-schema fingerprint (ADR-0060). |

Static teaching tools remain the authoritative closed set in this document. Dynamic MCP audit snapshots may record registered names and effects without expanding this table.

