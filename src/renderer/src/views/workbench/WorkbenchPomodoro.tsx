import { ChevronDown, Pause, Play, RotateCcw, Save, Settings2, Timer, Trash2, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { formatStudyDuration } from '../../study-space/domain'
import type { StudySnapshot, StudyTimerMode, StudyTimerPlanInput } from '../../study-space/types'
import { useWorkbenchDisclosureReveal } from './useWorkbenchDisclosureReveal'

type WorkbenchPomodoroProps = {
  snapshot: StudySnapshot
  timerProgress: number
  onToggleTimer: () => void
  onResetTimer: () => void
  onStartTimerInMode: (timerMode: StudyTimerMode) => void
  onSaveTimerPlan: (input: StudyTimerPlanInput) => void
  onApplyTimerPlan: (planId: string) => void
  onRemoveTimerPlan: (planId: string) => void
}

type TimerPlanDraft = StudyTimerPlanInput

function createTimerPlanDraft(snapshot: StudySnapshot): TimerPlanDraft {
  return {
    name: '',
    focusMinutes: snapshot.focusMinutes,
    breakMinutes: snapshot.breakMinutes,
    simulationStartTime: snapshot.simulationStartTime,
    simulationEndTime: snapshot.simulationEndTime
  }
}

export function WorkbenchPomodoro({
  snapshot,
  timerProgress,
  onToggleTimer,
  onResetTimer,
  onStartTimerInMode,
  onSaveTimerPlan,
  onApplyTimerPlan,
  onRemoveTimerPlan
}: WorkbenchPomodoroProps) {
  const { open, isClosing, revealHeight, revealRef, revealInnerRef, toggle } = useWorkbenchDisclosureReveal()
  const [selectedMode, setSelectedMode] = useState<StudyTimerMode>(snapshot.timerMode)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<TimerPlanDraft>(() => createTimerPlanDraft(snapshot))

  useEffect(() => {
    setSelectedMode(snapshot.timerMode)
  }, [snapshot.timerMode])

  const isModePreview = selectedMode !== snapshot.timerMode
  const displayedRemainingSeconds = isModePreview
    ? (selectedMode === 'focus' ? snapshot.focusMinutes : snapshot.breakMinutes) * 60
    : snapshot.remainingSeconds
  const displayedProgress = isModePreview ? 0 : Math.min(100, Math.max(0, timerProgress))
  const timerRingStyle = { '--timer-ring-offset': `${100 - displayedProgress}` } as CSSProperties
  const timerLabel = selectedMode === 'focus' ? '专注计时' : '休息计时'
  const remainingTime = formatStudyDuration(displayedRemainingSeconds)
  const timerIsRunning = snapshot.timerState === 'running' && !isModePreview
  const timerActionLabel = timerIsRunning
    ? '暂停'
    : isModePreview ? `开始${selectedMode === 'focus' ? '专注' : '休息'}`
      : snapshot.timerState === 'paused' ? '继续' : '开始'
  const hasValidDraft = Boolean(draft.name.trim())
    && Number.isInteger(draft.focusMinutes)
    && Number.isInteger(draft.breakMinutes)
    && draft.focusMinutes >= 5
    && draft.focusMinutes <= 120
    && draft.breakMinutes >= 1
    && draft.breakMinutes <= 45
    && draft.simulationStartTime < draft.simulationEndTime

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
      if (next) setDraft(createTimerPlanDraft(snapshot))
      return next
    })
  }

  const updateDraft = <Key extends keyof TimerPlanDraft>(key: Key, value: TimerPlanDraft[Key]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const handleSavePlan = (): void => {
    if (!hasValidDraft) return
    onSaveTimerPlan({ ...draft, name: draft.name.trim() })
    setDraft(createTimerPlanDraft({
      ...snapshot,
      focusMinutes: draft.focusMinutes,
      breakMinutes: draft.breakMinutes,
      simulationStartTime: draft.simulationStartTime,
      simulationEndTime: draft.simulationEndTime
    }))
  }

  return (
    <section
      className={`workbench-disclosure-card workbench-pomodoro-card is-${selectedMode}${open ? ' is-open' : ''}${isClosing ? ' is-closing' : ''}${settingsOpen ? ' has-settings-open' : ''}`}
      aria-label="番茄钟"
    >
      {settingsOpen ? (
        <aside id="workbench-pomodoro-settings" className="workbench-pomodoro-settings-card" aria-label="专注计时方案设置">
          <div className="workbench-pomodoro-settings-heading">
            <div>
              <span>专注方案</span>
              <strong>自定义计时节奏</strong>
            </div>
            <button type="button" onClick={toggleSettings} aria-label="关闭计时设置" title="关闭设置">
              <X size={16} aria-hidden="true" />
            </button>
          </div>

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
            <div className="workbench-pomodoro-settings-durations">
              <label>
                <span>专注时间</span>
                <div className="workbench-pomodoro-number-input">
                  <input
                    type="number"
                    aria-label="专注时间"
                    value={draft.focusMinutes}
                    min={5}
                    max={120}
                    step={1}
                    onChange={(event) => updateDraft('focusMinutes', Number(event.target.value))}
                  />
                  <em>分钟</em>
                </div>
              </label>
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
            </div>
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

          <div className="workbench-pomodoro-saved-plans">
            <span>已保存方案</span>
            {snapshot.timerPlans.length > 0 ? (
              <ul>
                {snapshot.timerPlans.map((plan) => (
                  <li key={plan.id}>
                    <button type="button" className="workbench-pomodoro-saved-plan" onClick={() => onApplyTimerPlan(plan.id)}>
                      <strong>{plan.name}</strong>
                      <small>{plan.focusMinutes} / {plan.breakMinutes} 分钟 · {plan.simulationStartTime}–{plan.simulationEndTime}</small>
                    </button>
                    <button
                      type="button"
                      className="workbench-pomodoro-remove-plan"
                      onClick={() => onRemoveTimerPlan(plan.id)}
                      aria-label={`删除方案：${plan.name}`}
                      title="删除方案"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>保存后的方案会显示在这里。</p>
            )}
          </div>
        </aside>
      ) : null}

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
          <div id="workbench-pomodoro-panel" className="workbench-disclosure-panel workbench-pomodoro-panel">
            <div
              className="workbench-pomodoro-mode"
              role="tablist"
              aria-label="计时模式"
              data-active-mode={selectedMode}
            >
              {(['focus', 'break'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={selectedMode === mode}
                  className={selectedMode === mode ? 'is-active' : ''}
                  onClick={() => {
                    if (selectedMode !== mode) setSelectedMode(mode)
                  }}
                >
                  {mode === 'focus' ? '专注' : '休息'}
                </button>
              ))}
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
