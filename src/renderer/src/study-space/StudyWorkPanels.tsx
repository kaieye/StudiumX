import { Check, CheckCircle2, Plus, Star, Trophy } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { formatStudyHours, studyPlantStage } from './domain'
import type { StudySnapshot } from './types'
import type { StudySpaceViewModel } from './viewModel'

type StudyWorkPanelsProps = {
  snapshot: StudySnapshot
  level: StudySpaceViewModel['level']
  currentTask: StudySpaceViewModel['currentTask']
  openTasks: number
  completedTasks: number
  weeklyFocus: number[]
  badges: StudySpaceViewModel['badges']
  taskInput: string
  children?: ReactNode
  onTaskInputChange: (value: string) => void
  onAddTask: (event: FormEvent<HTMLFormElement>) => void
  onToggleTask: (taskId: string) => void
  onRemoveDoneTasks: () => void
}

export function StudyWorkPanels({
  snapshot,
  level,
  currentTask,
  openTasks,
  completedTasks,
  weeklyFocus,
  badges,
  taskInput,
  children,
  onTaskInputChange,
  onAddTask,
  onToggleTask,
  onRemoveDoneTasks
}: StudyWorkPanelsProps) {
  return (
    <>
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
