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
  reopenPlanningTask,
  readStudyPlanningSnapshot,
  type PlanningClientApplyResult,
  type StudyPlanningApi
} from './planning-client'
import type { ScheduleBlock } from '../../../shared/study-planning'
import type { StudyTaskSchedule } from './types'
import {
  buildFocusScheduleBlockFromV1,
  resolveFocusBlockIdForScheduleUpsert
} from './planning-schedule-block-adapter'

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
 * reopen (done→open) uses dualWriteReopenTask / reopen_task.
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
 * Upsert a focus ScheduleBlock from V1 weekday+minutes schedule.
 * Resolves real block id from canonical (primary / preferred / default :v1)
 * so week-drag does not orphan multi-block / migrated ids (STC-307).
 */
/**
 * Publish reopen_task when V1 marks done=false (done|cancelled → open).
 * Idempotent on already-open tasks via store applyReopenTask.
 */
export async function dualWriteReopenTask(
  ctx: CanonicalPlanningContext,
  taskId: string
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) {
    return {
      kind: 'canonical_skipped',
      reason: !ctx.workspaceRoot?.trim() ? 'missing_workspace' : 'api_unavailable'
    }
  }
  const id = typeof taskId === 'string' ? taskId.trim() : ''
  if (!id) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'reopen_task requires id' }
      }
    }
  }
  const result = await reopenPlanningTask(ctx.api, ctx.workspaceRoot, { id }, { nowMs: ctx.nowMs })
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

export async function dualWriteUpsertScheduleFromV1(
  ctx: CanonicalPlanningContext,
  input: {
    taskId: string
    schedule: StudyTaskSchedule
    weekAnchorMidnightMs: number
    /** Explicit ScheduleBlock id; when omitted, resolve from canonical snapshot. */
    blockId?: string
    /**
     * When true (default), move primary block only — never invent a second
     * block for the same task on a plain V1 schedule write / week-drag.
     */
    preferExistingPrimary?: boolean
  }
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) {
    return {
      kind: 'canonical_skipped',
      reason: !ctx.workspaceRoot?.trim() ? 'missing_workspace' : 'api_unavailable'
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

  const preferExisting = input.preferExistingPrimary !== false
  const explicitId =
    typeof input.blockId === 'string' && input.blockId.trim() ? input.blockId.trim() : undefined
  const blockId =
    explicitId && !preferExisting
      ? explicitId
      : resolveFocusBlockIdForScheduleUpsert(
          read.snapshot.scheduleBlocks,
          input.taskId,
          nowMs(),
          explicitId
        )

  const existing = read.snapshot.scheduleBlocks.find((b) => b.id === blockId) ?? null
  const built = buildFocusScheduleBlockFromV1({
    taskId: input.taskId,
    schedule: input.schedule,
    weekAnchorMidnightMs: input.weekAnchorMidnightMs,
    blockId,
    existing
  })
  if (!built.ok) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: read.snapshot.revision,
        error: { code: 'invalid_command', message: 'invalid V1 schedule for block upsert' }
      }
    }
  }

  const block: ScheduleBlock = built.block
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

/**
 * STC-707 opt-in: sequential upsert of unlocked schedule moves with CAS.
 * Never auto-called; host must invoke only after explicit user confirm.
 * Refuses locked blocks. Stops on first failed apply.
 */
export async function dualWriteApplyConflictResolveMoves(
  ctx: CanonicalPlanningContext,
  input: {
    moves: ReadonlyArray<{
      blockId: string
      to: { startAtMs: number; endAtMs: number }
    }>
  }
): Promise<
  | { kind: 'canonical_ok'; applied: number; revision: number }
  | { kind: 'canonical_skipped'; reason: 'missing_workspace' | 'api_unavailable' }
  | {
      kind: 'canonical_failed'
      applied: number
      result: Extract<PlanningClientApplyResult, { ok: false }>
    }
  | { kind: 'canonical_failed'; applied: number; code: string; message: string }
> {
  if (!hasCanonicalContext(ctx)) {
    return {
      kind: 'canonical_skipped',
      reason: !ctx.workspaceRoot?.trim() ? 'missing_workspace' : 'api_unavailable'
    }
  }
  if (!input.moves.length) {
    return { kind: 'canonical_failed', applied: 0, code: 'no_moves', message: 'No moves to apply.' }
  }

  const nowMs = ctx.nowMs ?? (() => Date.now())
  let applied = 0
  let expectedRevision = 0

  // Initial read for revision + block source of truth
  const firstRead = await readStudyPlanningSnapshot(ctx.api, ctx.workspaceRoot)
  if (!firstRead.ok) {
    return {
      kind: 'canonical_failed',
      applied: 0,
      result: { ok: false, revision: 0, error: { code: firstRead.code, message: firstRead.message } }
    }
  }
  expectedRevision = firstRead.snapshot.revision
  let blocks = firstRead.snapshot.scheduleBlocks

  for (const move of input.moves) {
    const existing = blocks.find((b) => b.id === move.blockId)
    if (!existing) {
      return {
        kind: 'canonical_failed',
        applied,
        code: 'block_missing',
        message: `Block ${move.blockId} not found.`
      }
    }
    if (existing.locked) {
      return {
        kind: 'canonical_failed',
        applied,
        code: 'locked_would_move',
        message: `Refusing to upsert locked block ${move.blockId}.`
      }
    }
    if (
      !Number.isFinite(move.to.startAtMs) ||
      !Number.isFinite(move.to.endAtMs) ||
      move.to.endAtMs <= move.to.startAtMs
    ) {
      return {
        kind: 'canonical_failed',
        applied,
        code: 'duration_invalid',
        message: `Invalid target interval for ${move.blockId}.`
      }
    }

    const block: ScheduleBlock = {
      ...existing,
      startAtMs: move.to.startAtMs,
      endAtMs: move.to.endAtMs,
      revision: existing.revision + 1
    }

    const result = await applyStudyPlanningCommand(
      ctx.api,
      ctx.workspaceRoot,
      expectedRevision,
      {
        actionId: `resolve_conflict:${move.blockId}:${nowMs()}`,
        type: 'upsert_schedule_block',
        payload: { block },
        clientIssuedAtMs: nowMs()
      }
    )

    if (!result.ok) {
      return { kind: 'canonical_failed', applied, result }
    }

    applied += 1
    expectedRevision = result.revision
    // Refresh local view for subsequent locked checks / next existing
    const nextRead = await readStudyPlanningSnapshot(ctx.api, ctx.workspaceRoot)
    if (nextRead.ok) {
      blocks = nextRead.snapshot.scheduleBlocks
      expectedRevision = nextRead.snapshot.revision
    } else {
      // CAS progressed; keep revision from apply
      blocks = blocks.map((b) => (b.id === block.id ? block : b))
    }
  }

  return { kind: 'canonical_ok', applied, revision: expectedRevision }
}
