# Slice S05 — code-arch-improve (read-only)

**Agent:** Grok Build / code-arch-improve (S05 HEAD re-review)
**Revision:** HEAD `d9435064` (prior 0-cand closeout at `99d546a5`)
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S05

Main AI loop / run lifecycle: model iteration, hard run budget, durable-success / budget fallback, request-context projection, LiveAgent Phase A compaction pressure + file-touch ledger, ask pending, run audit, durable run lifecycle.

### Scope

| Item | Value |
| --- | --- |
| Primary paths | `agent-loop.ts`, `agent-loop-execution-state.ts`, peels, `agent-run-audit.ts`, `ask-pending.ts`, `compaction-pressure-controller.ts`, `context-compactor.ts`, `context-file-ledger.ts`, `request-context-projection.ts` |
| ADRs | 0044, 0045, 0056, 0057, 0059, 0064, 0100/0103/0106, 0143/0144/0145, settlement 0008/0011/0023, 0075 |
| Product floor | Hard multi-axis budget; durable-success / budget fallback; compaction never substitutes hard stop; file-touch ledger not teaching/settlement authority; no YOLO |

**approx_lines_examined:** **~6000**  
**candidate_count:** **0**  
**status:** **good_enough**

### Material evidence

- Loop owns iteration policy, not settlement; returns transcript/usage/stopReason.
- Hard budget sole authority vs soft context; COMPACTION_HARD_BUDGET_AUTHORITY fail-closed.
- Durable-success / budget fallback host-injected callbacks keep business policy outside loop core.
- Request-context: strip → hygiene → compact → inject file-touch after compact.
- File-touch ledger is projection floor only (ADR-0143).
- Ask pending process-local; timeout never auto-approves privileged paths.
- Prior peels (fallback, budget-reason, schema-guard, execution-state, pressure) still hold.

### Negative evidence

- Size of agent-loop residual is ADR-0075, not dual thrash.
- True mid-stream overflow compact deferred by ADR-0145 (product residual, not arch debt).
- No dual settlement path from Phase A.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Phase A in ledger/pressure/projector; budget in execution-state |
| Interface depth | **Healthy** | `runAgentLoop` + events hide internals |
| Seam legitimacy | **Healthy** | Hard budget vs projection; file-touch data-not-instructions |
| Test surface | **Healthy** | Loop/budget/pressure/ledger/ask units |
| Conceptual integrity | **Healthy** | Matches ADR-0045/0057/0143–0145 |
| Cost proportionality | **Healthy** | Further pure extraction without thrash is negative NPV |

### Candidates

**0 candidates**.

**Reopen if:** hard budget bugs need edits outside loop+execution-state+callbacks; file-touch treated as teaching evidence; compaction double-summarizes; callers re-implement projection ladder; AgentRun lifecycle fused into dual-writer loop.
