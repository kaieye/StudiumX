import {
  CalendarDays,
  ChartColumn,
  Check,
  CheckCircle2,
  ChevronUp,
  Plus,
  Tags,
  Target,
  Trash2
} from 'lucide-react'
import { useMemo, useState, type CSSProperties, type RefObject } from 'react'
import type { StudyTask } from '../../study-space/types'
import {
  getReadableCategoryInk,
  listStudyTaskCategories,
  resolveStudyTaskCategory
} from '../../study-space/taskCategories'
import {
  emptyLabelForTaskListView,
  projectStudyTasksForView,
  TASK_LIST_VIEWS,
  type ActiveTimerHint,
  type TaskListViewId
} from '../../study-space/planning-task-timeline-adapter'
import { useWorkbenchDisclosureReveal } from './useWorkbenchDisclosureReveal'

type WorkbenchTasksProps = {
  tasks: StudyTask[]
  openTasks: number
  completedTasks: number
  selectedTaskId?: string | null
  onSelectTask?: (taskId: string | null) => void
  onToggleTask: (taskId: string) => void
  onRemoveTask: (taskId: string) => void
  onOpenSchedule: () => void
  onOpenAddTask: () => void
  onOpenAnalytics: () => void
  analyticsButtonRef?: RefObject<HTMLButtonElement | null>
  defaultOpen?: boolean
  /** Optional active timer retained for focus-session analytics. */
  activeTimer?: ActiveTimerHint | null
  /** Initial timeline view; default "today" matches the primary task list. */
  defaultView?: TaskListViewId
  /** STC-408: open batch classify for current inbox (or selected subset). */
  onOpenBatchClassify?: (taskIds: string[]) => void
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
  selectedTaskId = null,
  onSelectTask,
  onToggleTask,
  onRemoveTask,
  onOpenSchedule,
  onOpenAddTask,
  onOpenAnalytics,
  analyticsButtonRef,
  defaultOpen = false,
  activeTimer = null,
  defaultView = 'today',
  onOpenBatchClassify
}: WorkbenchTasksProps) {
  const { open, isClosing, revealHeight, revealRef, revealInnerRef, toggle } = useWorkbenchDisclosureReveal({
    defaultOpen
  })
  const [view, setView] = useState<TaskListViewId>(defaultView)
  const categories = listStudyTaskCategories()
  const taskCount = openTasks + completedTasks
  const completedRatio = taskCount > 0 ? Math.round((completedTasks / taskCount) * 100) : 0

  const nowMs = Date.now()
  const tasksByView = useMemo(() => {
    const projected = {} as Record<TaskListViewId, StudyTask[]>
    for (const tab of TASK_LIST_VIEWS) {
      projected[tab.id] = projectStudyTasksForView({
        view: tab.id,
        tasks,
        activeTimer,
        nowMs
      })
    }
    return projected
  }, [tasks, activeTimer, nowMs])
  const visibleTasks = tasksByView[view]

  const emptyLabel = emptyLabelForTaskListView(view)

  const inboxTaskIds = useMemo(
    () =>
      tasks
        .filter((t) => !(typeof t.categoryId === 'string' && t.categoryId.trim().length > 0))
        .map((t) => t.id),
    [tasks]
  )


  return (
    <section className={`workbench-disclosure-card workbench-task-card${open ? ' is-open' : ''}${isClosing ? ' is-closing' : ''}`} aria-label="任务清单">
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
              <button
                ref={analyticsButtonRef}
                type="button"
                className="workbench-task-analytics-button"
                onClick={onOpenAnalytics}
                aria-label="打开学习分析"
                title="学习分析"
              >
                <ChartColumn size={14} strokeWidth={2.1} aria-hidden="true" />
                <span>学习分析</span>
              </button>
              <div className="workbench-task-actions">
                {onOpenBatchClassify && inboxTaskIds.length > 0 ? (
                  <button
                    type="button"
                    className="workbench-task-batch-classify-button"
                    onClick={() => {
                      if (inboxTaskIds.length > 0) onOpenBatchClassify(inboxTaskIds)
                    }}
                    aria-label={`批量归类（${inboxTaskIds.length}）`}
                    title="批量归类待归类任务"
                  >
                    <Tags size={14} aria-hidden="true" />
                    <span>归类</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="workbench-task-add-button"
                  onClick={onOpenAddTask}
                  aria-label="添加任务"
                  title="添加任务"
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
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
              <div className="workbench-task-progress-track" aria-hidden="true">
                <span style={{ width: `${completedRatio}%` }} />
              </div>
              <div className="workbench-task-progress-meta">
                <span>{completedTasks} 已完成</span>
                <span>{openTasks} 待完成</span>
              </div>
            </div>

            <div className="workbench-task-view-tabs" role="tablist" aria-label="任务视图">
              {TASK_LIST_VIEWS.map((tab) => {
                const selected = view === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`workbench-task-tab-${tab.id}`}
                    aria-selected={selected}
                    aria-controls="workbench-task-list"
                    className={`workbench-task-view-tab${selected ? ' is-active' : ''}`}
                    onClick={() => setView(tab.id)}
                  >
                    {tab.label} ({tasksByView[tab.id].length})
                  </button>
                )
              })}
            </div>


            <div
              id="workbench-task-list"
              className="workbench-task-list"
              role="tabpanel"
              aria-labelledby={`workbench-task-tab-${view}`}
              aria-label={TASK_LIST_VIEWS.find((t) => t.id === view)?.ariaLabel ?? '任务列表'}
            >
              {visibleTasks.length === 0 ? (
                <div className="workbench-task-empty">
                  <CheckCircle2 size={17} />
                  <span>{emptyLabel}</span>
                </div>
              ) : visibleTasks.map((task) => {
                const scheduleLabel = formatTaskSchedule(task)
                const category = resolveStudyTaskCategory(task.categoryId, categories)
                  ?? resolveStudyTaskCategory('study', categories)
                const categoryStyle: CategoryBadgeStyle | undefined = category
                  ? {
                      '--task-category-color': category.color,
                      '--task-category-ink': getReadableCategoryInk(category.color)
                    }
                  : undefined
                const isFocusTask = selectedTaskId === task.id
                return (
                  <div
                    key={task.id}
                    className={`workbench-task-row${task.done ? ' is-done' : ''}${isFocusTask ? ' is-focus-task' : ''}`}
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
                      {scheduleLabel ? <small className="workbench-task-schedule">{scheduleLabel}</small> : null}
                    </button>
                    {onSelectTask && !task.done ? (
                      <button
                        type="button"
                        className={`workbench-task-focus${isFocusTask ? ' is-active' : ''}`}
                        onClick={() => onSelectTask(isFocusTask ? null : task.id)}
                        aria-pressed={isFocusTask}
                        aria-label={isFocusTask ? `取消专注任务：${task.title}` : `设为专注任务：${task.title}`}
                        title={isFocusTask ? '取消专注' : '设为专注'}
                      >
                        <Target size={13} aria-hidden="true" />
                      </button>
                    ) : null}
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
          任务清单
        </span>
        <span className="workbench-disclosure-meta workbench-task-toggle-meta">
          <strong>{openTasks} 待办</strong>
          <ChevronUp className="workbench-disclosure-chevron" size={15} aria-hidden="true" />
        </span>
      </button>
    </section>
  )
}
