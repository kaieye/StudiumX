/**
 * Study planning pure domain — allocateTimeWindow (STC-102..107 core).
 *
 * Pure: no I/O, no Date.now side effects (caller supplies timestamps), no writes.
 * Produces AllocationProposal only; user must confirm before any store write (ADR-0094).
 */

import {
  normalizeTimerPlanV2,
  type TimerPlanV2,
  type WindowFillPolicy,
  TIMER_PLAN_SEED_DEFAULTS
} from './timer-plan'

export type ProposedBlockKind = 'focus' | 'short_break' | 'long_break' | 'wrap_up' | 'blank'

export type TimeWindow = {
  /** Epoch milliseconds (caller-local). */
  startAtMs: number
  /** Epoch milliseconds (caller-local). Must be > startAtMs. */
  endAtMs: number
  /** Default true: do not silently cross hard end (except allow_overrun policy). */
  hardEnd: boolean
  label?: string
}

export type AllocatorTask = {
  id: string
  /** Remaining estimate minutes; null/undefined = unknown (freeze #8 default). */
  estimateMinutes?: number | null
  remainingEstimateMinutes?: number | null
  /** Prefer not to invent estimate from plan focus minutes. */
  splittable?: boolean
  minimumBlockMinutes?: number
  priority?: 'low' | 'normal' | 'high'
  dueAtMs?: number | null
  /** Already in progress for prioritization. */
  inProgress?: boolean
  /** Manual list order (lower first). */
  manualOrder?: number
}

export type LockedScheduleBlock = {
  id: string
  taskId: string | null
  kind: ProposedBlockKind
  startAtMs: number
  endAtMs: number
}

export type ProposedBlock = {
  kind: ProposedBlockKind
  startAtMs: number
  endAtMs: number
  taskId?: string | null
  locked?: boolean
  source: 'allocator' | 'locked'
}

export type AllocationProposal = {
  window: TimeWindow
  planSnapshot: TimerPlanV2
  blocks: ProposedBlock[]
  warnings: string[]
  unscheduledTaskIds: string[]
  meta: {
    utilizationRatio: number
    policy: WindowFillPolicy
    focusMinutesTotal: number
    breakMinutesTotal: number
    windowMinutes: number
  }
}

export type AllocateTimeWindowInput = {
  window: TimeWindow
  plan: TimerPlanV2 | unknown
  tasks?: readonly AllocatorTask[]
  lockedBlocks?: readonly LockedScheduleBlock[]
  /** Optional now for prioritization of overdue; pure input. */
  nowMs?: number
}

const MINUTE_MS = 60_000
const PRIORITY_RANK: Record<NonNullable<AllocatorTask['priority']>, number> = {
  high: 0,
  normal: 1,
  low: 2
}

function minutesBetween(startMs: number, endMs: number): number {
  return Math.max(0, Math.round((endMs - startMs) / MINUTE_MS))
}

function addMinutes(startMs: number, minutes: number): number {
  return startMs + minutes * MINUTE_MS
}

function sortByStart<T extends { startAtMs: number; endAtMs: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.startAtMs - b.startAtMs || a.endAtMs - b.endAtMs)
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

function isValidWindow(window: TimeWindow): boolean {
  return (
    Number.isFinite(window.startAtMs) &&
    Number.isFinite(window.endAtMs) &&
    window.endAtMs > window.startAtMs
  )
}

function freeGaps(
  window: TimeWindow,
  locked: readonly LockedScheduleBlock[]
): Array<{ startAtMs: number; endAtMs: number }> {
  const clipped = sortByStart(locked)
    .map((block) => ({
      startAtMs: Math.max(window.startAtMs, block.startAtMs),
      endAtMs: Math.min(window.endAtMs, block.endAtMs)
    }))
    .filter((block) => block.endAtMs > block.startAtMs)

  const gaps: Array<{ startAtMs: number; endAtMs: number }> = []
  let cursor = window.startAtMs
  for (const block of clipped) {
    if (block.startAtMs > cursor) {
      gaps.push({ startAtMs: cursor, endAtMs: block.startAtMs })
    }
    cursor = Math.max(cursor, block.endAtMs)
  }
  if (cursor < window.endAtMs) {
    gaps.push({ startAtMs: cursor, endAtMs: window.endAtMs })
  }
  return gaps
}

function rankTasks(tasks: readonly AllocatorTask[], nowMs: number): AllocatorTask[] {
  return [...tasks].sort((a, b) => {
    if (Boolean(a.inProgress) !== Boolean(b.inProgress)) return a.inProgress ? -1 : 1
    const aOverdue = a.dueAtMs != null && a.dueAtMs < nowMs ? 0 : 1
    const bOverdue = b.dueAtMs != null && b.dueAtMs < nowMs ? 0 : 1
    if (aOverdue !== bOverdue) return aOverdue - bOverdue
    const aDue = a.dueAtMs ?? Number.POSITIVE_INFINITY
    const bDue = b.dueAtMs ?? Number.POSITIVE_INFINITY
    if (aDue !== bDue) return aDue - bDue
    const aPri = PRIORITY_RANK[a.priority ?? 'normal']
    const bPri = PRIORITY_RANK[b.priority ?? 'normal']
    if (aPri !== bPri) return aPri - bPri
    const aHasEst = remainingEstimate(a) != null ? 0 : 1
    const bHasEst = remainingEstimate(b) != null ? 0 : 1
    if (aHasEst !== bHasEst) return aHasEst - bHasEst
    return (a.manualOrder ?? 0) - (b.manualOrder ?? 0) || a.id.localeCompare(b.id)
  })
}

function remainingEstimate(task: AllocatorTask): number | null {
  const raw = task.remainingEstimateMinutes ?? task.estimateMinutes
  if (raw == null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  return Math.trunc(raw)
}

type TaskCursor = {
  task: AllocatorTask
  remaining: number | null
  placedMinutes: number
}

function takeTaskMinutes(
  cursor: TaskCursor | undefined,
  wantMinutes: number,
  minBlock: number
): { taskId: string | null; used: number; exhausted: boolean } {
  if (!cursor) return { taskId: null, used: wantMinutes, exhausted: false }
  const splittable = cursor.task.splittable !== false
  const taskMin = Math.max(1, cursor.task.minimumBlockMinutes ?? minBlock)

  if (cursor.remaining == null) {
    // Unknown estimate: assign full focus segment (freeze #8 does not invent estimate).
    cursor.placedMinutes += wantMinutes
    return { taskId: cursor.task.id, used: wantMinutes, exhausted: false }
  }

  if (cursor.remaining <= 0) {
    return { taskId: null, used: 0, exhausted: true }
  }

  if (!splittable && cursor.remaining > wantMinutes) {
    // Cannot fit non-splittable remainder into this segment.
    return { taskId: null, used: 0, exhausted: false }
  }

  const used = Math.min(wantMinutes, cursor.remaining)
  if (used < taskMin && cursor.remaining >= taskMin) {
    // Prefer keeping minimum block intact when possible.
    return { taskId: null, used: 0, exhausted: false }
  }

  cursor.remaining -= used
  cursor.placedMinutes += used
  return { taskId: cursor.task.id, used, exhausted: cursor.remaining <= 0 }
}

function pushBlock(
  blocks: ProposedBlock[],
  kind: ProposedBlockKind,
  startAtMs: number,
  endAtMs: number,
  taskId: string | null | undefined,
  locked = false
): void {
  if (endAtMs <= startAtMs) return
  blocks.push({
    kind,
    startAtMs,
    endAtMs,
    taskId: taskId ?? null,
    locked,
    source: locked ? 'locked' : 'allocator'
  })
}

function utilization(blocks: readonly ProposedBlock[], windowMinutes: number): {
  utilizationRatio: number
  focusMinutesTotal: number
  breakMinutesTotal: number
} {
  let focus = 0
  let brk = 0
  for (const block of blocks) {
    const mins = minutesBetween(block.startAtMs, block.endAtMs)
    if (block.kind === 'focus') focus += mins
    if (block.kind === 'short_break' || block.kind === 'long_break') brk += mins
  }
  const ratio = windowMinutes > 0 ? Math.min(1, (focus + brk) / windowMinutes) : 0
  return { utilizationRatio: ratio, focusMinutesTotal: focus, breakMinutesTotal: brk }
}

/**
 * Allocate focus/break/wrap/blank blocks into a time window using a TimerPlanV2 snapshot.
 * Deterministic for the same input. Never writes.
 */
export function allocateTimeWindow(input: AllocateTimeWindowInput): AllocationProposal {
  const warnings: string[] = []
  const normalized = normalizeTimerPlanV2(input.plan)
  const plan: TimerPlanV2 = normalized.ok
    ? normalized.plan
    : {
        id: 'invalid_plan',
        name: 'invalid',
        kind: 'pomodoro',
        clockMode: 'countdown',
        focusMinutes: TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes,
        shortBreakMinutes: TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes,
        longBreakMinutes: TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes,
        longBreakEvery: TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery,
        breakPolicy: TIMER_PLAN_SEED_DEFAULTS.pomodoroBreakPolicy,
        windowFillPolicy: TIMER_PLAN_SEED_DEFAULTS.windowFillPolicy,
        minimumFinalFocusMinutes: TIMER_PLAN_SEED_DEFAULTS.minimumFinalFocusMinutes,
        wrapUpMinutes: TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutes,
        notificationPolicy: {
          sound: true,
          systemNotification: true,
          focusEnd: true,
          breakEnd: true
        },
        revision: 1
      }

  if (!normalized.ok) {
    warnings.push('plan_invalid_fallback_seed')
    for (const issue of normalized.issues) warnings.push(`${issue.code}:${issue.message}`)
  } else {
    for (const w of normalized.warnings) warnings.push(`${w.code}:${w.message}`)
  }

  const window = {
    startAtMs: input.window.startAtMs,
    endAtMs: input.window.endAtMs,
    hardEnd: input.window.hardEnd !== false,
    ...(input.window.label ? { label: input.window.label } : {})
  }

  if (!isValidWindow(window)) {
    return {
      window,
      planSnapshot: plan,
      blocks: [],
      warnings: [...warnings, 'window_invalid'],
      unscheduledTaskIds: (input.tasks ?? []).map((t) => t.id),
      meta: {
        utilizationRatio: 0,
        policy: plan.windowFillPolicy,
        focusMinutesTotal: 0,
        breakMinutesTotal: 0,
        windowMinutes: 0
      }
    }
  }

  const windowMinutes = minutesBetween(window.startAtMs, window.endAtMs)
  const lockedAll = sortByStart(input.lockedBlocks ?? [])
  const lockedInWindow = lockedAll.filter((block) =>
    overlaps(block.startAtMs, block.endAtMs, window.startAtMs, window.endAtMs)
  )

  // Overlapping locks → warning; still attempt free-gap fill.
  for (let i = 1; i < lockedInWindow.length; i += 1) {
    const prev = lockedInWindow[i - 1]
    const cur = lockedInWindow[i]
    if (overlaps(prev.startAtMs, prev.endAtMs, cur.startAtMs, cur.endAtMs)) {
      warnings.push(`locked_overlap:${prev.id}:${cur.id}`)
    }
  }

  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : window.startAtMs
  const tasks = rankTasks(input.tasks ?? [], nowMs)
  const taskCursors: TaskCursor[] = tasks.map((task) => ({
    task,
    remaining: remainingEstimate(task),
    placedMinutes: 0
  }))
  let taskIndex = 0

  const advanceTask = (): void => {
    while (taskIndex < taskCursors.length) {
      const cur = taskCursors[taskIndex]
      if (cur.remaining == null || cur.remaining > 0) return
      taskIndex += 1
    }
  }

  const focusMinutes = plan.focusMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes
  const shortBreak = plan.shortBreakMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes
  const longBreak = plan.longBreakMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes
  const longEvery = plan.longBreakEvery ?? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery
  const minFinal = plan.minimumFinalFocusMinutes
  const wrapUp = plan.wrapUpMinutes
  const policy = plan.windowFillPolicy

  if (windowMinutes < Math.min(focusMinutes, minFinal) && lockedInWindow.length === 0) {
    warnings.push('window_too_short_for_focus')
  }

  const blocks: ProposedBlock[] = []
  // Materialize locked blocks first (clipped to window).
  for (const lock of lockedInWindow) {
    const startAtMs = Math.max(window.startAtMs, lock.startAtMs)
    const endAtMs = Math.min(window.endAtMs, lock.endAtMs)
    pushBlock(blocks, lock.kind, startAtMs, endAtMs, lock.taskId, true)
  }

  const gaps = freeGaps(window, lockedInWindow)
  let focusRound = 0

  for (const gap of gaps) {
    let cursor = gap.startAtMs
    const gapEnd = gap.endAtMs

    while (cursor < gapEnd) {
      const remaining = minutesBetween(cursor, gapEnd)
      if (remaining <= 0) break

      // Continuous / non-pomodoro: single focus fill of free gaps.
      if (plan.kind === 'continuous') {
        advanceTask()
        const curTask = taskIndex < taskCursors.length ? taskCursors[taskIndex] : undefined
        const assignment = takeTaskMinutes(curTask, remaining, minFinal)
        if (assignment.taskId) {
          pushBlock(blocks, 'focus', cursor, addMinutes(cursor, assignment.used), assignment.taskId)
          cursor = addMinutes(cursor, assignment.used)
          if (assignment.exhausted) {
            taskIndex += 1
            advanceTask()
          }
        } else {
          // No task fit: blank remainder.
          pushBlock(blocks, 'blank', cursor, gapEnd, null)
          cursor = gapEnd
        }
        continue
      }

      // Pomodoro focus attempt.
      const wantFocus = focusMinutes
      if (remaining >= wantFocus) {
        advanceTask()
        // Skip tasks that cannot fit this segment (non-splittable remainder, min block, etc.).
        let assignment: { taskId: string | null; used: number; exhausted: boolean } = {
          taskId: null,
          used: wantFocus,
          exhausted: false
        }
        let skippedWithoutFit = 0
        while (taskIndex < taskCursors.length) {
          const curTask = taskCursors[taskIndex]
          assignment = takeTaskMinutes(curTask, wantFocus, Math.min(minFinal, wantFocus))
          if (assignment.taskId) break
          if (assignment.exhausted) {
            taskIndex += 1
            advanceTask()
            continue
          }
          // Cannot place this task into wantFocus — try next task (STC-106 non-splittable / min block).
          taskIndex += 1
          skippedWithoutFit += 1
          advanceTask()
          if (skippedWithoutFit > taskCursors.length) break
        }
        const taskId = assignment.taskId
        const used = assignment.taskId ? assignment.used : wantFocus
        // Even without task, place focus as unattributed optional review time? Spec: do not invent fake tasks.
        pushBlock(blocks, 'focus', cursor, addMinutes(cursor, used), taskId)
        cursor = addMinutes(cursor, used)
        focusRound += 1
        if (assignment.exhausted) {
          taskIndex += 1
          advanceTask()
        }

        const afterFocusRemaining = minutesBetween(cursor, gapEnd)
        if (afterFocusRemaining <= 0) break

        const isLong = focusRound % longEvery === 0
        const breakMins = isLong ? longBreak : shortBreak
        const breakKind: ProposedBlockKind = isLong ? 'long_break' : 'short_break'

        if (policy === 'allow_overrun') {
          // Place break even if it overruns hard end when hardEnd is false or policy allows.
          const breakEnd = addMinutes(cursor, breakMins)
          if (breakEnd <= gapEnd || !window.hardEnd) {
            const clippedEnd = window.hardEnd ? Math.min(breakEnd, gapEnd) : breakEnd
            if (clippedEnd > cursor) {
              pushBlock(blocks, breakKind, cursor, clippedEnd, null)
              cursor = clippedEnd
            }
          } else if (afterFocusRemaining > 0) {
            // cannot fit full break inside gap
            warnings.push('break_truncated_in_gap')
          }
        } else if (afterFocusRemaining >= breakMins) {
          // Only schedule break if a subsequent focus could still fit, or leave break before adaptive tail.
          // Place break now; final adaptive logic handles tail after loop per gap.
          pushBlock(blocks, breakKind, cursor, addMinutes(cursor, breakMins), null)
          cursor = addMinutes(cursor, breakMins)
        } else {
          // Not enough room for a full break — keep cursor so the next while iteration
          // applies adaptive/complete_cycles tail policy on the remainder.
          continue
        }
        continue
      }

      // Remaining < full focusMinutes: tail policy.
      if (policy === 'adaptive_final_focus' && remaining >= minFinal) {
        advanceTask()
        const curTask = taskIndex < taskCursors.length ? taskCursors[taskIndex] : undefined
        const assignment = takeTaskMinutes(curTask, remaining, minFinal)
        const taskId = assignment.taskId
        pushBlock(blocks, 'focus', cursor, gapEnd, taskId)
        cursor = gapEnd
        focusRound += 1
        if (assignment.exhausted) {
          taskIndex += 1
          advanceTask()
        }
        break
      }

      if (policy === 'complete_cycles') {
        if (wrapUp > 0 && remaining >= wrapUp) {
          pushBlock(blocks, 'wrap_up', cursor, addMinutes(cursor, wrapUp), null)
          cursor = addMinutes(cursor, wrapUp)
        }
        if (cursor < gapEnd) {
          pushBlock(blocks, 'blank', cursor, gapEnd, null)
          warnings.push('remainder_unused_complete_cycles')
        }
        cursor = gapEnd
        break
      }

      // adaptive but remaining < minFinal → wrap_up or blank
      if (wrapUp > 0 && remaining >= wrapUp) {
        pushBlock(blocks, 'wrap_up', cursor, addMinutes(cursor, Math.min(wrapUp, remaining)), null)
        cursor = addMinutes(cursor, Math.min(wrapUp, remaining))
      }
      if (cursor < gapEnd) {
        pushBlock(blocks, 'blank', cursor, gapEnd, null)
        if (remaining > 0) warnings.push('remainder_below_minimum_final_focus')
      }
      cursor = gapEnd
      break
    }
  }

  // allow_overrun: if last action was a full focus at window end and policy wants break, note overrun.
  if (policy === 'allow_overrun' && window.hardEnd) {
    const last = sortByStart(blocks).at(-1)
    if (last && last.endAtMs > window.endAtMs) {
      warnings.push(`overrun_minutes:${minutesBetween(window.endAtMs, last.endAtMs)}`)
    }
  }

  // Sort output: locked + allocated by time.
  const ordered = sortByStart(blocks)

  // Non-overlap invariant among non-locked allocator blocks (locked may conflict → already warned).
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1]
    const cur = ordered[i]
    if (!prev.locked && !cur.locked && overlaps(prev.startAtMs, prev.endAtMs, cur.startAtMs, cur.endAtMs)) {
      warnings.push(`allocator_overlap:${prev.kind}:${cur.kind}`)
    }
  }

  const unscheduledTaskIds = taskCursors
    .filter((c) => {
      if (c.remaining == null) return c.placedMinutes === 0
      return c.remaining > 0
    })
    .map((c) => c.task.id)

  if (unscheduledTaskIds.length > 0) {
    warnings.push(`unscheduled_tasks:${unscheduledTaskIds.length}`)
  }

  const stats = utilization(ordered, windowMinutes)
  // Hard end default: no block may extend past end unless allow_overrun and !hardEnd already handled.
  if (window.hardEnd) {
    for (const block of ordered) {
      if (block.endAtMs > window.endAtMs + 1) {
        warnings.push(`block_past_hard_end:${block.kind}`)
      }
    }
  }

  return {
    window,
    planSnapshot: plan,
    blocks: ordered,
    warnings,
    unscheduledTaskIds,
    meta: {
      ...stats,
      policy,
      windowMinutes
    }
  }
}

/** Helper: wall-clock local minutes from midnight → ms offset on a fixed epoch day. */
export function msFromLocalMinutes(dayEpochMs: number, minutesFromMidnight: number): number {
  return dayEpochMs + minutesFromMidnight * MINUTE_MS
}

/** Fixed day anchor for deterministic tests (UTC). */
export const ALLOCATOR_TEST_DAY_UTC = Date.UTC(2026, 6, 21, 0, 0, 0, 0)
