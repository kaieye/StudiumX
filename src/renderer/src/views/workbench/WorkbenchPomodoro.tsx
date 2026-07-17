import { ChevronDown, Pause, Play, RotateCcw, Timer, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { formatStudyDuration } from '../../study-space/domain'
import type { StudySnapshot, StudyTimerMode } from '../../study-space/types'
import { useWorkbenchDisclosureReveal } from './useWorkbenchDisclosureReveal'

type WorkbenchPomodoroProps = {
  snapshot: StudySnapshot
  timerProgress: number
  ambientLabel: string
  onToggleTimer: () => void
  onResetTimer: () => void
  onStartTimerInMode: (timerMode: StudyTimerMode) => void
  onToggleAmbientEnabled: () => void
}

export function WorkbenchPomodoro({
  snapshot,
  timerProgress,
  ambientLabel,
  onToggleTimer,
  onResetTimer,
  onStartTimerInMode,
  onToggleAmbientEnabled
}: WorkbenchPomodoroProps) {
  const { open, isClosing, revealHeight, revealRef, revealInnerRef, toggle } = useWorkbenchDisclosureReveal()
  const [selectedMode, setSelectedMode] = useState<StudyTimerMode>(snapshot.timerMode)

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

  const handleTimerAction = (): void => {
    if (isModePreview) {
      onStartTimerInMode(selectedMode)
      return
    }
    onToggleTimer()
  }

  return (
    <section
      className={`workbench-disclosure-card workbench-pomodoro-card is-${selectedMode}${open ? ' is-open' : ''}${isClosing ? ' is-closing' : ''}`}
      aria-label="番茄钟"
    >
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
            <div className="workbench-pomodoro-mode" role="tablist" aria-label="计时模式">
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
                  <circle className="workbench-timer-ring__track" cx="60" cy="60" r="52" pathLength="100" />
                  <circle
                    className="workbench-timer-ring__progress"
                    cx="60"
                    cy="60"
                    r="52"
                    pathLength="100"
                    transform="rotate(-90 60 60)"
                  />
                </svg>
                <div className="workbench-pomodoro-time">
                  <strong>{remainingTime}</strong>
                  <span className="workbench-pomodoro-time__settings">
                    {snapshot.focusMinutes} / {snapshot.breakMinutes} 分钟
                  </span>
                </div>
              </div>
            </div>
            <div className="workbench-pomodoro-progress" aria-hidden="true">
              <span style={{ width: `${timerProgress}%` }} />
            </div>

            <div className="workbench-pomodoro-actions">
              <button
                className="workbench-pomodoro-reset"
                type="button"
                onClick={onResetTimer}
                aria-label="重置番茄钟"
                title="重置"
              >
                <RotateCcw size={16} />
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
                className={`workbench-pomodoro-ambient${snapshot.ambientEnabled ? ' is-active' : ''}`}
                type="button"
                onClick={onToggleAmbientEnabled}
                aria-label={ambientLabel}
                title={ambientLabel}
              >
                {snapshot.ambientEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
