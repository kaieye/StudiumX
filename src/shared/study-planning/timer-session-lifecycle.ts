/**
 * Study planning pure domain — TimerSession lifecycle (Phase 2 / STC-201..207).
 *
 * No I/O, no IPC, no renderer wiring. planSnapshot is frozen at start/segment.
 * Identity is always TimerSession (never bare "Session").
 *
 * ADR-0094 / ADR-0117: product freezes for breakPolicy, 120min reconcile, single active.
 */

import type { TimerPlanV2 } from './timer-plan'
import { TIMER_PLAN_SEED_DEFAULTS } from './timer-plan'
import {
  customRhythmMinutesForPhase,
  isCustomRhythmPlan
} from './custom-rhythm-sequence'

export type TimerSessionPhase = 'focus' | 'short_break' | 'long_break' | 'wrap_up'
export type TimerSessionState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'needs_reconcile'
export type TimerSessionClockMode = 'countdown' | 'countup'
export type TimerSessionAttribution =
  | 'explicit'
  | 'quick_start'
  | 'unattributed'
  | 'task_deleted'
  | 'switched'

export type TimerSessionRecord = {
  id: string
  taskId: string | null
  scheduleBlockId: string | null
  phase: TimerSessionPhase
  clockMode: TimerSessionClockMode
  state: TimerSessionState
  /** Null for open-ended countup. */
  targetSeconds: number | null
  startedAtMs: number
  endedAtMs?: number
  /** Wall time when last resumed/started for gap detection. */
  lastSampleWallMs: number
  /** Accumulated confirmed active seconds (focus or break as recorded). */
  accumulatedActiveSeconds: number
  /** Focus-only active seconds (breaks never count as task focus). */
  accumulatedFocusSeconds: number
  planSnapshot: TimerPlanV2 | null
  attributionReason: TimerSessionAttribution
  focusRoundInPlan: number
  /**
   * STC-702: 0-based index into planSnapshot.rhythmSequence when kind is custom_rhythm.
   * Frozen with the segment; plan catalog edits never rewrite this or planSnapshot.
   */
  rhythmStepIndex?: number
  /** Action id that created this segment (exact-retry key at store layer). */
  startActionId?: string
  /** Pending gap seconds awaiting user reconcile (not auto-added to focus). */
  pendingReconcileSeconds?: number
}

export type TimerSessionLifecycleEvent =
  | { type: 'segment_started'; session: TimerSessionRecord }
  | { type: 'segment_paused'; session: TimerSessionRecord }
  | { type: 'segment_resumed'; session: TimerSessionRecord }
  | { type: 'segment_completed'; session: TimerSessionRecord; reason: 'target_reached' | 'manual' | 'phase_skip' }
  | { type: 'segment_cancelled'; session: TimerSessionRecord }
  | { type: 'needs_reconcile'; session: TimerSessionRecord; gapSeconds: number }
  | { type: 'phase_prompt'; session: TimerSessionRecord; nextPhase: TimerSessionPhase; breakPolicy: string }
  | { type: 'task_switched'; ended: TimerSessionRecord; started: TimerSessionRecord }

export type TimerSessionReduceResult = {
  session: TimerSessionRecord | null
  /** Previous segment when switch/finish produced a closed record. */
  closedSession?: TimerSessionRecord
  events: TimerSessionLifecycleEvent[]
  error?: { code: string; message: string }
}

export const TIMER_SESSION_SEED = {
  staleGapMinutesDefault: 120,
  openEndedCountupTarget: null as null
} as const

function clonePlan(plan: TimerPlanV2 | null | undefined): TimerPlanV2 | null {
  if (!plan) return null
  return {
    ...plan,
    notificationPolicy: { ...plan.notificationPolicy },
    ...(plan.rhythmSequence
      ? { rhythmSequence: plan.rhythmSequence.map((s) => ({ ...s })) }
      : {})
  }
}

function phaseDurationSeconds(
  plan: TimerPlanV2 | null,
  phase: TimerSessionPhase,
  rhythmStepIndex?: number
): number | null {
  if (!plan) return null
  // STC-702: prefer per-step minutes when custom_rhythm sequence is present.
  if (isCustomRhythmPlan(plan)) {
    const mins = customRhythmMinutesForPhase(plan.rhythmSequence, phase, rhythmStepIndex)
    if (mins !== undefined) return mins * 60
  }
  if (phase === 'focus') {
    if (plan.clockMode === 'countup' && plan.kind === 'continuous' && plan.focusMinutes == null) {
      return null
    }
    return (plan.focusMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes) * 60
  }
  if (phase === 'short_break') {
    return (plan.shortBreakMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes) * 60
  }
  if (phase === 'long_break') {
    return (plan.longBreakMinutes ?? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes) * 60
  }
  return (plan.wrapUpMinutes ?? TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutes) * 60
}

/** Default rhythmStepIndex for a phase (first matching step, else 0). */
function defaultRhythmStepIndex(plan: TimerPlanV2, phase: TimerSessionPhase): number | undefined {
  if (!isCustomRhythmPlan(plan)) return undefined
  const seq = plan.rhythmSequence
  const idx = seq.findIndex((s) => s.kind === phase)
  return idx >= 0 ? idx : 0
}

function nextBreakPhase(
  plan: TimerPlanV2 | null,
  focusRoundInPlan: number,
  rhythmStepIndex?: number
): TimerSessionPhase {
  if (!plan || plan.kind === 'continuous') return 'short_break'
  // STC-702: prefer walk from stored rhythmStepIndex when available.
  if (plan.kind === 'custom_rhythm' && Array.isArray(plan.rhythmSequence) && plan.rhythmSequence.length > 0) {
    const seq = plan.rhythmSequence
    if (rhythmStepIndex !== undefined && Number.isFinite(rhythmStepIndex)) {
      const base = Math.trunc(rhythmStepIndex)
      for (let j = 1; j <= seq.length; j += 1) {
        const next = seq[(base + j) % seq.length]
        if (next.kind === 'long_break') return 'long_break'
        if (next.kind === 'short_break') return 'short_break'
        if (next.kind === 'wrap_up') return 'wrap_up'
      }
      return 'short_break'
    }
    // Fallback: count focus completions vs focusRoundInPlan.
    let focusSeen = 0
    for (let i = 0; i < seq.length * 2; i += 1) {
      const step = seq[i % seq.length]
      if (step.kind === 'focus') {
        focusSeen += 1
        if (focusSeen === focusRoundInPlan) {
          for (let j = 1; j <= seq.length; j += 1) {
            const next = seq[(i + j) % seq.length]
            if (next.kind === 'long_break') return 'long_break'
            if (next.kind === 'short_break') return 'short_break'
            if (next.kind === 'wrap_up') return 'wrap_up'
          }
          break
        }
      }
    }
    return 'short_break'
  }
  const every = plan.longBreakEvery ?? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery
  if (focusRoundInPlan > 0 && focusRoundInPlan % every === 0) return 'long_break'
  return 'short_break'
}

export type StartTimerSessionInput = {
  id: string
  nowMs: number
  plan: TimerPlanV2
  clockMode?: TimerSessionClockMode
  phase?: TimerSessionPhase
  taskId?: string | null
  scheduleBlockId?: string | null
  attributionReason?: TimerSessionAttribution
  /** Override target; null = open countup. */
  targetSeconds?: number | null
  focusRoundInPlan?: number
  /** STC-702: optional sequence index for custom_rhythm step minutes. */
  rhythmStepIndex?: number
  startActionId?: string
}

/** Start a new TimerSession with frozen planSnapshot. */
export function startTimerSession(input: StartTimerSessionInput): TimerSessionReduceResult {
  const plan = clonePlan(input.plan)
  if (!plan) {
    return {
      session: null,
      events: [],
      error: { code: 'plan_required', message: 'TimerPlan snapshot required to start' }
    }
  }
  const phase = input.phase ?? 'focus'
  const clockMode = input.clockMode ?? plan.clockMode
  const rhythmStepIndex =
    input.rhythmStepIndex !== undefined
      ? input.rhythmStepIndex
      : defaultRhythmStepIndex(plan, phase)
  let targetSeconds: number | null
  if (input.targetSeconds !== undefined) {
    targetSeconds = input.targetSeconds
  } else if (clockMode === 'countup' && plan.kind === 'continuous' && plan.focusMinutes == null) {
    targetSeconds = null
  } else {
    targetSeconds = phaseDurationSeconds(plan, phase, rhythmStepIndex)
  }

  const session: TimerSessionRecord = {
    id: input.id,
    taskId: input.taskId ?? null,
    scheduleBlockId: input.scheduleBlockId ?? null,
    phase,
    clockMode,
    state: 'running',
    targetSeconds,
    startedAtMs: input.nowMs,
    lastSampleWallMs: input.nowMs,
    accumulatedActiveSeconds: 0,
    accumulatedFocusSeconds: 0,
    planSnapshot: plan,
    attributionReason: input.attributionReason ?? (input.taskId ? 'explicit' : 'unattributed'),
    focusRoundInPlan: input.focusRoundInPlan ?? (phase === 'focus' ? 1 : 0),
    ...(rhythmStepIndex !== undefined ? { rhythmStepIndex } : {}),
    ...(input.startActionId ? { startActionId: input.startActionId } : {})
  }

  return {
    session,
    events: [{ type: 'segment_started', session }]
  }
}

export function pauseTimerSession(
  session: TimerSessionRecord,
  nowMs: number
): TimerSessionReduceResult {
  if (session.state === 'needs_reconcile') {
    return {
      session,
      events: [],
      error: { code: 'needs_reconcile', message: 'Resolve reconcile before pause/resume' }
    }
  }
  if (session.state !== 'running') {
    return {
      session,
      events: [],
      error: { code: 'not_running', message: 'Only running TimerSession can pause' }
    }
  }
  const advanced = applyElapsed(session, nowMs, { allowStale: false })
  if (advanced.error) return advanced
  const paused: TimerSessionRecord = {
    ...advanced.session!,
    state: 'paused',
    lastSampleWallMs: nowMs
  }
  return {
    session: paused,
    events: [...advanced.events, { type: 'segment_paused', session: paused }]
  }
}

export function resumeTimerSession(
  session: TimerSessionRecord,
  nowMs: number
): TimerSessionReduceResult {
  if (session.state === 'needs_reconcile') {
    return {
      session,
      events: [],
      error: { code: 'needs_reconcile', message: 'Resolve reconcile before resume' }
    }
  }
  if (session.state !== 'paused') {
    return {
      session,
      events: [],
      error: { code: 'not_paused', message: 'Only paused TimerSession can resume' }
    }
  }
  const resumed: TimerSessionRecord = {
    ...session,
    state: 'running',
    lastSampleWallMs: nowMs
  }
  return {
    session: resumed,
    events: [{ type: 'segment_resumed', session: resumed }]
  }
}

export type AdvanceTimerSessionOptions = {
  /** Default 120 minutes (product freeze #5). */
  staleGapMinutes?: number
  /** When true, large gaps still add time (tests only); default false → needs_reconcile. */
  allowStale?: boolean
}

function applyElapsed(
  session: TimerSessionRecord,
  nowMs: number,
  options: AdvanceTimerSessionOptions
): TimerSessionReduceResult {
  if (session.state !== 'running') {
    return { session, events: [] }
  }
  if (!Number.isFinite(nowMs) || nowMs < session.lastSampleWallMs) {
    // Clock skew / rewind: do not invent negative time; mark reconcile.
    const marked: TimerSessionRecord = {
      ...session,
      state: 'needs_reconcile',
      pendingReconcileSeconds: session.pendingReconcileSeconds ?? 0
    }
    return {
      session: marked,
      events: [{ type: 'needs_reconcile', session: marked, gapSeconds: 0 }]
    }
  }

  const deltaSec = Math.floor((nowMs - session.lastSampleWallMs) / 1000)
  if (deltaSec <= 0) {
    return { session: { ...session, lastSampleWallMs: nowMs }, events: [] }
  }

  const staleMin = options.staleGapMinutes ?? TIMER_SESSION_SEED.staleGapMinutesDefault
  if (!options.allowStale && deltaSec > staleMin * 60) {
    const marked: TimerSessionRecord = {
      ...session,
      state: 'needs_reconcile',
      pendingReconcileSeconds: deltaSec,
      lastSampleWallMs: nowMs
    }
    return {
      session: marked,
      events: [{ type: 'needs_reconcile', session: marked, gapSeconds: deltaSec }]
    }
  }

  let accumulatedActiveSeconds = session.accumulatedActiveSeconds + deltaSec
  let accumulatedFocusSeconds = session.accumulatedFocusSeconds
  if (session.phase === 'focus') {
    accumulatedFocusSeconds += deltaSec
  }

  let next: TimerSessionRecord = {
    ...session,
    accumulatedActiveSeconds,
    accumulatedFocusSeconds,
    lastSampleWallMs: nowMs
  }

  const events: TimerSessionLifecycleEvent[] = []

  if (next.clockMode === 'countdown' && next.targetSeconds != null) {
    if (next.accumulatedActiveSeconds >= next.targetSeconds) {
      // Cap at target; completion.
      const over = next.accumulatedActiveSeconds - next.targetSeconds
      if (over > 0 && next.phase === 'focus') {
        next = {
          ...next,
          accumulatedActiveSeconds: next.targetSeconds,
          accumulatedFocusSeconds: Math.max(0, next.accumulatedFocusSeconds - over)
        }
      } else {
        next = { ...next, accumulatedActiveSeconds: next.targetSeconds }
      }
      next = {
        ...next,
        state: 'completed',
        endedAtMs: nowMs
      }
      events.push({ type: 'segment_completed', session: next, reason: 'target_reached' })
      if (next.phase === 'focus' && next.planSnapshot) {
        const breakPolicy = next.planSnapshot.breakPolicy
        const nextPhase = nextBreakPhase(
          next.planSnapshot,
          next.focusRoundInPlan,
          next.rhythmStepIndex
        )
        events.push({
          type: 'phase_prompt',
          session: next,
          nextPhase,
          breakPolicy
        })
      }
    }
  }

  return { session: next, events }
}

/** Advance running session by wall clock sample (tick / wake). */
export function advanceTimerSession(
  session: TimerSessionRecord,
  nowMs: number,
  options: AdvanceTimerSessionOptions = {}
): TimerSessionReduceResult {
  return applyElapsed(session, nowMs, options)
}

export type ReconcileDecision = 'confirm_all' | 'truncate_to_target' | 'discard_gap'

/**
 * Resolve needs_reconcile (product freeze #5): user confirms, truncates, or discards gap.
 */
export function reconcileTimerSession(
  session: TimerSessionRecord,
  decision: ReconcileDecision,
  nowMs: number
): TimerSessionReduceResult {
  if (session.state !== 'needs_reconcile') {
    return {
      session,
      events: [],
      error: { code: 'not_needs_reconcile', message: 'Session is not awaiting reconcile' }
    }
  }
  const gap = session.pendingReconcileSeconds ?? 0
  let next: TimerSessionRecord = { ...session, pendingReconcileSeconds: undefined }

  if (decision === 'discard_gap') {
    next = {
      ...next,
      state: 'running',
      lastSampleWallMs: nowMs
    }
    return { session: next, events: [{ type: 'segment_resumed', session: next }] }
  }

  if (decision === 'confirm_all') {
    let accumulatedActiveSeconds = next.accumulatedActiveSeconds + gap
    let accumulatedFocusSeconds = next.accumulatedFocusSeconds
    if (next.phase === 'focus') accumulatedFocusSeconds += gap
    next = {
      ...next,
      accumulatedActiveSeconds,
      accumulatedFocusSeconds,
      state: 'running',
      lastSampleWallMs: nowMs
    }
    return applyElapsed(next, nowMs, { allowStale: true })
  }

  // truncate_to_target: add only up to remaining target for countdown; else discard overflow.
  if (next.clockMode === 'countdown' && next.targetSeconds != null) {
    const room = Math.max(0, next.targetSeconds - next.accumulatedActiveSeconds)
    const add = Math.min(gap, room)
    let accumulatedActiveSeconds = next.accumulatedActiveSeconds + add
    let accumulatedFocusSeconds = next.accumulatedFocusSeconds
    if (next.phase === 'focus') accumulatedFocusSeconds += add
    next = {
      ...next,
      accumulatedActiveSeconds,
      accumulatedFocusSeconds,
      state: 'running',
      lastSampleWallMs: nowMs
    }
    return applyElapsed(next, nowMs, { allowStale: true })
  }

  // Open countup truncate: treat as discard_gap (no invent).
  next = { ...next, state: 'running', lastSampleWallMs: nowMs }
  return { session: next, events: [{ type: 'segment_resumed', session: next }] }
}

export function finishTimerSession(
  session: TimerSessionRecord,
  nowMs: number,
  reason: 'manual' | 'cancelled' = 'manual'
): TimerSessionReduceResult {
  if (session.state === 'completed' || session.state === 'cancelled') {
    return { session, events: [] }
  }
  let current = session
  if (current.state === 'running') {
    const advanced = applyElapsed(current, nowMs, { allowStale: false })
    if (advanced.session) current = advanced.session
    if (advanced.error) {
      // still allow cancel/finish from needs_reconcile path below
      current = advanced.session ?? current
    }
  }

  if (reason === 'cancelled') {
    const cancelled: TimerSessionRecord = {
      ...current,
      state: 'cancelled',
      endedAtMs: nowMs
    }
    return {
      session: cancelled,
      events: [{ type: 'segment_cancelled', session: cancelled }]
    }
  }

  const completed: TimerSessionRecord = {
    ...current,
    state: 'completed',
    endedAtMs: nowMs
  }
  return {
    session: completed,
    events: [{ type: 'segment_completed', session: completed, reason: 'manual' }]
  }
}

/**
 * Switch task: end current segment, start new segment with same planSnapshot (frozen).
 * Does not mutate historical plan fields on the closed segment.
 */
export function switchTimerSessionTask(input: {
  session: TimerSessionRecord
  nowMs: number
  newSessionId: string
  newTaskId: string | null
  startActionId?: string
}): TimerSessionReduceResult {
  const { session, nowMs, newSessionId, newTaskId } = input
  if (session.state !== 'running' && session.state !== 'paused') {
    return {
      session,
      events: [],
      error: { code: 'not_active', message: 'Can only switch task on running/paused TimerSession' }
    }
  }
  if (!session.planSnapshot) {
    return {
      session,
      events: [],
      error: { code: 'plan_snapshot_missing', message: 'Active session missing planSnapshot' }
    }
  }

  const finished = finishTimerSession(session, nowMs, 'manual')
  const ended = finished.session!
  const started = startTimerSession({
    id: newSessionId,
    nowMs,
    plan: session.planSnapshot,
    clockMode: session.clockMode,
    phase: session.phase === 'focus' ? 'focus' : session.phase,
    taskId: newTaskId,
    scheduleBlockId: null,
    attributionReason: 'switched',
    targetSeconds:
      session.clockMode === 'countdown'
        ? phaseDurationSeconds(
            session.planSnapshot,
            session.phase === 'focus' ? 'focus' : session.phase,
            session.rhythmStepIndex
          )
        : session.targetSeconds,
    focusRoundInPlan: session.phase === 'focus' ? session.focusRoundInPlan : session.focusRoundInPlan,
    rhythmStepIndex: session.rhythmStepIndex,
    startActionId: input.startActionId
  })

  if (!started.session) return started

  return {
    session: started.session,
    closedSession: ended,
    events: [
      ...finished.events,
      ...started.events,
      { type: 'task_switched', ended, started: started.session }
    ]
  }
}

/**
 * Begin next phase after focus completion. Uses frozen planSnapshot only
 * (editing the live plan catalog does not rewrite this).
 */
export function startNextPhaseFromCompleted(input: {
  completed: TimerSessionRecord
  nowMs: number
  newSessionId: string
  phase: TimerSessionPhase
  /** When breakPolicy is ask, caller must only invoke after user confirms. */
  userConfirmed: boolean
  startActionId?: string
  /**
   * Optional focus taskId when starting focus after a break (break taskId is null).
   * Ignored for non-focus phases. When omitted, uses completed.taskId (may be null).
   */
  taskId?: string | null
}): TimerSessionReduceResult {
  const plan = input.completed.planSnapshot
  if (!plan) {
    return {
      session: null,
      events: [],
      error: { code: 'plan_snapshot_missing', message: 'No planSnapshot on completed session' }
    }
  }
  if (input.completed.state !== 'completed') {
    return {
      session: null,
      events: [],
      error: { code: 'not_completed', message: 'Next phase requires completed segment' }
    }
  }
  if (plan.breakPolicy === 'ask' && !input.userConfirmed) {
    return {
      session: null,
      events: [],
      error: { code: 'break_needs_confirmation', message: 'breakPolicy ask requires userConfirmed' }
    }
  }
  if (plan.breakPolicy === 'none' && input.phase !== 'focus' && input.phase !== 'wrap_up') {
    return {
      session: null,
      events: [],
      error: { code: 'break_disabled', message: 'breakPolicy none forbids break phases' }
    }
  }

  const focusRound =
    input.phase === 'focus' ? input.completed.focusRoundInPlan + 1 : input.completed.focusRoundInPlan

  // STC-702: advance rhythmStepIndex to the next matching phase step (wrap).
  let rhythmStepIndex: number | undefined
  if (isCustomRhythmPlan(plan)) {
    const seq = plan.rhythmSequence
    const completedIdx =
      input.completed.rhythmStepIndex !== undefined
        ? input.completed.rhythmStepIndex
        : defaultRhythmStepIndex(plan, input.completed.phase) ?? 0
    for (let j = 1; j <= seq.length; j += 1) {
      const idx = (Math.trunc(completedIdx) + j) % seq.length
      if (seq[idx].kind === input.phase) {
        rhythmStepIndex = idx
        break
      }
    }
    if (rhythmStepIndex === undefined) {
      rhythmStepIndex = defaultRhythmStepIndex(plan, input.phase)
    }
  }

  const taskId =
    input.phase === 'focus'
      ? input.taskId !== undefined
        ? input.taskId
        : input.completed.taskId
      : null
  const attributionReason =
    input.phase === 'focus' && taskId
      ? 'explicit'
      : input.phase === 'focus'
        ? 'unattributed'
        : 'unattributed'

  return startTimerSession({
    id: input.newSessionId,
    nowMs: input.nowMs,
    plan,
    phase: input.phase,
    clockMode: plan.clockMode === 'countup' && input.phase === 'focus' ? 'countup' : 'countdown',
    taskId,
    attributionReason,
    focusRoundInPlan: focusRound,
    ...(rhythmStepIndex !== undefined ? { rhythmStepIndex } : {}),
    startActionId: input.startActionId
  })
}

/** Display remaining (countdown) or elapsed (countup). Pure projection. */
export function projectTimerDisplay(session: TimerSessionRecord): {
  mode: TimerSessionClockMode
  elapsedSeconds: number
  remainingSeconds: number | null
  targetSeconds: number | null
} {
  const elapsed = session.accumulatedActiveSeconds
  if (session.clockMode === 'countup') {
    return {
      mode: 'countup',
      elapsedSeconds: elapsed,
      remainingSeconds: session.targetSeconds != null ? Math.max(0, session.targetSeconds - elapsed) : null,
      targetSeconds: session.targetSeconds
    }
  }
  const target = session.targetSeconds ?? 0
  return {
    mode: 'countdown',
    elapsedSeconds: elapsed,
    remainingSeconds: Math.max(0, target - elapsed),
    targetSeconds: session.targetSeconds
  }
}

/**
 * Assert at most one running session in a list (STC-207 / invariant #1).
 */
export function findRunningTimerSessions(
  sessions: readonly TimerSessionRecord[]
): TimerSessionRecord[] {
  return sessions.filter((s) => s.state === 'running')
}

export function assertSingleRunningTimerSession(
  sessions: readonly TimerSessionRecord[]
): { ok: true } | { ok: false; code: 'multiple_running'; ids: string[] } {
  const running = findRunningTimerSessions(sessions)
  if (running.length <= 1) return { ok: true }
  return { ok: false, code: 'multiple_running', ids: running.map((s) => s.id) }
}
