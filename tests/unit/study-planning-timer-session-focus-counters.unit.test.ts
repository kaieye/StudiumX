import { describe, expect, it } from 'vitest'
import {
  applyTimerSessionFocusCounterCredit,
  creditLiveFocusSeconds,
  focusSecondsDeltaBetweenSessions,
  stripV1LiveFocusCounterMutation
} from '../../src/renderer/src/study-space/planning-timer-session-focus-counters'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'
import type { TimerSessionRecord } from '../../src/shared/study-planning'
import { createClassicPomodoroPlan } from '../../src/shared/study-planning'

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
    remainingSeconds: 1500,
    todayFocusSeconds: 100,
    todaySessions: 1,
    totalFocusSeconds: 500,
    totalSessions: 5,
    streakDays: 2,
    xp: 20,
    lastStudyDate: '2026-07-22',
    tasks: [],
    ...overrides
  } as StudySnapshot
}

function focusSession(overrides?: Partial<TimerSessionRecord>): TimerSessionRecord {
  const plan = createClassicPomodoroPlan()
  return {
    id: 'ts:1',
    taskId: 'task-1',
    scheduleBlockId: null,
    phase: 'focus',
    clockMode: 'countdown',
    state: 'running',
    targetSeconds: 1500,
    startedAtMs: 0,
    lastSampleWallMs: 0,
    accumulatedActiveSeconds: 0,
    accumulatedFocusSeconds: 0,
    planSnapshot: plan,
    attributionReason: 'explicit',
    focusRoundInPlan: 1,
    ...overrides
  }
}

describe('planning-timer-session-focus-counters', () => {
  it('credits delta only for same focus session id', () => {
    const prev = focusSession({ accumulatedFocusSeconds: 10 })
    const next = focusSession({ accumulatedFocusSeconds: 13 })
    expect(focusSecondsDeltaBetweenSessions(prev, next)).toBe(3)
  })

  it('returns 0 on first sample / new session / break phase', () => {
    expect(focusSecondsDeltaBetweenSessions(null, focusSession({ accumulatedFocusSeconds: 5 }))).toBe(0)
    expect(
      focusSecondsDeltaBetweenSessions(
        focusSession({ id: 'a', accumulatedFocusSeconds: 5 }),
        focusSession({ id: 'b', accumulatedFocusSeconds: 8 })
      )
    ).toBe(0)
    expect(
      focusSecondsDeltaBetweenSessions(
        focusSession({ phase: 'short_break', accumulatedFocusSeconds: 0, accumulatedActiveSeconds: 5 }),
        focusSession({ phase: 'short_break', accumulatedFocusSeconds: 0, accumulatedActiveSeconds: 8 })
      )
    ).toBe(0)
  })

  it('clamps negative delta to 0', () => {
    expect(
      focusSecondsDeltaBetweenSessions(
        focusSession({ accumulatedFocusSeconds: 20 }),
        focusSession({ accumulatedFocusSeconds: 15 })
      )
    ).toBe(0)
  })

  it('creditLiveFocusSeconds bumps today/total focus and streak date', () => {
    const host = hostShell({ todayFocusSeconds: 100, totalFocusSeconds: 500, lastStudyDate: '2026-07-22' })
    const next = creditLiveFocusSeconds({
      host,
      focusDeltaSeconds: 7,
      localToday: '2026-07-22',
      isFocusPhase: true
    })
    expect(next.todayFocusSeconds).toBe(107)
    expect(next.totalFocusSeconds).toBe(507)
    expect(next.lastStudyDate).toBe('2026-07-22')
    // sessions / xp untouched
    expect(next.todaySessions).toBe(host.todaySessions)
    expect(next.xp).toBe(host.xp)
  })

  it('creditLiveFocusSeconds resets today base when lastStudyDate is not today', () => {
    const host = hostShell({
      todayFocusSeconds: 999,
      lastStudyDate: '2026-07-20',
      streakDays: 3
    })
    const next = creditLiveFocusSeconds({
      host,
      focusDeltaSeconds: 5,
      localToday: '2026-07-22',
      isFocusPhase: true
    })
    expect(next.todayFocusSeconds).toBe(5)
    expect(next.streakDays).toBe(1)
    expect(next.lastStudyDate).toBe('2026-07-22')
  })

  it('creditLiveFocusSeconds no-ops for break / zero delta', () => {
    const host = hostShell()
    expect(
      creditLiveFocusSeconds({
        host,
        focusDeltaSeconds: 3,
        localToday: '2026-07-22',
        isFocusPhase: false
      })
    ).toBe(host)
    expect(
      creditLiveFocusSeconds({
        host,
        focusDeltaSeconds: 0,
        localToday: '2026-07-22',
        isFocusPhase: true
      })
    ).toBe(host)
  })

  it('applyTimerSessionFocusCounterCredit wires delta from session samples', () => {
    const host = hostShell({ todayFocusSeconds: 0, totalFocusSeconds: 0 })
    const prev = focusSession({ accumulatedFocusSeconds: 2 })
    const next = focusSession({ accumulatedFocusSeconds: 5 })
    const out = applyTimerSessionFocusCounterCredit({
      host,
      previousSession: prev,
      nextSession: next,
      localToday: '2026-07-22'
    })
    expect(out.todayFocusSeconds).toBe(3)
    expect(out.totalFocusSeconds).toBe(3)
  })

  it('stripV1LiveFocusCounterMutation restores pre-tick focus counters', () => {
    const before = hostShell({
      todayFocusSeconds: 10,
      totalFocusSeconds: 100,
      streakDays: 2,
      lastStudyDate: '2026-07-22',
      remainingSeconds: 1500
    })
    const after = {
      ...before,
      todayFocusSeconds: 11,
      totalFocusSeconds: 101,
      remainingSeconds: 1499,
      todaySessions: 9
    }
    const stripped = stripV1LiveFocusCounterMutation({
      hostBefore: before,
      hostAfterV1Advance: after
    })
    expect(stripped.todayFocusSeconds).toBe(10)
    expect(stripped.totalFocusSeconds).toBe(100)
    expect(stripped.streakDays).toBe(2)
    expect(stripped.lastStudyDate).toBe('2026-07-22')
    // clock + completion shell fields from V1 advance kept
    expect(stripped.remainingSeconds).toBe(1499)
    expect(stripped.todaySessions).toBe(9)
  })
})
