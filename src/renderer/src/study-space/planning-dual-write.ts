/**
 * Dual-write helpers: keep V1 StudySnapshot UI projection while publishing
 * task mutations to workspace-canonical StudyPlanningStore (ADR-0117 cutover).
 *
 * Canonical is authority when workspaceRoot + TeachingSystemApi are available.
 * localStorage remains the UI cache during partial cutover (not teaching authority).
 */

import {
  applyStudyPlanningCommand,
  buildCompleteTaskCommand,
  buildCreateTaskCommand,
  createPlanningTask,
  completePlanningTask,
  readStudyPlanningSnapshot,
  type PlanningClientApplyResult,
  type StudyPlanningApi
} from './planning-client'
import { monFirstScheduleToIntervalMs } from '../../../shared/study-planning'
import type { ScheduleBlock } from '../../../shared/study-planning'
import type { StudyTaskSchedule } from './types'

export type CanonicalPlanningContext = {
  api: StudyPlanningApi | null | undefined
  workspaceRoot: string | null | undefined
  nowMs?: () => number
}

export type DualWriteResult =
  | { kind: 'canonical_ok'; result: Extract<PlanningClientApplyResult, { ok: true }> }
  | { kind: 'canonical_skipped'; reason: 'missing_workspace' | 'api_unavailable' }
  | { kind: 'canonical_failed'; result: Extract<PlanningClientApplyResult, { ok: false }> }

function hasCanonicalContext(ctx: CanonicalPlanningContext): boolean {
  const root = typeof ctx.workspaceRoot === 'string' ? ctx.workspaceRoot.trim() : ''
  if (!root) return false
  if (!ctx.api) return false
  if (typeof ctx.api.readStudyPlanning !== 'function') return false
  if (typeof ctx.api.applyStudyPlanning !== 'function') return false
  return true
}

/**
 * Publish create_task to canonical. Shared id with V1 so list/detail stay aligned.
 */
export async function dualWriteCreateTask(
  ctx: CanonicalPlanningContext,
  input: {
    id: string
    title: string
    categoryId?: string | null
    source?: 'manual' | 'quick_start'
  }
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) {
    return {
      kind: 'canonical_skipped',
      reason: !ctx.workspaceRoot?.trim() ? 'missing_workspace' : 'api_unavailable'
    }
  }
  const result = await createPlanningTask(ctx.api, ctx.workspaceRoot, {
    id: input.id,
    title: input.title,
    categoryId: input.categoryId ?? null,
    source: input.source ?? 'manual'
  }, { nowMs: ctx.nowMs })
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

/**
 * Publish complete_task when V1 marks done=true.
 * reopen (done→open) is not yet a store command; skip canonical for that direction.
 */
export async function dualWriteCompleteTask(
  ctx: CanonicalPlanningContext,
  taskId: string,
  options?: {
    futureBlocksDecision?: 'cancel' | 'keep_review' | 'reassign' | 'cancel_blocks' | 'keep_as_review'
    reassignTaskId?: string | null
  }
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) {
    return {
      kind: 'canonical_skipped',
      reason: !ctx.workspaceRoot?.trim() ? 'missing_workspace' : 'api_unavailable'
    }
  }
  const result = await completePlanningTask(
    ctx.api,
    ctx.workspaceRoot,
    {
      id: taskId,
      ...(options?.futureBlocksDecision
        ? {
            futureBlocksDecision:
              options.futureBlocksDecision === 'cancel_blocks'
                ? 'cancel'
                : options.futureBlocksDecision === 'keep_as_review'
                  ? 'keep_review'
                  : options.futureBlocksDecision === 'reassign'
                    ? 'reassign'
                    : options.futureBlocksDecision
          }
        : {}),
      ...(options?.reassignTaskId !== undefined ? { reassignTaskId: options.reassignTaskId } : {})
    },
    { nowMs: ctx.nowMs }
  )
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

/**
 * Optional: upsert a focus ScheduleBlock from V1 weekday+minutes schedule.
 * Uses caller's week anchor (local midnight of any day in target week).
 */
export async function dualWriteUpsertScheduleFromV1(
  ctx: CanonicalPlanningContext,
  input: {
    taskId: string
    schedule: StudyTaskSchedule
    weekAnchorMidnightMs: number
    blockId?: string
  }
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) {
    return {
      kind: 'canonical_skipped',
      reason: !ctx.workspaceRoot?.trim() ? 'missing_workspace' : 'api_unavailable'
    }
  }
  // Product V1 schedule is Mon-first (week plan UI); convert at dual-write boundary.
  const interval = monFirstScheduleToIntervalMs({
    weekday: input.schedule.weekday,
    startMinutes: input.schedule.startMinutes,
    endMinutes: input.schedule.endMinutes,
    weekAnchorMidnightMs: input.weekAnchorMidnightMs
  })
  if (!interval) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'invalid V1 schedule for block upsert' }
      }
    }
  }

  const nowMs = ctx.nowMs ?? (() => Date.now())
  const read = await readStudyPlanningSnapshot(ctx.api, ctx.workspaceRoot)
  if (!read.ok) {
    return {
      kind: 'canonical_failed',
      result: { ok: false, revision: 0, error: { code: read.code, message: read.message } }
    }
  }

  const blockId = input.blockId ?? `block:${input.taskId}:v1`
  const block: ScheduleBlock = {
    id: blockId,
    taskId: input.taskId,
    kind: 'focus',
    startAtMs: interval.startAtMs,
    endAtMs: interval.endAtMs,
    locked: false,
    source: 'manual',
    status: 'planned',
    revision: 1
  }

  const result = await applyStudyPlanningCommand(
    ctx.api,
    ctx.workspaceRoot,
    read.snapshot.revision,
    {
      actionId: `upsert_block:${blockId}:${nowMs()}`,
      type: 'upsert_schedule_block',
      payload: { block },
      clientIssuedAtMs: nowMs()
    }
  )
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

/** Re-export builders for tests / callers that need envelopes without dual-write. */
export {
  buildCreateTaskCommand,
  buildCompleteTaskCommand,
  readStudyPlanningSnapshot
}
