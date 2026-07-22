/**
 * Multi-block ScheduleBlock dual-write (STC-307 remainder).
 *
 * Pure command builders + dual-write for create/delete of focus blocks without
 * fattening useStudySession or cloning Task rows. V1.task.schedule stays a
 * rebuildable primary-block cache only.
 */
import type { ScheduleBlock } from '../../../shared/study-planning'
import type { StudyPlanningCommandEnvelope } from '../../../shared/study-planning'
import {
  applyStudyPlanningCommand,
  readStudyPlanningSnapshot
} from './planning-client'
import {
  dualWriteUpsertScheduleFromV1,
  type CanonicalPlanningContext,
  type DualWriteResult
} from './planning-dual-write'
import {
  buildFocusScheduleBlockFromV1,
  defaultV1ScheduleBlockId,
  listActiveFocusBlocksForTask
} from './planning-schedule-block-adapter'
import {
  pickPrimaryScheduleBlockForTask,
  scheduleBlockToV1Schedule
} from './planning-hydrate'
import type { StudyTaskSchedule } from './types'

export type CreateFocusBlockInput = {
  taskId: string
  schedule: StudyTaskSchedule
  weekAnchorMidnightMs: number
  /** Stable new id; default block:${taskId}:${epoch} */
  blockId?: string
}

export type DeleteFocusBlockInput = {
  blockId: string
}

/**
 * Stable id for a newly created focus block (not the primary :v1 cache id).
 */
export function allocateFocusBlockId(taskId: string, nowMs: number = Date.now()): string {
  const safeTask = taskId.trim() || 'task'
  return `block:${safeTask}:${nowMs}`
}

export function buildDeleteScheduleBlockCommand(
  blockId: string,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'delete_schedule_block',
    payload: { blockId },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

/**
 * Create an additional focus ScheduleBlock for a task (does not move primary).
 * Uses preferExistingPrimary:false so an explicit new id is always written.
 */
export async function dualWriteCreateFocusBlock(
  ctx: CanonicalPlanningContext,
  input: CreateFocusBlockInput
): Promise<DualWriteResult & { blockId?: string }> {
  const nowMs = ctx.nowMs?.() ?? Date.now()
  const blockId =
    (typeof input.blockId === 'string' && input.blockId.trim())
      ? input.blockId.trim()
      : allocateFocusBlockId(input.taskId, nowMs)

  const result = await dualWriteUpsertScheduleFromV1(ctx, {
    taskId: input.taskId,
    schedule: input.schedule,
    weekAnchorMidnightMs: input.weekAnchorMidnightMs,
    blockId,
    preferExistingPrimary: false
  })
  return { ...result, blockId }
}

/**
 * Delete one ScheduleBlock by id. Fail-closed without workspace.
 * Does not mutate V1 tasks — caller refreshes primary cache from next snapshot.
 */
export async function dualWriteDeleteScheduleBlock(
  ctx: CanonicalPlanningContext,
  input: DeleteFocusBlockInput
): Promise<DualWriteResult> {
  const root = typeof ctx.workspaceRoot === 'string' ? ctx.workspaceRoot.trim() : ''
  if (!root || !ctx.api) {
    return {
      kind: 'canonical_skipped',
      reason: !root ? 'missing_workspace' : 'api_unavailable'
    }
  }
  const nowMs = ctx.nowMs ?? (() => Date.now())
  const blockId = input.blockId.trim()
  if (!blockId) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'blockId required' }
      }
    }
  }

  const read = await readStudyPlanningSnapshot(ctx.api, root)
  if (!read.ok) {
    return {
      kind: 'canonical_failed',
      result: { ok: false, revision: 0, error: { code: read.code, message: read.message } }
    }
  }

  const result = await applyStudyPlanningCommand(
    ctx.api,
    root,
    read.snapshot.revision,
    buildDeleteScheduleBlockCommand(blockId, `delete_block:${blockId}:${nowMs()}`, nowMs())
  )
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

/**
 * After delete/create, recompute V1 primary schedule cache for a task.
 * Returns null when no active focus blocks remain.
 */
export function recomputePrimaryV1Schedule(
  blocks: readonly ScheduleBlock[],
  taskId: string,
  nowMs: number
): StudyTaskSchedule | null {
  const primary = pickPrimaryScheduleBlockForTask(blocks, taskId, nowMs)
  if (!primary) return null
  return scheduleBlockToV1Schedule(primary)
}

/**
 * Pure: should V1.task.schedule be cleared after deleting this block?
 * True when the deleted block was the only active focus block, or was primary
 * and no other focus blocks remain that reverse to V1.
 */
export function shouldClearV1ScheduleAfterDelete(input: {
  blocksBefore: readonly ScheduleBlock[]
  deletedBlockId: string
  taskId: string
  nowMs: number
}): boolean {
  const remaining = input.blocksBefore.filter((b) => b.id !== input.deletedBlockId)
  return listActiveFocusBlocksForTask(remaining, input.taskId).length === 0
}

/**
 * Pure optimistic local block list after delete.
 */
export function removeBlockFromLocalCache(
  blocks: readonly ScheduleBlock[],
  blockId: string
): ScheduleBlock[] {
  return blocks.filter((b) => b.id !== blockId)
}

/**
 * Pure optimistic local block list after create/upsert of one focus block.
 */
export function upsertBlockInLocalCache(
  blocks: readonly ScheduleBlock[],
  block: ScheduleBlock
): ScheduleBlock[] {
  const without = blocks.filter((b) => b.id !== block.id)
  return [...without, block]
}

export {
  buildFocusScheduleBlockFromV1,
  defaultV1ScheduleBlockId,
  listActiveFocusBlocksForTask
}
