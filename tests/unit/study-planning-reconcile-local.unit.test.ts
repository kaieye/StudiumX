/**
 * STC-206 local reconcile apply + project needsReconcile surface.
 */

import { describe, expect, it } from 'vitest'
import {
  advanceTimerSession,
  createClassicPomodoroPlan,
  startTimerSession,
  TIMER_SESSION_SEED
} from '../../src/shared/study-planning'
import {
  applyLocalReconcileDecision,
  projectFocusTimerUi
} from '../../src/renderer/src/study-space/planning-timer-display'
import { projectAndMergeTimerClock } from '../../src/renderer/src/study-space/planning-timer-session-bridge'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'

const t0 = 2_000_000

function hostShell(overrides?: Partial<StudySnapshot>): StudySnapshot {
  return {
    clientId: 'c1',
    nickname: 'n',
    spaceCode: 'SPACE',
    presenceRelayUrl: '',
    signalId: 'reading',
    modeId: 'free',
    contractText: '',
    contractLocked: false,
    roomId: 'silent',
    seatIndex: 0,
    seatClaimedAt: 0,
    timerMode: 'focus',
    timerState: 'running',
    focusMinutes: 25,
    breakMinutes: 5,
    simulationStartTime: '09:00',
    simulationEndTime: '11:00',
    timerPlans: [],
    remainingSeconds: 25 * 60,
    todayFocusSeconds: 0,
    todaySessions: 0,
    totalFocusSeconds: 0,
    totalSessions: 0,
    streakDays: 0,
    xp: 0,
    lastStudyDate: '',
    tasks: [],
    ...overrides
  }
}

describe('reconcile local product path (STC-206)', () => {
  it('projectFocusTimerUi flags needsReconcile on >120min gap', () => {
    const started = startTimerSession({
      id: 'loc-1',
      nowMs: t0,
      plan: createClassicPomodoroPlan(),
      taskId: 't'
    }).session!
    const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 1) * 60_000
    const projected = projectFocusTimerUi({ session: started, nowMs: t0 + gapMs })
    expect(projected.needsReconcile).toBe(true)
    expect(projected.session.state).toBe('needs_reconcile')
    expect(projected.gapSeconds).toBeGreaterThan(120 * 60)
  })

  it('applyLocalReconcileDecision discard keeps focus at 0', () => {
    const started = startTimerSession({
      id: 'loc-2',
      nowMs: t0,
      plan: createClassicPomodoroPlan(),
      taskId: 't'
    }).session!
    const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 10) * 60_000
    const stale = advanceTimerSession(started, t0 + gapMs).session!
    const next = applyLocalReconcileDecision({
      session: stale,
      decision: 'discard_gap',
      nowMs: t0 + gapMs
    })
    expect(next.state).toBe('running')
    expect(next.accumulatedFocusSeconds).toBe(0)
    expect(next.pendingReconcileSeconds).toBeUndefined()
  })

  it('projectAndMergeTimerClock surfaces needsReconcile + paused shell state', () => {
    const started = startTimerSession({
      id: 'loc-3',
      nowMs: t0,
      plan: createClassicPomodoroPlan(),
      taskId: 't'
    }).session!
    const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 2) * 60_000
    const out = projectAndMergeTimerClock({
      host: hostShell(),
      session: started,
      nowMs: t0 + gapMs,
      fullState: true
    })
    expect(out.needsReconcile).toBe(true)
    expect(out.session?.state).toBe('needs_reconcile')
    expect(out.snapshot.timerState).toBe('paused')
  })
})
