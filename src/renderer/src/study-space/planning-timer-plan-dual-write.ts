/**
 * TimerPlan dual-write (Plans catalog cutover partial).
 *
 * Map V1 StudyTimerPlan (focus/break + simulation window fields as UI cache)
 * ↔ TimerPlanV2 store commands (save/copy/delete/rename/set-default). Simulation window times are
 * not TimerPlan fields — they stay V1-only cache on the product path.
 *
 * Does not thrash per-tick writes; only explicit plan CRUD / prefs.
 */

import {
  applyStudyPlanningCommand,
  readStudyPlanningSnapshot,
  type PlanningClientApplyResult,
  type StudyPlanningApi
} from './planning-client'
import type { StudyPlanningCommandEnvelope } from '../../../shared/study-planning'
import {
  type TimerPlanV2
} from '../../../shared/study-planning'
import type { DualWriteResult, CanonicalPlanningContext } from './planning-dual-write'
import type { StudyTimerPlan } from './types'
import {
  projectV1TimerPlanToV2,
  projectV2TimerPlanToV1
} from './planning-timer-plan-kind'

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

/**
 * Project V1 StudyTimerPlan into TimerPlanV2 for durable save.
 * Uses classic pomodoro shell; maps breakMinutes → shortBreakMinutes.
 */
export function v1TimerPlanToV2(plan: StudyTimerPlan): TimerPlanV2 {
  // STC-502 + STC-504: pomodoro advanced fields or continuous kind projection.
  return projectV1TimerPlanToV2(plan)
}

/**
 * Project TimerPlanV2 into V1 StudyTimerPlan cache fields.
 * Simulation window defaults when absent (not stored on TimerPlanV2).
 */
export function v2TimerPlanToV1(
  plan: TimerPlanV2,
  window?: { simulationStartTime?: string; simulationEndTime?: string }
): StudyTimerPlan {
  // STC-502 + STC-504: advanced + kind/clockMode projection.
  return projectV2TimerPlanToV1(plan, window)
}

export function buildSaveTimerPlanCommand(
  plan: TimerPlanV2,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'save_timer_plan',
    payload: { plan },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export function buildDeleteTimerPlanCommand(
  planId: string,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'delete_timer_plan',
    payload: { planId },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export function buildCopyTimerPlanCommand(
  input: { sourceId: string; newId: string; newName?: string },
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'copy_timer_plan',
    payload: {
      sourceId: input.sourceId,
      newId: input.newId,
      ...(input.newName ? { newName: input.newName } : {})
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
    build(`${actionPrefix}:${retryIssued}:retry`, retryIssued)
  )
}

function toDualWrite(result: PlanningClientApplyResult): DualWriteResult {
  if (result.ok) return { kind: 'canonical_ok', result }
  return { kind: 'canonical_failed', result }
}

export async function dualWriteSaveTimerPlan(
  ctx: CanonicalPlanningContext,
  plan: StudyTimerPlan
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  const v2 = v1TimerPlanToV2(plan)
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildSaveTimerPlanCommand(v2, actionId, issued),
    nowMs,
    `save_timer_plan:${plan.id}`
  )
  return toDualWrite(result)
}

export async function dualWriteDeleteTimerPlan(
  ctx: CanonicalPlanningContext,
  planId: string
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (!planId.trim()) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'planId required' }
      }
    }
  }
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildDeleteTimerPlanCommand(planId, actionId, issued),
    nowMs,
    `delete_timer_plan:${planId}`
  )
  return toDualWrite(result)
}

export async function dualWriteCopyTimerPlan(
  ctx: CanonicalPlanningContext,
  input: { sourceId: string; newId: string; newName?: string }
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildCopyTimerPlanCommand(input, actionId, issued),
    nowMs,
    `copy_timer_plan:${input.newId}`
  )
  return toDualWrite(result)
}

export function buildSetDefaultTimerPlanCommand(
  defaultTimerPlanId: string | null,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'set_preferences',
    payload: { defaultTimerPlanId },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

/**
 * Rename a custom plan: save_timer_plan with updated name (V2 shell from V1 fields).
 * Builtin ids should be refused by caller / store.
 */
export async function dualWriteRenameTimerPlan(
  ctx: CanonicalPlanningContext,
  input: {
    planId: string
    name: string
    focusMinutes: number
    breakMinutes: number
    /** STC-502: preserve advanced fields on rename save. */
    longBreakMinutes?: number
    longBreakEvery?: number
    breakPolicy?: StudyTimerPlan['breakPolicy']
    kind?: StudyTimerPlan['kind']
    clockMode?: StudyTimerPlan['clockMode']
    continuousTarget?: boolean
    simulationStartTime?: string
    simulationEndTime?: string
  }
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  const planId = input.planId.trim()
  const name = input.name.trim()
  if (!planId || !name) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'planId and name required' }
      }
    }
  }
  // Use full V1→V2 map so rename does not wipe long break / breakPolicy.
  const v2 = v1TimerPlanToV2({
    id: planId,
    name,
    focusMinutes: input.focusMinutes,
    breakMinutes: input.breakMinutes,
    simulationStartTime: input.simulationStartTime ?? '09:00',
    simulationEndTime: input.simulationEndTime ?? '12:00',
    ...(input.longBreakMinutes !== undefined
      ? { longBreakMinutes: input.longBreakMinutes }
      : {}),
    ...(input.longBreakEvery !== undefined
      ? { longBreakEvery: input.longBreakEvery }
      : {}),
    ...(input.breakPolicy !== undefined ? { breakPolicy: input.breakPolicy } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.clockMode !== undefined ? { clockMode: input.clockMode } : {}),
    ...(input.continuousTarget !== undefined
      ? { continuousTarget: input.continuousTarget }
      : {})
  })
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildSaveTimerPlanCommand(v2, actionId, issued),
    nowMs,
    `rename_timer_plan:${planId}`
  )
  return toDualWrite(result)
}

export async function dualWriteSetDefaultTimerPlan(
  ctx: CanonicalPlanningContext,
  defaultTimerPlanId: string | null
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildSetDefaultTimerPlanCommand(defaultTimerPlanId, actionId, issued),
    nowMs,
    `set_default_timer_plan:${defaultTimerPlanId ?? 'null'}`
  )
  return toDualWrite(result)
}
