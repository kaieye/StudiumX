/**
 * STC-206 remainder: OS sleep / visibility wake + cold-start rehydrate pure helpers.
 */

import { describe, expect, it } from 'vitest'
import {
  advanceTimerSession,
  createClassicPomodoroPlan,
  startTimerSession,
  TIMER_SESSION_SEED,
  type TimerSessionRecord
} from '../../src/shared/study-planning'
import {
  mergeTimerWakeShellIntoSnapshot,
  projectRehydrateActiveTimerSession,
  projectTimerSessionAfterWake,
  shouldHandleTimerWakeSignal
} from '../../src/renderer/src/study-space/planning-timer-sleep-hooks'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'

const t0 = 3_000_000

function startFocus(nowMs = t0): TimerSessionRecord {
  return startTimerSession({
    id: 'wake-1',
    nowMs,
    plan: createClassicPomodoroPlan(),
    taskId: 'task-a'
  }).session!
}

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

describe('planning-timer-sleep-hooks (STC-206 remainder)', () => {
  it('shouldHandleTimerWakeSignal: visibility only when visible', () => {
    expect(
      shouldHandleTimerWakeSignal({
        kind: 'visibility_resume',
        nowMs: t0,
        visibilityState: 'hidden'
      })
    ).toBe(false)
    expect(
      shouldHandleTimerWakeSignal({
        kind: 'visibility_resume',
        nowMs: t0,
        visibilityState: 'visible'
      })
    ).toBe(true)
    expect(shouldHandleTimerWakeSignal({ kind: 'pagehide', nowMs: t0 })).toBe(true)
    expect(shouldHandleTimerWakeSignal({ kind: 'hydrate_reattach', nowMs: t0 })).toBe(true)
    expect(shouldHandleTimerWakeSignal({ kind: 'wall_sample', nowMs: Number.NaN })).toBe(false)
  })

  it('visibility resume short gap advances running without reconcile', () => {
    const session = startFocus()
    const nowMs = t0 + 90_000
    const action = projectTimerSessionAfterWake({
      session,
      signal: { kind: 'visibility_resume', nowMs, visibilityState: 'visible' }
    })
    expect(action.type).toBe('advance_ok')
    if (action.type !== 'advance_ok') return
    expect(action.needsReconcile).toBe(false)
    expect(action.completed).toBe(false)
    expect(action.session.state).toBe('running')
    expect(action.session.accumulatedFocusSeconds).toBe(90)
    expect(action.pinDurableAdvance).toBe(false)
  })

  it('visibility resume long sleep → needs_reconcile + pin (no silent credit)', () => {
    const session = startFocus()
    const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 5) * 60_000
    const action = projectTimerSessionAfterWake({
      session,
      signal: {
        kind: 'visibility_resume',
        nowMs: t0 + gapMs,
        visibilityState: 'visible'
      }
    })
    expect(action.type).toBe('advance_ok')
    if (action.type !== 'advance_ok') return
    expect(action.needsReconcile).toBe(true)
    expect(action.session.state).toBe('needs_reconcile')
    expect(action.session.accumulatedFocusSeconds).toBe(0)
    expect(action.gapSeconds).toBeGreaterThan(120 * 60)
    expect(action.pinDurableAdvance).toBe(true)
  })

  it('hidden visibility is noop (no invented advance while backgrounded signal alone)', () => {
    const session = startFocus()
    const action = projectTimerSessionAfterWake({
      session,
      signal: {
        kind: 'visibility_resume',
        nowMs: t0 + 200_000,
        visibilityState: 'hidden'
      }
    })
    expect(action.type).toBe('noop')
  })

  it('pagehide pins durable advance for running session', () => {
    const session = startFocus()
    const action = projectTimerSessionAfterWake({
      session,
      signal: { kind: 'pagehide', nowMs: t0 + 30_000 }
    })
    expect(action.type).toBe('advance_ok')
    if (action.type !== 'advance_ok') return
    expect(action.pinDurableAdvance).toBe(true)
    expect(action.session.accumulatedFocusSeconds).toBe(30)
    expect(action.needsReconcile).toBe(false)
  })

  it('pagehide with already needs_reconcile surfaces pending without inventing credit', () => {
    const started = startFocus()
    const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 1) * 60_000
    const stale = advanceTimerSession(started, t0 + gapMs).session!
    expect(stale.state).toBe('needs_reconcile')
    const action = projectTimerSessionAfterWake({
      session: stale,
      signal: { kind: 'pagehide', nowMs: t0 + gapMs + 5_000 }
    })
    expect(action.type).toBe('advance_ok')
    if (action.type !== 'advance_ok') return
    expect(action.needsReconcile).toBe(true)
    expect(action.session.state).toBe('needs_reconcile')
    expect(action.session.accumulatedFocusSeconds).toBe(0)
    expect(action.pinDurableAdvance).toBe(true)
  })

  it('paused session does not invent time on wake', () => {
    const started = startFocus()
    const paused: TimerSessionRecord = {
      ...started,
      state: 'paused',
      lastSampleWallMs: t0 + 10_000
    }
    const action = projectTimerSessionAfterWake({
      session: paused,
      signal: {
        kind: 'visibility_resume',
        nowMs: t0 + 10_000 + 3 * 60 * 60_000,
        visibilityState: 'visible'
      }
    })
    expect(action.type).toBe('advance_ok')
    if (action.type !== 'advance_ok') return
    expect(action.needsReconcile).toBe(false)
    expect(action.session.state).toBe('paused')
    expect(action.session.accumulatedFocusSeconds).toBe(0)
    expect(action.pinDurableAdvance).toBe(false)
  })

  it('rehydrate prefers running open session and advances long gap to needs_reconcile', () => {
    const running = startFocus(t0)
    const closed: TimerSessionRecord = {
      ...startFocus(t0 - 1_000_000),
      id: 'closed-1',
      state: 'completed',
      endedAtMs: t0 - 500_000
    }
    const gapMs = (TIMER_SESSION_SEED.staleGapMinutesDefault + 20) * 60_000
    const result = projectRehydrateActiveTimerSession({
      timerSessions: [closed, running],
      nowMs: t0 + gapMs
    })
    expect(result.kind).toBe('reattach')
    if (result.kind !== 'reattach') return
    expect(result.session.id).toBe('wake-1')
    expect(result.needsReconcile).toBe(true)
    expect(result.session.state).toBe('needs_reconcile')
    expect(result.shell.timerState).toBe('paused')
    expect(result.pinDurableAdvance).toBe(true)
  })

  it('rehydrate short gap restores running shell without reconcile', () => {
    const running = startFocus(t0)
    const result = projectRehydrateActiveTimerSession({
      timerSessions: [running],
      nowMs: t0 + 45_000
    })
    expect(result.kind).toBe('reattach')
    if (result.kind !== 'reattach') return
    expect(result.needsReconcile).toBe(false)
    expect(result.session.state).toBe('running')
    expect(result.shell.timerState).toBe('running')
    expect(result.shell.timerMode).toBe('focus')
    expect(result.shell.remainingSeconds).toBeGreaterThan(0)
    expect(result.pinDurableAdvance).toBe(true)
  })

  it('rehydrate skips when local session already present (no clobber)', () => {
    const durable = startFocus(t0)
    const local = startFocus(t0 + 1)
    const result = projectRehydrateActiveTimerSession({
      timerSessions: [durable],
      nowMs: t0 + 60_000,
      localSession: local
    })
    expect(result.kind).toBe('none')
    if (result.kind !== 'none') return
    expect(result.reason).toBe('local_session_present')
  })

  it('rehydrate none when no open sessions', () => {
    const closed: TimerSessionRecord = {
      ...startFocus(t0),
      state: 'completed',
      endedAtMs: t0 + 1000
    }
    const result = projectRehydrateActiveTimerSession({
      timerSessions: [closed],
      nowMs: t0 + 2000
    })
    expect(result.kind).toBe('none')
  })

  it('mergeTimerWakeShellIntoSnapshot overlays timer cache fields only', () => {
    const host = hostShell({ remainingSeconds: 999, timerState: 'idle', timerMode: 'break' })
    const next = mergeTimerWakeShellIntoSnapshot(host, {
      remainingSeconds: 400,
      timerState: 'running',
      timerMode: 'focus'
    })
    expect(next.remainingSeconds).toBe(400)
    expect(next.timerState).toBe('running')
    expect(next.timerMode).toBe('focus')
    expect(next.clientId).toBe(host.clientId)
    expect(next.tasks).toBe(host.tasks)
  })
})
