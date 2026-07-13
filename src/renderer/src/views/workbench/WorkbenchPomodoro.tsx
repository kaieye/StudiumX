import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import type { CSSProperties } from 'react'
import { formatStudyDuration } from '../../study-space/domain'
import type { StudySnapshot, StudyTimerMode } from '../../study-space/types'

type WorkbenchPomodoroProps = {
  snapshot: StudySnapshot
  timerProgress: number
  ambientLabel: string
  onToggleTimer: () => void
  onResetTimer: () => void
  onSwitchTimerMode: (timerMode: StudyTimerMode) => void
  onToggleAmbientEnabled: () => void
}

export function WorkbenchPomodoro({
  snapshot,
  timerProgress,
  ambientLabel,
  onToggleTimer,
  onResetTimer,
  onSwitchTimerMode,
  onToggleAmbientEnabled
}: WorkbenchPomodoroProps) {
  const progressStyle = { '--timer-progress': `${timerProgress}%` } as CSSProperties

  return (
    <section className={`workbench-pomodoro-card is-${snapshot.timerMode}`} style={progressStyle} aria-label="番茄钟">
      <header className="workbench-card-header">
        <span>{snapshot.timerMode === 'focus' ? '专注计时' : '休息计时'}</span>
        <button type="button" onClick={onResetTimer} aria-label="重置番茄钟" title="重置">
          <RotateCcw size={15} />
        </button>
      </header>

      <div className="workbench-pomodoro-mode" role="tablist" aria-label="计时模式">
        {(['focus', 'break'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={snapshot.timerMode === mode}
            className={snapshot.timerMode === mode ? 'is-active' : ''}
            onClick={() => {
              if (snapshot.timerMode !== mode) onSwitchTimerMode(mode)
            }}
          >
            {mode === 'focus' ? '专注' : '休息'}
          </button>
        ))}
      </div>

      <div className="workbench-timer-face">
        <div className="workbench-timer-ring" aria-hidden="true">
          <div className="workbench-pomodoro-time">
            <strong>{formatStudyDuration(snapshot.remainingSeconds)}</strong>
            <span>{snapshot.focusMinutes} / {snapshot.breakMinutes} 分钟</span>
          </div>
        </div>
      </div>
      <div className="workbench-pomodoro-progress" aria-hidden="true">
        <span style={{ width: `${timerProgress}%` }} />
      </div>

      <div className="workbench-pomodoro-actions">
        <button className="is-primary" type="button" onClick={onToggleTimer}>
          {snapshot.timerState === 'running' ? <Pause size={16} /> : <Play size={16} />}
          {snapshot.timerState === 'running' ? '暂停' : snapshot.timerState === 'paused' ? '继续' : '开始'}
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
    </section>
  )
}
