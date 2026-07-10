import { Pause, Play, RotateCcw, Timer, Volume2, VolumeX } from 'lucide-react'
import { formatStudyDuration } from '../../study-space/domain'
import type { StudySnapshot, StudyTimerMode } from '../../study-space/types'

const timerPresets = [
  [25, 5],
  [50, 10],
  [90, 15]
] as const

type WorkbenchPomodoroProps = {
  snapshot: StudySnapshot
  timerProgress: number
  ambientLabel: string
  onToggleTimer: () => void
  onResetTimer: () => void
  onSwitchTimerMode: (timerMode: StudyTimerMode) => void
  onUpdateTimerPreset: (focusMinutes: number, breakMinutes: number) => void
  onToggleAmbientEnabled: () => void
}

function timerStateLabel(snapshot: StudySnapshot): string {
  if (snapshot.timerState === 'running') return snapshot.timerMode === 'focus' ? '专注中' : '休息中'
  if (snapshot.timerState === 'paused') return '已暂停'
  return '准备'
}

export function WorkbenchPomodoro({
  snapshot,
  timerProgress,
  ambientLabel,
  onToggleTimer,
  onResetTimer,
  onSwitchTimerMode,
  onUpdateTimerPreset,
  onToggleAmbientEnabled
}: WorkbenchPomodoroProps) {
  return (
    <aside className="workbench-pomodoro" aria-label="番茄钟">
      <div className="workbench-pomodoro-head">
        <span><Timer size={16} /> 番茄钟</span>
        <small className={`is-${snapshot.timerState}`}>{timerStateLabel(snapshot)}</small>
      </div>

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

      <div className="workbench-pomodoro-time">
        <strong>{formatStudyDuration(snapshot.remainingSeconds)}</strong>
        <span>{snapshot.focusMinutes} 分钟专注 · {snapshot.breakMinutes} 分钟休息</span>
      </div>
      <div className="workbench-pomodoro-progress" aria-hidden="true">
        <span style={{ width: `${timerProgress}%` }} />
      </div>

      <div className="workbench-pomodoro-actions">
        <button className="is-primary" type="button" onClick={onToggleTimer}>
          {snapshot.timerState === 'running' ? <Pause size={16} /> : <Play size={16} />}
          {snapshot.timerState === 'running' ? '暂停' : snapshot.timerState === 'paused' ? '继续' : '开始'}
        </button>
        <button type="button" onClick={onResetTimer} aria-label="重置番茄钟" title="重置">
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="workbench-pomodoro-presets" aria-label="常用时长">
        {timerPresets.map(([focus, rest]) => (
          <button
            key={focus}
            type="button"
            className={snapshot.focusMinutes === focus && snapshot.breakMinutes === rest ? 'is-active' : ''}
            disabled={snapshot.timerState === 'running'}
            onClick={() => onUpdateTimerPreset(focus, rest)}
          >
            {focus}/{rest}
          </button>
        ))}
      </div>

      <button
        className={`workbench-pomodoro-ambient${snapshot.ambientEnabled ? ' is-active' : ''}`}
        type="button"
        onClick={onToggleAmbientEnabled}
      >
        {snapshot.ambientEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        {ambientLabel}
      </button>
    </aside>
  )
}
