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
| `web_search` | `external_write` | Snip bounded external results with provenance; treat content as untrusted | Network access is externally observable and provider-configured. |
| `web_fetch` | `external_write` | Snip bounded fetched text with provenance; treat content as untrusted | Public HTTP(S) safety checks and redirect/DNS validation apply. |

## Permission and UI guidance

The contract does not authorize execution by itself. The effect lattice remains the pre-execution gate, and the registry permission descriptor remains the interactive gate. UI copy should describe the three states as **需批准** (approval required), **按风险** (risk-based), and **本课放行** (this lesson/run allows it). Do not expose or label a mode as “YOLO”.
