/**
 * Task timeline projections (Phase 3 / STC-302..305 pure).
 * Sorting is a projection — never mutates manualOrder authority (invariant #13).
 */

import type { PlanningTask } from './schedule-block'
import type { ScheduleBlock } from './schedule-block'
import type { TimerSessionRecord } from './timer-session-lifecycle'

export type TaskTimelineViewId = 'now' | 'today' | 'inbox' | 'all' | 'done'

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
  if (block.kind !== 'focus') return 0
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
 * "today" sorts by next block time for display only.
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
      case 'inbox':
        return item.task.inbox === true && item.task.status !== 'cancelled'
      case 'done':
        return item.task.status === 'done'
      case 'all':
        return item.task.status !== 'cancelled'
      case 'now': {
        if (item.task.status !== 'open') return false
        // In progress session or block overlapping now
        const inSession = sessions.some(
          (s) => s.taskId === item.task.id && (s.state === 'running' || s.state === 'paused')
        )
        if (inSession) return true
        return item.blocks.some(
          (b) => b.startAtMs <= input.nowMs && input.nowMs < b.endAtMs && b.status !== 'cancelled'
        )
      }
      case 'today': {
        if (item.task.status === 'cancelled') return false
        if (item.task.status === 'done') {
          return item.blocks.some(
            (b) => b.startAtMs < input.dayEndMs && b.endAtMs > input.dayStartMs
          )
        }
        // open: has block today OR no schedule (inbox-style carry)
        const hasToday = item.blocks.some(
          (b) => b.startAtMs < input.dayEndMs && b.endAtMs > input.dayStartMs
        )
        return hasToday || item.blocks.length === 0
      }
      default:
        return true
    }
  })

  if (input.view === 'today' || input.view === 'now') {
    return filtered.slice().sort((a, b) => {
      const aKey = a.nextBlockStartAtMs ?? Number.POSITIVE_INFINITY
      const bKey = b.nextBlockStartAtMs ?? Number.POSITIVE_INFINITY
      if (aKey !== bKey) return aKey - bKey
      return a.manualOrder - b.manualOrder
    })
  }

  // all / inbox / done: preserve manual order
  return filtered.slice().sort((a, b) => a.manualOrder - b.manualOrder)
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
