/**
 * Adapter: V1 StudyTask list -> projectTaskTimeline views -> ordered StudyTask rows.
 *
 * Peel from WorkbenchTasks so the page stays thin (ADR-0075 / cutover policy).
 * Uses pure projectTaskTimeline (STC-302); does not write store.
 */
import {
  monFirstScheduleToIntervalMs,
  projectTaskTimeline,
  type PlanningTask,
  type ScheduleBlock,
  type TaskTimelineViewId,
  type TimerSessionRecord
} from '../../../shared/study-planning'
import type { StudyTask, StudyTaskSchedule } from './types'

export type TaskListViewId = TaskTimelineViewId

export const TASK_LIST_VIEWS: readonly {
  id: TaskListViewId
  label: string
  ariaLabel: string
}[] = [
  { id: 'now', label: '现在', ariaLabel: '现在进行的任务' },
  { id: 'today', label: '今日', ariaLabel: '今日任务' },
  { id: 'inbox', label: '待归类', ariaLabel: '待归类任务' },
  { id: 'all', label: '全部', ariaLabel: '全部任务' },
  { id: 'done', label: '已完成', ariaLabel: '已完成任务' }
] as const

export function isTaskListViewId(value: unknown): value is TaskListViewId {
  return (
    value === 'now' ||
    value === 'today' ||
    value === 'inbox' ||
    value === 'all' ||
    value === 'done'
  )
}

/** Local calendar day [start, end) for timeline day window. */
export function resolveLocalDayBounds(nowMs: number = Date.now()): {
  dayStartMs: number
  dayEndMs: number
} {
  const now = new Date(nowMs)
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayStartMs = dayStart.getTime()
  return { dayStartMs, dayEndMs: dayStartMs + 24 * 60 * 60_000 }
}

/**
 * Sunday-start local week anchor (midnight), same convention as dual-write schedule.
 */
export function resolveLocalWeekAnchorMidnightMs(nowMs: number = Date.now()): number {
  const now = new Date(nowMs)
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekAnchor = new Date(localMidnight)
  weekAnchor.setDate(localMidnight.getDate() - localMidnight.getDay())
  return weekAnchor.getTime()
}

/**
 * Map V1 StudyTask -> PlanningTask for timeline filter/sort only.
 * Missing categoryId -> inbox (freeze #2 projection).
 */
export function studyTaskToPlanningTask(task: StudyTask): PlanningTask {
  const hasCategory = typeof task.categoryId === 'string' && task.categoryId.trim().length > 0
  return {
    id: task.id,
    title: task.title,
    status: task.done ? 'done' : 'open',
    categoryId: hasCategory ? task.categoryId!.trim() : null,
    inbox: !hasCategory,
    estimateMinutes: null,
    remainingEstimateMinutes: null,
    splittable: true,
    revision: 1,
    source: 'manual'
  }
}

/**
 * Materialize V1 embedded schedule (Mon-first) as a focus ScheduleBlock for projection.
 */
export function studyTaskScheduleToBlock(
  taskId: string,
  schedule: StudyTaskSchedule,
  weekAnchorMidnightMs: number
): ScheduleBlock | null {
  const interval = monFirstScheduleToIntervalMs({
    weekday: schedule.weekday,
    startMinutes: schedule.startMinutes,
    endMinutes: schedule.endMinutes,
    weekAnchorMidnightMs
  })
  if (!interval) return null
  return {
    id: `block:${taskId}:v1`,
    taskId,
    kind: 'focus',
    startAtMs: interval.startAtMs,
    endAtMs: interval.endAtMs,
    locked: false,
    source: 'manual',
    status: 'planned',
    revision: 1
  }
}

export function studyTasksToScheduleBlocks(
  tasks: readonly StudyTask[],
  weekAnchorMidnightMs: number
): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = []
  for (const task of tasks) {
    if (!task.schedule) continue
    const block = studyTaskScheduleToBlock(task.id, task.schedule, weekAnchorMidnightMs)
    if (block) blocks.push(block)
  }
  return blocks
}

/** Minimal session hint for "now" view (running/paused focus on a task). */
export type ActiveTimerHint = {
  taskId: string
  state: 'running' | 'paused'
}

export type ProjectStudyTasksForViewInput = {
  view: TaskListViewId
  tasks: readonly StudyTask[]
  /** Optional canonical blocks; when omitted, V1 embedded schedules are materialized. */
  scheduleBlocks?: readonly ScheduleBlock[]
  nowMs?: number
  weekAnchorMidnightMs?: number
  /** Optional active timer for "now" view (V1 still owns the UI clock). */
  activeTimer?: ActiveTimerHint | null
}

function toProjectionSessions(
  activeTimer: ActiveTimerHint | null | undefined
): TimerSessionRecord[] {
  if (!activeTimer) return []
  return [
    {
      id: 'adapter-active',
      taskId: activeTimer.taskId,
      scheduleBlockId: null,
      phase: 'focus',
      clockMode: 'countdown',
      state: activeTimer.state,
      targetSeconds: null,
      startedAtMs: 0,
      lastSampleWallMs: 0,
      accumulatedActiveSeconds: 0,
      accumulatedFocusSeconds: 0,
      planSnapshot: null,
      attributionReason: 'explicit',
      focusRoundInPlan: 1
    }
  ]
}

/**
 * Filter + order V1 tasks for a timeline view. Preserves original StudyTask objects
 * (identity by id); only the displayed sequence changes.
 */
export function projectStudyTasksForView(input: ProjectStudyTasksForViewInput): StudyTask[] {
  const nowMs = input.nowMs ?? Date.now()
  const { dayStartMs, dayEndMs } = resolveLocalDayBounds(nowMs)
  const weekAnchor =
    input.weekAnchorMidnightMs ?? resolveLocalWeekAnchorMidnightMs(nowMs)

  const planningTasks = input.tasks.map((t) => studyTaskToPlanningTask(t))
  const byId = new Map(input.tasks.map((t) => [t.id, t]))

  const scheduleBlocks =
    input.scheduleBlocks !== undefined
      ? [...input.scheduleBlocks]
      : studyTasksToScheduleBlocks(input.tasks, weekAnchor)

  const items = projectTaskTimeline({
    view: input.view,
    tasks: planningTasks,
    scheduleBlocks,
    timerSessions: toProjectionSessions(input.activeTimer),
    dayStartMs,
    dayEndMs,
    nowMs
  })

  const ordered: StudyTask[] = []
  for (const item of items) {
    const original = byId.get(item.task.id)
    if (original) ordered.push(original)
  }
  return ordered
}

/** Empty-state copy per view (UI). */
export function emptyLabelForTaskListView(view: TaskListViewId): string {
  switch (view) {
    case 'now':
      return '此刻没有进行中的任务'
    case 'today':
      return '今日暂无任务'
    case 'inbox':
      return '没有待归类任务'
    case 'done':
      return '还没有已完成任务'
    case 'all':
    default:
      return '清单为空'
  }
}
