import { ChevronDown, ChevronLeft, ChevronRight, Pause, Play, Plus, RotateCcw, Settings2, Timer } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { formatStudyDuration } from '../../study-space/domain'
import type { StudySnapshot, StudyTimerMode, StudyTimerPlanInput } from '../../study-space/types'
import {
  timerPlanKindToUi,
  type StudyTimerPlanKind,
  type StudyTimerPlanKindUi
} from '../../study-space/planning-timer-plan-kind'
import { totalMinutesFromSimulationWindow } from '../../study-space/planning-simulation-window-ui'
import { useWorkbenchDisclosureReveal } from './useWorkbenchDisclosureReveal'
import type { TimerSessionRecord } from '../../../../shared/study-planning'
import {
  listTimerPlanCatalogRows,
  resolveTimerPlanShellForCatalog,
  type TimerPlanCatalogRow
} from '../../study-space/planning-timer-plan-catalog-ui'
import type { EmptyStartCategoryOption } from '../../study-space/planning-study-prefs-ui'
import {
  isPlanningTimerKeyboardTargetEditable,
  mapPlanningTimerKeyboardAction,
  projectPlanningTimerA11yStatus
} from '../../study-space/planning-timer-a11y-ui'
import { projectPlanningTimerPhaseChrome } from '../../study-space/planning-timer-phase-chrome-ui'
import { projectPlanningTimerStateMarkers } from '../../study-space/planning-timer-state-markers-ui'
import {
  formatExamWallClock,
  formatExamWallClockParts,
  projectWorkbenchTimerFaceClock
} from '../../study-space/planning-timer-face-clock-ui'
import {
  buildPlanPayload,
  createTimerPlanDraft,
  draftFromPlan,
  draftKindFromCatalogPlanKind,
  hasApplyableTimerFields,
  isDraftPayloadValid,
  type TimerPlanDraft
} from './workbench-pomodoro-draft'
import { WorkbenchPomodoroSettings } from './WorkbenchPomodoroSettings'

export type WorkbenchPomodoroProps = {
  snapshot: StudySnapshot
  timerProgress: number
  selectedTaskId?: string | null
  /** Canonical / local default plan id for catalog UI (STC-502). */
  defaultTimerPlanId?: string | null
  /** Empty-start / quick_start category id (default other). */
  emptyStartCategoryId?: string
  /** Category options for empty-start select (preset + custom). */
  emptyStartCategoryOptions?: readonly EmptyStartCategoryOption[]
  /** STC-503: live local TimerSession with frozen planSnapshot (UI clock authority). */
  activeTimerSession?: TimerSessionRecord | null
  onToggleTimer: () => void
  onResetTimer: () => void
  onStartTimerInMode: (timerMode: StudyTimerMode) => void
  onSaveTimerPlan: (
    input: StudyTimerPlanInput & { id?: string; applyOnly?: boolean }
  ) => string | null | void
  onApplyTimerPlan: (planId: string) => void
  onRemoveTimerPlan: (planId: string) => void
  /** STC-501: copy catalog plan as custom (optional for hosts that dual-write). */
  onCopyTimerPlan?: (planId: string) => void
  /** STC-502: rename custom plan (returns false when refused). */
  onRenameTimerPlan?: (planId: string, name: string) => boolean
  /** STC-502: set default plan preference. */
  onSetDefaultTimerPlan?: (planId: string) => void
  /** Write emptyStartCategoryId preference (implies quick_start). */
  onEmptyStartCategoryIdChange?: (categoryId: string) => void
  /**
   * STC-205 / §10.3: extend active countdown target (typically break mid-run).
   * Host maps to useStudySession.extendActiveTimerTarget.
   */
  onExtendActiveTimer?: (addMinutes: number) => void
}

export function WorkbenchPomodoro({
  snapshot,
  timerProgress,
  selectedTaskId = null,
  defaultTimerPlanId = null,
  emptyStartCategoryId = 'other',
  emptyStartCategoryOptions = [],
  activeTimerSession = null,
  onToggleTimer,
  onResetTimer,
  onStartTimerInMode,
  onSaveTimerPlan,
  onApplyTimerPlan,
  onRemoveTimerPlan,
  onCopyTimerPlan: _onCopyTimerPlan,
  onRenameTimerPlan,
  onSetDefaultTimerPlan: _onSetDefaultTimerPlan,
  onEmptyStartCategoryIdChange,
  onExtendActiveTimer
}: WorkbenchPomodoroProps) {
  const { open, isClosing, revealHeight, revealRef, revealInnerRef, toggle } = useWorkbenchDisclosureReveal()
  const [selectedMode, setSelectedMode] = useState<StudyTimerMode>(snapshot.timerMode)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<TimerPlanDraft>(() => createTimerPlanDraft(snapshot))
  const settingsTitleId = useId()
  const [settingsPortalHost, setSettingsPortalHost] = useState<HTMLElement | null>(null)
  const [selectedCatalogPlanId, setSelectedCatalogPlanId] = useState<string | null>(null)
  /** Catalog plan id last applied to the live timer preset (left-nav / 应用). */
  const [appliedCatalogPlanId, setAppliedCatalogPlanId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // STC-604: host-owned reduced-motion flag (matchMedia); pure markers stay window-free.
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!media) return
    const apply = (): void => setReducedMotion(Boolean(media.matches))
    apply()
    const onChange = (event: MediaQueryListEvent): void => setReducedMotion(event.matches)
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])

  useEffect(() => {
    setSelectedMode(snapshot.timerMode)
  }, [snapshot.timerMode])

  useEffect(() => {
    if (defaultTimerPlanId) {
      setAppliedCatalogPlanId(defaultTimerPlanId)
    }
  }, [defaultTimerPlanId])

  const appliedPlanShell = useMemo(() => {
    const id = appliedCatalogPlanId ?? defaultTimerPlanId ?? null
    if (!id) return null
    return resolveTimerPlanShellForCatalog(id, snapshot.timerPlans)
  }, [appliedCatalogPlanId, defaultTimerPlanId, snapshot.timerPlans])

  const faceClock = projectWorkbenchTimerFaceClock({
    timerState: snapshot.timerState,
    timerMode: snapshot.timerMode,
    selectedMode,
    remainingSeconds: snapshot.remainingSeconds,
    focusMinutes: snapshot.focusMinutes,
    breakMinutes: snapshot.breakMinutes,
    simulationStartTime: snapshot.simulationStartTime,
    simulationEndTime: snapshot.simulationEndTime,
    appliedPlan: appliedPlanShell,
    activeSessionClockMode: activeTimerSession?.clockMode ?? null
  })
  const displayedRemainingSeconds = faceClock.displaySeconds
  /** Exam-only: HH:MM primary + SS under the dial. Other plans stay MM:SS (or H+:SS) on one line. */
  const isExamFace = faceClock.wallBaseSeconds != null
  const examFaceParts = isExamFace
    ? formatExamWallClockParts(faceClock.wallBaseSeconds!, displayedRemainingSeconds)
    : null
  const remainingTime = isExamFace
    ? formatExamWallClock(faceClock.wallBaseSeconds!, displayedRemainingSeconds, {
        alwaysSeconds: snapshot.timerState === 'running' || snapshot.timerState === 'paused'
      })
    : formatStudyDuration(displayedRemainingSeconds)

  const isModePreview = selectedMode !== snapshot.timerMode
  const displayedProgress = isModePreview ? 0 : Math.min(100, Math.max(0, timerProgress))
  const timerRingStyle = { '--timer-ring-offset': `${100 - displayedProgress}` } as CSSProperties
  // STC-205: wrap_up mid-run chrome (durable phase != V1 break shell label).
  const phaseChrome = projectPlanningTimerPhaseChrome({
    activeSession: activeTimerSession,
    timerMode: snapshot.timerMode,
    selectedMode
  })
  // STC-604: non-color state chip + overtime + reduced-motion class tokens.
  const stateMarkers = projectPlanningTimerStateMarkers({
    timerState: snapshot.timerState,
    timerMode: snapshot.timerMode,
    selectedMode,
    activeSession: activeTimerSession,
    remainingSeconds: isModePreview ? null : snapshot.remainingSeconds,
    reducedMotion,
    countdownSegment: activeTimerSession?.clockMode !== 'countup'
  })
  const timerLabel = phaseChrome.timerLabel
  const focusTask = selectedTaskId
    ? snapshot.tasks.find((task) => task.id === selectedTaskId) ?? null
    : null
  const timerIsRunning = snapshot.timerState === 'running' && !isModePreview
  const timerActionLabel = timerIsRunning
    ? '暂停'
    : isModePreview ? `开始${selectedMode === 'focus' ? '专注' : '休息'}`
      : snapshot.timerState === 'paused' ? '继续' : '开始'
  const draftKind: StudyTimerPlanKind =
    draft.kind === 'continuous'
      ? 'continuous'
      : draft.kind === 'custom_rhythm'
        ? 'custom_rhythm'
        : 'pomodoro'
  const draftKindUi: StudyTimerPlanKindUi = timerPlanKindToUi(
    draft.kind,
    draft.continuousTarget === true,
    draft.continuousMode
  )
  const continuousTotalMinutes =
    totalMinutesFromSimulationWindow(draft.simulationStartTime, draft.simulationEndTime)
    ?? (
      Number.isInteger(draft.focusMinutes) && draft.focusMinutes >= 5
        ? draft.focusMinutes
        : null
    )
  const hasValidDraft = isDraftPayloadValid(draft)

  // STC-205: mid-break extend (+1 min) when host provides callback and break is active countdown.
  const canExtendBreak = Boolean(
    onExtendActiveTimer
    && (
      (
        activeTimerSession
        && (activeTimerSession.phase === 'short_break' || activeTimerSession.phase === 'long_break')
        && (activeTimerSession.state === 'running' || activeTimerSession.state === 'paused')
        && activeTimerSession.clockMode === 'countdown'
        && activeTimerSession.targetSeconds != null
      )
      || (
        !activeTimerSession
        && snapshot.timerMode === 'break'
        && (snapshot.timerState === 'running' || snapshot.timerState === 'paused')
      )
    )
  )

  // STC-603: static (non-ticking) status for screen readers.
  const a11yStatus = projectPlanningTimerA11yStatus({
    timerState: snapshot.timerState,
    timerMode: selectedMode,
    activeSession: activeTimerSession,
    taskTitle: focusTask?.title ?? null,
    fallbackClockMode: 'countdown'
  })

  const catalogRows = useMemo(
    () =>
      listTimerPlanCatalogRows({
        userPlans: snapshot.timerPlans,
        defaultTimerPlanId,
        includeBuiltins: true
      }),
    [snapshot.timerPlans, defaultTimerPlanId]
  )

  const selectedCatalogRow = useMemo(() => {
    // Empty string = '添加方案' draft mode (no catalog row selected).
    if (selectedCatalogPlanId === '') return null
    const id =
      selectedCatalogPlanId
      ?? catalogRows.find((row) => row.isDefault)?.id
      ?? catalogRows[0]?.id
      ?? null
    if (!id) return null
    return catalogRows.find((row) => row.id === id) ?? null
  }, [catalogRows, selectedCatalogPlanId])

  const handleAddPlan = (): void => {
    setSelectedCatalogPlanId('')
    setAppliedCatalogPlanId(null)
    setDraft(createTimerPlanDraft(snapshot))
  }

  const startRename = (row: TimerPlanCatalogRow): void => {
    if (!row.canRename || !onRenameTimerPlan) return
    setRenamingId(row.id)
    setRenameDraft(row.name)
  }

  const commitRename = (): void => {
    if (!renamingId || !onRenameTimerPlan) {
      setRenamingId(null)
      return
    }
    const nextName = renameDraft.trim()
    const ok = onRenameTimerPlan(renamingId, renameDraft)
    if (ok) {
      setRenamingId(null)
      // Keep editor name in sync so 应用/保存 stays valid after rename.
      if (selectedCatalogPlanId === renamingId || selectedCatalogPlanId == null) {
        setDraft((current) => ({
          ...current,
          name: nextName || current.name
        }))
      }
    }
  }

  const loadDraftForCatalogPlan = (planId: string): void => {
    const row = catalogRows.find((r) => r.id === planId)
    const plan = snapshot.timerPlans.find((p) => p.id === planId)
    const shell = plan ?? resolveTimerPlanShellForCatalog(planId, snapshot.timerPlans)
    if (shell) {
      setDraft(draftFromPlan(shell))
      return
    }
    if (row) {
      // Catalog row has planKind only. Exam/target/open come from shell continuousMode
      // (resolveTimerPlanShellForCatalog above). Fallback: continuous → target cycle.
      const kind = draftKindFromCatalogPlanKind(row.planKind)
      setDraft(draftFromPlan({
        name: row.name,
        focusMinutes: row.focusMinutes,
        breakMinutes: row.breakMinutes,
        simulationStartTime: row.simulationStartTime,
        simulationEndTime: row.simulationEndTime,
        kind,
        continuousTarget: false,
        continuousMode: kind === 'continuous' ? 'target' : undefined,
        clockMode: 'countdown'
      }))
    }
  }

  /** Left-nav selects/previews a plan; apply only via footer 应用 (or explicit host apply). */
  const selectCatalogPlan = (planId: string): void => {
    setSelectedCatalogPlanId(planId)
    loadDraftForCatalogPlan(planId)
  }

  const handleRemoveSelectedPlan = (): void => {
    if (!selectedCatalogRow || !selectedCatalogRow.canDelete) return
    const removedId = selectedCatalogRow.id
    const remaining = catalogRows.filter((row) => row.id !== removedId)
    const nextRow =
      remaining.find((row) => row.isDefault)
      ?? remaining[0]
      ?? null
    onRemoveTimerPlan(removedId)
    // Do not mark a neighbor as applied unless the host default still points elsewhere.
    if (appliedCatalogPlanId === removedId) {
      setAppliedCatalogPlanId(
        defaultTimerPlanId && defaultTimerPlanId !== removedId
          ? defaultTimerPlanId
          : null
      )
    }
    if (nextRow) {
      setSelectedCatalogPlanId(nextRow.id)
      const plan = snapshot.timerPlans.find((p) => p.id === nextRow.id)
      if (plan) {
        setDraft(draftFromPlan(plan))
      } else {
        const kind = draftKindFromCatalogPlanKind(nextRow.planKind)
        setDraft(draftFromPlan({
          name: nextRow.name,
          focusMinutes: nextRow.focusMinutes,
          breakMinutes: nextRow.breakMinutes,
          simulationStartTime: nextRow.simulationStartTime,
          simulationEndTime: nextRow.simulationEndTime,
          kind
        }))
      }
    } else {
      setSelectedCatalogPlanId('')
      setDraft(createTimerPlanDraft(snapshot))
    }
  }

  const handleTimerAction = (): void => {
    if (isModePreview) {
      onStartTimerInMode(selectedMode)
      return
    }
    onToggleTimer()
  }

  const toggleSettings = (): void => {
    setSettingsOpen((current) => {
      const next = !current
      if (next) {
        // Open on the selected/default catalog plan (not a blank draft).
        const openId =
          selectedCatalogPlanId
          && selectedCatalogPlanId !== ''
            ? selectedCatalogPlanId
            : (catalogRows.find((row) => row.isDefault)?.id ?? catalogRows[0]?.id ?? null)
        if (openId) {
          setSelectedCatalogPlanId(openId)
          // Applied = host default / last footer-applied plan — not the open selection.
          setAppliedCatalogPlanId((currentApplied) => currentApplied ?? defaultTimerPlanId ?? null)
          loadDraftForCatalogPlan(openId)
        } else {
          setDraft(createTimerPlanDraft(snapshot))
        }
      }
      return next
    })
  }

  const closeSettings = (): void => {
    setSettingsOpen(false)
  }

  useEffect(() => {
    // Match add-task: host overlay on the study-room stage so tools transform
    // cannot clip or offset the dialog. Tests fall back to document.body.
    const stage = document.querySelector('.office-workbench-stage')
    setSettingsPortalHost(stage instanceof HTMLElement ? stage : document.body)
  }, [])

  useEffect(() => {
    if (!settingsOpen) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen])

  const isAddingPlanMode = selectedCatalogPlanId === ''
  // Any selected catalog plan (including system seeds) can be edited in place.
  const isEditingCustomPlan = Boolean(selectedCatalogRow && !isAddingPlanMode)
  // Applied = viewing the catalog plan currently driving the live timer preset.
  const isViewingAppliedPlan = Boolean(
    !isAddingPlanMode
    && selectedCatalogRow
    && appliedCatalogPlanId != null
    && selectedCatalogRow.id === appliedCatalogPlanId
  )
  const primaryActionLabel = isAddingPlanMode
    ? '添加'
    : isViewingAppliedPlan
      ? '已应用'
      : '应用'
  const primaryActionDisabled = isAddingPlanMode
    ? !hasValidDraft
    : isViewingAppliedPlan
      ? true
      : !hasValidDraft

  /**
   * Immediate effect on draft change:
   * - upsert same id when editing a custom catalog plan (full valid draft)
   * - otherwise applyOnly the active timer preset when timer fields are valid
   * - skip while composing a brand-new plan (wait for 添加)
   * Running session planSnapshot stays frozen (STC-503 / ADR-0094).
   */
  const commitLiveDraft = (next: TimerPlanDraft): void => {
    if (isAddingPlanMode) return
    if (isEditingCustomPlan && selectedCatalogRow && isDraftPayloadValid(next)) {
      onSaveTimerPlan({
        ...buildPlanPayload(next),
        id: selectedCatalogRow.id
      })
      return
    }
    // Builtin / preview: immediately apply active timer preset when timer fields change.
    if (!hasApplyableTimerFields(next)) return
    const row = selectedCatalogRow
    if (row) {
      const nextKind =
        next.kind === 'continuous'
          ? 'continuous'
          : next.kind === 'custom_rhythm'
            ? 'custom_rhythm'
            : 'pomodoro'
      const rowKind = draftKindFromCatalogPlanKind(row.planKind)
      // Compare draft clock/exam flags to the applied shell — not a hard-coded
      // "countdown implies same as catalog". Turning 正计时 off must still applyOnly
      // so the next start freezes countdown (or cycle continuous, not exam).
      const appliedShell = resolveTimerPlanShellForCatalog(row.id, snapshot.timerPlans)
      const draftClock = next.clockMode === 'countup' ? 'countup' : 'countdown'
      const shellClock = appliedShell?.clockMode === 'countup' ? 'countup' : 'countdown'
      const draftExam = next.continuousMode === 'exam' || next.continuousTarget === true
      const shellExam =
        appliedShell?.continuousMode === 'exam' || appliedShell?.continuousTarget === true
      const sameTimer =
        nextKind === rowKind
        && next.focusMinutes === row.focusMinutes
        && next.breakMinutes === row.breakMinutes
        && next.simulationStartTime === row.simulationStartTime
        && next.simulationEndTime === row.simulationEndTime
        && draftClock === shellClock
        && draftExam === shellExam
      if (sameTimer) return
    }
    onSaveTimerPlan({
      ...buildPlanPayload({
        ...next,
        name: next.name.trim() || selectedCatalogRow?.name || 'temp'
      }),
      applyOnly: true
    })
  }

  const updateDraft = <Key extends keyof TimerPlanDraft>(key: Key, value: TimerPlanDraft[Key]): void => {
    setDraft((current) => {
      const next = { ...current, [key]: value }
      void Promise.resolve().then(() => commitLiveDraft(next))
      return next
    })
  }

  const setDraftAndMaybeCommit = (updater: (current: TimerPlanDraft) => TimerPlanDraft): void => {
    setDraft((current) => {
      const next = updater(current)
      void Promise.resolve().then(() => commitLiveDraft(next))
      return next
    })
  }

  /** Persist draft to catalog without switching the live applied preset. */
  const handleSavePlan = (): void => {
    if (!hasValidDraft) return
    const payload = buildPlanPayload(draft)
    if (isAddingPlanMode) {
      const newId = onSaveTimerPlan(payload)
      if (typeof newId === 'string' && newId) {
        setSelectedCatalogPlanId(newId)
        setDraft(draftFromPlan({ ...payload, name: payload.name }))
      } else {
        setSelectedCatalogPlanId(null)
      }
      return
    }
    if (isEditingCustomPlan && selectedCatalogRow) {
      onSaveTimerPlan({ ...payload, id: selectedCatalogRow.id })
      return
    }
    // Builtin / new-name: save as a new custom catalog plan (do not apply live preset).
    const newId = onSaveTimerPlan(payload)
    if (typeof newId === 'string' && newId) {
      setSelectedCatalogPlanId(newId)
      setDraft(draftFromPlan({ ...payload, name: payload.name }))
    }
  }

  const handleApplyPlan = (): void => {
    if (!hasValidDraft || isViewingAppliedPlan) return
    const payload = buildPlanPayload(draft)
    if (isAddingPlanMode) {
      // 添加: create new catalog entry, apply live, and stay on that plan.
      const newId = onSaveTimerPlan(payload)
      if (typeof newId === 'string' && newId) {
        setSelectedCatalogPlanId(newId)
        setAppliedCatalogPlanId(newId)
        onApplyTimerPlan(newId)
        setDraft(draftFromPlan({ ...payload, name: payload.name }))
      } else {
        // Host may not return id (legacy void); leave add mode via null selection.
        setSelectedCatalogPlanId(null)
      }
      return
    }
    if (isEditingCustomPlan && selectedCatalogRow) {
      // Explicit 应用: re-upsert current custom plan id and mark as active preset.
      onSaveTimerPlan({ ...payload, id: selectedCatalogRow.id })
      onApplyTimerPlan(selectedCatalogRow.id)
      setAppliedCatalogPlanId(selectedCatalogRow.id)
      return
    }
    // Builtin / new-name path: save as new custom plan from current draft and apply.
    const newId = onSaveTimerPlan(payload)
    if (typeof newId === 'string' && newId) {
      setSelectedCatalogPlanId(newId)
      setAppliedCatalogPlanId(newId)
      onApplyTimerPlan(newId)
      setDraft(draftFromPlan({ ...payload, name: payload.name }))
    }
  }

  // STC-603: keyboard path when panel is open and focus is not in editable fields.
  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open || settingsOpen) return
    const mapped = mapPlanningTimerKeyboardAction({
      key: event.key,
      panelOpen: open,
      settingsOpen,
      targetIsEditable: isPlanningTimerKeyboardTargetEditable(event.target),
      canExtendBreak,
      selectedMode
    })
    if (mapped.action === 'none') return
    if (mapped.preventDefault) {
      event.preventDefault()
      event.stopPropagation()
    }
    switch (mapped.action) {
      case 'toggle_or_start':
        handleTimerAction()
        break
      case 'reset':
        onResetTimer()
        break
      case 'extend_break':
        if (canExtendBreak) onExtendActiveTimer?.(1)
        break
      case 'select_focus':
        setSelectedMode('focus')
        break
      case 'select_break':
        setSelectedMode('break')
        break
      default:
        break
    }
  }

  return (
    <section
      className={[
        'workbench-disclosure-card',
        'workbench-pomodoro-card',
        ...stateMarkers.cardClassTokens,
        open ? 'is-open' : '',
        isClosing ? 'is-closing' : '',
        settingsOpen ? 'has-settings-open' : ''
      ].filter(Boolean).join(' ')}
      data-timer-surface-phase={phaseChrome.surfacePhase}
      data-timer-state={stateMarkers.dataTimerState}
      data-reduced-motion={stateMarkers.reduceMotion ? 'true' : 'false'}
      aria-label="番茄钟"
    >
      {settingsOpen && settingsPortalHost
        ? createPortal(
          <WorkbenchPomodoroSettings
            settingsTitleId={settingsTitleId}
            catalogRows={catalogRows}
            selectedCatalogPlanId={selectedCatalogPlanId}
            selectedCatalogRow={selectedCatalogRow}
            draft={draft}
            draftKind={draftKind}
            draftKindUi={draftKindUi}
            continuousTotalMinutes={continuousTotalMinutes}
            hasValidDraft={hasValidDraft}
            isAddingPlanMode={isAddingPlanMode}
            isViewingAppliedPlan={isViewingAppliedPlan}
            primaryActionLabel={primaryActionLabel}
            primaryActionDisabled={primaryActionDisabled}
            renamingId={renamingId}
            renameDraft={renameDraft}
            emptyStartCategoryId={emptyStartCategoryId}
            emptyStartCategoryOptions={emptyStartCategoryOptions}
            onEmptyStartCategoryIdChange={onEmptyStartCategoryIdChange}
            onClose={closeSettings}
            onSelectCatalogPlan={selectCatalogPlan}
            onAddPlan={handleAddPlan}
            onStartRename={startRename}
            onCommitRename={commitRename}
            onRenameDraftChange={setRenameDraft}
            onCancelRename={() => setRenamingId(null)}
            onRemoveSelectedPlan={handleRemoveSelectedPlan}
            onSavePlan={handleSavePlan}
            onApplyPlan={handleApplyPlan}
            updateDraft={updateDraft}
            setDraftAndMaybeCommit={setDraftAndMaybeCommit}
          />,
          settingsPortalHost
        )
        : null}

      <button
        type="button"
        className="workbench-disclosure-toggle workbench-pomodoro-toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="workbench-pomodoro-panel"
      >
        <span className="workbench-disclosure-label workbench-pomodoro-toggle-label">
          <Timer size={15} />
          {timerLabel}
        </span>
        <span className="workbench-disclosure-meta workbench-pomodoro-toggle-meta">
          <strong>{remainingTime}</strong>
          <ChevronDown className="workbench-disclosure-chevron" size={15} aria-hidden="true" />
        </span>
      </button>

      <div
        ref={revealRef}
        className="workbench-disclosure-reveal workbench-pomodoro-reveal"
        style={{ height: `${revealHeight}px` }}
        aria-hidden={!open}
        inert={!open}
      >
        <div ref={revealInnerRef} className="workbench-disclosure-reveal-inner workbench-pomodoro-reveal-inner">
          <div
            id="workbench-pomodoro-panel"
            className="workbench-disclosure-panel workbench-pomodoro-panel"
            tabIndex={open ? 0 : -1}
            onKeyDown={handlePanelKeyDown}
            data-testid="workbench-pomodoro-panel"
          >
            <p
              className="workbench-pomodoro-status-live"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="workbench-pomodoro-status-live"
            >
              {a11yStatus.statusLabel}
            </p>
            <div
              className="workbench-pomodoro-title"
              data-testid="workbench-pomodoro-title"
              title={
                phaseChrome.surfacePhase === 'wrap_up'
                  ? (phaseChrome.faceBadge ?? timerLabel)
                  : selectedMode === 'focus'
                    ? (focusTask ? focusTask.title : '未选择任务（时间不计入任务占比）')
                    : timerLabel
              }
            >
              {phaseChrome.surfacePhase === 'wrap_up'
                ? (phaseChrome.faceBadge ?? timerLabel)
                : selectedMode === 'focus'
                  ? (focusTask ? focusTask.title : '未选择任务')
                  : timerLabel}
            </div>

            <div
              className="workbench-timer-face"
              data-active-mode={
                phaseChrome.surfacePhase === 'wrap_up'
                  ? phaseChrome.selectedModeVisual
                  : selectedMode
              }
            >
              <button
                type="button"
                className="workbench-pomodoro-mode-arrow workbench-pomodoro-mode-arrow--prev"
                aria-label={selectedMode === 'focus' ? '切换到休息' : '切换到专注'}
                title={selectedMode === 'focus' ? '休息' : '专注'}
                disabled={!phaseChrome.modeTabsInteractive}
                data-testid="workbench-pomodoro-mode-prev"
                onClick={() => {
                  if (!phaseChrome.modeTabsInteractive) return
                  setSelectedMode((current) => (current === 'focus' ? 'break' : 'focus'))
                }}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>

              <div className="workbench-timer-ring" style={timerRingStyle} aria-hidden="true">
                <svg className="workbench-timer-ring__dial" viewBox="0 0 120 120" focusable="false">
                  <circle className="workbench-timer-ring__track" cx="60" cy="60" r="56" pathLength="100" />
                  <circle
                    className="workbench-timer-ring__progress"
                    cx="60"
                    cy="60"
                    r="56"
                    pathLength="100"
                    transform="rotate(-90 60 60)"
                  />
                </svg>
                <div className="workbench-pomodoro-time">
                  {examFaceParts ? (
                    <>
                      <strong className="workbench-pomodoro-time__primary">{examFaceParts.primary}</strong>
                      <span className="workbench-pomodoro-time__seconds" aria-hidden="true">{examFaceParts.seconds}</span>
                      <span className="visually-hidden">{remainingTime}</span>
                    </>
                  ) : (
                    <strong>{remainingTime}</strong>
                  )}
                  {stateMarkers.overtimeLabelZh ? (
                    <span
                      className="workbench-pomodoro-state-chip"
                      data-testid="workbench-pomodoro-state-chip"
                      data-timer-state={stateMarkers.dataTimerState}
                      data-surface-phase={stateMarkers.surfacePhase}
                    >
                      {stateMarkers.overtimeLabelZh}
                    </span>
                  ) : null}
                  {phaseChrome.surfacePhase === 'wrap_up' && phaseChrome.faceBadge ? (
                    <span
                      className="workbench-pomodoro-time__task workbench-pomodoro-time__task--wrap-up"
                      title={phaseChrome.faceBadge}
                      data-testid="workbench-pomodoro-wrap-up-badge"
                    >
                      {phaseChrome.faceBadge}
                    </span>
                  ) : null}
                  {faceClock.faceMeta ? (
                    <span className="workbench-pomodoro-time__settings">
                      {faceClock.faceMeta}
                    </span>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                className="workbench-pomodoro-mode-arrow workbench-pomodoro-mode-arrow--next"
                aria-label={selectedMode === 'focus' ? '切换到休息' : '切换到专注'}
                title={selectedMode === 'focus' ? '休息' : '专注'}
                disabled={!phaseChrome.modeTabsInteractive}
                data-testid="workbench-pomodoro-mode-next"
                onClick={() => {
                  if (!phaseChrome.modeTabsInteractive) return
                  setSelectedMode((current) => (current === 'focus' ? 'break' : 'focus'))
                }}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="workbench-pomodoro-progress" aria-hidden="true">
              <span style={{ width: `${timerProgress}%` }} />
            </div>

            <div className="workbench-pomodoro-actions">
              <button
                className={`workbench-pomodoro-settings${settingsOpen ? ' is-active' : ''}`}
                type="button"
                onClick={toggleSettings}
                aria-expanded={settingsOpen}
                aria-controls="workbench-pomodoro-settings"
                aria-label="计时设置"
                title="设置"
              >
                <Settings2 size={16} aria-hidden="true" />
              </button>
              <button
                className="workbench-pomodoro-start"
                type="button"
                onClick={handleTimerAction}
                aria-label={timerActionLabel}
                title={timerActionLabel}
              >
                {timerIsRunning
                  ? <Pause size={16} aria-hidden="true" />
                  : <Play size={16} aria-hidden="true" />}
              </button>
              {canExtendBreak ? (
                <button
                  className="workbench-pomodoro-extend"
                  type="button"
                  onClick={() => onExtendActiveTimer?.(1)}
                  aria-label="延长休息 1 分钟"
                  title="延长休息 +1 分钟"
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              ) : null}
              <button
                className="workbench-pomodoro-reset"
                type="button"
                onClick={onResetTimer}
                aria-label="重置番茄钟"
                title="重置"
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
