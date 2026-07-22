/**
 * Dual-write for V1 updateTask (title/category + schedule) → canonical store.
 *
 * Peel from useStudySession so the session hook stays thin (module-size policy).
 * Schedule uses product Mon-first weekday; dualWriteUpsertScheduleFromV1 converts.
 */
import {
  dualWriteUpsertScheduleFromV1,
  type CanonicalPlanningContext,
  type DualWriteResult
} from './planning-dual-write'
import {
  updatePlanningTask,
  type UpdatePlanningTaskInput
} from './planning-client'
import type { StudyTaskSchedule, StudyTaskUpdateInput } from './types'

export type DualWriteUpdateTaskInput = {
  taskId: string
  update: StudyTaskUpdateInput
  /**
   * Epoch ms for local midnight of any day in the target week.
   * Required when update.schedule is present; if omitted, current local week (Sunday-start anchor) is used.
   */
  weekAnchorMidnightMs?: number
  /** Stable ScheduleBlock id; default block:${taskId}:v1 */
  blockId?: string
}

export type DualWriteUpdateTaskResult = {
  task: DualWriteResult | null
  schedule: DualWriteResult | null
}

function hasTaskFieldUpdates(update: StudyTaskUpdateInput): boolean {
  if (typeof update.title === 'string' && update.title.trim()) return true
  if (update.categoryId !== undefined) return true
  if (update.estimateMinutes !== undefined) return true
  return false
}

/**
 * Build update_task payload from V1 StudyTaskUpdateInput (fields the store accepts).
 * `done` / reopen are not update_task (complete / reopen dual-writes).
 */
export function buildUpdateTaskPayloadFromV1(
  taskId: string,
  update: StudyTaskUpdateInput
): UpdatePlanningTaskInput | null {
  if (!hasTaskFieldUpdates(update)) return null
  const payload: UpdatePlanningTaskInput = { id: taskId }
  if (typeof update.title === 'string') {
    const title = update.title.trim().slice(0, 80)
    if (title) payload.title = title
  }
  if (update.categoryId !== undefined) {
    payload.categoryId = update.categoryId
  }
  if (update.estimateMinutes !== undefined) {
    payload.estimateMinutes = update.estimateMinutes
  }
  // No fields besides id → skip (e.g. title was whitespace-only)
  if (
    payload.title === undefined &&
    payload.categoryId === undefined &&
    payload.estimateMinutes === undefined
  ) {
    return null
  }
  return payload
}

/**
 * Local midnight of "today", then back to Sunday (JS getDay()==0) — same as addScheduledTask.
 * weekAnchor is any day in the target week; Sunday midnight matches v1ScheduleToIntervalMs tests.
 */
export function resolveDefaultWeekAnchorMidnightMs(nowMs: number = Date.now()): number {
  const now = new Date(nowMs)
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = localMidnight.getDay()
  const weekAnchor = new Date(localMidnight)
  weekAnchor.setDate(localMidnight.getDate() - day)
  return weekAnchor.getTime()
}

/**
 * Publish update_task and/or upsert_schedule_block for a V1 task edit / week drag.
 * Fail-closed without workspace; V1 remains UI cache regardless of result.
 */
export async function dualWriteUpdateTask(
  ctx: CanonicalPlanningContext,
  input: DualWriteUpdateTaskInput
): Promise<DualWriteUpdateTaskResult> {
  const out: DualWriteUpdateTaskResult = { task: null, schedule: null }

  const taskPayload = buildUpdateTaskPayloadFromV1(input.taskId, input.update)
  if (taskPayload) {
    const root = typeof ctx.workspaceRoot === 'string' ? ctx.workspaceRoot.trim() : ''
    if (!root || !ctx.api) {
      out.task = {
        kind: 'canonical_skipped',
        reason: !root ? 'missing_workspace' : 'api_unavailable'
      }
    } else {
      const result = await updatePlanningTask(ctx.api, ctx.workspaceRoot, taskPayload, {
        nowMs: ctx.nowMs
      })
      out.task = result.ok
        ? { kind: 'canonical_ok', result }
        : { kind: 'canonical_failed', result }
    }
  }

  if (input.update.schedule) {
    // null means clear V1 primary cache only — no upsert (use delete_schedule_block).
    const schedule: StudyTaskSchedule = input.update.schedule
    const weekAnchor =
      input.weekAnchorMidnightMs ?? resolveDefaultWeekAnchorMidnightMs(ctx.nowMs?.() ?? Date.now())
    out.schedule = await dualWriteUpsertScheduleFromV1(ctx, {
      taskId: input.taskId,
      schedule,
      weekAnchorMidnightMs: weekAnchor,
      ...(input.blockId ? { blockId: input.blockId } : {})
    })
  }

  return out
}
