/**
 * Study planning categories dual-write (sole-authority demotion).
 * set_categories CAS + revision retry. localStorage remains rebuildable cache.
 */

import type { StudyPlanningCommandEnvelope } from '../../../shared/study-planning'
import {
  applyStudyPlanningCommand,
  readStudyPlanningSnapshot,
  type PlanningClientApplyResult,
  type StudyPlanningApi
} from './planning-client'
import type { DualWriteResult, CanonicalPlanningContext } from './planning-dual-write'
import { normalizeCategoriesForCanonical } from './planning-categories-ui'
import type { StudyTaskCategory } from './types'

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

export function buildSetCategoriesCommand(
  categories: readonly StudyTaskCategory[],
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'set_categories',
    payload: {
      categories: normalizeCategoriesForCanonical(categories)
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
 * Dual-write full category catalog into snapshot.categories.
 * Fail-closed when empty input (normalize would invent builtins-only; callers should pass real list).
 */
export async function dualWriteSetCategories(
  ctx: CanonicalPlanningContext,
  categories: readonly StudyTaskCategory[]
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (!Array.isArray(categories)) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'set_categories requires categories array' }
      }
    }
  }
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildSetCategoriesCommand(categories, actionId, issued),
    nowMs,
    'set_categories'
  )
  return toDualWrite(result)
}
