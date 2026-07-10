import { Check, CheckCircle2, Plus } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import type { StudySnapshot } from './types'
import type { StudySpaceViewModel } from './viewModel'

type StudyWorkPanelsProps = {
  snapshot: StudySnapshot
  currentTask: StudySpaceViewModel['currentTask']
  openTasks: number
  completedTasks: number
  taskInput: string
  children?: ReactNode
  onTaskInputChange: (value: string) => void
  onAddTask: (event: FormEvent<HTMLFormElement>) => void
  onToggleTask: (taskId: string) => void
  onRemoveDoneTasks: () => void
}

export function StudyWorkPanels({
  snapshot,
  currentTask,
  openTasks,
  completedTasks,
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

      <section className="study-panel study-work-panel study-growth-panel" aria-label="养成" />
    </>
  )
}
