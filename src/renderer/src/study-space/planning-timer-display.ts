/**
 * Timer sole-read display projection (Slice D remainder).
 *
 * Focus clock authority for UI:
 * - When a focus TimerSession is running/paused locally, project remaining/elapsed
 *   via shared `projectTimerDisplay` + pure wall advance (no disk thrash).
 * - V1 StudySnapshot.remainingSeconds is kept in sync as a rebuildable cache so
 *   WorkbenchPomodoro / viewModel continue to read familiar fields.
 * - Durable store still receives only start/pause/resume/finish dual-write;
 *   per-tick advance stays pure local (never advance_timer_session every second).
 *
 * Break segments: local TimerSession with phase short_break|long_break is UI clock
 * authority when present. Segment-close analytics project from TimerSession
 * (planning-timer-session-analytics); mode handoff is product-path STC-205.
 * Live focus-second counters credit from TimerSession deltas
 * (planning-timer-session-focus-counters); V1 twin counters are stripped on tick.
 */

import {
  advanceTimerSession,
  pauseTimerSession,
  projectTimerDisplay,
  reconcileTimerSession,
  resumeTimerSession,
  startNextPhaseFromCompleted,
  startTimerSession,
  type ReconcileDecision,
  type TimerPlanV2,
  type TimerSessionPhase,
  type TimerSessionRecord,
  type TimerSessionState,
  phaseTargetSecondsForPlan
} from '../../../shared/study-planning'
import type { StudySnapshot, StudyTimerState } from './types'
import { resolvePlanV2ForStart } from './planning-timer-plan-kind'

export type FocusTimerUiProjection = {
  /** V1-compatible fields for snapshot cache merge. */
  remainingSeconds: number
  timerState: StudyTimerState
  timerMode: 'focus' | 'break'
  /** Shared projection detail. */
  elapsedSeconds: number
  targetSeconds: number | null
  clockMode: 'countdown' | 'countup'
  phase: TimerSessionRecord['phase']
  sessionId: string
  taskId: string | null
  /** True when projection came from TimerSession (not V1-only break path). */
  fromCanonicalSession: true
}

export type ProjectFocusTimerUiInput = {
  session: TimerSessionRecord
  /** Wall sample for pure local advance of a running session. */
  nowMs: number
  /** Optional stale gap; default matches TIMER_SESSION_SEED (120). */
  staleGapMinutes?: number
}

/**
 * Pure local advance + UI projection. Does not write store/disk.
 * Running sessions are advanced in-memory from lastSampleWallMs to nowMs.
 */
export function projectFocusTimerUi(input: ProjectFocusTimerUiInput): {
  session: TimerSessionRecord
  projection: FocusTimerUiProjection
  completed: boolean
  needsReconcile: boolean
  gapSeconds: number
} {
  const { nowMs, staleGapMinutes } = input
  let session = input.session
  let completed = false
  let needsReconcile = false
  let gapSeconds = 0

  if (session.state === 'running') {
    const advanced = advanceTimerSession(session, nowMs, {
      ...(staleGapMinutes !== undefined ? { staleGapMinutes } : {})
    })
    if (advanced.session) session = advanced.session
    for (const ev of advanced.events) {
      if (ev.type === 'segment_completed') completed = true
      if (ev.type === 'needs_reconcile') {
        needsReconcile = true
        gapSeconds = ev.gapSeconds
      }
    }
  }

  const display = projectTimerDisplay(session)
  const remainingSeconds =
    display.mode === 'countdown'
      ? Math.max(0, display.remainingSeconds ?? 0)
      : Math.max(0, display.elapsedSeconds)

  const timerState = mapTimerSessionStateToV1(session.state)

  const projection: FocusTimerUiProjection = {
    remainingSeconds:
      display.mode === 'countdown'
        ? // V1 advanceStudyTimerBySeconds floors remaining to >=1 while running;
          // keep 0 only when completed so UI can show end state cleanly.
          completed
          ? 0
          : Math.max(1, Math.ceil(remainingSeconds || 0))
        : Math.max(0, remainingSeconds),
    timerState,
    timerMode: session.phase === 'focus' ? 'focus' : 'break',
    elapsedSeconds: display.elapsedSeconds,
    targetSeconds: display.targetSeconds,
    clockMode: display.mode,
    phase: session.phase,
    sessionId: session.id,
    taskId: session.taskId,
    fromCanonicalSession: true
  }

  return { session, projection, completed, needsReconcile, gapSeconds }
}

export function mapTimerSessionStateToV1(state: TimerSessionState): StudyTimerState {
  if (state === 'running') return 'running'
  if (state === 'paused' || state === 'needs_reconcile') return 'paused'
  return 'idle'
}

/**
 * Apply user reconcile decision to local needs_reconcile session (pure).
 * Fail-closed: returns original session when decision invalid / not awaiting reconcile.
 */
export function applyLocalReconcileDecision(input: {
  session: TimerSessionRecord
  decision: ReconcileDecision
  nowMs: number
}): TimerSessionRecord {
  const r = reconcileTimerSession(input.session, input.decision, input.nowMs)
  if (r.error || !r.session) return input.session
  return r.session
}

/**
 * Merge focus timer projection into V1 snapshot shell (cache fields only).
 * Preserves tasks/presence/stats; does not invent analytics XP.
 *
 * By default only overlays remainingSeconds so product-path handoff handlers
 * own focus→break completion. Pass fullState: true to also project timerState
 * (pause/resume paths).
 */
export function mergeFocusTimerProjectionIntoSnapshot(
  host: StudySnapshot,
  projection: FocusTimerUiProjection,
  options?: { fullState?: boolean }
): StudySnapshot {
  if (options?.fullState) {
    return {
      ...host,
      timerMode: projection.timerMode,
      timerState: projection.timerState,
      remainingSeconds: projection.remainingSeconds
    }
  }
  // Display sole-read: remainingSeconds only while V1 still runs the segment.
  return {
    ...host,
    remainingSeconds: projection.remainingSeconds
  }
}

export type StartLocalFocusTimerSessionInput = {
  sessionId: string
  nowMs: number
  taskId?: string | null
  attributionReason?: 'explicit' | 'quick_start' | 'unattributed'
  /** Prefer V1 remainingSeconds so UI duration matches preset. */
  targetSeconds?: number | null
  plan?: TimerPlanV2
  planId?: string
  /** Defaults to focus. Use short_break|long_break for rest segments. */
  phase?: TimerSessionPhase
  /** Preserve focus round across phase handoff when starting focus again. */
  focusRoundInPlan?: number
}

/**
 * Build a local running TimerSession with frozen planSnapshot.
 * Pure — caller dual-writes start separately.
 * phase defaults to focus; pass short_break|long_break for rest segments.
 */
export function startLocalFocusTimerSession(
  input: StartLocalFocusTimerSessionInput
): TimerSessionRecord {
  const phase: TimerSessionPhase = input.phase ?? 'focus'
  const plan =
    input.plan ??
    resolvePlanV2ForStart({
      planId: input.planId,
      plan: null
    })
  const started = startTimerSession({
    id: input.sessionId,
    nowMs: input.nowMs,
    plan,
    phase,
    taskId: phase === 'focus' ? (input.taskId ?? null) : null,
    attributionReason:
      phase === 'focus'
        ? (input.attributionReason ??
          (input.taskId ? 'explicit' : 'unattributed'))
        : 'unattributed',
    ...(input.targetSeconds !== undefined ? { targetSeconds: input.targetSeconds } : {}),
    ...(input.focusRoundInPlan !== undefined ? { focusRoundInPlan: input.focusRoundInPlan } : {})
  })
  if (!started.session) {
    // Fail-closed fallback: still return a minimal running record so UI can start.
    // Prefer shared phaseTargetSecondsForPlan (seed defaults) — not hard-coded 25/15/5.
    const fallbackTarget: number | null =
      input.targetSeconds !== undefined
        ? input.targetSeconds
        : phaseTargetSecondsForPlan(
            plan,
            phase === 'long_break'
              ? 'long_break'
              : phase === 'wrap_up'
                ? 'wrap_up'
                : phase === 'focus'
                  ? 'focus'
                  : 'short_break'
          )
    return {
      id: input.sessionId,
      taskId: phase === 'focus' ? (input.taskId ?? null) : null,
      scheduleBlockId: null,
      phase,
      clockMode: plan.clockMode === 'countup' && phase === 'focus' ? 'countup' : 'countdown',
      state: 'running',
      targetSeconds: fallbackTarget,
      startedAtMs: input.nowMs,
      lastSampleWallMs: input.nowMs,
      accumulatedActiveSeconds: 0,
      accumulatedFocusSeconds: 0,
      planSnapshot: plan,
      attributionReason:
        phase === 'focus'
          ? (input.attributionReason ?? (input.taskId ? 'explicit' : 'unattributed'))
          : 'unattributed',
      focusRoundInPlan:
        input.focusRoundInPlan ?? (phase === 'focus' ? 1 : 0)
    }
  }
  return started.session
}

/**
 * Convenience: local short_break session (taskId forced null).
 */
export function startLocalBreakTimerSession(
  input: Omit<StartLocalFocusTimerSessionInput, 'phase' | 'taskId' | 'attributionReason'> & {
    phase?: 'short_break' | 'long_break'
  }
): TimerSessionRecord {
  return startLocalFocusTimerSession({
    ...input,
    phase: input.phase ?? 'short_break',
    taskId: null,
    attributionReason: 'unattributed'
  })
}

/**
 * STC-205: start next phase from a completed focus segment using frozen planSnapshot.
 * Returns null when pure reducer rejects (ask without confirm / none forbids break).
 */
export function startLocalNextPhaseFromCompleted(input: {
  completed: TimerSessionRecord
  newSessionId: string
  nowMs: number
  phase: TimerSessionPhase
  userConfirmed: boolean
  targetSeconds?: number | null
  /** Focus task after break (break sessions have null taskId). */
  taskId?: string | null
}): TimerSessionRecord | null {
  const started = startNextPhaseFromCompleted({
    completed: input.completed,
    nowMs: input.nowMs,
    newSessionId: input.newSessionId,
    phase: input.phase,
    userConfirmed: input.userConfirmed,
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {})
  })
  if (!started.session) return null
  if (input.targetSeconds !== undefined) {
    return { ...started.session, targetSeconds: input.targetSeconds }
  }
  return started.session
}

/**
 * Project ring progress (0–100) for V1 snapshot / focus UI.
 *
 * Explicit dual-write semantics for 
emainingSeconds:
 * - countdown: seconds left (depletes toward 0)
 * - countup: elapsed seconds (fills toward total)
 *
 * Idle + countup always yields 0% so shells that seed remaining to the
 * target (or 0) do not paint a full / inverted ring before start.
 */
export function projectTimerProgressPercent(input: {
  /**
   * Countdown: seconds left. Countup (exam / continuous): elapsed seconds
   * (same dual-write cache shape as FocusTimerUiProjection.remainingSeconds).
   */
  remainingSeconds: number
  targetSeconds: number | null | undefined
  focusMinutes: number
  breakMinutes: number
  timerMode: 'focus' | 'break'
  /**
   * Countup rings fill clockwise from empty; countdown depletes remaining.
   * Default countdown preserves historical callers.
   */
  clockMode?: 'countdown' | 'countup'
  /**
   * When countup and idle, progress stays 0 even if remainingSeconds was
   * seeded to total (or left at 0). Running/paused countup fill from value.
   *
   * Open continuous (countup without a positive targetSeconds) has
   * **indeterminate** progress until product defines a soft cap — do not
   * fall back to focusMinutes*60 (that paints a fake ring). All states
   * return 0 when there is no positive target.
   */
  timerState?: 'idle' | 'running' | 'paused'
}): number {
  if (input.clockMode === 'countup') {
    // Open continuous / missing target: no determinate ring (avoid fake focusMinutes total).
    if (input.targetSeconds == null || input.targetSeconds <= 0) return 0
    if (input.timerState === 'idle') return 0
    const total = input.targetSeconds
    const value = Math.max(0, input.remainingSeconds)
    return Math.min(100, Math.max(0, Math.round((value / total) * 100)))
  }
  const total =
    input.targetSeconds != null && input.targetSeconds > 0
      ? input.targetSeconds
      : (input.timerMode === 'focus' ? input.focusMinutes : input.breakMinutes) * 60
  if (total <= 0) return 0
  const value = Math.max(0, input.remainingSeconds)
  return Math.min(100, Math.max(0, Math.round(((total - value) / total) * 100)))
}

/**
 * Pick the active (running/paused/needs_reconcile) focus session from a list.
 * Prefers running over paused.
 */
export function pickActiveFocusTimerSession(
  sessions: readonly TimerSessionRecord[]
): TimerSessionRecord | null {
  return pickActiveTimerSession(sessions, 'focus')
}

/**
 * Pick active session for a phase group. phaseGroup 'break' matches short_break|long_break.
 * Prefers running over paused.
 */
export function pickActiveTimerSession(
  sessions: readonly TimerSessionRecord[],
  phaseGroup: 'focus' | 'break' | 'any' = 'any'
): TimerSessionRecord | null {
  const match = sessions.filter((s) => {
    const active =
      s.state === 'running' || s.state === 'paused' || s.state === 'needs_reconcile'
    if (!active) return false
    if (phaseGroup === 'any') return true
    if (phaseGroup === 'focus') return s.phase === 'focus'
    return s.phase === 'short_break' || s.phase === 'long_break'
  })
  if (match.length === 0) return null
  const running = match.find((s) => s.state === 'running')
  if (running) return running
  return match[0] ?? null
}

/** Map V1 breakMinutes + optional long-break preference to TimerSession phase. */
export function resolveBreakPhaseFromPlan(input: {
  breakMinutes: number
  plan?: TimerPlanV2 | null
}): 'short_break' | 'long_break' {
  const plan = input.plan
  if (plan?.longBreakMinutes != null && input.breakMinutes >= plan.longBreakMinutes) {
    return 'long_break'
  }
  // Classic: long break typically 15, short 5. Treat >= 12 as long when no plan.
  if (!plan && input.breakMinutes >= 12) return 'long_break'
  return 'short_break'
}


/**
 * Pure local pause of focus TimerSession (caller dual-writes separately).
 */
export function pauseLocalFocusTimerSession(
  session: TimerSessionRecord,
  nowMs: number
): TimerSessionRecord {
  if (session.state !== 'running') return session
  const paused = pauseTimerSession(session, nowMs)
  return paused.session ?? { ...session, state: 'paused', lastSampleWallMs: nowMs }
}

/**
 * Pure local resume of focus TimerSession (caller dual-writes separately).
 */
export function resumeLocalFocusTimerSession(
  session: TimerSessionRecord,
  nowMs: number
): TimerSessionRecord {
  if (session.state !== 'paused' && session.state !== 'needs_reconcile') return session
  if (session.state === 'needs_reconcile') {
    // UI sole-read: resume without inventing gap seconds (discard_gap spirit).
    return {
      ...session,
      state: 'running',
      lastSampleWallMs: nowMs,
      pendingReconcileSeconds: undefined
    }
  }
  const resumed = resumeTimerSession(session, nowMs)
  return resumed.session ?? { ...session, state: 'running', lastSampleWallMs: nowMs }
}