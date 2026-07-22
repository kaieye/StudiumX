/**
 * Study planning preferences dual-write (STC-404 restore path).
 * emptyStartPolicy + classificationPromptOptOut via set_preferences CAS.
 */

import {
  applyStudyPlanningCommand,
  readStudyPlanningSnapshot,
  type PlanningClientApplyResult,
  type StudyPlanningApi
} from './planning-client'
import type {
  EmptyStartPolicy,
  RecurrenceRule,
  StudyPlanningCommandEnvelope
} from '../../../shared/study-planning'
import type { DualWriteResult, CanonicalPlanningContext } from './planning-dual-write'
import {
  buildSimulationWindowPreferencesPatch,
  normalizeSimulationWindow
} from './planning-simulation-window-ui'

export type StudyPlanningPrefsPatch = {
  emptyStartPolicy?: EmptyStartPolicy
  classificationPromptOptOut?: boolean
  defaultTimerPlanId?: string | null
  /** Active simulation window labels (HH:MM). */
  simulationStartTime?: string
  simulationEndTime?: string
  /** Optional V1 dual-authority demote marker (ms). */
  v1LocalAuthorityDemotedAtMs?: number
  /** Optional durable recurrence rules (STC-703); full replace when set. */
  recurrenceRules?: RecurrenceRule[]
}

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

export function buildSetPreferencesCommand(
  patch: StudyPlanningPrefsPatch,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  const payload: Record<string, unknown> = {}
  if (patch.emptyStartPolicy !== undefined) {
    payload.emptyStartPolicy = patch.emptyStartPolicy
  }
  if (typeof patch.classificationPromptOptOut === 'boolean') {
    payload.classificationPromptOptOut = patch.classificationPromptOptOut
  }
  if (patch.defaultTimerPlanId !== undefined) {
    payload.defaultTimerPlanId = patch.defaultTimerPlanId
  }
  if (typeof patch.simulationStartTime === 'string') {
    payload.simulationStartTime = patch.simulationStartTime
  }
  if (typeof patch.simulationEndTime === 'string') {
    payload.simulationEndTime = patch.simulationEndTime
  }
  if (
    typeof patch.v1LocalAuthorityDemotedAtMs === 'number' &&
    Number.isFinite(patch.v1LocalAuthorityDemotedAtMs) &&
    patch.v1LocalAuthorityDemotedAtMs > 0
  ) {
    payload.v1LocalAuthorityDemotedAtMs = Math.floor(patch.v1LocalAuthorityDemotedAtMs)
  }
  if (patch.recurrenceRules !== undefined) {
    payload.recurrenceRules = patch.recurrenceRules
  }
  return {
    actionId,
    type: 'set_preferences',
    payload,
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

export async function dualWriteSetPreferences(
  ctx: CanonicalPlanningContext,
  patch: StudyPlanningPrefsPatch
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (
    patch.emptyStartPolicy === undefined &&
    patch.classificationPromptOptOut === undefined &&
    patch.defaultTimerPlanId === undefined &&
    patch.simulationStartTime === undefined &&
    patch.simulationEndTime === undefined &&
    patch.v1LocalAuthorityDemotedAtMs === undefined &&
    patch.recurrenceRules === undefined
  ) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'set_preferences requires at least one field' }
      }
    }
  }
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildSetPreferencesCommand(patch, actionId, issued),
    nowMs,
    `set_preferences:${Object.keys(patch).sort().join('+')}`
  )
  return toDualWrite(result)
}

export async function dualWriteSetEmptyStartPolicy(
  ctx: CanonicalPlanningContext,
  emptyStartPolicy: EmptyStartPolicy
): Promise<DualWriteResult> {
  return dualWriteSetPreferences(ctx, { emptyStartPolicy })
}

export async function dualWriteSetClassificationPromptOptOut(
  ctx: CanonicalPlanningContext,
  classificationPromptOptOut: boolean
): Promise<DualWriteResult> {
  return dualWriteSetPreferences(ctx, { classificationPromptOptOut })
}

/**
 * Dual-write active simulation / allocation window into preferences.
 * Fail-closed: invalid HH:MM or start>=end skips canonical write.
 */
export async function dualWriteSetSimulationWindow(
  ctx: CanonicalPlanningContext,
  input: { simulationStartTime?: unknown; simulationEndTime?: unknown }
): Promise<DualWriteResult> {
  const window = normalizeSimulationWindow(input)
  if (!window) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: {
          code: 'invalid_command',
          message: 'simulation window requires valid HH:MM start < end'
        }
      }
    }
  }
  return dualWriteSetPreferences(ctx, buildSimulationWindowPreferencesPatch(window))
}
