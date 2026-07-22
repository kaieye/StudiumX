/**
 * Live focus-second counters from TimerSession (sole-authority demotion).
 *
 * While a canonical TimerSession is running, todayFocusSeconds / totalFocusSeconds
 * / streak should credit from TimerSession accumulatedFocusSeconds deltas — not
 * from the parallel V1 ActiveStudySession reliable-timer twin.
 *
 * Completion shell (sessions / xp) remains planning-timer-session-analytics.
 * Presence broadcast still reads StudySnapshot counters (rebuildable shell).
 *
 * Not teaching authority. No disk thrash. No import of session-bridge (cycle-safe).
 */

import type { TimerSessionRecord } from '../../../shared/study-planning'
import { nextStudyStreakForDate } from './domain'
import type { StudySnapshot } from './types'

/**
 * Focus-second delta between two TimerSession samples of the same segment.
 * Only credits when both samples are focus phase with the same session id.
 * First sample / new session id → 0 (avoid hydrate double-count).
 * Clamps negative (clock skew / reset) to 0.
 */
export function focusSecondsDeltaBetweenSessions(
  previous: TimerSessionRecord | null | undefined,
  next: TimerSessionRecord | null | undefined
): number {
  if (!next || next.phase !== 'focus') return 0
  if (!previous || previous.phase !== 'focus' || previous.id !== next.id) return 0
  const nextSecs = Math.max(0, Math.floor(next.accumulatedFocusSeconds))
  const prevSecs = Math.max(0, Math.floor(previous.accumulatedFocusSeconds))
  return Math.max(0, nextSecs - prevSecs)
}

/**
 * Credit live focus counters on the V1 shell without mutating timer mode/state/remaining.
 * Break / wrap_up never credit focus.
 */
export function creditLiveFocusSeconds(input: {
  host: StudySnapshot
  focusDeltaSeconds: number
  localToday: string
  /** When false, skip (break / wrap_up). Default true. */
  isFocusPhase?: boolean
}): StudySnapshot {
  if (input.isFocusPhase === false) return input.host
  const delta = Math.max(0, Math.floor(input.focusDeltaSeconds))
  if (delta <= 0) return input.host

  const localToday = input.localToday
  const todayFocusBase =
    input.host.lastStudyDate === localToday ? input.host.todayFocusSeconds : 0
  const streakDays = nextStudyStreakForDate(
    input.host.lastStudyDate,
    input.host.streakDays,
    localToday
  )

  return {
    ...input.host,
    todayFocusSeconds: todayFocusBase + delta,
    totalFocusSeconds: input.host.totalFocusSeconds + delta,
    streakDays,
    lastStudyDate: localToday
  }
}

/**
 * Apply focus delta after a TimerSession sole-read project (caller provides both samples).
 * Does not re-project clock — caller already merged remainingSeconds from TimerSession.
 */
export function applyTimerSessionFocusCounterCredit(input: {
  host: StudySnapshot
  previousSession: TimerSessionRecord | null | undefined
  nextSession: TimerSessionRecord | null | undefined
  localToday: string
}): StudySnapshot {
  const isFocusPhase = input.nextSession?.phase === 'focus'
  const focusDeltaSeconds = focusSecondsDeltaBetweenSessions(
    input.previousSession,
    input.nextSession
  )
  return creditLiveFocusSeconds({
    host: input.host,
    focusDeltaSeconds,
    localToday: input.localToday,
    isFocusPhase: isFocusPhase === true
  })
}

/**
 * Strip V1 twin focus-second / streak mutations from an advanced host while keeping
 * remainingSeconds / timerState / timerMode the lifecycle already mutated.
 * Used when merging: start from pre-tick host, take clock fields from V1 advance only
 * if needed, then credit from TimerSession.
 *
 * Prefer: hostBefore + projectAndMergeTimerClock + applyTimerSessionFocusCounterCredit.
 * This helper is a safety net when a caller already ran lifecycle.advance.
 */
export function stripV1LiveFocusCounterMutation(input: {
  hostBefore: StudySnapshot
  hostAfterV1Advance: StudySnapshot
}): StudySnapshot {
  return {
    ...input.hostAfterV1Advance,
    todayFocusSeconds: input.hostBefore.todayFocusSeconds,
    totalFocusSeconds: input.hostBefore.totalFocusSeconds,
    streakDays: input.hostBefore.streakDays,
    lastStudyDate: input.hostBefore.lastStudyDate
    // keep todaySessions / totalSessions / xp — completion shell may have touched them
  }
}
