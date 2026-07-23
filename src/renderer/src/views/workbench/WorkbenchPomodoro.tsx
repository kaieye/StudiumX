import { Check, ChevronDown, Pause, Play, Plus, RotateCcw, Settings2, Timer, Trash2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { formatStudyDuration } from '../../study-space/domain'
import type { StudySnapshot, StudyTimerMode, StudyTimerPlanInput } from '../../study-space/types'
import {
  defaultTimerPlanAdvancedFields,
  isValidTimerPlanAdvancedDraft,
  type PomodoroBreakPolicy
} from '../../study-space/planning-timer-plan-advanced-fields'
import {
  TIMER_PLAN_KIND_OPTIONS,
  defaultContinuousBreakPolicy,
  isValidContinuousPlanDraft,
  type ContinuousBreakPolicy,
  type StudyTimerPlanKind
} from '../../study-space/planning-timer-plan-kind'
import {
  simulationWindowFromTotalMinutes,
  totalMinutesFromSimulationWindow
} from '../../study-space/planning-simulation-window-ui'
import { useWorkbenchDisclosureReveal } from './useWorkbenchDisclosureReveal'
import { StudyPlanningPrefsSection } from './StudyPlanningPrefsSection'
import {
  SegmentedControl,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  ToggleSwitch
} from '../settings/SettingsPrimitives'
import type { TimerSessionRecord } from '../../../../shared/study-planning'
import {
  listTimerPlanCatalogRows,
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

type WorkbenchPomodoroProps = {
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

type TimerPlanDraft = StudyTimerPlanInput

function createTimerPlanDraft(snapshot: StudySnapshot): TimerPlanDraft {
  const advanced = defaultTimerPlanAdvancedFields()
  // Blank draft for 添加方案: always pomodoro shell. Do not inherit kind from
  // timerPlans[0] — that previously jumped the editor to continuous after save.
  return {
    name: '',
    focusMinutes: snapshot.focusMinutes,
    breakMinutes: snapshot.breakMinutes,
    simulationStartTime: snapshot.simulationStartTime,
    simulationEndTime: snapshot.simulationEndTime,
    longBreakMinutes: advanced.longBreakMinutes,
    longBreakEvery: advanced.longBreakEvery,
    kind: 'pomodoro',
    clockMode: 'countdown',
    continuousTarget: undefined,
    rhythmSequence: undefined,
    breakPolicy: advanced.breakPolicy
  }
}

function draftFromPlan(plan: {
  name: string
  focusMinutes: number
  breakMinutes: number
  simulationStartTime: string
  simulationEndTime: string
  longBreakMinutes?: number
  longBreakEvery?: number
  kind?: StudyTimerPlanKind | string
  clockMode?: 'countdown' | 'countup' | string
  continuousTarget?: boolean
  breakPolicy?: PomodoroBreakPolicy | ContinuousBreakPolicy | string
}): TimerPlanDraft {
  const advanced = defaultTimerPlanAdvancedFields()
  const kind: StudyTimerPlanKind = plan.kind === 'continuous' ? 'continuous' : 'pomodoro'
  return {
    name: plan.name,
    focusMinutes: plan.focusMinutes,
    breakMinutes: plan.breakMinutes,
    simulationStartTime: plan.simulationStartTime,
    simulationEndTime: plan.simulationEndTime,
    longBreakMinutes: plan.longBreakMinutes ?? advanced.longBreakMinutes,
    longBreakEvery: plan.longBreakEvery ?? advanced.longBreakEvery,
    kind,
    clockMode: kind === 'continuous'
      ? (plan.clockMode === 'countup' ? 'countup' : 'countdown')
      : 'countdown',
    continuousTarget: plan.continuousTarget === true,
    rhythmSequence: undefined,
    breakPolicy: (plan.breakPolicy ?? (
      kind === 'continuous' ? defaultContinuousBreakPolicy() : advanced.breakPolicy
    )) as PomodoroBreakPolicy | ContinuousBreakPolicy
  }
}

function buildPlanPayload(draft: TimerPlanDraft): StudyTimerPlanInput {
  const kind: StudyTimerPlanKind = draft.kind === 'continuous' ? 'continuous' : 'pomodoro'
  const isExam = kind === 'continuous' && draft.continuousTarget === true
  const totalMinutes =
    totalMinutesFromSimulationWindow(draft.simulationStartTime, draft.simulationEndTime)
    ?? (Number.isInteger(draft.focusMinutes) ? draft.focusMinutes : 90)
  return {
    ...draft,
    name: draft.name.trim(),
    kind,
    clockMode: kind === 'continuous'
      ? (draft.clockMode === 'countup' ? 'countup' : 'countdown')
      : 'countdown',
    continuousTarget: kind === 'continuous' ? isExam : undefined,
    focusMinutes: isExam ? totalMinutes : draft.focusMinutes,
    breakMinutes: kind === 'continuous'
      ? (isExam ? 0 : (draft.breakMinutes || 0))
      : draft.breakMinutes,
    rhythmSequence: undefined
  }
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

  const isModePreview = selectedMode !== snapshot.timerMode
  const displayedRemainingSeconds = isModePreview
    ? (selectedMode === 'focus' ? snapshot.focusMinutes : snapshot.breakMinutes) * 60
    : snapshot.remainingSeconds
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
  const focusTaskLabel = phaseChrome.showFocusTaskLabel
    ? (focusTask ? focusTask.title : '未选择任务（时间不计入任务占比）')
    : phaseChrome.faceBadge
  const remainingTime = formatStudyDuration(displayedRemainingSeconds)
  const timerIsRunning = snapshot.timerState === 'running' && !isModePreview
  const timerActionLabel = timerIsRunning
    ? '暂停'
    : isModePreview ? `开始${selectedMode === 'focus' ? '专注' : '休息'}`
      : snapshot.timerState === 'paused' ? '继续' : '开始'
  const draftKind: StudyTimerPlanKind = draft.kind === 'continuous' ? 'continuous' : 'pomodoro'
  // Primary CTA: 添加 only while composing a blank draft; 已应用 when viewing the active plan; 应用 otherwise.
  // Note: isAddingPlanMode / selectedCatalogRow are defined with catalog selection helpers below.
  const continuousTotalMinutes =
    totalMinutesFromSimulationWindow(draft.simulationStartTime, draft.simulationEndTime)
    ?? (
      Number.isInteger(draft.focusMinutes) && draft.focusMinutes >= 5
        ? draft.focusMinutes
        : null
    )
  const hasValidDraft = draftKind === 'continuous'
    ? isValidContinuousPlanDraft({
      name: draft.name,
      focusMinutes: draft.focusMinutes,
      breakMinutes: draft.breakMinutes,
      continuousTarget: draft.continuousTarget === true,
      breakPolicy: draft.breakPolicy,
      totalMinutes: continuousTotalMinutes,
      simulationStartTime: draft.simulationStartTime,
      simulationEndTime: draft.simulationEndTime
    })
    : Boolean(draft.name.trim())
      && Number.isInteger(draft.focusMinutes)
      && Number.isInteger(draft.breakMinutes)
      && draft.focusMinutes >= 5
      && draft.focusMinutes <= 120
      && draft.breakMinutes >= 0
      && draft.breakMinutes <= 45
      && isValidTimerPlanAdvancedDraft({
        longBreakMinutes: draft.longBreakMinutes,
        longBreakEvery: draft.longBreakEvery,
        breakPolicy: draft.breakPolicy
      })

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
    const ok = onRenameTimerPlan(renamingId, renameDraft)
    if (ok) setRenamingId(null)
  }

  const selectCatalogPlan = (planId: string): void => {
    setSelectedCatalogPlanId(planId)
    setAppliedCatalogPlanId(planId)
    // Always apply the preset shell so left-nav clicks are never no-ops.
    onApplyTimerPlan(planId)
    const row = catalogRows.find((r) => r.id === planId)
    const plan = snapshot.timerPlans.find((p) => p.id === planId)
    // Fill draft from applied plan shell (user or builtin summary).
    // Builtin rows keep an empty name so 应用 saves a custom copy only after the user names it.
    if (plan) {
      setDraft(draftFromPlan(plan))
    } else if (row) {
      setDraft(draftFromPlan({
        name: row.readonly ? '' : row.name,
        focusMinutes: row.focusMinutes,
        breakMinutes: row.breakMinutes,
        simulationStartTime: row.simulationStartTime,
        simulationEndTime: row.simulationEndTime,
        kind: row.planKind === 'continuous' ? 'continuous' : 'pomodoro'
      }))
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
          setAppliedCatalogPlanId((current) => current ?? openId)
          const plan = snapshot.timerPlans.find((p) => p.id === openId)
          const row = catalogRows.find((r) => r.id === openId)
          if (plan) {
            setDraft(draftFromPlan(plan))
          } else if (row) {
            setDraft(draftFromPlan({
              name: row.readonly ? '' : row.name,
              focusMinutes: row.focusMinutes,
              breakMinutes: row.breakMinutes,
              simulationStartTime: row.simulationStartTime,
              simulationEndTime: row.simulationEndTime,
              kind: row.planKind === 'continuous' ? 'continuous' : 'pomodoro'
            }))
          } else {
            setDraft(createTimerPlanDraft(snapshot))
          }
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

  const isEditingCustomPlan = Boolean(
    selectedCatalogRow && !selectedCatalogRow.readonly && selectedCatalogRow.canDelete
  )
  const isAddingPlanMode = selectedCatalogPlanId === ''
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

  const isDraftPayloadValid = (next: TimerPlanDraft): boolean => {
    const kind: StudyTimerPlanKind = next.kind === 'continuous' ? 'continuous' : 'pomodoro'
    const total =
      totalMinutesFromSimulationWindow(next.simulationStartTime, next.simulationEndTime)
      ?? (
        Number.isInteger(next.focusMinutes) && next.focusMinutes >= 5
          ? next.focusMinutes
          : null
      )
    if (kind === 'continuous') {
      return isValidContinuousPlanDraft({
        name: next.name,
        focusMinutes: next.focusMinutes,
        breakMinutes: next.breakMinutes,
        continuousTarget: next.continuousTarget === true,
        breakPolicy: next.breakPolicy,
        totalMinutes: total,
        simulationStartTime: next.simulationStartTime,
        simulationEndTime: next.simulationEndTime
      })
    }
    return Boolean(next.name.trim())
      && Number.isInteger(next.focusMinutes)
      && Number.isInteger(next.breakMinutes)
      && next.focusMinutes >= 5
      && next.focusMinutes <= 120
      && next.breakMinutes >= 0
      && next.breakMinutes <= 45
      && isValidTimerPlanAdvancedDraft({
        longBreakMinutes: next.longBreakMinutes,
        longBreakEvery: next.longBreakEvery,
        breakPolicy: next.breakPolicy
      })
  }

  /** Timer fields only — immediate active-preset apply without requiring catalog name. */
  const hasApplyableTimerFields = (next: TimerPlanDraft): boolean => {
    const kind: StudyTimerPlanKind = next.kind === 'continuous' ? 'continuous' : 'pomodoro'
    if (kind === 'continuous') {
      const total = totalMinutesFromSimulationWindow(next.simulationStartTime, next.simulationEndTime)
      if (next.continuousTarget === true) {
        return total != null && total >= 5
      }
      return Number.isInteger(next.focusMinutes)
        && next.focusMinutes >= 5
        && next.focusMinutes <= 240
        && Number.isInteger(next.breakMinutes)
        && next.breakMinutes >= 0
        && next.breakMinutes <= 45
        && total != null
        && total >= 5
    }
    return Number.isInteger(next.focusMinutes)
      && Number.isInteger(next.breakMinutes)
      && next.focusMinutes >= 5
      && next.focusMinutes <= 120
      && next.breakMinutes >= 0
      && next.breakMinutes <= 45
  }

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
      const nextKind = next.kind === 'continuous' ? 'continuous' : 'pomodoro'
      const rowKind = row.planKind === 'continuous' ? 'continuous' : 'pomodoro'
      const sameTimer =
        nextKind === rowKind
        && next.focusMinutes === row.focusMinutes
        && next.breakMinutes === row.breakMinutes
        && next.simulationStartTime === row.simulationStartTime
        && next.simulationEndTime === row.simulationEndTime
        && (next.continuousTarget === true) === false
        && next.clockMode !== 'countup'
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

  const handleApplyPlan = (): void => {
    if (!hasValidDraft || isViewingAppliedPlan) return
    const payload = buildPlanPayload(draft)
    if (isAddingPlanMode) {
      // 添加: create new catalog entry and stay on that plan (do not reset draft shell).
      const newId = onSaveTimerPlan(payload)
      if (typeof newId === 'string' && newId) {
        setSelectedCatalogPlanId(newId)
        setAppliedCatalogPlanId(newId)
        setDraft(draftFromPlan({ ...payload, name: payload.name }))
      } else {
        // Host may not return id (legacy void); leave add mode via null selection.
        setSelectedCatalogPlanId(null)
      }
      return
    }
    if (isEditingCustomPlan && selectedCatalogRow) {
      // Explicit 应用: re-upsert current custom plan id (also covered by live commits).
      onSaveTimerPlan({ ...payload, id: selectedCatalogRow.id })
      setAppliedCatalogPlanId(selectedCatalogRow.id)
      return
    }
    // Builtin / new-name path: save as new custom plan from current draft.
    const newId = onSaveTimerPlan(payload)
    if (typeof newId === 'string' && newId) {
      setSelectedCatalogPlanId(newId)
      setAppliedCatalogPlanId(newId)
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
          <div className="office-workbench-timer-settings-overlay">
            <div
              className="study-schedule-editor-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeSettings()
              }}
            >
              <div
                id="workbench-pomodoro-settings"
                className="workbench-pomodoro-settings-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby={settingsTitleId}
              >
                <button
                  type="button"
                  className="workbench-pomodoro-settings-close"
                  onClick={closeSettings}
                  aria-label="关闭计时设置"
                  title="关闭设置"
                >
                  <X size={17} aria-hidden="true" />
                </button>

                <aside className="workbench-pomodoro-settings-nav" aria-label="专注计时方案">
                  <div className="workbench-pomodoro-settings-nav-heading" id={settingsTitleId}>专注计时</div>
                  <div className="workbench-pomodoro-settings-nav-list" role="list" aria-label="方案列表">
                    {catalogRows.map((row) => {
                      const selected =
                        selectedCatalogPlanId === row.id
                        || (selectedCatalogPlanId == null && row.isDefault)
                      return (
                        <div
                          key={row.id}
                          role="listitem"
                          className={`workbench-pomodoro-settings-nav-plan${selected ? ' is-active' : ''}${row.readonly ? ' is-builtin' : ''}${row.isDefault ? ' is-default' : ''}`}
                        >
                          {renamingId === row.id ? (
                            <div className="workbench-pomodoro-rename-row">
                              <input
                                type="text"
                                aria-label={`重命名方案：${row.name}`}
                                value={renameDraft}
                                maxLength={24}
                                autoFocus
                                onChange={(e) => setRenameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitRename()
                                  if (e.key === 'Escape') setRenamingId(null)
                                }}
                              />
                              <button type="button" className="workbench-pomodoro-plan-action" onClick={commitRename} aria-label="确认重命名">
                                <Check size={14} aria-hidden="true" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={`workbench-pomodoro-settings-nav-item${selected ? ' is-active' : ''}`}
                              aria-current={selected ? 'true' : undefined}
                              onClick={() => selectCatalogPlan(row.id)}
                              onDoubleClick={() => startRename(row)}
                              title={row.readonly ? '系统方案（只读，点击应用）' : '点击应用；双击重命名'}
                            >
                              <span>
                                <strong>{row.name}</strong>
                              </span>
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="workbench-pomodoro-settings-nav-add">
                    <button
                      type="button"
                      className="workbench-pomodoro-settings-nav-add-btn"
                      onClick={handleAddPlan}
                      aria-label="添加方案"
                      title="添加方案"
                    >
                      <Plus size={15} aria-hidden="true" />
                      添加方案
                    </button>
                  </div>
                </aside>

                <div className="workbench-pomodoro-settings-content">
                      <header className="workbench-pomodoro-settings-panel-heading">
                        <h2>专注方案</h2>
                        <p>自定义计时节奏；左侧点选即可套用。进行中的会话方案快照不会被覆盖。</p>
                      </header>

                      <div className="workbench-pomodoro-settings-scroll">
                      <SettingsCard className="workbench-pomodoro-settings-card">
                        <SettingsRow label="方案名称" detail="用于方案列表显示">
                          <input
                            className="settings-input"
                            type="text"
                            aria-label="方案名称"
                            value={draft.name}
                            maxLength={24}
                            placeholder="例如：晨间冲刺"
                            onChange={(event) => updateDraft('name', event.target.value)}
                          />
                        </SettingsRow>
                        <SettingsRow label="方案类型">
                          <SettingsSelect
                            value={draftKind}
                            position="item-aligned"
                            options={[...TIMER_PLAN_KIND_OPTIONS]}
                            onChange={(next) => {
                              setDraftAndMaybeCommit((current) => {
                                const nextFocus =
                                  next === 'continuous'
                                    ? (Number.isInteger(current.focusMinutes) && current.focusMinutes >= 5
                                      ? current.focusMinutes
                                      : 25)
                                    : current.focusMinutes
                                const nextBreak =
                                  next === 'continuous'
                                    ? (Number.isInteger(current.breakMinutes) && current.breakMinutes >= 0
                                      ? current.breakMinutes
                                      : 5)
                                    : (current.breakMinutes || 5)
                                // Seed a same-day total window from segment minutes when switching in.
                                const totalWindow =
                                  next === 'continuous'
                                    ? (simulationWindowFromTotalMinutes(
                                      Math.min(240, Math.max(5, nextFocus * 2 + nextBreak))
                                    ) ?? {
                                      start: current.simulationStartTime || '00:00',
                                      end: current.simulationEndTime || '01:00'
                                    })
                                    : null
                                return {
                                  ...current,
                                  kind: next,
                                  // Continuous defaults to countdown; countup is an opt-in toggle.
                                  clockMode: next === 'continuous' ? 'countdown' : 'countdown',
                                  continuousTarget: next === 'continuous' ? false : undefined,
                                  breakPolicy: next === 'continuous'
                                    ? defaultContinuousBreakPolicy()
                                    : (current.breakPolicy === 'automatic' || current.breakPolicy === 'ask'
                                      ? current.breakPolicy
                                      : 'ask'),
                                  focusMinutes: nextFocus,
                                  breakMinutes: nextBreak,
                                  ...(totalWindow
                                    ? {
                                      simulationStartTime: totalWindow.start,
                                      simulationEndTime: totalWindow.end
                                    }
                                    : {}),
                                  rhythmSequence: undefined
                                }
                              })
                            }}
                          />
                        </SettingsRow>
                        {draftKind === 'continuous' ? (
                          <SettingsRow label="专注模式" detail="考场模拟选择时间段；连续循环可配置专注与休息">
                            <SegmentedControl
                              value={draft.continuousTarget === true ? 'exam' : 'cycle'}
                              options={[
                                { value: 'exam', label: '考场模拟' },
                                { value: 'cycle', label: '连续循环' }
                              ]}
                              onChange={(mode) => {
                                setDraftAndMaybeCommit((current) => {
                                  const existingTotal =
                                    totalMinutesFromSimulationWindow(
                                      current.simulationStartTime,
                                      current.simulationEndTime
                                    )
                                  if (mode === 'exam') {
                                    // Prefer keeping a real daytime window; fall back to 09:00–11:30.
                                    const keepWindow =
                                      current.simulationStartTime
                                      && current.simulationEndTime
                                      && current.simulationStartTime < current.simulationEndTime
                                      && current.simulationStartTime !== '00:00'
                                    const examStart = keepWindow ? current.simulationStartTime : '09:00'
                                    const examEnd = keepWindow
                                      ? current.simulationEndTime
                                      : (existingTotal
                                        ? (simulationWindowFromTotalMinutes(existingTotal, '09:00')?.end ?? '11:30')
                                        : '11:30')
                                    const examTotal =
                                      totalMinutesFromSimulationWindow(examStart, examEnd) ?? 150
                                    return {
                                      ...current,
                                      continuousTarget: true,
                                      clockMode: 'countdown',
                                      focusMinutes: examTotal,
                                      breakMinutes: 0,
                                      simulationStartTime: examStart,
                                      simulationEndTime: examEnd,
                                      breakPolicy: 'none'
                                    }
                                  }
                                  const nextTotal =
                                    existingTotal
                                    ?? Math.min(240, Math.max(5, (current.focusMinutes || 25) * 2 + (current.breakMinutes || 5)))
                                  const totalWindow = simulationWindowFromTotalMinutes(nextTotal) ?? {
                                    start: '00:00',
                                    end: '01:30'
                                  }
                                  return {
                                    ...current,
                                    continuousTarget: false,
                                    clockMode: current.clockMode === 'countup' ? 'countup' : 'countdown',
                                    focusMinutes:
                                      Number.isInteger(current.focusMinutes) && current.focusMinutes >= 5
                                        ? current.focusMinutes
                                        : 25,
                                    breakMinutes:
                                      Number.isInteger(current.breakMinutes) && current.breakMinutes >= 0
                                        ? current.breakMinutes
                                        : 5,
                                    simulationStartTime: totalWindow.start,
                                    simulationEndTime: totalWindow.end,
                                    breakPolicy:
                                      current.breakPolicy === 'automatic'
                                      || current.breakPolicy === 'ask'
                                      || current.breakPolicy === 'reminder_only'
                                      || current.breakPolicy === 'none'
                                        ? current.breakPolicy
                                        : defaultContinuousBreakPolicy()
                                  }
                                })
                              }}
                            />
                          </SettingsRow>
                        ) : null}
                        {draftKind === 'continuous' && draft.continuousTarget === true ? (
                          <>
                            <SettingsRow label="考试时段" detail="开始与结束时间">
                              <div className="workbench-pomodoro-time-range workbench-pomodoro-time-range--settings">
                                <input
                                  className="settings-input"
                                  type="time"
                                  aria-label="考试开始时间"
                                  value={draft.simulationStartTime}
                                  onChange={(event) => {
                                    const start = event.target.value
                                    setDraftAndMaybeCommit((current) => {
                                      const end = current.simulationEndTime
                                      const total = totalMinutesFromSimulationWindow(start, end)
                                      return {
                                        ...current,
                                        simulationStartTime: start,
                                        focusMinutes: total ?? current.focusMinutes
                                      }
                                    })
                                  }}
                                />
                                <i>—</i>
                                <input
                                  className="settings-input"
                                  type="time"
                                  aria-label="考试结束时间"
                                  value={draft.simulationEndTime}
                                  onChange={(event) => {
                                    const end = event.target.value
                                    setDraftAndMaybeCommit((current) => {
                                      const start = current.simulationStartTime
                                      const total = totalMinutesFromSimulationWindow(start, end)
                                      return {
                                        ...current,
                                        simulationEndTime: end,
                                        focusMinutes: total ?? current.focusMinutes
                                      }
                                    })
                                  }}
                                />
                              </div>
                            </SettingsRow>
                          </>
                        ) : draftKind === 'continuous' ? (
                          <>
                            <SettingsRow label="专注时间" detail="单位：分钟">
                              <div className="workbench-pomodoro-settings-control-inline">
                                <input
                                  className="settings-number"
                                  type="number"
                                  aria-label="专注时间"
                                  value={draft.focusMinutes}
                                  min={5}
                                  max={240}
                                  step={1}
                                  onChange={(event) => updateDraft('focusMinutes', Number(event.target.value))}
                                />
                                <span className="workbench-pomodoro-settings-unit">分钟</span>
                              </div>
                            </SettingsRow>
                            <SettingsRow label="休息时间" detail="单位：分钟">
                              <div className="workbench-pomodoro-settings-control-inline">
                                <input
                                  className="settings-number"
                                  type="number"
                                  aria-label="休息时间"
                                  value={draft.breakMinutes}
                                  min={0}
                                  max={45}
                                  step={1}
                                  onChange={(event) => updateDraft('breakMinutes', Number(event.target.value))}
                                />
                                <span className="workbench-pomodoro-settings-unit">分钟</span>
                              </div>
                            </SettingsRow>
                            <SettingsRow label="总时长" detail="单位：分钟">
                              <div className="workbench-pomodoro-settings-control-inline">
                                <input
                                  className="settings-number"
                                  type="number"
                                  aria-label="总时长"
                                  value={continuousTotalMinutes ?? ''}
                                  min={5}
                                  max={240}
                                  step={1}
                                  onChange={(event) => {
                                    const raw = event.target.value
                                    if (raw.trim() === '') {
                                      setDraftAndMaybeCommit((current) => ({
                                        ...current,
                                        simulationStartTime: '00:00',
                                        simulationEndTime: '00:00'
                                      }))
                                      return
                                    }
                                    const mins = Number(raw)
                                    if (!Number.isInteger(mins)) return
                                    const window = simulationWindowFromTotalMinutes(mins)
                                    if (!window) return
                                    setDraftAndMaybeCommit((current) => ({
                                      ...current,
                                      simulationStartTime: window.start,
                                      simulationEndTime: window.end
                                    }))
                                  }}
                                />
                                <span className="workbench-pomodoro-settings-unit">分钟</span>
                              </div>
                            </SettingsRow>
                            <SettingsRow
                              label="正计时"
                              detail="默认关闭（倒计时）；开启后按正计时显示"
                            >
                              <ToggleSwitch
                                checked={draft.clockMode === 'countup'}
                                ariaLabel="正计时"
                                onChange={(checked) =>
                                  updateDraft('clockMode', checked ? 'countup' : 'countdown')
                                }
                              />
                            </SettingsRow>
                          </>
                        ) : (
                          <>
                            <SettingsRow label="专注时间" detail="单位：分钟">
                              <div className="workbench-pomodoro-settings-control-inline">
                                <input
                                  className="settings-number"
                                  type="number"
                                  aria-label="专注时间"
                                  value={draft.focusMinutes}
                                  min={5}
                                  max={120}
                                  step={1}
                                  onChange={(event) => updateDraft('focusMinutes', Number(event.target.value))}
                                />
                                <span className="workbench-pomodoro-settings-unit">分钟</span>
                              </div>
                            </SettingsRow>
                            <SettingsRow label="休息时间" detail="单位：分钟">
                              <div className="workbench-pomodoro-settings-control-inline">
                                <input
                                  className="settings-number"
                                  type="number"
                                  aria-label="休息时间"
                                  value={draft.breakMinutes}
                                  min={0}
                                  max={45}
                                  step={1}
                                  onChange={(event) => updateDraft('breakMinutes', Number(event.target.value))}
                                />
                                <span className="workbench-pomodoro-settings-unit">分钟</span>
                              </div>
                            </SettingsRow>
                            <SettingsRow
                              label="自动开启下一循环"
                              detail="开启后到点自动进入下一段"
                            >

                              <ToggleSwitch
                                checked={draft.breakPolicy === 'automatic'}
                                ariaLabel="自动开启下一循环"
                                onChange={(checked) =>
                                  updateDraft('breakPolicy', (checked ? 'automatic' : 'ask') as PomodoroBreakPolicy)
                                }
                              />
                            </SettingsRow>
                          </>
                        )}
                        {onEmptyStartCategoryIdChange ? (
                          <StudyPlanningPrefsSection
                            emptyStartCategoryId={emptyStartCategoryId}
                            categoryOptions={emptyStartCategoryOptions}
                            onEmptyStartCategoryIdChange={onEmptyStartCategoryIdChange}
                            compact
                          />
                        ) : null}
                      </SettingsCard>
                      </div>

                      <div className="workbench-pomodoro-settings-footer" role="toolbar" aria-label="方案操作">
                        <div className="workbench-pomodoro-settings-footer-actions">
                          {selectedCatalogRow && selectedCatalogRow.canDelete ? (
                            <button
                              type="button"
                              className="ghost-button danger"
                              onClick={() => onRemoveTimerPlan(selectedCatalogRow.id)}
                              aria-label={`删除方案：${selectedCatalogRow.name}`}
                              title="删除方案"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                              删除方案
                            </button>
                          ) : null}
                        </div>
                        <button
                          className={`ghost-button workbench-pomodoro-apply-plan${isViewingAppliedPlan ? ' is-applied' : ' strong'}`}
                          type="button"
                          onClick={handleApplyPlan}
                          disabled={primaryActionDisabled}
                          aria-label={primaryActionLabel}
                          title={primaryActionLabel}
                        >
                          {isViewingAppliedPlan ? <Check size={15} aria-hidden="true" /> : null}
                          {primaryActionLabel}
                        </button>
                      </div>
                </div>
              </div>
            </div>
          </div>,
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
              className="workbench-pomodoro-mode"
              role="tablist"
              aria-label="计时模式"
              data-active-mode={selectedMode}
            >
              {(['focus', 'break'] as const).map((mode) => {
                const selected =
                  phaseChrome.surfacePhase === 'wrap_up'
                    ? phaseChrome.selectedModeVisual === mode
                    : selectedMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={selected ? 'is-active' : ''}
                    disabled={!phaseChrome.modeTabsInteractive}
                    onClick={() => {
                      if (!phaseChrome.modeTabsInteractive) return
                      if (selectedMode !== mode) setSelectedMode(mode)
                    }}
                  >
                    {mode === 'focus' ? '专注' : '休息'}
                  </button>
                )
              })}
            </div>

            <div className="workbench-timer-face">
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
                  <strong>{remainingTime}</strong>
                  <span
                    className="workbench-pomodoro-state-chip"
                    data-testid="workbench-pomodoro-state-chip"
                    data-timer-state={stateMarkers.dataTimerState}
                    data-surface-phase={stateMarkers.surfacePhase}
                  >
                    {stateMarkers.stateChipText}
                    {stateMarkers.overtimeLabelZh
                      ? ` · ${stateMarkers.overtimeLabelZh}`
                      : ''}
                  </span>
                  {focusTaskLabel ? (
                    <span
                      className={
                        phaseChrome.surfacePhase === 'wrap_up'
                          ? 'workbench-pomodoro-time__task workbench-pomodoro-time__task--wrap-up'
                          : 'workbench-pomodoro-time__task'
                      }
                      title={focusTaskLabel}
                      data-testid={
                        phaseChrome.surfacePhase === 'wrap_up'
                          ? 'workbench-pomodoro-wrap-up-badge'
                          : undefined
                      }
                    >
                      {phaseChrome.surfacePhase === 'wrap_up'
                        ? focusTaskLabel
                        : focusTask
                          ? `FOCUS · ${focusTaskLabel}`
                          : focusTaskLabel}
                    </span>
                  ) : null}
                  <span className="workbench-pomodoro-time__settings">
                    {snapshot.focusMinutes} / {snapshot.breakMinutes} 分钟 · {snapshot.simulationStartTime}–{snapshot.simulationEndTime}
                  </span>
                </div>
              </div>
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
