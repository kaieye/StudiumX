/**
 * Pure TimerSession target extend (STC-205 remainder / product §10.3).
 *
 * Extends countdown targetSeconds without rewriting planSnapshot.
 * Local UI clock authority may bump mid-segment; durable finish still uses
 * the closed session (no new store command required for this slice).
 *
 * Fail-closed: countup / open target / completed / cancelled / needs_reconcile.
 */

import { TIMER_PLAN_SEED_DEFAULTS } from './timer-plan'
import {
  advanceTimerSession,
  type TimerSessionPhase,
  type TimerSessionRecord
} from './timer-session-lifecycle'

export type ExtendTimerSessionInput = {
  session: TimerSessionRecord
  nowMs: number
  /** Prefer exact seconds when both provided. */
  addSeconds?: number
  addMinutes?: number
  /** Absolute ceiling for targetSeconds after extend (seconds). */
  maxTargetSeconds?: number
}

export type ExtendTimerSessionOk = {
  ok: true
  session: TimerSessionRecord
  addedSeconds: number
  previousTargetSeconds: number
  nextTargetSeconds: number
}

export type ExtendTimerSessionErr = {
  ok: false
  code:
    | 'not_countdown'
    | 'no_finite_target'
    | 'invalid_add'
    | 'terminal_state'
    | 'needs_reconcile'
    | 'already_at_cap'
  message: string
  session: TimerSessionRecord
}

export type ExtendTimerSessionResult = ExtendTimerSessionOk | ExtendTimerSessionErr

/** Default absolute max targetSeconds for a phase (seed catalog ceilings). */
export function defaultMaxTargetSecondsForPhase(phase: TimerSessionPhase): number {
  switch (phase) {
    case 'short_break':
      return TIMER_PLAN_SEED_DEFAULTS.shortBreakMinutesMax * 60
    case 'long_break':
      return TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMax * 60
    case 'wrap_up':
      return TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutesMax * 60
    case 'focus':
    default:
      return TIMER_PLAN_SEED_DEFAULTS.focusMinutesMax * 60
  }
}

/**
 * Normalize add amount to whole positive seconds. Fail-closed on non-finite / ≤0.
 */
export function resolveExtendAddSeconds(input: {
  addSeconds?: number
  addMinutes?: number
}): number | null {
  if (input.addSeconds !== undefined) {
    if (!Number.isFinite(input.addSeconds)) return null
    const sec = Math.floor(input.addSeconds)
    return sec > 0 ? sec : null
  }
  if (input.addMinutes !== undefined) {
    if (!Number.isFinite(input.addMinutes)) return null
    const sec = Math.floor(input.addMinutes * 60)
    return sec > 0 ? sec : null
  }
  return null
}

/**
 * Pure: increase countdown targetSeconds by N (clamped to max).
 * Running sessions are advanced once from lastSampleWallMs → nowMs first so
 * remaining room stays consistent with wall time (no silent credit of sleep).
 * Does not mutate planSnapshot.
 */
export function extendTimerSessionTarget(
  input: ExtendTimerSessionInput
): ExtendTimerSessionResult {
  const session = input.session
  const addSeconds = resolveExtendAddSeconds(input)
  if (addSeconds == null) {
    return {
      ok: false,
      code: 'invalid_add',
      message: 'extend requires positive addSeconds or addMinutes',
      session
    }
  }

  if (session.state === 'completed' || session.state === 'cancelled' || session.state === 'idle') {
    return {
      ok: false,
      code: 'terminal_state',
      message: `cannot extend session in state ${session.state}`,
      session
    }
  }
  if (session.state === 'needs_reconcile') {
    return {
      ok: false,
      code: 'needs_reconcile',
      message: 'resolve reconcile before extending target',
      session
    }
  }
  if (session.clockMode !== 'countdown') {
    return {
      ok: false,
      code: 'not_countdown',
      message: 'only countdown sessions can extend targetSeconds',
      session
    }
  }
  if (session.targetSeconds == null || !Number.isFinite(session.targetSeconds) || session.targetSeconds <= 0) {
    return {
      ok: false,
      code: 'no_finite_target',
      message: 'open-ended or missing target cannot be extended',
      session
    }
  }

  // Advance running wall sample first (pure local; no disk).
  let working = session
  if (working.state === 'running') {
    const advanced = advanceTimerSession(working, input.nowMs)
    if (advanced.session) working = advanced.session
    // If advance completed the segment, refuse extend (user must start a new one).
    if (working.state === 'completed' || working.state === 'needs_reconcile') {
      return {
        ok: false,
        code: working.state === 'needs_reconcile' ? 'needs_reconcile' : 'terminal_state',
        message:
          working.state === 'needs_reconcile'
            ? 'resolve reconcile before extending target'
            : 'segment already completed; cannot extend',
        session: working
      }
    }
  }

  const previousTargetSeconds = working.targetSeconds ?? 0
  const maxTarget =
    input.maxTargetSeconds != null && Number.isFinite(input.maxTargetSeconds) && input.maxTargetSeconds > 0
      ? Math.floor(input.maxTargetSeconds)
      : defaultMaxTargetSecondsForPhase(working.phase)

  if (previousTargetSeconds >= maxTarget) {
    return {
      ok: false,
      code: 'already_at_cap',
      message: `target already at max ${maxTarget}s`,
      session: working
    }
  }

  const nextTargetSeconds = Math.min(maxTarget, previousTargetSeconds + addSeconds)
  const actualAdded = nextTargetSeconds - previousTargetSeconds
  if (actualAdded <= 0) {
    return {
      ok: false,
      code: 'already_at_cap',
      message: `target already at max ${maxTarget}s`,
      session: working
    }
  }

  // Preserve planSnapshot reference (frozen); only bump target + sample wall.
  const next: TimerSessionRecord = {
    ...working,
    targetSeconds: nextTargetSeconds,
    lastSampleWallMs: input.nowMs
  }

  return {
    ok: true,
    session: next,
    addedSeconds: actualAdded,
    previousTargetSeconds,
    nextTargetSeconds
  }
}

/**
 * Compute start targetSeconds for a break handoff with optional user extend.
 * Base minutes from handoff; extendMinutes adds on top; clamp to phase max.
 */
export function computeExtendedBreakTargetSeconds(input: {
  baseMinutes: number
  extendMinutes?: number
  phase: 'short_break' | 'long_break'
}): number {
  const base = Math.max(1, Math.floor(Number.isFinite(input.baseMinutes) ? input.baseMinutes : 1))
  const extra =
    input.extendMinutes != null && Number.isFinite(input.extendMinutes)
      ? Math.max(0, Math.floor(input.extendMinutes))
      : 0
  const maxMin =
    input.phase === 'long_break'
      ? TIMER_PLAN_SEED_DEFAULTS.longBreakMinutesMax
      : TIMER_PLAN_SEED_DEFAULTS.shortBreakMinutesMax
  return Math.min(maxMin, base + extra) * 60
}
