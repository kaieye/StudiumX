# Slice S14 — code-arch-improve (read-only)

**Agent:** Grok Build subagent (improve-codebase-architecture, read-only)
**Revision:** `99d546a5480888d318f4511d1210c6d3971384d9` (post workbench pomodoro draft peel; prior pass `6ff53d849b8df3b194ff74bf80f49622bc3aec62`)
**Skill:** `$code-arch-improve` + codebase-design vocabulary (module / interface / depth / seam / adapter / leverage / locality)
**Mode:** read-only — **0 production edits**

---

### Slice S14

Renderer workbench B: task schedule page, recurrence editors, planning sheets, study analytics UI/domain — **plus re-check of WorkbenchPomodoro draft/settings peels** that landed after the prior S14 pass (also adjacent to S13 workbench A).

### Scope

| Item | Value |
| --- | --- |
| Revision | `99d546a5480888d318f4511d1210c6d3971384d9` |
| Primary LOC | **~47 files / ~12.4k** (schedule + recurrence + sheets + analytics + pomodoro draft triad; one logical workbench-B pass slightly over 10k) |
| Examined deeply | `WorkbenchPomodoro.tsx` (~827), `WorkbenchPomodoroSettings.tsx` (~452), `workbench-pomodoro-draft.ts` (~541); `StudyTaskSchedulePage.tsx` (~1791) + month/time/conflicts/interaction peels; recurrence rule/series/month + custom-rhythm editor; empty-start / reconcile / phase / break / classify / migration / v1-demote / future-blocks sheets; analytics `activityLedger` + `useStudyAnalytics` + page/charts |
| ADRs | 0094 timer planSnapshot freeze; 0117/0129 dual-write sole-read; analytics local projection (not teaching truth; not remote telemetry); product floors in `Agents.md` |

**Material evidence**

#### Pomodoro draft peel (delta since prior S14)

- **`workbench-pomodoro-draft.ts`** is a pure module (no React/DOM): draft create/project/build/validate, kind-UI transitions (`applyTimerPlanKindUi`), catalog projection (`draftFromCatalogPlanSources`), and **decide\*** helpers (`decideLiveDraftCommit`, `decideSavePlan`, `decideApplyPlan`). React only wires state + host callbacks — **deep interface** for plan-edit policy; authority for continuous/exam/custom_rhythm stays on shared kind/advanced-field peels (`planning-timer-plan-kind`, `planning-timer-plan-advanced-fields`, simulation-window UI).
- **`WorkbenchPomodoroSettings.tsx`** is a presentational portal (catalog nav, rename, plan fields, footer) over pure draft + host props — **seam legitimacy**: settings UI ≠ dual-write / CAS.
- **`WorkbenchPomodoro.tsx`** remains the composition root for face clock / phase chrome / a11y / state markers (study-space pure projectors) and live-commit via `decideLiveDraftCommit` with explicit STC-503 / ADR-0094 freeze of running `planSnapshot`. Host props (`onSaveTimerPlan`, `onApplyTimerPlan`, …) are adapters; no local StudyPlanningStore CAS.
- Dense pure units: `tests/unit/workbench-pomodoro-draft.unit.test.ts` (+ multiple UI unit files for face clock, mode arrows, wrap-up, extend-rest, a11y, state markers).

#### Schedule / recurrence / sheets / analytics (stable peels)

- **Schedule page** consumes host projectors (`projectWeekScheduleEntriesFromHost`, timeline adapters, calendar-nav pure models, conflict-resolve host helpers) — calendar **UI over host projections**, not a second store. Peels already extract month board, time select, conflicts banner, interaction/layout helpers; dual-write for categories goes through `dualWriteSetCategories` + optional `CanonicalPlanningContext` / `canonicalCategories` sole-read — not React inventing CAS.
- **Sheets** (empty start, classify, batch classify, reconcile, phase, break, migration, v1 demote, future blocks) are thin UI shells over **shared pure sheet models** (`buildEmptyStartSheetModel`, `buildReconcileSheetModel`, …) — locality for product flows; host resolves outcomes.
- **Recurrence** UI peels (rule editor, series edit sheet, month preview) mirror shared pure domain (`planning-recurrence-expand`, `planning-recurrence-series-ui`); explicit CTAs, no auto-expand / silent task clone.
- **Analytics:** `activityLedger` + dateRange + charts are **local rebuildable projection** with retention (`STUDY_ANALYTICS_RETENTION_DAYS`, storage key prefix); coverage warnings explicit; not FTS/vector product search; not SQLite teaching authority; not default remote telemetry. `useStudyAnalytics` is a query/client adapter shell over personal ledger + optional learning-analytics client.
- Large schedule page (~1.8k) and activity ledger (~0.9k) are **interaction / projection surfaces**; size alone is not a candidate under ADR-0075 without dual thrash / dual-authority signals.

**Negative evidence**

- No evidence callers re-orchestrate StudyPlanningStore CAS in React for schedule or pomodoro (host dual-write / planning-client remain authority paths — see S15).
- Pomodoro remaining size is UI chrome + React state wiring after settings/draft peels — not a missing domain seam.
- Analytics size is domain projection complexity that belongs behind the ledger interface.
- Peel-for-size of `StudyTaskSchedulePage` or `WorkbenchPomodoro` alone fails ADR-0075 + skill gates without dual thrash signals.
- Immersive/music localStorage prefs exist under workbench but are **out of S14 product authority** (scene/playback prefs, not schedule dual-write truth). Migration/demote copy correctly refuses elevating localStorage after workspace commit.

### Verdict

**Good enough — no architecture change recommended**

Pomodoro draft/settings peel **improved** change locality and interface depth for timer-plan editing without inventing a second authority path. Workbench B schedule/recurrence/sheets/analytics remain on existing peels; **0 positive-NPV candidates**.

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Draft pure module + settings portal; schedule/recurrence/sheet/analytics peels |
| Interface depth | **Healthy** | `decide*` / `draftFrom*` / host projectors hide policy; React wires only |
| Seam legitimacy | **Healthy** | Pure draft vs React; dual-write client vs UI; local analytics vs teaching ledger; frozen planSnapshot mid-run |
| Test surface | **Healthy** | draft units + schedule/sheet/recurrence/analytics unit matrix; pomodoro UI units |
| Conceptual integrity | **Healthy** | ADR-0129 / 0094 anchors match; draft does not dual-authorize localStorage |
| Cost proportionality | **Healthy** | 0 candidates; further size peels fail skill gates |

### Candidates

**0 candidates** (none admitted under dual-signal + cost gates; size alone ≠ candidate per ADR-0075).

**Reopen if:**

1. Pomodoro UI reimplements CAS / timer lifecycle outside host dual-write + TimerSession.
2. Schedule UI dual-authorizes localStorage as planning truth (bypassing sole-read hydrate / dual-write).
3. Analytics becomes remote telemetry (phone-home) or teaching evidence authority.
4. Recurrence UI diverges from shared expand rules without tests, or auto-expands / clones tasks silently.
5. Live draft commit mutates running session `planSnapshot` (breaks STC-503 / ADR-0094).
6. `decide*` policy leaks back into React components as duplicated branches (seam thrash).

### Metrics

- approx_lines_examined: **12400**
- files_examined: **47**
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: pomodoro draft triad re-examined at HEAD; schedule/recurrence/analytics/sheets peels re-validated; 0 production edits
