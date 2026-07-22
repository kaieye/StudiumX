/**
 * Dual-write for batch classify (STC-408).
 * One batch_classify_tasks command; no per-task prompt storm.
 */

import {
  applyStudyPlanningCommand,
  readStudyPlanningSnapshot,
  type PlanningClientApplyResult,
  type StudyPlanningApi
} from './planning-client'
import type { StudyPlanningCommandEnvelope } from '../../../shared/study-planning'
import type { DualWriteResult, CanonicalPlanningContext } from './planning-dual-write'

function hasCanonicalContext(ctx: CanonicalPlanningContext): boolean {
  const root = typeof ctx.workspaceRoot === 'string' ? ctx.workspaceRoot.trim() : ''
  if (!root) return false
  if (!ctx.api) return false
  if (typeof ctx.api.readStudyPlanning !== 'function') return false
  if (typeof ctx.api.applyStudyPlanning !== 'function') return false
  return true
}

function skipped(ctx: CanonicalPlanningContext): DualWriteResult {
  return {
    kind: 'canonical_skipped',
    reason: !ctx.workspaceRoot?.trim() ? 'missing_workspace' : 'api_unavailable'
  }
}

function nowOf(ctx: CanonicalPlanningContext): number {
  return (ctx.nowMs ?? (() => Date.now()))()
}

function toDualWrite(result: PlanningClientApplyResult): DualWriteResult {
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

export function buildBatchClassifyTasksCommand(
  input: { taskIds: readonly string[]; categoryId: string },
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'batch_classify_tasks',
    payload: {
      taskIds: input.taskIds.slice(),
      categoryId: input.categoryId
    },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

async function applyWithRevisionRetry(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined,
  build: (actionId: string, issuedAt: number) => StudyPlanningCommandEnvelope,
  nowMs: () => number,
  actionPrefix: string
): Promise<PlanningClientApplyResult> {
  const read = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!read.ok) {
    return { ok: false, revision: 0, error: { code: read.code, message: read.message } }
  }
  const issued = nowMs()
  const first = await applyStudyPlanningCommand(
    api,
    workspaceRoot,
    read.snapshot.revision,
    build(`${actionPrefix}:${issued}:0`, issued)
  )
  if (first.ok) return first
  if (first.error.code !== 'revision_conflict') return first

  const refreshed = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!refreshed.ok) {
    return {
      ok: false,
      revision: first.revision,
      error: { code: refreshed.code, message: refreshed.message }
    }
  }
  const retryIssued = nowMs()
  return applyStudyPlanningCommand(
    api,
    workspaceRoot,
    refreshed.snapshot.revision,
    build(`${actionPrefix}:${retryIssued}:1`, retryIssued)
  )
}

/**
 * Classify many tasks with one category via batch_classify_tasks CAS.
 */
export async function dualWriteBatchClassifyTasks(
  ctx: CanonicalPlanningContext,
  input: { taskIds: readonly string[]; categoryId: string }
): Promise<DualWriteResult> {
  const categoryId = typeof input.categoryId === 'string' ? input.categoryId.trim() : ''
  if (!categoryId) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'categoryId required' }
      }
    }
  }
  const taskIds = input.taskIds
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim())
  if (taskIds.length === 0) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'taskIds required' }
      }
    }
  }
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) =>
      buildBatchClassifyTasksCommand({ taskIds, categoryId }, actionId, issued),
    nowMs,
    `batch_classify_tasks:${taskIds.length}:${categoryId}`
  )
  return toDualWrite(result)
}
