import { Check, CheckCircle2, Maximize2, Pause, Play, Plus, RotateCcw, Sparkles, Star, Timer, Trophy, Volume2, VolumeX } from 'lucide-react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { studyModes, studySignals } from './constants'
import { formatStudyDuration, formatStudyHours, studyPlantStage, studySignalLabel } from './domain'
import type { StudySignalId, StudySnapshot, StudyTimerMode } from './types'
import type { StudySpaceViewModel } from './viewModel'

type StudyWorkPanelsProps = {
  activeRoom: StudySpaceViewModel['activeRoom']
  activeMode: StudySpaceViewModel['activeMode']
  snapshot: StudySnapshot
  level: StudySpaceViewModel['level']
  timerProgress: number
  currentTask: StudySpaceViewModel['currentTask']
  openTasks: number
  completedTasks: number
  weeklyFocus: number[]
  badges: StudySpaceViewModel['badges']
  taskInput: string
  children?: ReactNode
  onTaskInputChange: (value: string) => void
  onSelectStudyMode: (mode: typeof studyModes[number]) => void
  onSelectSignal: (signalId: StudySignalId) => void
  onToggleTimer: () => void
  onResetTimer: () => void
  onOpenFocusTheater: () => void
  onUpdateTimerPreset: (focusMinutes: number, breakMinutes: number) => void
  onSwitchTimerMode: (timerMode: StudyTimerMode) => void
  onToggleAmbientEnabled: () => void
  onSetAmbientVolume: (volume: number) => void
  onAddTask: (event: FormEvent<HTMLFormElement>) => void
  onToggleTask: (taskId: string) => void
  onRemoveDoneTasks: () => void
}

export function StudyWorkPanels({
  activeRoom,
  activeMode,
  snapshot,
  level,
  timerProgress,
  currentTask,
  openTasks,
  completedTasks,
  weeklyFocus,
  badges,
  taskInput,
  children,
  onTaskInputChange,
  onSelectStudyMode,
  onSelectSignal,
  onToggleTimer,
  onResetTimer,
  onOpenFocusTheater,
  onUpdateTimerPreset,
  onSwitchTimerMode,
  onToggleAmbientEnabled,
  onSetAmbientVolume,
  onAddTask,
  onToggleTask,
  onRemoveDoneTasks
}: StudyWorkPanelsProps) {
  return (
    <>
      <section className="study-panel study-work-panel study-mode-panel" aria-label="学习模式和学习状态">
        <div className="study-panel-head">
          <div>
            <span className="study-kicker"><Sparkles size={14} /> 学习模式</span>
            <h2>学习模式</h2>
          </div>
          <span className="study-session-label">{activeMode.name}</span>
        </div>
        <div className="study-mode-grid">
          {studyModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`study-mode-card${snapshot.modeId === mode.id ? ' is-active' : ''}`}
              onClick={() => onSelectStudyMode(mode)}
              disabled={snapshot.timerState === 'running'}
            >
              <strong>{mode.name}</strong>
              <span>{mode.focusMinutes}/{mode.breakMinutes} · {mode.detail}</span>
            </button>
          ))}
        </div>
        <div className="study-signal-picker" aria-label="学习状态">
          <div>
            <span className="study-kicker"><Sparkles size={14} /> 学习状态</span>
            <strong>{studySignalLabel(snapshot.signalId)}</strong>
          </div>
          <div>
            {studySignals.map((signal) => (
              <button
                key={signal.id}
                type="button"
                className={snapshot.signalId === signal.id ? 'is-active' : ''}
                onClick={() => onSelectSignal(signal.id)}
                title={signal.detail}
              >
                {signal.shortLabel}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="study-panel study-work-panel study-timer-panel" aria-label="番茄时钟">
        <div className="study-panel-head">
          <div>
            <span className="study-kicker"><Timer size={14} /> 番茄钟</span>
            <h2>{snapshot.timerMode === 'focus' ? '专注轮次' : '恢复时间'}</h2>
          </div>
          <span className="study-session-label">{snapshot.focusMinutes}/{snapshot.breakMinutes}</span>
        </div>
        <div className="study-timer-face" style={{ '--study-progress': `${timerProgress}%` } as CSSProperties}>
          <span>{formatStudyDuration(snapshot.remainingSeconds)}</span>
          <small>{snapshot.timerState === 'running' ? '进行中' : snapshot.timerState === 'paused' ? '已暂停' : '准备好'}</small>
        </div>
        <div className="study-timer-actions">
          <button className="primary-button" type="button" onClick={onToggleTimer}>
            {snapshot.timerState === 'running' ? <Pause size={15} /> : <Play size={15} />}
            {snapshot.timerState === 'running' ? '暂停' : '开始'}
          </button>
          <button className="ghost-button" type="button" onClick={onResetTimer}>
            <RotateCcw size={15} />
            重置
          </button>
          <button className="ghost-button" type="button" onClick={onOpenFocusTheater}>
            <Maximize2 size={15} />
            沉浸
          </button>
        </div>
        <div className="study-presets" aria-label="专注时长">
          {[
            [25, 5],
            [45, 10],
            [50, 10],
            [90, 15]
          ].map(([focus, rest]) => (
            <button
              key={focus}
              type="button"
              className={snapshot.focusMinutes === focus && snapshot.breakMinutes === rest ? 'is-active' : ''}
              onClick={() => onUpdateTimerPreset(focus, rest)}
            >
              {focus}/{rest}
            </button>
          ))}
        </div>
        <div className="study-mode-switch" role="tablist" aria-label="计时模式">
          <button type="button" className={snapshot.timerMode === 'focus' ? 'is-active' : ''} onClick={() => onSwitchTimerMode('focus')}>专注</button>
          <button type="button" className={snapshot.timerMode === 'break' ? 'is-active' : ''} onClick={() => onSwitchTimerMode('break')}>休息</button>
        </div>
        <div className="study-ambient-control">
          <button
            type="button"
            className={snapshot.ambientEnabled ? 'is-active' : ''}
            onClick={onToggleAmbientEnabled}
          >
            {snapshot.ambientEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {activeRoom.ambient}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={snapshot.ambientVolume}
            disabled={!snapshot.ambientEnabled}
            onChange={(event) => onSetAmbientVolume(Number(event.target.value))}
            aria-label="环境音音量"
          />
        </div>
      </section>

      {children}

      <section className="study-panel study-work-panel study-task-panel" aria-label="学习任务">
        <div className="study-panel-head">
          <div>
            <span className="study-kicker"><CheckCircle2 size={14} /> 今日清单</span>
            <h2>学习任务</h2>
          </div>
          <button className="study-clear-button" type="button" onClick={onRemoveDoneTasks}>清除完成</button>
        </div>
        <div className="study-task-summary" aria-label="任务执行摘要">
          <div>
            <span>本轮目标</span>
            <strong>{currentTask?.title ?? '今日任务已清空'}</strong>
          </div>
          <div>
            <span>未完成</span>
            <strong>{openTasks}</strong>
          </div>
          <div>
            <span>已完成</span>
            <strong>{completedTasks}</strong>
          </div>
        </div>
        <form className="study-task-form" onSubmit={onAddTask}>
          <input
            value={taskInput}
            onChange={(event) => onTaskInputChange(event.target.value)}
            placeholder="添加本轮目标"
            maxLength={80}
          />
          <button type="submit" aria-label="添加任务"><Plus size={15} /></button>
        </form>
        <div className="study-task-list">
          {snapshot.tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`study-task-row${task.done ? ' is-done' : ''}`}
              onClick={() => onToggleTask(task.id)}
            >
              <span>{task.done ? <Check size={13} /> : null}</span>
              <strong>{task.title}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="study-panel study-work-panel study-growth-panel" aria-label="成长系统">
        <div className="study-panel-head">
          <div>
            <span className="study-kicker"><Star size={14} /> 养成</span>
            <h2>{studyPlantStage(snapshot.xp)}</h2>
          </div>
          <span className="study-xp">{level.current}/{level.next} XP</span>
        </div>
        <div className="study-level-track"><span style={{ width: `${level.progress}%` }} /></div>
        <div className="study-growth-grid">
          <div><strong>{formatStudyHours(snapshot.totalFocusSeconds)}h</strong><span>累计专注</span></div>
          <div><strong>{snapshot.totalSessions}</strong><span>完成番茄</span></div>
          <div><strong>{snapshot.todaySessions}</strong><span>今日轮次</span></div>
        </div>
        <div className="study-week-bars" aria-label="一周专注">
          {weeklyFocus.map((value, index) => (
            <span key={index}><i style={{ height: `${Math.max(12, Math.round(value * 100))}%` }} /></span>
          ))}
        </div>
        <div className="study-badges">
          {badges.map((badge) => (
            <span key={badge.label} className={badge.unlocked ? 'is-unlocked' : ''}>
              <Trophy size={12} />
              {badge.label}
            </span>
          ))}
        </div>
      </section>
    </>
  )
}
