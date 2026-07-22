/**
 * Dual-write delete_task (soft-cancel) for product remove path (§7.3).
 * V1 UI list drops the task optimistically; canonical marks cancelled and may
 * emit future_blocks_need_decision for a second delete_task with disposition.
 */

import {
  deletePlanningTask,
  type PlanningClientApplyResult
} from './planning-client'
import type { CanonicalPlanningContext, DualWriteResult } from './planning-dual-write'

function hasCanonicalContext(ctx: CanonicalPlanningContext): boolean {
  const root = typeof ctx.workspaceRoot === 'string' ? ctx.workspaceRoot.trim() : ''
  if (!root) return false
  if (!ctx.api) return false
  if (typeof ctx.api.readStudyPlanning !== 'function') return false
  if (typeof ctx.api.applyStudyPlanning !== 'function') return false
  return true
}

export type DualWriteDeleteTaskOptions = {
  futureBlocksDecision?: 'cancel' | 'keep_review' | 'reassign' | 'cancel_blocks' | 'keep_as_review'
  reassignTaskId?: string | null
}

function wireDecision(
  decision: DualWriteDeleteTaskOptions['futureBlocksDecision']
): 'cancel' | 'keep_review' | 'reassign' | undefined {
  if (!decision) return undefined
  if (decision === 'cancel_blocks' || decision === 'cancel') return 'cancel'
  if (decision === 'keep_as_review' || decision === 'keep_review') return 'keep_review'
  if (decision === 'reassign') return 'reassign'
  return undefined
}

/**
 * Publish delete_task to canonical. Shared id with V1 remove so list/detail stay aligned.
 */
export async function dualWriteDeleteTask(
  ctx: CanonicalPlanningContext,
  taskId: string,
  options?: DualWriteDeleteTaskOptions
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
        error: { code: 'invalid_command', message: 'delete_task requires id' }
      }
    }
  }

  const decision = wireDecision(options?.futureBlocksDecision)
  const result = await deletePlanningTask(
    ctx.api,
    ctx.workspaceRoot,
    {
      id,
      ...(decision ? { futureBlocksDecision: decision } : {}),
      ...(options?.reassignTaskId !== undefined ? { reassignTaskId: options.reassignTaskId } : {})
    },
    { nowMs: ctx.nowMs }
  )
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

export type { PlanningClientApplyResult }


/**
 * Collect V1 task ids marked done (for removeDoneTasks product path).
 * Pure helper — no side effects.
 */
export function collectDoneTaskIds(
  tasks: readonly { id: string; done?: boolean }[]
): string[] {
  const out: string[] = []
  for (const t of tasks) {
    if (!t || typeof t.id !== 'string') continue
    const id = t.id.trim()
    if (!id) continue
    if (t.done === true) out.push(id)
  }
  return out
}

/**
 * Bulk soft-cancel done tasks on canonical (removeDoneTasks product path).
 * Uses futureBlocksDecision: cancel to avoid per-task sheet storm on clear-completed.
 * Sequential applies; fails do not roll back V1 cache.
 */
export async function dualWriteRemoveDoneTasks(
  ctx: CanonicalPlanningContext,
  taskIds: readonly string[]
): Promise<DualWriteResult[]> {
  const results: DualWriteResult[] = []
  for (const raw of taskIds) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!id) continue
    const r = await dualWriteDeleteTask(ctx, id, { futureBlocksDecision: 'cancel' })
    results.push(r)
  }
  return results
}

