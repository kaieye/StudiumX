/**
 * TimerSession dual-write (Slice D partial cutover).
 *
 * Dual-write transitions only. Local TimerSession (planning-timer-display)
 * is the focus UI clock authority; V1 StudySessionLifecycle still hosts
 * analytics + break segments.
 * When workspace + IPC are available, publish start/pause/resume/finish
 * (and on-demand advance + reconcile_stale_session) to durable StudyPlanningStore
 * so planSnapshot freezes and single-running is enforced across windows.
 *
 * Intentionally does NOT dual-write every tick advance (disk thrash).
 * Elapsed is applied by durable pause/finish reducers from lastSampleWallMs.
 * STC-206: advance once to pin needs_reconcile, then reconcile_stale_session after user decide.
 *
 * Break segments: start with phase short_break|long_break (store accepts phase);
 * pause/resume/finish reuse the same session commands. Still no per-tick advance.
 */

import {
  applyStudyPlanningCommand,
  readStudyPlanningSnapshot,
  type PlanningClientApplyResult,
  type StudyPlanningApi
} from './planning-client'
import type { StudyPlanningCommandEnvelope } from '../../../shared/study-planning'
import type { DualWriteResult, CanonicalPlanningContext } from './planning-dual-write'

export type TimerSessionAttributionReason =
  | 'explicit'
  | 'quick_start'
  | 'unattributed'

export type DualWriteTimerPhase = 'focus' | 'short_break' | 'long_break' | 'wrap_up'

export type DualWriteStartTimerInput = {
  sessionId: string
  taskId?: string | null
  planId?: string
  /** Prefer V1 remainingSeconds so duration matches UI even when plan is classic seed. */
  targetSeconds?: number | null
  attributionReason?: TimerSessionAttributionReason
  /** Defaults to focus in store when omitted. Use short_break/long_break for rest segments. */
  phase?: DualWriteTimerPhase
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

export function buildStartTimerSessionCommand(
  input: DualWriteStartTimerInput,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  const payload: Record<string, unknown> = {
    id: input.sessionId
  }
  if (input.planId) payload.planId = input.planId
  if (input.taskId !== undefined) payload.taskId = input.taskId
  if (input.attributionReason) payload.attributionReason = input.attributionReason
  if (input.targetSeconds !== undefined) payload.targetSeconds = input.targetSeconds
  if (input.phase) payload.phase = input.phase

  return {
    actionId,
    type: 'start_timer_session',
    payload,
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export function buildPauseTimerSessionCommand(
  sessionId: string,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'pause_timer_session',
    payload: { sessionId },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export function buildResumeTimerSessionCommand(
  sessionId: string,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'resume_timer_session',
    payload: { sessionId },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export function buildFinishTimerSessionCommand(
  sessionId: string,
  reason: 'manual' | 'cancelled',
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'finish_timer_session',
    payload: { sessionId, reason },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export type DualWriteReconcileDecision = 'confirm_all' | 'truncate_to_target' | 'discard_gap'

export function buildAdvanceTimerSessionCommand(
  sessionId: string,
  actionId: string,
  clientIssuedAtMs?: number,
  nowMs?: number
): StudyPlanningCommandEnvelope {
  const payload: Record<string, unknown> = { sessionId }
  if (nowMs !== undefined) payload.nowMs = nowMs
  return {
    actionId,
    type: 'advance_timer_session',
    payload,
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export function buildReconcileStaleSessionCommand(
  sessionId: string,
  decision: DualWriteReconcileDecision,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'reconcile_stale_session',
    payload: { sessionId, decision },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export type DualWriteSwitchSessionTaskInput = {
  sessionId: string
  newSessionId: string
  newTaskId: string | null
}

/**
 * Build switch_session_task envelope (STC-204 mid-run task switch).
 * Ends current segment and starts a new session with frozen planSnapshot.
 */
export function buildSwitchSessionTaskCommand(
  input: DualWriteSwitchSessionTaskInput,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'switch_session_task',
    payload: {
      sessionId: input.sessionId,
      newSessionId: input.newSessionId,
      newTaskId: input.newTaskId
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

/** Create a stable-enough unique TimerSession id for dual-write (caller-owned). */
export function createCanonicalTimerSessionId(nowMs = Date.now()): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  return `ts:${nowMs}:${rand}`
}

export async function dualWriteStartTimerSession(
  ctx: CanonicalPlanningContext,
  input: DualWriteStartTimerInput
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildStartTimerSessionCommand(input, actionId, issued),
    nowMs,
    `start_timer:${input.sessionId}`
  )
  return toDualWrite(result)
}

export async function dualWritePauseTimerSession(
  ctx: CanonicalPlanningContext,
  sessionId: string
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (!sessionId) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'sessionId required for pause' }
      }
    }
  }
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildPauseTimerSessionCommand(sessionId, actionId, issued),
    nowMs,
    `pause_timer:${sessionId}`
  )
  return toDualWrite(result)
}

export async function dualWriteResumeTimerSession(
  ctx: CanonicalPlanningContext,
  sessionId: string
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (!sessionId) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'sessionId required for resume' }
      }
    }
  }
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildResumeTimerSessionCommand(sessionId, actionId, issued),
    nowMs,
    `resume_timer:${sessionId}`
  )
  return toDualWrite(result)
}

export async function dualWriteFinishTimerSession(
  ctx: CanonicalPlanningContext,
  sessionId: string,
  reason: 'manual' | 'cancelled' = 'manual'
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (!sessionId) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'sessionId required for finish' }
      }
    }
  }
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildFinishTimerSessionCommand(sessionId, reason, actionId, issued),
    nowMs,
    `finish_timer:${sessionId}`
  )
  return toDualWrite(result)
}

/**
 * Dual-write durable advance (e.g. pin needs_reconcile gap on disk).
 * Not used on every tick — only when product path must publish wall sample.
 */
export async function dualWriteAdvanceTimerSession(
  ctx: CanonicalPlanningContext,
  sessionId: string,
  nowMsSample?: number
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (!sessionId) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'sessionId required for advance' }
      }
    }
  }
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) =>
      buildAdvanceTimerSessionCommand(sessionId, actionId, issued, nowMsSample ?? issued),
    nowMs,
    `advance_timer:${sessionId}`
  )
  return toDualWrite(result)
}

/**
 * Dual-write reconcile_stale_session after user decides (freeze #5).
 * Store requires session.state === needs_reconcile; caller should advance first if only local.
 */
export async function dualWriteReconcileStaleSession(
  ctx: CanonicalPlanningContext,
  sessionId: string,
  decision: DualWriteReconcileDecision
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (!sessionId) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'sessionId required for reconcile' }
      }
    }
  }
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildReconcileStaleSessionCommand(sessionId, decision, actionId, issued),
    nowMs,
    `reconcile_timer:${sessionId}`
  )
  return toDualWrite(result)
}

/**
 * Map V1 timerMode + optional task into store attribution.
 * Break segments dual-write as TimerSessions with phase short_break|long_break (taskId null).
 */
/**
 * Dual-write switch_session_task (STC-204). Fail-closed without workspace.
 * Caller supplies newSessionId (createCanonicalTimerSessionId).
 */
export async function dualWriteSwitchSessionTask(
  ctx: CanonicalPlanningContext,
  input: DualWriteSwitchSessionTaskInput
): Promise<DualWriteResult> {
  if (!hasCanonicalContext(ctx)) return skipped(ctx)
  if (!input.sessionId) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'sessionId required for switch_session_task' }
      }
    }
  }
  if (!input.newSessionId) {
    return {
      kind: 'canonical_failed',
      result: {
        ok: false,
        revision: 0,
        error: { code: 'invalid_command', message: 'newSessionId required for switch_session_task' }
      }
    }
  }
  const nowMs = () => nowOf(ctx)
  const result = await applyWithRevisionRetry(
    ctx.api,
    ctx.workspaceRoot,
    (actionId, issued) => buildSwitchSessionTaskCommand(input, actionId, issued),
    nowMs,
    `switch_session:${input.sessionId}->${input.newSessionId}`
  )
  return toDualWrite(result)
}

export function resolveTimerAttribution(
  taskId: string | null | undefined
): { taskId: string | null; attributionReason: TimerSessionAttributionReason } {
  if (taskId) return { taskId, attributionReason: 'explicit' }
  return { taskId: null, attributionReason: 'unattributed' }
}
