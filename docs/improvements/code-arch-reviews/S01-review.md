# Slice S01 — code-arch-improve (read-only)

**Agent:** /root (main; subagent brief-delivery failed for S01 wave)
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S01

Giants + settlement host: `teaching-workspace.ts`, `learning-session-ledger.ts`, `teaching-turn-coordinator.ts`, `teaching-turn-coordinator-host.ts`.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary LOC | ~3026 + ~2661 + ~2369 + ~343 ≈ **8.4k** |
| Expansion hop | `teaching-workspace/**` peels; host→coordinator ports; shared teaching-events command parse |
| ADRs | 0008 ledger authority; 0011 outcome settlement; 0023 coordinator host + blocking CI; 0075 module size / peel-by-touch |
| Product floor | Files = teaching truth; **settlement sole-writer = coordinator/host**; no YOLO/shell |
| History | Feature landings (host wire, settlement durability, mission correlation, MCP opt-in) — not multi-module bug thrash of one shallow seam |
| Tests | `teaching-turn-coordinator(.host)`, `learning-session-ledger*`, many `teaching-workspace-*` units + integration harness |

**Material evidence**

- **Host** (`teaching-turn-coordinator-host.ts`): documented thin multi-workspace adapter; `execute` + `commitLearningOutcome` sole production IPC commit path; synthesizes `commit_outcome` turn; inject factories for ledger/recorder/committer/planner — real test adapters.
- **Coordinator**: deep ports-only orchestration (`TeachingTurnCoordinatorPorts`); single `execute(command)`; capacity/idempotency/serialize/terminal stickiness documented and implemented; mutator ports only after preflight; not settlement-split (committer is a port, not a second product writer).
- **Ledger**: deep `LearningSessionLedger` interface (open/append/complete/load/scan); filesystem authority + writer lock; projections/repair internal.
- **TeachingWorkspaceService**: composition host for catalog/docs/conversations/MCP prep/mission/direct-lesson; already peels (catalog, documents, review deck, activation-lifecycle, item-lifecycle, paths, generation). Large façade is product surface, not a missing seam.

**Negative evidence**

- Size of three giants is known (ADR-0075 warning residual) — **not** dual-signal architectural failure.
- Further pure extraction of coordinator body or ledger internals without a recurring cross-caller friction would violate cost proportionality and risk settlement authority drift.
- S02 already closed conversation cluster as good_enough; host composition of conversations is compose-only.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Host vs coordinator vs ledger vs workspace peels already separated; history peels land by touch |
| Interface depth | **Healthy** | Callers use `execute` / ledger ops / workspace service methods; capacity, locks, terminal mapping stay inside |
| Seam legitimacy | **Healthy** | Sole-writer host, ledger FS authority, ports for test variation — domain-real, not mock-only |
| Test surface | **Healthy** | Coordinator/host/ledger/workspace unit + integration cover public interfaces |
| Conceptual integrity | **Healthy** | ADR language matches module headers (ports-only coordinator; host thin; ledger durable authority) |
| Cost proportionality | **Healthy** | Giant peel only when touched (ADR-0075); purity rewrite of 8k without recurrence is negative NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) settlement/idempotency bugs require coordinated edits outside coordinator+host; (2) workspace façade forces repeated dual-edits across peels for one product change; (3) ledger lock/settlement durability repeatedly leaks into callers.

### Metrics for tracker

- approx_lines_examined: **8400**
- files_examined: **4 primary + hop samples (~12)**
- candidate_count: **0**
- status_for_tracker: **good_enough**
