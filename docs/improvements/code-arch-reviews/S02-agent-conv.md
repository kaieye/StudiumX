# Slice S02 — code-arch-improve (read-only)

**Agent:** Grok Build (S02 agent-conv re-review)
**Revision:** HEAD `d9435064`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S02

Agent conversation durability + session tree + archive/audit/history/checkpoints + shared sanitize + renderer runner. Not teaching outcome settlement (S01).

### Scope

| Item | Value |
| --- | --- |
| Primary | teaching-agent-conversations, session-tree, session-audit, history, archive, checkpoints, summary-projection |
| Shared | agent-persisted-history, catalog, turns |
| Renderer | agent-conversation views, agent-conversation-runner |
| Floor | toolsReplayed false on fork/replay; expectedRevision CAS; files = conversation truth |

**approx_lines_examined:** **~8800**  
**candidate_count:** **0**  
**status:** **good_enough**

### Material evidence

- Domain split: catalog → I/O → archive save → audit → tree/fork → history → checkpoints → summary.
- Single saveAgentConversationArchive owns durability lattice.
- Fork/replay hard-codes toolsReplayed false; drops tools/process.
- CAS on branch save/status/fork; renderer runner single seam with expectedBranchRevision.
- LiveAgent busy queue / file-touch presentation land inside existing seams.

### Negative evidence

- Dual branch-metadata normalizers are intentional fail-closed layering (watch only).
- Module size is ADR-0075 residual.
- History/summary are derived non-authority.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Save vs tree vs audit vs history separated |
| Interface depth | **Healthy** | Callers use save/fork/open/list; CAS inside |
| Seam legitimacy | **Healthy** | Durable archive, replay non-execution |
| Test surface | **Healthy** | Session-tree/archive/audit units |
| Conceptual integrity | **Healthy** | toolsReplayed false; files truth |
| Cost proportionality | **Healthy** | Durability machinery earns cost |

### Candidates

**0 candidates**.

**Reopen if:** dual normalizer integrity bug; archive+tree+audit thrash beyond co-change; derived history becomes teaching authority; toolsReplayed true on fork.
