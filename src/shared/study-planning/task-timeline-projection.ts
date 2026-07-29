/**
 * Task timeline projections (Phase 3 / STC-302..305 pure).
 * Sorting is a projection — never mutates manualOrder authority (invariant #13).
 */

import type { PlanningTask } from './schedule-block'
import type { ScheduleBlock } from './schedule-block'
import type { TimerSessionRecord } from './timer-session-lifecycle'

export type TaskTimelineViewId = 'today' | 'unfinished' | 'all'

export type TaskTimelineItem = {
  task: PlanningTask
  /** Blocks for this task in the projection window (may be empty). */
  blocks: ScheduleBlock[]
  /** Next future focus block start, if any. */
  nextBlockStartAtMs: number | null
  /** Sum of focus block planned seconds. */
  plannedFocusSeconds: number
  actualFocusSeconds: number
  /** Preserved manual order from task list index or explicit field. */
  manualOrder: number
}

export type ProjectTaskTimelineInput = {
  view: TaskTimelineViewId
  tasks: readonly PlanningTask[]
  scheduleBlocks: readonly ScheduleBlock[]
  timerSessions?: readonly TimerSessionRecord[]
  /** Local day [start, end) in epoch ms. */
  dayStartMs: number
  dayEndMs: number
  nowMs: number
}

function focusSeconds(block: ScheduleBlock): number {
  if (block.kind !== 'focus' || block.status === 'cancelled') return 0
  return Math.max(0, Math.floor((block.endAtMs - block.startAtMs) / 1000))
}

function actualFocusForTask(taskId: string, sessions: readonly TimerSessionRecord[]): number {
  let sum = 0
  for (const s of sessions) {
    if (s.taskId === taskId && s.phase === 'focus') sum += s.accumulatedFocusSeconds
  }
  return sum
}

/**
 * Project tasks for a view. `manualOrder` is source order of `tasks` array (authority).
 * The primary list surfaces only today, unfinished, and all tasks; inbox remains a
 * classification attribute rather than its own destination.
 */
export function projectTaskTimeline(input: ProjectTaskTimelineInput): TaskTimelineItem[] {
  const sessions = input.timerSessions ?? []
  const blocksByTask = new Map<string, ScheduleBlock[]>()
  for (const block of input.scheduleBlocks) {
    if (!block.taskId) continue
    const list = blocksByTask.get(block.taskId) ?? []
    list.push(block)
    blocksByTask.set(block.taskId, list)
  }

  const items: TaskTimelineItem[] = []
  input.tasks.forEach((task, index) => {
    const blocks = (blocksByTask.get(task.id) ?? []).slice().sort((a, b) => a.startAtMs - b.startAtMs)
    const future = blocks.filter((b) => b.endAtMs > input.nowMs && b.status !== 'cancelled')
    const nextBlockStartAtMs = future[0]?.startAtMs ?? null
    const plannedFocusSeconds = blocks.reduce((acc, b) => acc + focusSeconds(b), 0)
    const actualFocusSeconds = actualFocusForTask(task.id, sessions)

    items.push({
      task,
      blocks,
      nextBlockStartAtMs,
      plannedFocusSeconds,
      actualFocusSeconds,
      manualOrder: index
    })
  })

  const filtered = items.filter((item) => {
    switch (input.view) {
      case 'unfinished':
        return item.task.status === 'open'
      case 'all':
        return item.task.status !== 'cancelled'
      case 'today': {
        if (item.task.status !== 'open') return false
        const isDueTodayOrOverdue =
          item.task.dueAtMs != null && item.task.dueAtMs < input.dayEndMs
        const hasScheduledBlockToday = item.blocks.some(
          (block) =>
            block.status !== 'cancelled' &&
            block.startAtMs < input.dayEndMs &&
            block.endAtMs > input.dayStartMs
        )
        return isDueTodayOrOverdue || hasScheduledBlockToday
      }
    }
  })

  return filtered.slice().sort((a, b) => compareTaskTimelineItems(a, b, input))
}

function compareTaskTimelineItems(
  a: TaskTimelineItem,
  b: TaskTimelineItem,
  input: Pick<ProjectTaskTimelineInput, 'view' | 'dayStartMs' | 'dayEndMs' | 'nowMs'>
): number {
  if (input.view === 'all') {
    const aIsOpen = a.task.status === 'open'
    const bIsOpen = b.task.status === 'open'
    if (aIsOpen !== bIsOpen) return aIsOpen ? -1 : 1
  }

  const aUrgency = taskUrgency(a, input)
  const bUrgency = taskUrgency(b, input)
  if (aUrgency.bucket !== bUrgency.bucket) return aUrgency.bucket - bUrgency.bucket
  if (aUrgency.timeMs !== bUrgency.timeMs) return aUrgency.timeMs - bUrgency.timeMs
  return a.manualOrder - b.manualOrder
}

type TaskUrgency = { bucket: number; timeMs: number }

/** Priority: overdue → today → scheduled/due later → no date. */
function taskUrgency(
  item: TaskTimelineItem,
  input: Pick<ProjectTaskTimelineInput, 'dayStartMs' | 'dayEndMs' | 'nowMs'>
): TaskUrgency {
  const dueAtMs = item.task.dueAtMs
  if (dueAtMs != null) {
    if (dueAtMs < input.nowMs) return { bucket: 0, timeMs: dueAtMs }
    if (dueAtMs < input.dayEndMs) return { bucket: 1, timeMs: dueAtMs }
    return { bucket: 2, timeMs: dueAtMs }
  }

  const todayBlockStarts = item.blocks
    .filter(
      (block) =>
        block.status !== 'cancelled' &&
        block.startAtMs < input.dayEndMs &&
        block.endAtMs > input.dayStartMs
    )
    .map((block) => block.startAtMs)
  if (todayBlockStarts.length > 0) {
    return { bucket: 1, timeMs: Math.min(...todayBlockStarts) }
  }

  const futureBlockStarts = item.blocks
    .filter((block) => block.status !== 'cancelled' && block.endAtMs > input.nowMs)
    .map((block) => block.startAtMs)
  if (futureBlockStarts.length > 0) {
    return { bucket: 2, timeMs: Math.min(...futureBlockStarts) }
  }

  return { bucket: 3, timeMs: Number.MAX_SAFE_INTEGER }
}

export type FutureBlocksDecision = 'cancel_blocks' | 'keep_as_review' | 'reassign'

export type CompleteTaskWithFutureBlocksResult = {
  task: PlanningTask
  scheduleBlocks: ScheduleBlock[]
  /** Always true when future blocks exist — UI must ask (freeze #7). */
  requiresDecision: boolean
  futureBlockIds: string[]
}

/**
 * Pure complete-task + future block handling. Does not invent a default when
 * future blocks exist unless `decision` is provided.
 */
export function applyCompleteTaskFutureBlocks(input: {
  task: PlanningTask
  scheduleBlocks: readonly ScheduleBlock[]
  nowMs: number
  decision?: FutureBlocksDecision
  /** When reassign: target task id for future focus blocks. */
  reassignTaskId?: string | null
}): CompleteTaskWithFutureBlocksResult {
  const future = input.scheduleBlocks.filter(
    (b) =>
      b.taskId === input.task.id &&
      b.startAtMs > input.nowMs &&
      b.status !== 'cancelled' &&
      b.status !== 'completed'
  )
  const futureBlockIds = future.map((b) => b.id)
  const completedTask: PlanningTask = {
    ...input.task,
    status: 'done',
    revision: input.task.revision + 1
  }

  if (future.length === 0) {
    return {
      task: completedTask,
      scheduleBlocks: [...input.scheduleBlocks],
      requiresDecision: false,
      futureBlockIds: []
    }
  }

  if (!input.decision) {
    return {
      task: completedTask,
      scheduleBlocks: [...input.scheduleBlocks],
      requiresDecision: true,
      futureBlockIds
    }
  }

  const nextBlocks = input.scheduleBlocks.map((block) => {
    if (!futureBlockIds.includes(block.id)) return block
    if (input.decision === 'cancel_blocks') {
      return { ...block, status: 'cancelled' as const, revision: block.revision + 1 }
    }
    if (input.decision === 'keep_as_review') {
      // Keep planned; task is done — block remains for review (status planned).
      return block
    }
    // reassign
    return {
      ...block,
      taskId: input.reassignTaskId ?? null,
      revision: block.revision + 1
    }
  })

  return {
    task: completedTask,
    scheduleBlocks: nextBlocks,
    requiresDecision: false,
    futureBlockIds
  }
}

export type ReopenTaskResult = {
  task: PlanningTask
  /** True when status transitioned (done|cancelled → open). */
  changed: boolean
}

/**
 * Pure reopen: done or cancelled → open (product toggle done→open).
 * Idempotent when already open (no revision bump).
 * Does not invent schedule blocks or clear history TimerSession refs.
 */
export function applyReopenTask(input: {
  task: PlanningTask
}): ReopenTaskResult {
  if (input.task.status === 'open') {
    return { task: input.task, changed: false }
  }
  return {
    task: {
      ...input.task,
      status: 'open',
      revision: input.task.revision + 1
    },
    changed: true
  }
}

export type DeleteTaskWithFutureBlocksResult = {
  task: PlanningTask
  scheduleBlocks: ScheduleBlock[]
  /** True when future blocks exist and no decision was provided — UI must ask (§7.3). */
  requiresDecision: boolean
  futureBlockIds: string[]
}

/**
 * Pure delete-task + future block handling (roadmap §7.3).
 * Marks task `cancelled` (not hard-deleted) so TimerSession history can keep taskId refs.
 * Does not invent a default for future blocks unless `decision` is provided.
 */
export function applyDeleteTaskFutureBlocks(input: {
  task: PlanningTask
  scheduleBlocks: readonly ScheduleBlock[]
  nowMs: number
  decision?: FutureBlocksDecision
  reassignTaskId?: string | null
}): DeleteTaskWithFutureBlocksResult {
  const future = input.scheduleBlocks.filter(
    (b) =>
      b.taskId === input.task.id &&
      b.startAtMs > input.nowMs &&
      b.status !== 'cancelled' &&
      b.status !== 'completed'
  )
  const futureBlockIds = future.map((b) => b.id)
  // Idempotent: already-cancelled keeps cancelled; bump revision only when transitioning.
  const nextStatus: PlanningTask['status'] = 'cancelled'
  const cancelledTask: PlanningTask = {
    ...input.task,
    status: nextStatus,
    revision:
      input.task.status === 'cancelled' ? input.task.revision : input.task.revision + 1
  }

  if (future.length === 0) {
    return {
      task: cancelledTask,
      scheduleBlocks: [...input.scheduleBlocks],
      requiresDecision: false,
      futureBlockIds: []
    }
  }

  if (!input.decision) {
    return {
      task: cancelledTask,
      scheduleBlocks: [...input.scheduleBlocks],
      requiresDecision: true,
      futureBlockIds
    }
  }

  const nextBlocks = input.scheduleBlocks.map((block) => {
    if (!futureBlockIds.includes(block.id)) return block
    if (input.decision === 'cancel_blocks') {
      return { ...block, status: 'cancelled' as const, revision: block.revision + 1 }
    }
    if (input.decision === 'keep_as_review') {
      // Keep planned on cancelled task for review (parity with complete keep_as_review).
      return block
    }
    // reassign
    return {
      ...block,
      taskId: input.reassignTaskId ?? null,
      revision: block.revision + 1
    }
  })

  return {
    task: cancelledTask,
    scheduleBlocks: nextBlocks,
    requiresDecision: false,
    futureBlockIds
  }
}

/** Diff helper for schedule block sets (pure). Historical STC-308 allocation confirm UI removed 2026-07-22. */
export function diffScheduleBlocks(
  current: readonly ScheduleBlock[],
  proposed: readonly ScheduleBlock[]
): {
  added: ScheduleBlock[]
  removed: ScheduleBlock[]
  unchanged: ScheduleBlock[]
} {
  const curIds = new Set(current.map((b) => b.id))
  const propIds = new Set(proposed.map((b) => b.id))
  const added = proposed.filter((b) => !curIds.has(b.id))
  const removed = current.filter((b) => !propIds.has(b.id))
  const unchanged = proposed.filter((b) => curIds.has(b.id))
  return { added, removed, unchanged }
}
