/**
 * Dual-write for post-complete classification prompt (STC-406/407).
 *
 * Thin peel: classify → update_task; never_prompt → set_preferences.
 * keep_inbox / later → no durable write (complete already settled).
 */

import { updatePlanningTask } from './planning-client'
import type { StudyPlanningCommandEnvelope } from '../../../shared/study-planning'
import type { DualWriteResult, CanonicalPlanningContext } from './planning-dual-write'
import type { ClassificationPromptAction } from '../../../shared/study-planning'
import { dualWriteSetClassificationPromptOptOut } from './planning-preferences-dual-write'

export { dualWriteSetClassificationPromptOptOut }

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

export function buildSetClassificationPromptOptOutCommand(
  classificationPromptOptOut: boolean,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  // Thin alias — same set_preferences shape as planning-preferences-dual-write.
  return {
    actionId,
    type: 'set_preferences',
    payload: { classificationPromptOptOut },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

/**
 * Classify an inbox task into a category (clears inbox via store update_task rules).
 */
export async function dualWriteClassifyTask(
  ctx: CanonicalPlanningContext,
  input: { taskId: string; categoryId: string }
): Promise<DualWriteResult> {
  const categoryId = input.categoryId.trim()
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
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  const result = await updatePlanningTask(
    ctx.api,
    ctx.workspaceRoot,
    { id: input.taskId, categoryId },
    { nowMs: ctx.nowMs }
  )
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

/**
 * Apply host answer after complete. Returns null when no durable write is needed.
 */
export async function dualWriteClassificationPromptAnswer(
  ctx: CanonicalPlanningContext,
  input: {
    taskId: string
    action: ClassificationPromptAction
    selectedCategoryId?: string | null
  }
): Promise<DualWriteResult | null> {
  if (input.action === 'later' || input.action === 'keep_inbox') {
    return null
  }
  if (input.action === 'never_prompt') {
    return dualWriteSetClassificationPromptOptOut(ctx, true)
  }
  // classify
  const cat =
    typeof input.selectedCategoryId === 'string' ? input.selectedCategoryId.trim() : ''
  if (!cat) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'classify requires selectedCategoryId' }
      }
    }
  }
  return dualWriteClassifyTask(ctx, { taskId: input.taskId, categoryId: cat })
}
