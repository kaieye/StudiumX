# Slice S11 — code-arch-improve (read-only)

**Agent:** Grok Build / code-arch-improve (S11 HEAD re-confirm)
**Revision:** HEAD `d9435064` (prior 0-cand at `99d546a5` / phase handoff landed; light re-review)
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S11

Shared study-planning pure domain: `src/shared/study-planning/**` (store, timer plans, lifecycle, schedule, recurrence, migration, sheets, projections, phase handoff intents).

### Scope

| Item | Value |
| --- | --- |
| Revision | `d9435064` |
| Primary path | `D:\project\StudiumX\src\shared\study-planning\**` |
| Primary LOC | **~29 files / ~9.1k** (order of magnitude retained) |
| Examined deeply | `phase-handoff-intent`, `next-break-phase`, `phase-prompt-sheet`, `break-end-prompt-sheet`, `timer-session-lifecycle`, `timer-plan`, `study-planning-store` (`applyCommand` sole-writer), `index` barrel |
| Expansion hop | main durable store / IPC (adapter); renderer dual-write (ADR-0129; S15); phase unit tests |
| ADRs | **0094** design gate; **0117** paths/wire/store sole-writer; **0129** dual-write + sole-read; **0130** residual; TimerSession ≠ LearningSession |
| Tests | Dense pure suite: phase handoff, sheets, store CAS, recurrence, custom-rhythm, migration |

**Material evidence**

- **Pure shared (no fs/electron):** schema, commands, `expectedRevision` CAS, `actionId` exact-retry behind `applyCommand` — deep sole-writer core.
- **Single next-break authority:** `resolveNextBreakPhase` in `next-break-phase.ts`; lifecycle and `phase-prompt-sheet` `computeNextBreakPhase` **delegate** to it (presentation may coerce `wrap_up → short_break` only for sheet surface).
- **Host intent adapter:** `phase-handoff-intent` maps disposition → shell/notify/start; host applies effects without re-walking break math.
- **Domain peels already exist:** timer-plan, lifecycle, schedule-block, recurrence, custom-rhythm, migration, categories, timeline projection, empty-start/classification sheets.
- **Store size (~1.1k)** is command dispatch + invariants behind one interface; peel-for-size alone fails ADR-0075.
- Product floor: no shell/YOLO; study-planning physically separate from teaching ledger / settlement.

**Negative evidence**

- Competing phase walker did not appear at HEAD; dual export names are adapter typing, not dual authority.
- Renderer dual-write thrash would reopen renderer slices, not pure shared without new evidence.
- No TimerSession ↔ LearningSession type confusion in shared types.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Plan kinds, lifecycle, next-break walker, sheets, host-intent, schedule, recurrence, migration peels |
| Interface depth | **Healthy** | Commands / normalize* / reducers / project*HandoffPlan / resolve*HandoffIntent; CAS inside |
| Seam legitimacy | **Healthy** | Pure store vs durable host; projection vs authority; presentation coerce vs full lifecycle phase |
| Test surface | **Healthy** | Phase/break sheets, handoff, store, lifecycle, custom-rhythm units |
| Conceptual integrity | **Healthy** | ADR-0094/0117/0129; single next-break authority held |
| Cost proportionality | **Healthy** | No admitted deepening with positive NPV; size alone not a candidate |

### Candidates

**0 candidates** (none admitted under skill gates).

| Rejected smell | Why not admitted |
| --- | --- |
| Peel `study-planning-store` by size | Sole-writer depth intentional; no dual thrash; ADR-0075 |
| Merge `computeNextBreakPhase` / `resolveNextBreakPhase` | Presentation adapter; zero thrash |
| Fold `phase-handoff-intent` into sheets/host | Would raise host coupling |

**Reopen later only if:** (1) pure store and durable host diverge on CAS/revision; (2) dual-write silently dual-authorizes localStorage; (3) TimerSession confused with LearningSession; (4) competing longBreakEvery/custom_rhythm walker outside `next-break-phase` + custom-rhythm helpers; (5) host re-implements break math bypassing projectors/intents.

### Metrics for tracker

- approx_lines_examined: **9200**
- files_examined: **29** (+ host hop / ADR anchors not double-counted)
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: HEAD `d9435064` re-confirm; phase handoff architecture still good_enough
