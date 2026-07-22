import { ChevronDown, Pause, Play, Plus, RotateCcw, Save, Settings2, Timer, X } from 'lucide-react'
import { useEffect, useId, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { formatStudyDuration } from '../../study-space/domain'
import type { StudySnapshot, StudyTimerMode, StudyTimerPlanInput } from '../../study-space/types'
import {
  defaultTimerPlanAdvancedFields,
  isValidTimerPlanAdvancedDraft,
  POMODORO_BREAK_POLICY_OPTIONS,
  type PomodoroBreakPolicy
} from '../../study-space/planning-timer-plan-advanced-fields'
import {
  CONTINUOUS_BREAK_POLICY_OPTIONS,
  TIMER_PLAN_KIND_OPTIONS,
  defaultContinuousBreakPolicy,
  isValidContinuousPlanDraft,
  isValidCustomRhythmPlanDraft,
  type ContinuousBreakPolicy,
  type StudyTimerPlanKind
} from '../../study-space/planning-timer-plan-kind'
import {
  CustomRhythmSequenceEditor,
  DEFAULT_CUSTOM_RHYTHM_SEQUENCE
} from './CustomRhythmSequenceEditor'
import { useWorkbenchDisclosureReveal } from './useWorkbenchDisclosureReveal'
import { StudyTimerPlanCatalogSection } from './StudyTimerPlanCatalogSection'
import { StudyPlanningPrefsSection } from './StudyPlanningPrefsSection'
import { ActiveVsNextPlanSection } from './ActiveVsNextPlanSection'
import type { EmptyStartPolicy, TimerSessionRecord } from '../../../../shared/study-planning'
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
  /** STC-404: empty-start preference (sole-read). */
  emptyStartPolicy?: EmptyStartPolicy
  /** STC-404/406: classification prompt opt-out (sole-read; restorable). */
  classificationPromptOptOut?: boolean
  /** STC-503: live local TimerSession with frozen planSnapshot (UI clock authority). */
  activeTimerSession?: TimerSessionRecord | null
  /** STC-503 fallback: sole-read timerSessions cache when live session not mirrored. */
  timerSessions?: readonly TimerSessionRecord[] | null
  onToggleTimer: () => void
  onResetTimer: () => void
  onStartTimerInMode: (timerMode: StudyTimerMode) => void
  onSaveTimerPlan: (input: StudyTimerPlanInput) => void
  onApplyTimerPlan: (planId: string) => void
  onRemoveTimerPlan: (planId: string) => void
  /** STC-501: copy catalog plan as custom (optional for hosts that dual-write). */
  onCopyTimerPlan?: (planId: string) => void
  /** STC-502: rename custom plan (returns false when refused). */
  onRenameTimerPlan?: (planId: string, name: string) => boolean
  /** STC-502: set default plan preference. */
  onSetDefaultTimerPlan?: (planId: string) => void
  /** STC-404: write emptyStartPolicy preference. */
  onEmptyStartPolicyChange?: (policy: EmptyStartPolicy) => void
  /** STC-404: write / restore classificationPromptOptOut. */
  onClassificationPromptOptOutChange?: (optOut: boolean) => void
  /**
   * STC-205 / §10.3: extend active countdown target (typically break mid-run).
   * Host maps to useStudySession.extendActiveTimerTarget.
   */
  onExtendActiveTimer?: (addMinutes: number) => void
}

type TimerPlanDraft = StudyTimerPlanInput

function createTimerPlanDraft(snapshot: StudySnapshot): TimerPlanDraft {
  const advanced = defaultTimerPlanAdvancedFields()
  // Prefer last saved plan advanced fields when present (sole-read cache).
  const last = snapshot.timerPlans[0]
  const kind: StudyTimerPlanKind =
    last?.kind === 'continuous'
      ? 'continuous'
      : last?.kind === 'custom_rhythm'
        ? 'custom_rhythm'
        : 'pomodoro'
  return {
    name: '',
    focusMinutes: snapshot.focusMinutes,
    breakMinutes: snapshot.breakMinutes,
    simulationStartTime: snapshot.simulationStartTime,
    simulationEndTime: snapshot.simulationEndTime,
    longBreakMinutes: last?.longBreakMinutes ?? advanced.longBreakMinutes,
    longBreakEvery: last?.longBreakEvery ?? advanced.longBreakEvery,
    kind,
    clockMode: kind === 'continuous' ? 'countup' : 'countdown',
    continuousTarget: last?.continuousTarget === true,
    rhythmSequence:
      kind === 'custom_rhythm' && Array.isArray(last?.rhythmSequence) && last.rhythmSequence.length > 0
        ? last.rhythmSequence.map((s) => ({ kind: s.kind, minutes: s.minutes }))
        : kind === 'custom_rhythm'
          ? DEFAULT_CUSTOM_RHYTHM_SEQUENCE.map((s) => ({ ...s }))
          : undefined,
    breakPolicy: (
      kind === 'continuous'
        ? (last?.breakPolicy ?? defaultContinuousBreakPolicy())
        : (last?.breakPolicy === 'automatic' || last?.breakPolicy === 'ask'
          ? last.breakPolicy
          : advanced.breakPolicy)
    ) as PomodoroBreakPolicy | ContinuousBreakPolicy
  }
}

export function WorkbenchPomodoro({
  snapshot,
  timerProgress,
  selectedTaskId = null,
  defaultTimerPlanId = null,
  emptyStartPolicy = 'ask_every_time',
  classificationPromptOptOut = false,
  activeTimerSession = null,
  timerSessions = null,
  onToggleTimer,
  onResetTimer,
  onStartTimerInMode,
  onSaveTimerPlan,
  onApplyTimerPlan,
  onRemoveTimerPlan,
  onCopyTimerPlan,
  onRenameTimerPlan,
  onSetDefaultTimerPlan,
  onEmptyStartPolicyChange,
  onClassificationPromptOptOutChange,
  onExtendActiveTimer
}: WorkbenchPomodoroProps) {
  const { open, isClosing, revealHeight, revealRef, revealInnerRef, toggle } = useWorkbenchDisclosureReveal()
  const [selectedMode, setSelectedMode] = useState<StudyTimerMode>(snapshot.timerMode)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<TimerPlanDraft>(() => createTimerPlanDraft(snapshot))
  const settingsTitleId = useId()
  const [settingsPortalHost, setSettingsPortalHost] = useState<HTMLElement | null>(null)
  const [settingsSection, setSettingsSection] = useState<'plan' | 'prefs'>('plan')
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
  const draftKind: StudyTimerPlanKind =
    draft.kind === 'continuous'
      ? 'continuous'
      : draft.kind === 'custom_rhythm'
        ? 'custom_rhythm'
        : 'pomodoro'
  const hasValidDraft = draftKind === 'continuous'
    ? isValidContinuousPlanDraft({
      name: draft.name,
      focusMinutes: draft.focusMinutes,
      continuousTarget: draft.continuousTarget === true,
      breakPolicy: draft.breakPolicy,
      simulationStartTime: draft.simulationStartTime,
      simulationEndTime: draft.simulationEndTime
    })
    : draftKind === 'custom_rhythm'
      ? isValidCustomRhythmPlanDraft({
        name: draft.name,
        rhythmSequence: draft.rhythmSequence,
        simulationStartTime: draft.simulationStartTime,
        simulationEndTime: draft.simulationEndTime
      })
      : Boolean(draft.name.trim())
        && Number.isInteger(draft.focusMinutes)
        && Number.isInteger(draft.breakMinutes)
        && draft.focusMinutes >= 5
        && draft.focusMinutes <= 120
        && draft.breakMinutes >= 1
        && draft.breakMinutes <= 45
        && draft.simulationStartTime < draft.simulationEndTime
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
        setDraft(createTimerPlanDraft(snapshot))
        setSettingsSection('plan')
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

  const updateDraft = <Key extends keyof TimerPlanDraft>(key: Key, value: TimerPlanDraft[Key]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const handleSavePlan = (): void => {
    if (!hasValidDraft) return
    const kind: StudyTimerPlanKind =
      draft.kind === 'continuous'
        ? 'continuous'
        : draft.kind === 'custom_rhythm'
          ? 'custom_rhythm'
          : 'pomodoro'
    // Catalog save only — never mutates live session planSnapshot (STC-503 / ADR-0094 freeze).
    onSaveTimerPlan({
      ...draft,
      name: draft.name.trim(),
      kind,
      clockMode: kind === 'continuous' ? 'countup' : 'countdown',
      continuousTarget: kind === 'continuous' ? draft.continuousTarget === true : undefined,
      breakMinutes: kind === 'continuous' ? (draft.breakMinutes || 0) : draft.breakMinutes,
      rhythmSequence:
        kind === 'custom_rhythm' && Array.isArray(draft.rhythmSequence)
          ? draft.rhythmSequence.map((s) => ({ kind: s.kind, minutes: s.minutes }))
          : undefined
    })
    setDraft(createTimerPlanDraft({
      ...snapshot,
      focusMinutes: draft.focusMinutes,
      breakMinutes: draft.breakMinutes,
      simulationStartTime: draft.simulationStartTime,
      simulationEndTime: draft.simulationEndTime
    }))
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

                <aside className="workbench-pomodoro-settings-nav" aria-label="计时设置分区">
                  <div className="workbench-pomodoro-settings-nav-heading" id={settingsTitleId}>专注计时</div>
                  <button
                    type="button"
                    className={`workbench-pomodoro-settings-nav-item${settingsSection === 'plan' ? ' is-active' : ''}`}
                    aria-current={settingsSection === 'plan' ? 'page' : undefined}
                    onClick={() => setSettingsSection('plan')}
                  >
                    <Settings2 size={17} aria-hidden="true" />
                    <span>
                      <strong>专注方案</strong>
                      <small>时长 · 节奏 · 目录</small>
                    </span>
                  </button>
                  {onEmptyStartPolicyChange && onClassificationPromptOptOutChange ? (
                    <button
                      type="button"
                      className={`workbench-pomodoro-settings-nav-item${settingsSection === 'prefs' ? ' is-active' : ''}`}
                      aria-current={settingsSection === 'prefs' ? 'page' : undefined}
                      onClick={() => setSettingsSection('prefs')}
                    >
                      <Timer size={17} aria-hidden="true" />
                      <span>
                        <strong>启动偏好</strong>
                        <small>空启动 · 分类提示</small>
                      </span>
                    </button>
                  ) : null}
                </aside>

                <div className="workbench-pomodoro-settings-content">
                  {settingsSection === 'plan' ? (
                    <>
                      <header className="workbench-pomodoro-settings-panel-heading">
                        <h2>专注方案</h2>
                        <p>自定义计时节奏，保存后可在目录中一键套用；进行中的会话方案快照不会被覆盖。</p>
                      </header>

                      <div className="workbench-pomodoro-settings-fields">
                        <label>
                          <span>方案名称</span>
                          <input
                            type="text"
                            aria-label="方案名称"
                            value={draft.name}
                            maxLength={24}
                            placeholder="例如：晨间冲刺"
                            onChange={(event) => updateDraft('name', event.target.value)}
                          />
                        </label>
                        <label>
                          <span>方案类型</span>
                          <select
                            aria-label="方案类型"
                            value={draftKind}
                            onChange={(event) => {
                              const next = event.target.value as StudyTimerPlanKind
                              setDraft((current) => ({
                                ...current,
                                kind: next,
                                clockMode: next === 'continuous' ? 'countup' : 'countdown',
                                continuousTarget: next === 'continuous' ? false : undefined,
                                breakPolicy: next === 'continuous'
                                  ? defaultContinuousBreakPolicy()
                                  : (current.breakPolicy === 'automatic' || current.breakPolicy === 'ask'
                                    ? current.breakPolicy
                                    : 'ask'),
                                breakMinutes: next === 'continuous' ? 0 : (current.breakMinutes || 5),
                                rhythmSequence:
                                  next === 'custom_rhythm'
                                    ? (Array.isArray(current.rhythmSequence) && current.rhythmSequence.length > 0
                                      ? current.rhythmSequence
                                      : DEFAULT_CUSTOM_RHYTHM_SEQUENCE.map((s) => ({ ...s })))
                                    : undefined
                              }))
                            }}
                          >
                            {TIMER_PLAN_KIND_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </label>
                        {draftKind === 'custom_rhythm' ? (
                          <CustomRhythmSequenceEditor
                            sequence={
                              Array.isArray(draft.rhythmSequence)
                                ? draft.rhythmSequence
                                : DEFAULT_CUSTOM_RHYTHM_SEQUENCE
                            }
                            onChange={(next) => updateDraft('rhythmSequence', next)}
                            freezeActiveSession={Boolean(
                              activeTimerSession
                              && (activeTimerSession.state === 'running' || activeTimerSession.state === 'paused')
                            )}
                          />
                        ) : (
                          <div className="workbench-pomodoro-settings-durations">
                            <label>
                              <span>{draftKind === 'continuous' ? '目标时长（可选）' : '专注时间'}</span>
                              <div className="workbench-pomodoro-number-input">
                                <input
                                  type="number"
                                  aria-label="专注时间"
                                  value={draft.focusMinutes}
                                  min={5}
                                  max={draftKind === 'continuous' ? 240 : 120}
                                  step={1}
                                  disabled={draftKind === 'continuous' && draft.continuousTarget !== true}
                                  onChange={(event) => updateDraft('focusMinutes', Number(event.target.value))}
                                />
                                <em>分钟</em>
                              </div>
                            </label>
                            {draftKind === 'pomodoro' ? (
                              <label>
                                <span>休息时间</span>
                                <div className="workbench-pomodoro-number-input">
                                  <input
                                    type="number"
                                    aria-label="休息时间"
                                    value={draft.breakMinutes}
                                    min={1}
                                    max={45}
                                    step={1}
                                    onChange={(event) => updateDraft('breakMinutes', Number(event.target.value))}
                                  />
                                  <em>分钟</em>
                                </div>
                              </label>
                            ) : (
                              <label>
                                <span>目标正计时</span>
                                <div className="workbench-pomodoro-number-input">
                                  <input
                                    type="checkbox"
                                    aria-label="启用目标正计时"
                                    checked={draft.continuousTarget === true}
                                    onChange={(event) => updateDraft('continuousTarget', event.target.checked)}
                                  />
                                  <em>设定目标</em>
                                </div>
                              </label>
                            )}
                          </div>
                        )}
                        {draftKind === 'pomodoro' ? (
                          <>
                            <div className="workbench-pomodoro-settings-durations" aria-label="长休息设置">
                              <label>
                                <span>长休息</span>
                                <div className="workbench-pomodoro-number-input">
                                  <input
                                    type="number"
                                    aria-label="长休息时间"
                                    value={draft.longBreakMinutes ?? 15}
                                    min={5}
                                    max={60}
                                    step={1}
                                    onChange={(event) => updateDraft('longBreakMinutes', Number(event.target.value))}
                                  />
                                  <em>分钟</em>
                                </div>
                              </label>
                              <label>
                                <span>每 N 轮</span>
                                <div className="workbench-pomodoro-number-input">
                                  <input
                                    type="number"
                                    aria-label="长休息间隔轮数"
                                    value={draft.longBreakEvery ?? 4}
                                    min={2}
                                    max={8}
                                    step={1}
                                    onChange={(event) => updateDraft('longBreakEvery', Number(event.target.value))}
                                  />
                                  <em>轮</em>
                                </div>
                              </label>
                            </div>
                            <label>
                              <span>休息策略</span>
                              <select
                                aria-label="休息策略"
                                value={draft.breakPolicy === 'automatic' || draft.breakPolicy === 'ask' ? draft.breakPolicy : 'ask'}
                                onChange={(event) => updateDraft('breakPolicy', event.target.value as PomodoroBreakPolicy)}
                              >
                                {POMODORO_BREAK_POLICY_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </label>
                          </>
                        ) : draftKind === 'custom_rhythm' ? (
                          <label>
                            <span>休息策略</span>
                            <select
                              aria-label="自定义节奏休息策略"
                              value={draft.breakPolicy === 'automatic' || draft.breakPolicy === 'ask' ? draft.breakPolicy : 'ask'}
                              onChange={(event) => updateDraft('breakPolicy', event.target.value as PomodoroBreakPolicy)}
                            >
                              {POMODORO_BREAK_POLICY_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label>
                            <span>休息策略</span>
                            <select
                              aria-label="连续专注休息策略"
                              value={
                                draft.breakPolicy === 'automatic' ||
                                draft.breakPolicy === 'ask' ||
                                draft.breakPolicy === 'reminder_only' ||
                                draft.breakPolicy === 'none'
                                  ? draft.breakPolicy
                                  : defaultContinuousBreakPolicy()
                              }
                              onChange={(event) => updateDraft('breakPolicy', event.target.value as ContinuousBreakPolicy)}
                            >
                              {CONTINUOUS_BREAK_POLICY_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label>
                          <span>模拟时段</span>
                          <div className="workbench-pomodoro-time-range">
                            <input
                              type="time"
                              aria-label="模拟开始时间"
                              value={draft.simulationStartTime}
                              onChange={(event) => updateDraft('simulationStartTime', event.target.value)}
                            />
                            <i>至</i>
                            <input
                              type="time"
                              aria-label="模拟结束时间"
                              value={draft.simulationEndTime}
                              onChange={(event) => updateDraft('simulationEndTime', event.target.value)}
                            />
                          </div>
                        </label>
                      </div>

                      <button
                        className="workbench-pomodoro-save-plan"
                        type="button"
                        onClick={handleSavePlan}
                        disabled={!hasValidDraft}
                      >
                        <Save size={15} aria-hidden="true" />
                        保存方案
                      </button>
                      {draft.simulationStartTime >= draft.simulationEndTime ? (
                        <p className="workbench-pomodoro-settings-hint" role="status">结束时间需晚于开始时间。</p>
                      ) : null}
                      {draftKind === 'custom_rhythm' && !hasValidDraft ? (
                        <p className="workbench-pomodoro-settings-hint" role="status">
                          自定义节奏未通过校验：空序列、未知类型或非正分钟数会阻止保存（不会静默使用默认番茄）。
                        </p>
                      ) : null}

                      <ActiveVsNextPlanSection
                        activeSession={activeTimerSession}
                        timerSessions={timerSessions}
                        nextPlanId={defaultTimerPlanId}
                        userPlans={snapshot.timerPlans}
                      />

                      <StudyTimerPlanCatalogSection
                        userPlans={snapshot.timerPlans}
                        defaultTimerPlanId={defaultTimerPlanId}
                        onApply={onApplyTimerPlan}
                        onCopy={onCopyTimerPlan}
                        onRemove={onRemoveTimerPlan}
                        onRename={onRenameTimerPlan}
                        onSetDefault={onSetDefaultTimerPlan}
                      />
                    </>
                  ) : onEmptyStartPolicyChange && onClassificationPromptOptOutChange ? (
                    <>
                      <header className="workbench-pomodoro-settings-panel-heading">
                        <h2>启动偏好</h2>
                        <p>控制空启动归因与分类提示，避免静默绑定或提示风暴。</p>
                      </header>
                      <StudyPlanningPrefsSection
                        emptyStartPolicy={emptyStartPolicy}
                        classificationPromptOptOut={classificationPromptOptOut}
                        onEmptyStartPolicyChange={onEmptyStartPolicyChange}
                        onClassificationPromptOptOutChange={onClassificationPromptOptOutChange}
                      />
                    </>
                  ) : null}
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
