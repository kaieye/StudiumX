# Slice S07 — code-arch-improve (read-only re-review)

**Agent:** Grok Build (code-arch-improve / skill gates)
**Revision:** HEAD `d9435064` (re-review after agent shell sandbox delivery; prior close 0-cand pre-shell)
**Skill:** `$code-arch-improve` + codebase-design vocabulary (module / interface / depth / seam / adapter / leverage / locality)
**Mode:** read-only — **0 production edits**

---

### Slice S07

`src/main/ai/tools/**` — registry, dispatcher, effect/policy, approval receipts, write policy, batch/parallel dispatch, workspace/web/memory handlers, **and** agent shell/sandbox cluster (ADR-0152/0153).

### Scope

| Item | Value |
| --- | --- |
| Slice | **S07** |
| Primary tree | `src/main/ai/tools/**` |
| Prior report | Good enough / **0** candidates pre-product-shell |
| Drift since prior | Workspace shell + dual-axis sandbox delivery: `workspace-shell`, `agent-sandbox-policy`, `shell-hardline`, `shell-env-scrub`, `shell-command-safety`, `agent-shell-resolve`, `codex-sandbox-transform`; registry register shell; effect `privileged`; edit path + pure `edit-match`; ask deadline |
| ADRs | 0024, 0041, 0048, 0061, 0063, 0144, 0146, 0152, 0153, 0075 |
| Product floor | Effect lattice; no YOLO; shell not teaching Evidence; tools.enabled default off; workspaceShell default on once tools enabled; sandbox honesty |

**approx_lines_examined:** **~9200**  
**candidate_count:** **0**  
**status:** **good_enough**

### Material evidence

- **Layered shell ownership:** orchestration (`workspace-shell`) vs pure policy (`agent-sandbox-policy`) vs OS transform (`codex-sandbox-transform`) vs hardline/env scrub/safety pure modules — deletion would re-couple policy with spawn I/O.
- **Effect lattice + registration:** shell maps to `privileged`; registry gates behind tools master switch + workspaceShell; no second YOLO path.
- **Dispatcher depth unchanged:** thin effect auth → parse → handler → ToolOutcome.
- **Workspace edit seam:** pure `edit-match` vs durable `workspace-edit` — legitimate variation.
- **Honesty / floor:** non-Evidence command results; Windows helper fail-closed `notConfigured`.

### Negative evidence

- Size of transform/workspace alone is not a candidate (ADR-0075).
- Shell delivery is coordinated product work with ADRs + units — intentional peels, not dual thrash.
- Further purity re-partition fails net-payoff gate.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Shell policy / OS transform / hardline / scrub / spawn already separate |
| Interface depth | **Healthy** | Callers use registry handlerMap / ToolDispatcher; shared OS probe |
| Seam legitimacy | **Healthy** | Dual-axis sandbox × approval; privileged effect; hardline floor |
| Test surface | **Healthy** | Shell lifecycle, policy, transform, hardline units |
| Conceptual integrity | **Healthy** | TOOL_CONTRACT + ADR-0152/0153 + AGENTS floor agree |
| Cost proportionality | **Healthy** | Lattice + dual-axis earn cost; purity peels negative NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** permission resolve and effect auth diverge; spawn/policy/transform thrash; product claims OS isolation when notConfigured; shell becomes teaching Evidence; YOLO / silent shell when tools.enabled off reappears.
