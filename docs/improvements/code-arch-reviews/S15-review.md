# Slice S15 — code-arch-improve (read-only re-review)

**Agent:** Grok Build subagent (read-only)
**Revision:** `99d546a5480888d318f4511d1210c6d3971384d9` (HEAD `main`; prior dirty timer phase WIP landed)
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**
**Prior pass:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62` → good_enough · 0 cand (Watch on dirty useStudySession / timer WIP)

---

### Slice S15

Renderer study-space host: dual-write / sole-read hydrate / timer session bridge / phase handoff host wire / presence / migration demote for StudyPlanning cutover (ADR-0117 / ADR-0129).

### Scope

| Item | Value |
| --- | --- |
| Revision | `99d546a5480888d318f4511d1210c6d3971384d9` |
| Primary LOC | **62 files / ~18.7k** (one logical study-space pass; honest over-10k cutover cluster) |
| Examined deeply | `planning-client` (CAS IPC thin adapter), `planning-dual-write` + timer/task/prefs dual-write peels, `planning-hydrate` sole-read, `planning-v1-authority-demote`, `session/useStudySession` composition (~3.2k), `planning-timer-session-bridge`, `planning-timer-display` (sole-read clock + next-phase local start), `planning-timer-face-clock-ui`, `planning-timer-plan-kind`, shared hop: `phase-handoff-intent` / `startNextPhaseFromCompleted` |
| Expansion hop | shared pure store / phase sheets (S11), main durable IPC (S09 sample), workbench sheets/analytics (S13–S14) |
| ADRs | **0117** paths/wire; **0129** dual-write + sole-read + demote fail-closed + TimerSession clock authority; **0094** design gate; **0075** module size (size alone ≠ candidate); TimerSession ≠ LearningSession / settlement |
| Product drift since prior | Timer phase handoff landed in `useStudySession` + bridge/display; pure disposition/intent table in shared (`projectPhaseHandoffPlan` / `resolveFocusCompleteHandoffIntent` / `startNextPhaseFromCompleted`) |
| Tests | Dense suite (`study-planning-*` units + timer thrash/recovery/demote e2e): client, hydrate, dual-write family, demote, timer dual-write/sleep/analytics, phase sheets, migration, recurrence, schedule conflicts, etc. |

**Material evidence**

- **Client depth:** `planning-client` remains a thin fail-closed IPC **adapter**: missing workspace/API → structured error; `expectedRevision` CAS; unique `actionId`; revision_conflict re-read/retry; **never** localStorage fallback as planning/teaching authority.
- **Dual-write ≠ dual authority (ADR-0129):** optimistic V1 UI shell + canonical publish; skip/fail keeps UI usable without elevating localStorage to planning truth. Per-tick advance intentionally not dual-written (disk thrash policy) — still encoded in `planning-timer-dual-write` / display headers.
- **Sole-read hydrate:** when canonical has tasks, UI tasks replaced by projected PlanningTask rows; empty canonical + V1 tasks → keep V1 + `migrationSuggested`; missing API/workspace → keep V1 fail-closed; timerSessions / scheduleBlocks / preferences project as sole-read caches (not open-clock authority).
- **Demote fail-closed:** erase requires `userConfirmed` + `backupExportOk`; migration commit alone never demotes; presence keys preserved by default; demoted persist strips task authority.
- **Timer authority split holds after phase land:** local TimerSession = focus/break UI clock; dual-write transitions only; segment-close analytics + live focus counters demoted from V1 twin to TimerSession projection; **no** `LearningSession` / settlement / `toolsReplayed` coupling in study-space.
- **Phase handoff product path (post-WIP):** host **interface** is effect application only — pure projectors/intents live in shared (`phase-handoff-intent`, `phase-prompt-sheet`, `timer-session-lifecycle.startNextPhaseFromCompleted`); renderer `applyTimerSessionTransition({ kind: 'start_from_completed' })` + `startLocalNextPhaseFromCompleted` wrap the shared reducer; `useStudySession` maps intent → shell / notify / prompt / start without inventing a second phase walker or CAS path.
- **Face / plan-kind peels:** `planning-timer-face-clock-ui` and `planning-timer-plan-kind` are pure projection **adapters** (dial chrome / V1↔V2 kind fields) — locality for UI/clockMode product work; no I/O, no authority.
- **Composition giant (`useStudySession` ~3188 LOC):** wiring surface for already-peeled dual-write / hydrate / timer / notification / presence / phase-host intents — expected cutover **depth** at the React seam, not a missing domain **seam**. Domain peels exist at file level (client, dual-write*, hydrate, demote, migration, timer-*, schedule-*, recurrence-*, lifecycle, bridge).
- **Peel-for-size of the hook alone** fails ADR-0075 + skill gates without dual thrash / dual-authority / second-CAS signals.

**Negative evidence**

- History and structure show planned cutover peels (STC slices) + completed phase handoff product land, not multi-module bug series around one shallow seam.
- Phase WIP from prior Watch **landed without** a competing phase walker outside shared pure reducers; residual V1 auto-handoff only when frozen plan / handoff projector returns null (legacy shell fail-closed — not dual authority).
- Presence MQTT / ambient playback are peripheral adapters; no shell/YOLO/settlement coupling; study-space analytics is local rebuildable, not remote telemetry or teaching evidence.
- No evidence callers re-implement StudyPlanningStore CAS in React outside planning-client dual-write peels.
- No dual thrash signals (same hotspot edited for conflicting reasons across unrelated modules) sufficient to admit a candidate under skill gates.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Dual-write / hydrate / demote / timer / schedule / recurrence / face-clock / plan-kind peels already separate; phase policy in shared pure |
| Interface depth | **Healthy** | Callers use client + dualWrite* + hydrate + bridge transition API; CAS/actionId/authority + phase disposition tables inside peels/shared |
| Seam legitimacy | **Healthy** | Canonical vs V1 cache; UI clock vs durable TimerSession; dual-write vs sole-read asymmetry per ADR-0129; host effects vs pure intent |
| Test surface | **Healthy** | Large dual-write / hydrate / demote / timer / thrash unit+e2e matrix |
| Conceptual integrity | **Healthy** | Phase handoff landed on shared sole reducers + intent table; TimerSession ≠ LearningSession preserved; dual-write language still matches ADR-0129 |
| Cost proportionality | **Healthy** | No admitted deepening with positive NPV; composition-hook size is expected cutover surface (ADR-0075) |

### Candidates

**0 candidates** (none admitted under skill gates; dual signals required — size / LOC alone insufficient).

**Reopen later only if:** (1) dual-write silently dual-authorizes localStorage as planning truth; (2) hydrate invents rows when API missing; (3) demote erases without confirm+backup; (4) useStudySession regrows a second competing CAS/orchestration path outside planning-client; (5) a second phase walker lands outside shared pure reducers / intent table; (6) TimerSession confused with LearningSession / settlement sole-writer.

### Metrics for tracker

- approx_lines_examined: **18686**
- files_examined: **62**
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: re-review after timer phase handoff land at `99d546a5`; prior Watch on dirty WIP cleared — conceptual integrity Healthy; still 0 candidates
