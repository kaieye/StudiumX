import { describe, expect, it } from 'vitest'
import {
  mapTimerSessionStateToV1,
  mergeFocusTimerProjectionIntoSnapshot,
  pauseLocalFocusTimerSession,
  pickActiveFocusTimerSession,
  pickActiveTimerSession,
  projectFocusTimerUi,
  projectTimerProgressPercent,
  resolveBreakPhaseFromPlan,
  resumeLocalFocusTimerSession,
  startLocalBreakTimerSession,
  startLocalFocusTimerSession
} from '../../src/renderer/src/study-space/planning-timer-display'
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

function baseSession(overrides?: Partial<TimerSessionRecord>): TimerSessionRecord {
  const plan = createClassicPomodoroPlan()
  return {
    id: 'ts:1',
    taskId: 'task-1',
    scheduleBlockId: null,
    phase: 'focus',
    clockMode: 'countdown',
    state: 'running',
    targetSeconds: 25 * 60,
    startedAtMs: 1_000_000,
    lastSampleWallMs: 1_000_000,
    accumulatedActiveSeconds: 0,
    accumulatedFocusSeconds: 0,
    planSnapshot: plan,
    attributionReason: 'explicit',
    focusRoundInPlan: 1,
    ...overrides
  }
}

describe('planning-timer-display (focus sole-read)', () => {
  it('startLocalFocusTimerSession freezes planSnapshot and targetSeconds', () => {
    const session = startLocalFocusTimerSession({
      sessionId: 'ts:start',
      nowMs: 5_000,
      taskId: 't1',
      attributionReason: 'explicit',
      targetSeconds: 12 * 60,
      planId: 'classic_25_5'
    })
    expect(session.id).toBe('ts:start')
    expect(session.state).toBe('running')
    expect(session.phase).toBe('focus')
    expect(session.targetSeconds).toBe(12 * 60)
    expect(session.planSnapshot?.id).toBe('classic_25_5')
    expect(session.taskId).toBe('t1')
  })

  it('projectFocusTimerUi advances pure local remaining without thrashing disk semantics', () => {
    const session = baseSession({
      startedAtMs: 0,
      lastSampleWallMs: 0,
      targetSeconds: 100
    })
    const { session: advanced, projection, completed } = projectFocusTimerUi({
      session,
      nowMs: 40_000
    })
    expect(completed).toBe(false)
    expect(advanced.accumulatedActiveSeconds).toBe(40)
    expect(advanced.accumulatedFocusSeconds).toBe(40)
    expect(projection.fromCanonicalSession).toBe(true)
    expect(projection.timerMode).toBe('focus')
    expect(projection.timerState).toBe('running')
    // remaining = 100 - 40 = 60; sole-read keeps >=1 while running
    expect(projection.remainingSeconds).toBe(60)
    expect(projection.elapsedSeconds).toBe(40)
  })

  it('projectFocusTimerUi marks completed when target reached', () => {
    const session = baseSession({
      startedAtMs: 0,
      lastSampleWallMs: 0,
      targetSeconds: 30,
      accumulatedActiveSeconds: 0
    })
    const { projection, completed, session: advanced } = projectFocusTimerUi({
      session,
      nowMs: 30_000
    })
    expect(completed).toBe(true)
    expect(advanced.state).toBe('completed')
    expect(projection.remainingSeconds).toBe(0)
  })

  it('mergeFocusTimerProjectionIntoSnapshot overlays remaining only by default', () => {
    const host = hostShell({
      remainingSeconds: 999,
      timerState: 'running',
      timerMode: 'focus',
      todayFocusSeconds: 42
    })
    const session = baseSession()
    const { projection } = projectFocusTimerUi({ session, nowMs: session.lastSampleWallMs + 10_000 })
    const merged = mergeFocusTimerProjectionIntoSnapshot(host, projection)
    expect(merged.remainingSeconds).toBe(projection.remainingSeconds)
    expect(merged.timerState).toBe('running')
    expect(merged.todayFocusSeconds).toBe(42)
  })

  it('merge fullState also projects timerState for pause paths', () => {
    const host = hostShell({ remainingSeconds: 100, timerState: 'running' })
    let session = baseSession({ targetSeconds: 100, lastSampleWallMs: 0, startedAtMs: 0 })
    session = pauseLocalFocusTimerSession(session, 15_000)
    const { projection } = projectFocusTimerUi({ session, nowMs: 15_000 })
    const merged = mergeFocusTimerProjectionIntoSnapshot(host, projection, { fullState: true })
    expect(merged.timerState).toBe('paused')
    expect(merged.remainingSeconds).toBe(projection.remainingSeconds)
  })

  it('pause and resume local session round-trip', () => {
    let session = baseSession({ lastSampleWallMs: 0, startedAtMs: 0, targetSeconds: 60 })
    session = pauseLocalFocusTimerSession(session, 20_000)
    expect(session.state).toBe('paused')
    expect(session.accumulatedActiveSeconds).toBe(20)
    session = resumeLocalFocusTimerSession(session, 25_000)
    expect(session.state).toBe('running')
    expect(session.lastSampleWallMs).toBe(25_000)
    const { projection } = projectFocusTimerUi({ session, nowMs: 35_000 })
    // 20s before pause + 10s after resume = 30 elapsed; remaining 30
    expect(projection.elapsedSeconds).toBe(30)
    expect(projection.remainingSeconds).toBe(30)
  })

  it('mapTimerSessionStateToV1 maps needs_reconcile to paused', () => {
    expect(mapTimerSessionStateToV1('needs_reconcile')).toBe('paused')
    expect(mapTimerSessionStateToV1('completed')).toBe('idle')
    expect(mapTimerSessionStateToV1('running')).toBe('running')
  })

  it('projectTimerProgressPercent uses targetSeconds when present', () => {
    expect(
      projectTimerProgressPercent({
        remainingSeconds: 750,
        targetSeconds: 1500,
        focusMinutes: 25,
        breakMinutes: 5,
        timerMode: 'focus'
      })
    ).toBe(50)
  })

  it('projectTimerProgressPercent fills clockwise for countup elapsed cache', () => {
    // Exam / continuous dual-write: remainingSeconds holds elapsed, not time left.
    expect(
      projectTimerProgressPercent({
        remainingSeconds: 300,
        targetSeconds: 1500,
        focusMinutes: 25,
        breakMinutes: 0,
        timerMode: 'focus',
        clockMode: 'countup',
        timerState: 'running'
      })
    ).toBe(20)
    expect(
      projectTimerProgressPercent({
        remainingSeconds: 0,
        targetSeconds: 1500,
        focusMinutes: 25,
        breakMinutes: 0,
        timerMode: 'focus',
        clockMode: 'countup',
        timerState: 'running'
      })
    ).toBe(0)
  })

  it('projectTimerProgressPercent keeps idle countup at 0% even when remaining seeded to total', () => {
    expect(
      projectTimerProgressPercent({
        remainingSeconds: 1500,
        targetSeconds: 1500,
        focusMinutes: 25,
        breakMinutes: 0,
        timerMode: 'focus',
        clockMode: 'countup',
        timerState: 'idle'
      })
    ).toBe(0)
  })

  it('pickActiveFocusTimerSession prefers running over paused', () => {
    const paused = baseSession({ id: 'p', state: 'paused' })
    const running = baseSession({ id: 'r', state: 'running' })
    expect(pickActiveFocusTimerSession([paused, running])?.id).toBe('r')
    expect(pickActiveFocusTimerSession([paused])?.id).toBe('p')
    expect(pickActiveFocusTimerSession([])).toBeNull()
  })

  it('does not invent remaining when session is paused without advance', () => {
    const session = baseSession({
      state: 'paused',
      accumulatedActiveSeconds: 100,
      targetSeconds: 600,
      lastSampleWallMs: 50_000
    })
    const { projection, session: same } = projectFocusTimerUi({
      session,
      nowMs: 90_000
    })
    // paused: no wall advance
    expect(same.accumulatedActiveSeconds).toBe(100)
    expect(projection.remainingSeconds).toBe(500)
    expect(projection.timerState).toBe('paused')
  })
})


describe('planning-timer-display (break sole-read)', () => {
  it('startLocalBreakTimerSession freezes short_break phase and null taskId', () => {
    const session = startLocalBreakTimerSession({
      sessionId: 'ts:break:1',
      nowMs: 1_000,
      targetSeconds: 300,
      planId: 'classic_25_5'
    })
    expect(session.phase).toBe('short_break')
    expect(session.taskId).toBeNull()
    expect(session.state).toBe('running')
    expect(session.targetSeconds).toBe(300)
    expect(session.planSnapshot).not.toBeNull()
    expect(session.attributionReason).toBe('unattributed')
  })

  it('projectFocusTimerUi maps break phase to timerMode break', () => {
    const session = startLocalBreakTimerSession({
      sessionId: 'ts:break:2',
      nowMs: 0,
      targetSeconds: 60
    })
    const { projection, completed } = projectFocusTimerUi({
      session,
      nowMs: 10_000
    })
    expect(projection.timerMode).toBe('break')
    expect(projection.phase).toBe('short_break')
    expect(projection.fromCanonicalSession).toBe(true)
    expect(completed).toBe(false)
    expect(projection.remainingSeconds).toBeGreaterThan(0)
  })

  it('resolveBreakPhaseFromPlan treats classic 5 as short and 15 as long', () => {
    expect(resolveBreakPhaseFromPlan({ breakMinutes: 5 })).toBe('short_break')
    expect(resolveBreakPhaseFromPlan({ breakMinutes: 15 })).toBe('long_break')
    const plan = createClassicPomodoroPlan()
    expect(
      resolveBreakPhaseFromPlan({ breakMinutes: plan.longBreakMinutes ?? 15, plan })
    ).toBe('long_break')
  })

  it('pickActiveTimerSession break group ignores focus sessions', () => {
    const focus = startLocalFocusTimerSession({
      sessionId: 'f1',
      nowMs: 0,
      targetSeconds: 100
    })
    const br = startLocalBreakTimerSession({
      sessionId: 'b1',
      nowMs: 0,
      targetSeconds: 50
    })
    expect(pickActiveTimerSession([focus, br], 'break')?.id).toBe('b1')
    expect(pickActiveFocusTimerSession([focus, br])?.id).toBe('f1')
  })
})
