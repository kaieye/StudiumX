/**
 * STC-206 OS sleep / app exit / cold-start reattach helpers (product path remainder).
 *
 * Pure (no React / no Electron / no IPC):
 * - Decide what a wake signal (visibility resume, pagehide, wall jump) should do
 *   for a local TimerSession so long sleep never silently credits focus.
 * - Project rehydrate of a durable running|paused|needs_reconcile session after
 *   cold start (sole-read timerSessions cache → live UI clock).
 *
 * Product rules (freeze #5 / §6.3 / §12):
 * - Short gaps: pure advance continues (same as tick path).
 * - Gap > staleGapMinutes (default 120): mark needs_reconcile; no silent credit.
 * - later / leave needs_reconcile until user decides.
 * - pagehide / exit: best-effort pin wall sample (advance dual-write), never finish.
 */

import { TIMER_SESSION_SEED, type TimerSessionRecord } from '../../../shared/study-planning'
import { pickActiveTimerSession, projectFocusTimerUi } from './planning-timer-display'
import type { StudySnapshot, StudyTimerState } from './types'

/** Renderer / host wake signals we care about for STC-206 remainder. */
export type TimerWakeSignalKind =
  | 'visibility_resume'
  | 'pagehide'
  | 'wall_sample'
  | 'hydrate_reattach'

export type TimerWakeSignal = {
  kind: TimerWakeSignalKind
  /** Wall clock sample for advance / pin. */
  nowMs: number
  /**
   * For visibility: document.visibilityState after the event.
   * Only 'visible' is treated as resume; hidden is ignored for advance.
   */
  visibilityState?: 'visible' | 'hidden' | string
}

export type TimerWakeAction =
  | { type: 'noop'; reason: string }
  | {
      type: 'advance_ok'
      session: TimerSessionRecord
      completed: boolean
      /** When true, UI should open ReconcileSheet (gap > threshold). */
      needsReconcile: boolean
      gapSeconds: number
      /** Best-effort durable pin recommended (pagehide / needs_reconcile / hydrate). */
      pinDurableAdvance: boolean
    }

export type RehydrateActiveTimerResult =
  | { kind: 'none'; reason: string }
  | {
      kind: 'reattach'
      session: TimerSessionRecord
      /** V1 shell fields to merge (remainingSeconds + timerState/mode). */
      shell: {
        remainingSeconds: number
        timerState: StudyTimerState
        timerMode: 'focus' | 'break'
      }
      needsReconcile: boolean
      gapSeconds: number
      pinDurableAdvance: boolean
    }

/**
 * Fail-closed filter: only act on signals that should re-sample the wall clock.
 * - visibility_resume: only when becoming visible
 * - pagehide: always (best-effort pin before teardown)
 * - wall_sample / hydrate_reattach: always when session present (caller gates)
 */
export function shouldHandleTimerWakeSignal(signal: TimerWakeSignal): boolean {
  if (!Number.isFinite(signal.nowMs)) return false
  if (signal.kind === 'visibility_resume') {
    return signal.visibilityState === 'visible'
  }
  if (signal.kind === 'pagehide') return true
  if (signal.kind === 'wall_sample') return true
  if (signal.kind === 'hydrate_reattach') return true
  return false
}

/**
 * Pure local advance of a running session after wake / wall jump.
 * Paused / needs_reconcile: no invented time (surface pending gap only).
 * Completed / cancelled: noop.
 */
export function projectTimerSessionAfterWake(input: {
  session: TimerSessionRecord | null | undefined
  signal: TimerWakeSignal
  staleGapMinutes?: number
}): TimerWakeAction {
  const session = input.session
  if (!session) return { type: 'noop', reason: 'no_session' }
  if (!shouldHandleTimerWakeSignal(input.signal)) {
    return { type: 'noop', reason: 'signal_ignored' }
  }

  const nowMs = Math.floor(input.signal.nowMs)
  const pinOnExit = input.signal.kind === 'pagehide'
  const pinOnHydrate = input.signal.kind === 'hydrate_reattach'
  const staleGapMinutes = input.staleGapMinutes ?? TIMER_SESSION_SEED.staleGapMinutesDefault

  if (session.state === 'needs_reconcile') {
    return {
      type: 'advance_ok',
      session,
      completed: false,
      needsReconcile: true,
      gapSeconds:
        typeof session.pendingReconcileSeconds === 'number' &&
        Number.isFinite(session.pendingReconcileSeconds)
          ? Math.max(0, Math.floor(session.pendingReconcileSeconds))
          : 0,
      // Already durable needs_reconcile; pin optional. pagehide still pins advance no-op-ish.
      pinDurableAdvance: pinOnExit
    }
  }

  if (session.state === 'paused') {
    // Do not invent time while paused; pagehide may still dual-write pause (caller).
    return {
      type: 'advance_ok',
      session,
      completed: false,
      needsReconcile: false,
      gapSeconds: 0,
      pinDurableAdvance: false
    }
  }

  if (session.state !== 'running') {
    return { type: 'noop', reason: `session_state_${session.state}` }
  }

  const projected = projectFocusTimerUi({
    session,
    nowMs,
    staleGapMinutes
  })

  return {
    type: 'advance_ok',
    session: projected.session,
    completed: projected.completed,
    needsReconcile: projected.needsReconcile,
    gapSeconds: projected.gapSeconds,
    // Pin durable when: exit, hydrate reattach, or entered needs_reconcile, or completed on wake.
    pinDurableAdvance:
      pinOnExit ||
      pinOnHydrate ||
      projected.needsReconcile ||
      projected.completed
  }
}

/**
 * Pick a durable open session and project it into a live UI clock after hydrate.
 * Prefers running > needs_reconcile > paused (pickActiveTimerSession: running first).
 * Advances running wall sample so long sleep after crash → needs_reconcile.
 */
export function projectRehydrateActiveTimerSession(input: {
  timerSessions: readonly TimerSessionRecord[] | null | undefined
  nowMs: number
  /** When local UI already owns a live session, skip reattach (no clobber). */
  localSession?: TimerSessionRecord | null
  staleGapMinutes?: number
}): RehydrateActiveTimerResult {
  if (input.localSession) {
    return { kind: 'none', reason: 'local_session_present' }
  }
  const sessions = input.timerSessions
  if (!sessions || sessions.length === 0) {
    return { kind: 'none', reason: 'no_timer_sessions' }
  }

  const picked = pickActiveTimerSession(sessions, 'any')
  if (!picked) {
    return { kind: 'none', reason: 'no_open_session' }
  }

  const wake = projectTimerSessionAfterWake({
    session: picked,
    signal: { kind: 'hydrate_reattach', nowMs: input.nowMs },
    staleGapMinutes: input.staleGapMinutes
  })

  if (wake.type === 'noop') {
    return { kind: 'none', reason: wake.reason }
  }

  // Map shell via projectFocusTimerUi display for remainingSeconds consistency.
  const display = projectFocusTimerUi({
    session: wake.session,
    // needs_reconcile / paused: project without re-advance (projectFocusTimerUi only advances running)
    nowMs: input.nowMs,
    staleGapMinutes: input.staleGapMinutes
  })

  const timerMode: 'focus' | 'break' =
    wake.session.phase === 'focus' ? 'focus' : 'break'

  return {
    kind: 'reattach',
    session: wake.session,
    shell: {
      remainingSeconds: display.projection.remainingSeconds,
      timerState: display.projection.timerState,
      timerMode
    },
    needsReconcile: wake.needsReconcile,
    gapSeconds: wake.gapSeconds,
    pinDurableAdvance: wake.pinDurableAdvance
  }
}

/**
 * Host snapshot fields to overlay after reattach / wake advance (cache only).
 */
export function mergeTimerWakeShellIntoSnapshot(
  host: StudySnapshot,
  shell: {
    remainingSeconds: number
    timerState: StudyTimerState
    timerMode: 'focus' | 'break'
  }
): StudySnapshot {
  return {
    ...host,
    remainingSeconds: shell.remainingSeconds,
    timerState: shell.timerState,
    timerMode: shell.timerMode
  }
}

