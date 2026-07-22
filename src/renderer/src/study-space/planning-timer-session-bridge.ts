/**
 * TimerSession product-path bridge (focus + break + room-cycle + phase handoff).
 *
 * Pure orchestration helpers for dual-write transitions + sole-read projection
 * so useStudySession stays thin. No React; caller owns refs / reportPlanningWrite.
 *
 * Room-cycle join: finish any prior TimerSession, then start a session whose
 * phase/targetSeconds match the shared study-room cycle (not the personal preset).
 *
 * STC-205: start break from completed focus uses frozen planSnapshot
 * (startNextPhaseFromCompleted) — catalog edits must not rewrite the segment.
 *
 * STC-206: reconcile_stale + pin_needs_reconcile for freeze #5 gap UX.
 */

import type { DualWriteResult, CanonicalPlanningContext } from './planning-dual-write'
import {
  createCanonicalTimerSessionId,
  dualWriteAdvanceTimerSession,
  dualWriteFinishTimerSession,
  dualWritePauseTimerSession,
  dualWriteReconcileStaleSession,
  dualWriteResumeTimerSession,
  dualWriteStartTimerSession,
  dualWriteSwitchSessionTask,
  resolveTimerAttribution,
  type DualWriteReconcileDecision
} from './planning-timer-dual-write'
import {
  mergeFocusTimerProjectionIntoSnapshot,
  pauseLocalFocusTimerSession,
  projectFocusTimerUi,
  resolveBreakPhaseFromPlan,
  resumeLocalFocusTimerSession,
  startLocalBreakTimerSession,
  startLocalFocusTimerSession,
  startLocalNextPhaseFromCompleted,
  applyLocalReconcileDecision
} from './planning-timer-display'
import type { StudySnapshot } from './types'
import type { TimerPlanV2, TimerSessionPhase, TimerSessionRecord } from '../../../shared/study-planning'
import { switchTimerSessionTask } from '../../../shared/study-planning'

export type TimerSessionTransition =
  | {
      kind: 'start'
      taskId?: string | null
      /** Null for open continuous countup (STC-504). */
      targetSeconds: number | null
      phase?: 'focus' | 'short_break' | 'long_break'
      /** Frozen planSnapshot for this segment (preferred over catalog planId). */
      plan?: TimerPlanV2
      planId?: string
      focusRoundInPlan?: number
    }
  | {
      /**
       * STC-205: start next phase from a completed focus/break segment.
       * Uses frozen planSnapshot only; ask policy requires userConfirmed.
       */
      kind: 'start_from_completed'
      completed: TimerSessionRecord
      phase: TimerSessionPhase
      userConfirmed: boolean
      targetSeconds?: number
      /** Focus task after break end (optional). */
      taskId?: string | null
    }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'finish'; reason: 'manual' | 'cancelled' }
  | {
      /** STC-206: resolve needs_reconcile (confirm / truncate / discard). */
      kind: 'reconcile_stale'
      decision: DualWriteReconcileDecision
    }
  | {
      /** Pin local needs_reconcile gap to durable store (optional). */
      kind: 'pin_needs_reconcile'
    }
  | {
      /**
       * STC-204: switch focus attribution mid-run.
       * Ends current TimerSession segment and starts a new one with frozen planSnapshot.
       * newTaskId null = unattributed focus segment.
       */
      kind: 'switch_task'
      newTaskId: string | null
    }

export type CanonicalTimerRefs = {
  sessionId: string | null
  session: TimerSessionRecord | null
  /** Set when switch_task closes the prior segment (STC-204). */
  closedSession?: TimerSessionRecord | null
}

/**
 * Apply a TimerSession transition: update local session + fire dual-write.
 * Returns next ref bag. Never thrash advance_timer_session per tick.
 */
export function applyTimerSessionTransition(input: {
  transition: TimerSessionTransition
  ctx: CanonicalPlanningContext
  refs: CanonicalTimerRefs
  nowMs?: number
  planId?: string
  onWrite?: (result: DualWriteResult) => void
}): CanonicalTimerRefs {
  const nowMs = input.nowMs ?? Date.now()
  const planId = input.planId ?? 'classic_25_5'
  const report = input.onWrite ?? (() => undefined)
  const transition = input.transition
  let sessionId = input.refs.sessionId
  let session = input.refs.session

  if (transition.kind === 'start_from_completed') {
    const nextId = createCanonicalTimerSessionId(nowMs)
    const started = startLocalNextPhaseFromCompleted({
      completed: transition.completed,
      newSessionId: nextId,
      nowMs,
      phase: transition.phase,
      userConfirmed: transition.userConfirmed,
      ...(transition.targetSeconds !== undefined ? { targetSeconds: transition.targetSeconds } : {}),
      ...(transition.taskId !== undefined ? { taskId: transition.taskId } : {})
    })
    if (!started) {
      return { sessionId: null, session: null }
    }
    session = started
    sessionId = nextId
    const frozenPlanId = transition.completed.planSnapshot?.id ?? planId
    void dualWriteStartTimerSession(input.ctx, {
      sessionId: nextId,
      taskId: started.taskId,
      attributionReason: started.attributionReason === 'explicit' || started.attributionReason === 'quick_start'
        ? started.attributionReason
        : 'unattributed',
      targetSeconds: started.targetSeconds,
      planId: frozenPlanId,
      phase: started.phase as 'focus' | 'short_break' | 'long_break' | 'wrap_up'
    }).then(report)
    return { sessionId, session }
  }

  if (transition.kind === 'start') {
    const nextId = createCanonicalTimerSessionId(nowMs)
    const phase = transition.phase ?? 'focus'
    const resolvedPlanId = transition.plan?.id ?? transition.planId ?? planId
    if (phase === 'focus') {
      const attr = resolveTimerAttribution(transition.taskId)
      session = startLocalFocusTimerSession({
        sessionId: nextId,
        nowMs,
        taskId: attr.taskId,
        attributionReason: attr.attributionReason,
        targetSeconds: transition.targetSeconds,
        planId: resolvedPlanId,
        ...(transition.plan ? { plan: transition.plan } : {}),
        ...(transition.focusRoundInPlan !== undefined
          ? { focusRoundInPlan: transition.focusRoundInPlan }
          : {}),
        phase: 'focus'
      })
      sessionId = nextId
      void dualWriteStartTimerSession(input.ctx, {
        sessionId: nextId,
        taskId: attr.taskId,
        attributionReason: attr.attributionReason,
        targetSeconds: transition.targetSeconds,
        planId: resolvedPlanId,
        phase: 'focus'
      }).then(report)
      return { sessionId, session }
    }
    session = startLocalBreakTimerSession({
      sessionId: nextId,
      nowMs,
      targetSeconds: transition.targetSeconds,
      planId: resolvedPlanId,
      ...(transition.plan ? { plan: transition.plan } : {}),
      ...(transition.focusRoundInPlan !== undefined
        ? { focusRoundInPlan: transition.focusRoundInPlan }
        : {}),
      phase
    })
    sessionId = nextId
    void dualWriteStartTimerSession(input.ctx, {
      sessionId: nextId,
      taskId: null,
      attributionReason: 'unattributed',
      targetSeconds: transition.targetSeconds,
      planId: resolvedPlanId,
      phase
    }).then(report)
    return { sessionId, session }
  }

  if (!sessionId) return { sessionId, session }

  if (transition.kind === 'pause') {
    if (session) {
      session = pauseLocalFocusTimerSession(session, nowMs)
    }
    void dualWritePauseTimerSession(input.ctx, sessionId).then(report)
    return { sessionId, session }
  }

  if (transition.kind === 'resume') {
    if (session) {
      session = resumeLocalFocusTimerSession(session, nowMs)
    }
    void dualWriteResumeTimerSession(input.ctx, sessionId).then(report)
    return { sessionId, session }
  }

  if (transition.kind === 'reconcile_stale') {
    if (session) {
      session = applyLocalReconcileDecision({
        session,
        decision: transition.decision,
        nowMs
      })
    }
    void dualWriteReconcileStaleSession(input.ctx, sessionId, transition.decision).then(report)
    // If reconcile completed the segment, clear open refs (caller may still read session once).
    if (session && (session.state === 'completed' || session.state === 'cancelled')) {
      return { sessionId: null, session }
    }
    return { sessionId, session }
  }

  if (transition.kind === 'pin_needs_reconcile') {
    // Local already needs_reconcile; publish wall advance so durable store matches.
    void dualWriteAdvanceTimerSession(input.ctx, sessionId, nowMs).then(report)
    return { sessionId, session }
  }

  if (transition.kind === 'switch_task') {
    if (!session) {
      // No local session: cannot invent a frozen planSnapshot for switch.
      return { sessionId, session }
    }
    if (session.phase !== 'focus') {
      // Mid-run switch is focus-only product path (breaks stay unattributed).
      return { sessionId, session }
    }
    if (session.state !== 'running' && session.state !== 'paused') {
      return { sessionId, session }
    }
    const sameTask =
      (session.taskId ?? null) === (transition.newTaskId ?? null)
    if (sameTask) {
      return { sessionId, session }
    }
    const nextId = createCanonicalTimerSessionId(nowMs)
    const switched = switchTimerSessionTask({
      session,
      nowMs,
      newSessionId: nextId,
      newTaskId: transition.newTaskId
    })
    if (switched.error || !switched.session) {
      return { sessionId, session }
    }
    session = switched.session
    sessionId = nextId
    void dualWriteSwitchSessionTask(input.ctx, {
      sessionId: input.refs.sessionId!,
      newSessionId: nextId,
      newTaskId: transition.newTaskId
    }).then(report)
    return {
      sessionId,
      session,
      closedSession: switched.closedSession ?? null
    }
  }

  // finish
  void dualWriteFinishTimerSession(input.ctx, sessionId, transition.reason).then(report)
  return { sessionId: null, session: null }
}

export type RoomCycleTimerStartInput = {
  /** Shared room cycle phase (V1 StudyTimerMode). */
  roomPhase: 'focus' | 'break'
  /** Remaining seconds in the current room cycle segment. */
  remainingSeconds: number
  /** Focus attribution; ignored for break (break sessions use taskId null). */
  taskId?: string | null
  /** Room break minutes — used to pick short_break vs long_break. */
  breakMinutes: number
}

/**
 * Map room-cycle phase → TimerSession start transition.
 * Focus keeps task attribution; break is always unattributed short/long rest.
 */
export function buildRoomCycleTimerStartTransition(
  input: RoomCycleTimerStartInput
): TimerSessionTransition {
  const targetSeconds = Math.max(1, Math.floor(input.remainingSeconds))
  if (input.roomPhase === 'focus') {
    return {
      kind: 'start',
      taskId: input.taskId,
      targetSeconds,
      phase: 'focus'
    }
  }
  const breakPhase = resolveBreakPhaseFromPlan({
    breakMinutes: input.breakMinutes
  })
  return {
    kind: 'start',
    taskId: null,
    targetSeconds,
    phase: breakPhase
  }
}

/**
 * Follow room cycle on the TimerSession path:
 * 1) finish prior local/durable session (if any) — mirrors V1 interrupted finish
 * 2) start a new session with room remainingSeconds + phase
 *
 * Does not thrash advance_timer_session per tick. Empty-start attribution stays
 * with the caller (resolveFocusTaskId before this).
 */
export function applyRoomCycleTimerSession(input: {
  ctx: CanonicalPlanningContext
  refs: CanonicalTimerRefs
  roomPhase: 'focus' | 'break'
  remainingSeconds: number
  taskId?: string | null
  breakMinutes: number
  nowMs?: number
  planId?: string
  onWrite?: (result: DualWriteResult) => void
}): CanonicalTimerRefs {
  let refs = input.refs
  if (refs.sessionId) {
    refs = applyTimerSessionTransition({
      transition: { kind: 'finish', reason: 'manual' },
      ctx: input.ctx,
      refs,
      nowMs: input.nowMs,
      planId: input.planId,
      onWrite: input.onWrite
    })
  }
  const start = buildRoomCycleTimerStartTransition({
    roomPhase: input.roomPhase,
    remainingSeconds: input.remainingSeconds,
    taskId: input.taskId,
    breakMinutes: input.breakMinutes
  })
  return applyTimerSessionTransition({
    transition: start,
    ctx: input.ctx,
    refs,
    nowMs: input.nowMs,
    planId: input.planId,
    onWrite: input.onWrite
  })
}

/**
 * Sole-read: project local TimerSession into V1 remainingSeconds cache.
 * Mode handoff is STC-205 product path; segment-close analytics project from
 * TimerSession (planning-timer-session-analytics).
 */
export function projectAndMergeTimerClock(input: {
  host: StudySnapshot
  session: TimerSessionRecord | null
  nowMs?: number
  fullState?: boolean
}): {
  snapshot: StudySnapshot
  session: TimerSessionRecord | null
  completed: boolean
  needsReconcile: boolean
  gapSeconds: number
} {
  const active = input.session
  if (!active) {
    return { snapshot: input.host, session: null, completed: false, needsReconcile: false, gapSeconds: 0 }
  }
  const sessionIsBreak = active.phase === 'short_break' || active.phase === 'long_break'
  if (input.host.timerMode === 'focus' && sessionIsBreak) {
    return {
      snapshot: input.host,
      session: active,
      completed: false,
      needsReconcile: active.state === 'needs_reconcile',
      gapSeconds: active.pendingReconcileSeconds ?? 0
    }
  }
  if (input.host.timerMode === 'break' && active.phase === 'focus') {
    return {
      snapshot: input.host,
      session: active,
      completed: false,
      needsReconcile: active.state === 'needs_reconcile',
      gapSeconds: active.pendingReconcileSeconds ?? 0
    }
  }
  const nowMs = input.nowMs ?? Date.now()
  // Already awaiting reconcile: do not re-advance; surface pending gap.
  if (active.state === 'needs_reconcile') {
    const projected = projectFocusTimerUi({ session: active, nowMs })
    return {
      snapshot: mergeFocusTimerProjectionIntoSnapshot(input.host, projected.projection, {
        fullState: true
      }),
      session: active,
      completed: false,
      needsReconcile: true,
      gapSeconds: active.pendingReconcileSeconds ?? 0
    }
  }
  const projected = projectFocusTimerUi({ session: active, nowMs })
  return {
    snapshot: mergeFocusTimerProjectionIntoSnapshot(input.host, projected.projection, {
      fullState: input.fullState === true
    }),
    session: projected.session,
    completed: projected.completed,
    needsReconcile: projected.needsReconcile,
    gapSeconds: projected.gapSeconds
  }
}
