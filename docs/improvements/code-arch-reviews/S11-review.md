# Slice S11 — code-arch-improve (read-only re-review)

**Agent:** Grok Build subagent (`improve-codebase-architecture`, read-only)
**Revision:** `99d546a5480888d318f4511d1210c6d3971384d9` (branch `main` HEAD)
**Prior review:** rev `6ff53d849b8df3b194ff74bf80f49622bc3aec62` — **good_enough**, fitness Watch on dirty phase WIP
**Material delta:** phase handoff / break walker product work landed in `99d546a5` (no longer dirty WIP)
**Skill:** `$code-arch-improve` + codebase-design vocabulary (module, interface, depth, seam, adapter, leverage, locality)
**Mode:** read-only — **0 production edits**; only this report file rewritten

---

### Slice S11

Shared study-planning pure domain: `src/shared/study-planning/**` (store, timer plans, lifecycle, schedule, recurrence, migration, sheets, projections, phase handoff intents).

### Scope

| Item | Value |
| --- | --- |
| Revision | `99d546a5480888d318f4511d1210c6d3971384d9` |
| Primary path | `D:\project\StudiumX\src\shared\study-planning\**` |
| Primary LOC | **29 files / ~9.1k** (unchanged order of magnitude vs prior; phase modules already in tree at prior dirty count) |
| Examined deeply | `phase-handoff-intent`, `next-break-phase`, `phase-prompt-sheet`, `break-end-prompt-sheet`, `timer-session-lifecycle` (walker + `startNextPhaseFromCompleted`), `timer-plan` (`normalizeBreakPolicy` sole normalize), `study-planning-store` (CAS / `actionId` / command sole-writer), `index` barrel, host hop `useStudySession` handoff apply path |
| Expansion hop | main durable store / IPC (adapter; outside slice); renderer dual-write / hydrate (ADR-0129; S15 territory); unit tests under `tests/unit/study-planning-phase-*.unit.test.ts` |
| ADRs | **0094** design gate (TimerSession ≠ LearningSession; breakPolicy freezes); **0117** paths/wire/store sole-writer; **0129** dual-write + sole-read; **0130** residual; product floor TimerSession ≠ LearningSession |
| Prior dirty → landed | `timer-plan`, `timer-session-lifecycle`, `phase-prompt-sheet`, `break-end-prompt-sheet`, `index`, `next-break-phase`, `phase-handoff-intent` — now product-landed architecture, not mid-flight WIP |
| Tests | Dense pure suite: phase handoff intent, phase/break prompt sheets, store CAS, recurrence, custom-rhythm, migration, dual-write (renderer), recovery matrix |

**Material evidence**

- **Pure shared (no fs/electron):** durable publish remains main adapter; shared enforces schema, commands, `expectedRevision` CAS, `actionId` exact-retry in-memory — deep sole-writer core behind a small `applyCommand` surface (`study-planning-store.ts`).
- **Phase handoff landed as layered peels, not a second authority:**
  1. **Domain walker module** `next-break-phase.ts`: single `resolveNextBreakPhase` for short/long/wrap after completed focus (pomodoro `longBreakEvery`, custom_rhythm sequence walk, continuous → short_break).
  2. **Lifecycle adapter** `timer-session-lifecycle.ts`: private `nextBreakPhase` → `resolveNextBreakPhase` only; `phase_prompt` events and segment targets share that authority; `startNextPhaseFromCompleted` freezes `planSnapshot` + advances `rhythmStepIndex` via custom-rhythm walker.
  3. **Presentation module** `phase-prompt-sheet.ts`: `computeNextBreakPhase` **delegates** to `resolveNextBreakPhase`, then coerces `wrap_up → short_break` for the break-sheet surface only (documented; lifecycle keeps full phase set).
  4. **Break-end sheet** `break-end-prompt-sheet.ts`: `projectBreakEndHandoffPlan` + disposition via shared `resolvePhasePromptDisposition` / `normalizeBreakPolicy` (no duplicate policy table).
  5. **Host intent adapter** `phase-handoff-intent.ts`: disposition → shell/notify/start intents; fail-closed answer maps; host `useStudySession` applies effects only (commits, dual-write starts, notifications) — does not re-walk break math.
- **Domain peels already exist:** timer-plan, lifecycle reducers, schedule-block, recurrence, custom-rhythm, migration dry-run/commit, categories, timeline projection, empty-start/classification sheets — change locality for product features remains file-level.
- **Authority language explicit:** epoch-ms schedule authority; projections never mutate order authority; localStorage demote marker; dual-write semantics in ADR-0129 (shared pure does not invent a second authority); TimerSession identity language stable (never bare “Session”).
- **Store size (~1.1k)** is command dispatch + invariants that *belong* behind one sole-writer interface; peel-for-size alone fails ADR-0075 without dual thrash signals.
- History remains feature cutover landings, not multi-module bug series around one shallow seam.
- Product floor intact: no shell/YOLO; no MCP marketplace surface; study-planning physically separate from teaching ledger / settlement sole-writer.

**Negative evidence**

- Prior reopen condition “(4) phase WIP lands a second competing phase walker outside sole reducers” **did not materialize**: both lifecycle and phase-prompt UI call the same `resolveNextBreakPhase` module; presentation coerce is an intentional surface adapter, not a second longBreakEvery walker.
- Renderer dual-write thrash would reopen **renderer** slices (e.g. S15), not restructure pure shared without new evidence.
- `computeNextBreakPhase` + `resolveNextBreakPhase` dual export is **not** dual authority: one pure function wraps the other for sheet typing; dual-signal thrash absent.
- No evidence pure store and durable host diverged on CAS/revision semantics within this slice.
- No TimerSession ↔ LearningSession type confusion in shared types.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Plan kinds, lifecycle, next-break walker, phase/break sheets, host-intent map, schedule, recurrence, migration peels already separate; handoff landing added modules instead of bloating store |
| Interface depth | **Healthy** | Callers use store commands / normalize* / pure reducers / project*HandoffPlan / resolve*HandoffIntent; CAS + catalog + break-phase invariants inside |
| Seam legitimacy | **Healthy** | Pure store vs durable host; UI clock vs durable finish; projection vs authority; disposition projectors vs host effect application; presentation coerce vs lifecycle full phase |
| Test surface | **Healthy** | Unit coverage for phase/break sheets, handoff intents, store, lifecycle, custom-rhythm |
| Conceptual integrity | **Healthy** | Prior Watch cleared: single next-break authority landed; ADR-0094/0117/0129 language still matches code; TimerSession ≠ LearningSession |
| Cost proportionality | **Healthy** | No admitted deepening with positive NPV; store size alone is not a candidate |

### Candidates

**0 candidates** (none admitted under skill gates).

Gates applied to every potential smell (none passed **all** of: dual evidence, recurrence, causality, depth, safety, compatibility, net payoff):

| Rejected smell | Why not admitted |
| --- | --- |
| Peel `study-planning-store` by size (~1.1k) | Single command sole-writer is the intended deep interface; no dual thrash / multi-fix series; ADR-0075 peel-for-size without leverage fails net payoff |
| Merge `computeNextBreakPhase` / `resolveNextBreakPhase` | Intentional presentation adapter; zero thrash signals; merge would hurt sheet typing locality |
| Fold `phase-handoff-intent` into sheets or host | Currently improves host locality (useStudySession applies, does not re-switch disposition); reverse would raise renderer coupling |
| Second phase walker in renderer | Negative evidence: host uses projectors + intent resolvers only |

**Reopen later only if:** (1) pure store and durable host diverge on CAS/revision semantics; (2) dual-write silently dual-authorizes localStorage; (3) TimerSession confused with LearningSession in shared types; (4) a **new** competing longBreakEvery / custom_rhythm walker appears outside `next-break-phase` + custom-rhythm advance helpers; (5) host re-implements disposition/break math bypassing `project*HandoffPlan` / `resolve*HandoffIntent`.

### Metrics for tracker

- approx_lines_examined: **9200**
- files_examined: **29** (slice) + host hop / ADRs / unit anchors (out of scope LOC not double-counted into primary LOC)
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: phase handoff WIP from prior review is landed at HEAD `99d546a5`; conceptual integrity Watch cleared; still no architecture candidates
