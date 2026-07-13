import { CalendarDays, Check, CheckCircle2, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { useState, type CSSProperties, type FormEvent } from 'react'
import type { StudyTask } from '../../study-space/types'
import {
  getReadableCategoryInk,
  listStudyTaskCategories,
  resolveStudyTaskCategory
} from '../../study-space/taskCategories'
import { useWorkbenchDisclosureReveal } from './useWorkbenchDisclosureReveal'

type WorkbenchTasksProps = {
  tasks: StudyTask[]
  openTasks: number
  completedTasks: number
  onAddTask: (title: string) => boolean
  onToggleTask: (taskId: string) => void
  onRemoveTask: (taskId: string) => void
  onOpenSchedule: () => void
}

function formatTaskMinutes(minutes: number): string {
  if (minutes >= 24 * 60) return '24:00'
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatTaskSchedule(task: StudyTask): string | null {
  if (!task.schedule) return null
  return `${formatTaskMinutes(task.schedule.startMinutes)}-${formatTaskMinutes(task.schedule.endMinutes)}`
}

type CategoryBadgeStyle = CSSProperties & Record<'--task-category-color' | '--task-category-ink', string>

export function WorkbenchTasks({
  tasks,
  openTasks,
  completedTasks,
  onAddTask,
  onToggleTask,
  onRemoveTask,
  onOpenSchedule
}: WorkbenchTasksProps) {
  const { open, isClosing, revealHeight, revealRef, revealInnerRef, toggle } = useWorkbenchDisclosureReveal()
  const [taskInput, setTaskInput] = useState('')
  const categories = listStudyTaskCategories()
  const taskCount = openTasks + completedTasks
  const completedRatio = taskCount > 0 ? Math.round((completedTasks / taskCount) * 100) : 0

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (onAddTask(taskInput)) setTaskInput('')
  }

  return (
    <section className={`workbench-disclosure-card workbench-task-card${open ? ' is-open' : ''}${isClosing ? ' is-closing' : ''}`} aria-label="今日清单">
      <div
        ref={revealRef}
        className="workbench-disclosure-reveal workbench-task-reveal"
        style={{ height: `${revealHeight}px` }}
        aria-hidden={!open}
        inert={!open}
      >
        <div ref={revealInnerRef} className="workbench-disclosure-reveal-inner workbench-task-reveal-inner">
          <div id="workbench-task-panel" className="workbench-disclosure-panel workbench-task-panel">
            <div className="workbench-task-head">
              <div>
                <span><CheckCircle2 size={13} /> 清单管理</span>
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
              </div>
            </div>

            <div className="workbench-task-progress" aria-label={`任务进度，已完成 ${completedTasks} 个，共 ${taskCount} 个`}>
              <div className="workbench-task-progress-head">
                <span>进度</span>
                <strong>{completedTasks}/{taskCount}</strong>
              </div>
              <div className="workbench-task-progress-track" aria-hidden="true">
                <span style={{ width: `${completedRatio}%` }} />
              </div>
              <div className="workbench-task-progress-meta">
                <span>{completedTasks} 已完成</span>
                <span>{openTasks} 待完成</span>
              </div>
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
              ) : tasks.map((task) => {
                const scheduleLabel = formatTaskSchedule(task)
                const category = resolveStudyTaskCategory(task.categoryId, categories)
                  ?? resolveStudyTaskCategory('study', categories)
                const categoryStyle: CategoryBadgeStyle | undefined = category
                  ? {
                      '--task-category-color': category.color,
                      '--task-category-ink': getReadableCategoryInk(category.color)
                    }
                  : undefined
                return (
                  <div
                    key={task.id}
                    className={`workbench-task-row${task.done ? ' is-done' : ''}`}
                  >
                    <button
                      type="button"
                      className="workbench-task-toggle"
                      onClick={() => onToggleTask(task.id)}
                      aria-pressed={task.done}
                    >
                      <span className="workbench-task-check">{task.done ? <Check size={11} /> : null}</span>
                      <strong>{task.title}</strong>
                      {category ? (
                        <small className="workbench-task-category" style={categoryStyle}>
                          {category.name}
                        </small>
                      ) : null}
                      {scheduleLabel ? <small>{scheduleLabel}</small> : null}
                    </button>
                    <button
                      type="button"
                      className="workbench-task-delete"
                      onClick={() => onRemoveTask(task.id)}
                      aria-label={`删除任务：${task.title}`}
                      title="删除任务"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="workbench-disclosure-toggle workbench-task-toggle-card"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="workbench-task-panel"
      >
        <span className="workbench-disclosure-label workbench-task-toggle-label">
          <CheckCircle2 size={15} />
          今日清单
        </span>
        <span className="workbench-disclosure-meta workbench-task-toggle-meta">
          <strong>{openTasks} 待办</strong>
          <ChevronUp className="workbench-disclosure-chevron" size={15} aria-hidden="true" />
        </span>
      </button>
    </section>
  )
}
