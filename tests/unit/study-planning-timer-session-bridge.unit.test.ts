import { describe, expect, it } from 'vitest'
import {
  applyRoomCycleTimerSession,
  applyTimerSessionTransition,
  buildRoomCycleTimerStartTransition,
  projectAndMergeTimerClock
} from '../../src/renderer/src/study-space/planning-timer-session-bridge'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'

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
    timerMode: 'break',
    timerState: 'running',
    focusMinutes: 25,
    breakMinutes: 5,
    simulationStartTime: '09:00',
    simulationEndTime: '11:00',
    timerPlans: [],
    remainingSeconds: 300,
    todayFocusSeconds: 0,
    todaySessions: 0,
    totalFocusSeconds: 0,
    totalSessions: 0,
    streakDays: 0,
    xp: 0,
    lastStudyDate: '',
    tasks: [],
    ...overrides
  } as StudySnapshot
}

describe('planning-timer-session-bridge', () => {
  it('start break transition builds local short_break session without workspace', () => {
    const writes: unknown[] = []
    const next = applyTimerSessionTransition({
      transition: {
        kind: 'start',
        targetSeconds: 300,
        phase: 'short_break',
        taskId: null
      },
      ctx: { workspaceRoot: null, api: null },
      refs: { sessionId: null, session: null },
      nowMs: 10_000,
      onWrite: (r) => writes.push(r)
    })
    expect(next.sessionId).toBeTruthy()
    expect(next.session?.phase).toBe('short_break')
    expect(next.session?.taskId).toBeNull()
    expect(next.session?.targetSeconds).toBe(300)
    // fire-and-forget dual-write resolves async; kind should be skipped without workspace
  })

  it('projectAndMergeTimerClock projects break remainingSeconds', () => {
    const started = applyTimerSessionTransition({
      transition: {
        kind: 'start',
        targetSeconds: 60,
        phase: 'short_break'
      },
      ctx: { workspaceRoot: null, api: null },
      refs: { sessionId: null, session: null },
      nowMs: 0
    })
    const host = hostShell({ remainingSeconds: 999, timerMode: 'break', timerState: 'running' })
    const projected = projectAndMergeTimerClock({
      host,
      session: started.session,
      nowMs: 5_000
    })
    expect(projected.completed).toBe(false)
    expect(projected.snapshot.remainingSeconds).toBeLessThan(60)
    expect(projected.snapshot.remainingSeconds).toBeGreaterThan(0)
    expect(projected.session?.phase).toBe('short_break')
  })

  it('finish clears refs', () => {
    const started = applyTimerSessionTransition({
      transition: { kind: 'start', targetSeconds: 100, phase: 'focus', taskId: 't1' },
      ctx: { workspaceRoot: null, api: null },
      refs: { sessionId: null, session: null },
      nowMs: 1
    })
    const finished = applyTimerSessionTransition({
      transition: { kind: 'finish', reason: 'manual' },
      ctx: { workspaceRoot: null, api: null },
      refs: started,
      nowMs: 2
    })
    expect(finished.sessionId).toBeNull()
    expect(finished.session).toBeNull()
  })

  it('buildRoomCycleTimerStartTransition maps focus with task attribution', () => {
    const t = buildRoomCycleTimerStartTransition({
      roomPhase: 'focus',
      remainingSeconds: 842,
      taskId: 'task-room-1',
      breakMinutes: 5
    })
    expect(t).toEqual({
      kind: 'start',
      taskId: 'task-room-1',
      targetSeconds: 842,
      phase: 'focus'
    })
  })

  it('buildRoomCycleTimerStartTransition maps break to short_break with null task', () => {
    const t = buildRoomCycleTimerStartTransition({
      roomPhase: 'break',
      remainingSeconds: 120,
      taskId: 'should-ignore',
      breakMinutes: 5
    })
    expect(t.kind).toBe('start')
    if (t.kind !== 'start') return
    expect(t.phase).toBe('short_break')
    expect(t.taskId).toBeNull()
    expect(t.targetSeconds).toBe(120)
  })

  it('buildRoomCycleTimerStartTransition maps long room break to long_break', () => {
    const t = buildRoomCycleTimerStartTransition({
      roomPhase: 'break',
      remainingSeconds: 900,
      breakMinutes: 15
    })
    if (t.kind !== 'start') throw new Error('expected start')
    expect(t.phase).toBe('long_break')
    expect(t.targetSeconds).toBe(900)
  })

  it('buildRoomCycleTimerStartTransition clamps remainingSeconds to at least 1', () => {
    const t = buildRoomCycleTimerStartTransition({
      roomPhase: 'focus',
      remainingSeconds: 0.4,
      breakMinutes: 5
    })
    if (t.kind !== 'start') throw new Error('expected start')
    expect(t.targetSeconds).toBe(1)
  })

  it('applyRoomCycleTimerSession finishes prior session then starts room remaining', () => {
    const prior = applyTimerSessionTransition({
      transition: { kind: 'start', targetSeconds: 1500, phase: 'focus', taskId: 'old' },
      ctx: { workspaceRoot: null, api: null },
      refs: { sessionId: null, session: null },
      nowMs: 1_000
    })
    expect(prior.sessionId).toBeTruthy()
    const priorId = prior.sessionId

    const joined = applyRoomCycleTimerSession({
      ctx: { workspaceRoot: null, api: null },
      refs: prior,
      roomPhase: 'focus',
      remainingSeconds: 600,
      taskId: 'room-task',
      breakMinutes: 5,
      nowMs: 2_000
    })
    expect(joined.sessionId).toBeTruthy()
    expect(joined.sessionId).not.toBe(priorId)
    expect(joined.session?.phase).toBe('focus')
    expect(joined.session?.targetSeconds).toBe(600)
    expect(joined.session?.taskId).toBe('room-task')
  })

  it('applyRoomCycleTimerSession break join uses short_break and room remaining', () => {
    const joined = applyRoomCycleTimerSession({
      ctx: { workspaceRoot: null, api: null },
      refs: { sessionId: null, session: null },
      roomPhase: 'break',
      remainingSeconds: 180,
      taskId: 'ignored-on-break',
      breakMinutes: 5,
      nowMs: 3_000
    })
    expect(joined.session?.phase).toBe('short_break')
    expect(joined.session?.taskId).toBeNull()
    expect(joined.session?.targetSeconds).toBe(180)

    const host = hostShell({
      timerMode: 'break',
      timerState: 'running',
      remainingSeconds: 999,
      breakMinutes: 5
    })
    const projected = projectAndMergeTimerClock({
      host,
      session: joined.session,
      nowMs: 3_000
    })
    expect(projected.snapshot.remainingSeconds).toBe(180)
  })
})
