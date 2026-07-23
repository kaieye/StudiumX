# Slice S13 — code-arch-improve (read-only re-review)

**Agent:** Grok Build subagent (`improve-codebase-architecture`, read-only)
**Revision:** `99d546a5480888d318f4511d1210c6d3971384d9` (branch `main` HEAD; prior pass `6ff53d849b8df3b194ff74bf80f49622bc3aec62`)
**Skill:** `$code-arch-improve` + codebase-design vocabulary (module, interface, depth, seam, adapter, leverage, locality)
**Mode:** read-only — **0 production edits**; only this report file rewritten
**Prior pass:** good_enough · 0 cand (fitness Watch on dirty timer phase WIP)

---

### Slice S13

Renderer workbench A: focus timer / pomodoro UI, office immersive scene, music player, immersive media peels.

### Scope

| Item | Value |
| --- | --- |
| Revision | `99d546a5480888d318f4511d1210c6d3971384d9` |
| Primary path | `D:\project\StudiumX\src\renderer\src\views\workbench\` (timer / office / music / immersive cluster) |
| Primary LOC | **16 files / ~6.5k** (same order of magnitude as prior S13; TS/TSX product peels only) |
| Examined deeply | `WorkbenchPomodoro.tsx` (~827), `WorkbenchPomodoroSettings.tsx` (~452), `workbench-pomodoro-draft.ts` (~541); `OfficeWorkbench.tsx` (~1200 composition root); `office-scene-runtime.ts` (~521); immersive peels (`ImmersiveSceneLayer`, `ImmersiveFocusTimerScene`, `ImmersiveScenePicker`, `immersive-scene-{types,catalog}`, `immersive-clock-display`, `immersive-custom-media-store`, `useImmersiveCustomMedia`); music (`WorkbenchMusicPlayer` ~1297, `music-playback-session`, `music-client`); supporting disclosures (`useWorkbenchDisclosureReveal`, `WorkbenchLeaderboard`, `WorkbenchRoomSwitcher`, `useDialogAsk`) |
| EXCLUDED (S14) | Schedule page, recurrence editors, analytics domain/page, empty-start/classify/reconcile/phase/break **sheet components as product owners** — those sheets are **hosted** by OfficeWorkbench but owned as workbench-B / study-space flows (S14/S15) |
| EXCLUDED (S15) | `useStudySession`, dual-write / hydrate / TimerSession bridge / phase-handoff host effects |
| EXCLUDED (S11) | Shared pure phase walkers / store CAS (`src/shared/study-planning/**`) |
| ADRs | **0094** TimerSession design gate; **0117** / **0129** dual-write sole-read (host authority outside React); local music/IDB/scene prefs **not** teaching evidence |
| Material delta since prior | Continuous/exam sole predicate landed (`isExamContinuousPlan` / `continuousModeFromV1` — see `out/continuous-mode-exam-authority-completion-report.md`); immersive multi-item IDB + scene picker peels stable; phase handoff product path closed in S11/S15 — S13 only dialog-wires sheets |
| Tests | `workbench-pomodoro*.unit.test.tsx`, `workbench-pomodoro-draft.unit.test.ts`, `office-scene-runtime.unit.test.ts`, `office-workbench-immersive.unit.test.tsx`, `immersive-custom-media-store.unit.test.ts`, `music-playback-session.unit.test.ts`; e2e immersive/menu/fullscreen/clock |

**Pomodoro ownership:** **In S13** (not S14). Paths exist and remain the timer UI surface: `WorkbenchPomodoro*.tsx`, `workbench-pomodoro-draft.ts`. S14 owns schedule/recurrence/analytics only.

**Material evidence**

- **Draft peel (deep interface):** `workbench-pomodoro-draft.ts` owns pure `createTimerPlanDraft` / `draftFromPlan` / `buildPlanPayload` / validity / `applyTimerPlanKindUi` / `decideLiveDraftCommit` / `decideSavePlan` / `decideApplyPlan`. React (`WorkbenchPomodoro`) only holds editor state and calls host callbacks (`onSaveTimerPlan` / `onApplyTimerPlan`) — no second plan authority in the component tree.
- **Pomodoro UI projects chrome; does not invent timer lifecycle:** face clock, phase chrome, a11y, state markers, catalog rows come from study-space pure UI helpers (`planning-timer-face-clock-ui`, `planning-timer-phase-chrome-ui`, `planning-timer-a11y-ui`, `planning-timer-state-markers-ui`, `planning-timer-plan-catalog-ui`, `planning-timer-plan-kind`). Live clock / transitions remain `activeTimerSession` + host `useStudySession` (ADR-0129 / S15) — React does not dual-write CAS or reimplement lifecycle reducers.
- **Exam/continuous integrity improved:** post-prior WIP, exam detection routes through shared sole predicates (`isExamContinuousPlan` / `continuousModeFromV1`) in draft + settings + face-clock path — clears prior conceptual Watch for ad-hoc exam checks on this surface.
- **OfficeWorkbench is composition root, not a second domain store:** mounts canvas + `createOfficeSceneRuntime`, wires `useStudySession` callbacks into pomodoro/tasks/music, immersive arc/controls, and sheet dialogs via `useDialogAsk`. Schedule/analytics routes compose S14 pages; phase/break/empty-start sheets are UI shells over study-space ask ports — host apply stays in S15.
- **Office scene runtime** is a deep canvas/DOM adapter (`mount` / `update` / `dispose`) with seat hit-testing and pet sprite draw; desk layout constants local; selection intent callback only — no planning authority.
- **Immersive peels already legitimate:** catalog + types + custom media IDB store + hook + layer/plane + focus-timer face projector + scene picker. Store header states renderer-local only, **not** teaching evidence / workspace truth. Object URLs ephemeral; Blobs durable. Preference localStorage is scene chrome only.
- **Music:** `music-playback-session` owns audio element + snapshot + localStorage convenience queue; `music-client` is thin `window.studiumxMusic` IPC adapter; `WorkbenchMusicPlayer` is large UI surface (queue/library/account tabs). Music localStorage is playback convenience, not StudyPlanning dual-write or teaching authority.
- **Disclosure helper** (`useWorkbenchDisclosureReveal`) peels height-reveal for pomodoro/music/leaderboard — shared presentation, not domain thrash.

**Negative evidence**

- No dual thrash of a shallow seam across unrelated modules: timer product work deepens pure draft + study-space projectors; immersive work stays in media store/hook/picker; music stays in session/client/player.
- Phase handoff reopen condition (second walker) is **out of S13** and already cleared in S11/S15; OfficeWorkbench only maps dialog results to `useStudySession` ask ports.
- Size of `WorkbenchMusicPlayer` (~1.3k) and `OfficeWorkbench` (~1.2k) is product UI composition surface — peel-for-LOC alone fails ADR-0075 + skill cost gate without dual-signal friction.
- No settlement / shell / YOLO / MCP marketplace product surface in workbench A.
- No FTS/vector product search; immersive IDB is media blobs only.
- Prior dirty timer WIP is no longer an architecture Watch on this slice: authority remains dual-write + TimerSession host (S15); exam sole predicate landed on UI paths.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Draft / settings / scene runtime / immersive store+hook+picker / music session+client peels already separate |
| Interface depth | **Healthy** | `decide*` helpers + pure face/phase projectors + runtime mount/update/dispose + music snapshot API hide policy |
| Seam legitimacy | **Healthy** | Pure draft vs React wire; host TimerSession vs UI chrome; scene runtime vs OfficeWorkbench; music session vs view; IDB media ≠ teaching truth |
| Test surface | **Healthy** | Draft decide* units; pomodoro settings/face/wrap-up/state-marker units; immersive store + office immersive; music playback session; e2e immersive |
| Conceptual integrity | **Healthy** | Exam/continuous sole predicates landed; timer authority still host-side (ADR-0129); music/immersive explicitly non-teaching |
| Cost proportionality | **Healthy** | 0 positive-NPV candidates under skill gates |

### Candidates

**0 candidates** (none admitted under skill gates; dual signals required — size / LOC alone insufficient).

**Reopen later only if:** (1) pomodoro UI reimplements CAS/lifecycle or invents a second timer authority outside host + pure draft; (2) music or immersive local stores become teaching / StudyPlanning authority; (3) immersive media thrash couples unrelated modules for one product change; (4) OfficeWorkbench regrows dual-write or phase-walker logic instead of dialog→host ports.

### Metrics for tracker

- approx_lines_examined: **6510**
- files_examined: **16** primary (+ supporting disclosure/leaderboard/dialog hooks sampled)
- candidate_count: **0**
- status_for_tracker: **good_enough**
