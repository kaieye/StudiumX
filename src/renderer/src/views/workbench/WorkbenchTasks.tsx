import { CalendarDays, Check, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { StudyTask } from '../../study-space/types'

type WorkbenchTasksProps = {
  tasks: StudyTask[]
  currentTask: StudyTask | undefined
  openTasks: number
  completedTasks: number
  onAddTask: (title: string) => boolean
  onToggleTask: (taskId: string) => void
  onRemoveDoneTasks: () => void
  onOpenSchedule: () => void
}

export function WorkbenchTasks({
  tasks,
  currentTask,
  openTasks,
  completedTasks,
  onAddTask,
  onToggleTask,
  onRemoveDoneTasks,
  onOpenSchedule
}: WorkbenchTasksProps) {
  const [taskInput, setTaskInput] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (onAddTask(taskInput)) setTaskInput('')
  }

  return (
    <section className="workbench-task-card" aria-label="今日清单">
      <div className="workbench-task-head">
        <div>
          <span><CheckCircle2 size={13} /> 今日清单</span>
          <strong title={currentTask?.title}>{currentTask?.title ?? '今日任务已清空'}</strong>
        </div>
        <div className="workbench-task-actions">
          <button
            type="button"
            className="workbench-task-detail-button"
            onClick={onOpenSchedule}
            aria-label="查看任务详情"
            title="任务详情"
          >
            <CalendarDays size={14} />
            <span>详情</span>
          </button>
          <button
            type="button"
            onClick={onRemoveDoneTasks}
            disabled={completedTasks === 0}
            aria-label="清除已完成任务"
            title="清除已完成"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="workbench-task-summary" aria-label="任务执行摘要">
        <span><strong>{openTasks}</strong> 待完成</span>
        <span><strong>{completedTasks}</strong> 已完成</span>
      </div>

      <form className="workbench-task-form" onSubmit={handleSubmit}>
        <input
          value={taskInput}
          onChange={(event) => setTaskInput(event.target.value)}
          placeholder="添加本轮目标"
          aria-label="添加本轮目标"
          maxLength={80}
        />
        <button type="submit" disabled={!taskInput.trim()} aria-label="添加任务">
          <Plus size={15} />
        </button>
      </form>

      <div className="workbench-task-list" aria-label="任务列表">
        {tasks.length === 0 ? (
          <div className="workbench-task-empty">
            <CheckCircle2 size={17} />
            <span>清单已完成</span>
          </div>
        ) : tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className={`workbench-task-row${task.done ? ' is-done' : ''}`}
            onClick={() => onToggleTask(task.id)}
            aria-pressed={task.done}
          >
            <span>{task.done ? <Check size={11} /> : null}</span>
            <strong>{task.title}</strong>
          </button>
        ))}
      </div>
    </section>
  )
}
