import { describe, expect, it } from 'vitest'
import type { StudySessionLifecycleIntent } from '../../src/renderer/src/study-space/session/study-session-lifecycle'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'
import {
  analyticsContextFromSnapshot,
  applyTimerSessionCompletionShellStats,
  filterV1SessionCompletionAnalyticsIntents,
  mapTimerSessionPhaseToAnalyticsMode,
  projectStudySessionFactFromTimerSession,
  projectTimerSessionCloseForHost,
  resolveTaskTitleSnapshot,
  resolveTimerSessionTaskAttribution
} from '../../src/renderer/src/study-space/planning-timer-session-analytics'
import type { TimerSessionRecord } from '../../src/shared/study-planning'
import { createClassicPomodoroPlan } from '../../src/shared/study-planning'
import type { StudySessionFact } from '../../src/shared/teaching-types/analytics'

function hostShell(overrides?: Partial<StudySnapshot>): StudySnapshot {
  return {
    clientId: 'client-1',
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
    remainingSeconds: 0,
    todayFocusSeconds: 100,
    todaySessions: 2,
    totalFocusSeconds: 500,
    totalSessions: 10,
    streakDays: 1,
    xp: 40,
    lastStudyDate: '2026-07-22',
    tasks: [{ id: 'task-1', title: 'Math', done: false, createdAt: 0 }],
    ...overrides
  } as StudySnapshot
}

function focusSession(overrides?: Partial<TimerSessionRecord>): TimerSessionRecord {
  const plan = createClassicPomodoroPlan()
  return {
    id: 'ts:focus-1',
    taskId: 'task-1',
    scheduleBlockId: null,
    phase: 'focus',
    clockMode: 'countdown',
    state: 'completed',
    targetSeconds: 1500,
    startedAtMs: 1_000_000,
    endedAtMs: 1_000_000 + 1_500_000,
    lastSampleWallMs: 1_000_000 + 1_500_000,
    accumulatedActiveSeconds: 1500,
    accumulatedFocusSeconds: 1500,
    planSnapshot: plan,
    attributionReason: 'explicit',
    focusRoundInPlan: 1,
    ...overrides
  }
}

describe('planning-timer-session-analytics', () => {
  it('maps focus/break/wrap_up phases for analytics timerMode', () => {
    expect(mapTimerSessionPhaseToAnalyticsMode('focus')).toBe('focus')
    expect(mapTimerSessionPhaseToAnalyticsMode('short_break')).toBe('break')
    expect(mapTimerSessionPhaseToAnalyticsMode('long_break')).toBe('break')
    expect(mapTimerSessionPhaseToAnalyticsMode('wrap_up')).toBe('break')
  })

  it('projects completed focus TimerSession into StudySessionFact with session id', () => {
    const session = focusSession()
    const fact = projectStudySessionFactFromTimerSession({
      session,
      clientId: 'client-1',
      context: {
        modeId: 'free',
        roomId: 'silent',
        signalId: 'reading',
        spaceCode: 'SPACE'
      },
      taskTitleSnapshot: 'Math',
      workspaceId: 'ws-1',
      outcome: 'completed',
      recordedAtMs: 2_000_000,
      timeZone: 'UTC'
    })
    expect(fact).not.toBeNull()
    expect(fact!.id).toBe('ts:focus-1')
    expect(fact!.factKind).toBe('study_session')
    expect(fact!.timerMode).toBe('focus')
    expect(fact!.outcome).toBe('completed')
    expect(fact!.activeSeconds).toBe(1500)
    expect(fact!.plannedSeconds).toBe(1500)
    expect(fact!.completedFocusSessions).toBe(1)
    expect(fact!.xpEarned).toBe(Math.max(10, Math.round(1500 / 30)))
    expect(fact!.taskAttribution).toEqual({
      kind: 'explicit',
      capturedAt: 'session_start',
      taskId: 'task-1',
      taskTitleSnapshot: 'Math',
      workspaceId: 'ws-1'
    })
    expect(fact!.daySegments).toHaveLength(1)
    expect(fact!.daySegments[0]!.activeSeconds).toBe(1500)
    expect(fact!.daySegments[0]!.pausedSeconds).toBe(0)
  })

  it('projects open continuous countup with null target using active seconds as planned', () => {
    const session = focusSession({
      clockMode: 'countup',
      targetSeconds: null,
      accumulatedFocusSeconds: 600,
      accumulatedActiveSeconds: 600,
      endedAtMs: 1_000_000 + 600_000
    })
    const fact = projectStudySessionFactFromTimerSession({
      session,
      clientId: 'c',
      context: { modeId: 'free', roomId: 'silent', signalId: 'reading' },
      outcome: 'completed',
      timeZone: 'UTC'
    })
    expect(fact!.plannedSeconds).toBe(600)
    expect(fact!.activeSeconds).toBe(600)
    expect(fact!.completedFocusSessions).toBe(1)
  })

  it('projects break sessions without completedFocusSessions / xp', () => {
    const session = focusSession({
      id: 'ts:break-1',
      phase: 'short_break',
      taskId: null,
      attributionReason: 'unattributed',
      targetSeconds: 300,
      accumulatedActiveSeconds: 300,
      accumulatedFocusSeconds: 0
    })
    const fact = projectStudySessionFactFromTimerSession({
      session,
      clientId: 'c',
      context: { modeId: 'free', roomId: 'silent', signalId: 'reading' },
      outcome: 'completed',
      timeZone: 'UTC'
    })
    expect(fact!.timerMode).toBe('break')
    expect(fact!.completedFocusSessions).toBe(0)
    expect(fact!.xpEarned).toBe(0)
    expect(fact!.activeSeconds).toBe(300)
  })

  it('returns null when clientId or session id missing', () => {
    expect(
      projectStudySessionFactFromTimerSession({
        session: focusSession(),
        clientId: '  ',
        context: { modeId: 'free', roomId: 'silent', signalId: 'reading' },
        outcome: 'completed'
      })
    ).toBeNull()
    expect(
      projectStudySessionFactFromTimerSession({
        session: focusSession({ id: '' }),
        clientId: 'c',
        context: { modeId: 'free', roomId: 'silent', signalId: 'reading' },
        outcome: 'completed'
      })
    ).toBeNull()
  })

  it('resolves unattributed when no task or missing title', () => {
    expect(
      resolveTimerSessionTaskAttribution({
        session: focusSession({ taskId: null, attributionReason: 'unattributed' })
      })
    ).toEqual({ kind: 'unattributed', reason: 'no_task_selected' })
    expect(
      resolveTimerSessionTaskAttribution({
        session: focusSession({ taskId: 'gone', attributionReason: 'task_deleted' }),
        taskTitleSnapshot: null
      })
    ).toEqual({ kind: 'unattributed', reason: 'task_missing' })
  })

  it('applies completion shell stats only for completed focus (not re-adding active seconds)', () => {
    const host = hostShell({ todaySessions: 2, totalSessions: 10, xp: 40, lastStudyDate: '2026-07-22' })
    const fact = projectStudySessionFactFromTimerSession({
      session: focusSession(),
      clientId: host.clientId,
      context: analyticsContextFromSnapshot(host),
      taskTitleSnapshot: 'Math',
      outcome: 'completed',
      timeZone: 'UTC'
    })!
    const next = applyTimerSessionCompletionShellStats(host, fact, '2026-07-22')
    expect(next.todaySessions).toBe(3)
    expect(next.totalSessions).toBe(11)
    expect(next.xp).toBe(40 + fact.xpEarned)
    // Live focus seconds remain V1 tick authority — not re-added here.
    expect(next.todayFocusSeconds).toBe(host.todayFocusSeconds)
    expect(next.totalFocusSeconds).toBe(host.totalFocusSeconds)
  })

  it('does not bump shell stats for interrupted/canceled or break facts', () => {
    const host = hostShell()
    const interrupted = projectStudySessionFactFromTimerSession({
      session: focusSession({ state: 'cancelled' }),
      clientId: host.clientId,
      context: analyticsContextFromSnapshot(host),
      outcome: 'interrupted',
      timeZone: 'UTC'
    })!
    expect(applyTimerSessionCompletionShellStats(host, interrupted, '2026-07-22')).toEqual(host)

    const breakFact = projectStudySessionFactFromTimerSession({
      session: focusSession({ phase: 'short_break', taskId: null }),
      clientId: host.clientId,
      context: analyticsContextFromSnapshot(host),
      outcome: 'completed',
      timeZone: 'UTC'
    })!
    expect(applyTimerSessionCompletionShellStats(host, breakFact, '2026-07-22')).toEqual(host)
  })

  it('filters V1 study_session analytics intents but keeps presence/notification/task facts', () => {
    const studySession: StudySessionFact = {
      factVersion: 1,
      factKind: 'study_session',
      id: 'v1-sess',
      clientId: 'c',
      timerMode: 'focus',
      outcome: 'completed',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(1).toISOString(),
      recordedAt: new Date(1).toISOString(),
      plannedSeconds: 60,
      activeSeconds: 60,
      pausedSeconds: 0,
      completedFocusSessions: 1,
      xpEarned: 10,
      context: { modeId: 'free', roomId: 'silent', signalId: 'reading' },
      taskAttribution: { kind: 'unattributed', reason: 'no_task_selected' },
      daySegments: []
    }
    const intents: StudySessionLifecycleIntent[] = [
      {
        kind: 'analytics',
        clientId: 'c',
        facts: [
          studySession,
          {
            factVersion: 1,
            factKind: 'study_activity',
            id: 'act-1',
            clientId: 'c',
            occurredAt: new Date(1).toISOString(),
            recordedAt: new Date(1).toISOString(),
            localDate: '2026-07-22',
            timezoneOffsetMinutes: 0,
            activity: {
              kind: 'task_completed',
              before: { taskId: 't', title: 'x', done: false },
              after: { taskId: 't', title: 'x', done: true }
            }
          }
        ]
      },
      { kind: 'presence', event: 'task_done', text: 'done', target: { roomId: 'silent', spaceCode: 'S' } },
      { kind: 'notification', title: '自习室', body: '休息' }
    ]
    const filtered = filterV1SessionCompletionAnalyticsIntents(intents)
    expect(filtered).toHaveLength(3)
    const analytics = filtered.find((i) => i.kind === 'analytics')
    expect(analytics?.kind === 'analytics' && analytics.facts).toHaveLength(1)
    expect(analytics?.kind === 'analytics' && analytics.facts[0]?.factKind).toBe('study_activity')
    expect(filtered.some((i) => i.kind === 'presence')).toBe(true)
    expect(filtered.some((i) => i.kind === 'notification')).toBe(true)
  })

  it('projectTimerSessionCloseForHost applies shell stats when requested', () => {
    const host = hostShell({ todaySessions: 0, totalSessions: 0, xp: 0, lastStudyDate: '' })
    const { fact, host: next } = projectTimerSessionCloseForHost({
      session: focusSession(),
      host,
      outcome: 'completed',
      taskTitleSnapshot: 'Math',
      applyShellStats: true,
      localToday: '2026-07-22',
      timeZone: 'UTC'
    })
    expect(fact?.id).toBe('ts:focus-1')
    expect(next.todaySessions).toBe(1)
    expect(next.totalSessions).toBe(1)
    expect(next.xp).toBeGreaterThan(0)
  })

  it('resolveTaskTitleSnapshot finds title or null', () => {
    expect(resolveTaskTitleSnapshot([{ id: 'a', title: 'A' }], 'a')).toBe('A')
    expect(resolveTaskTitleSnapshot([{ id: 'a', title: 'A' }], 'missing')).toBeNull()
    expect(resolveTaskTitleSnapshot([], null)).toBeNull()
  })

  it('analyticsContextFromSnapshot copies mode/room/signal/space', () => {
    expect(analyticsContextFromSnapshot(hostShell())).toEqual({
      modeId: 'free',
      roomId: 'silent',
      signalId: 'reading',
      spaceCode: 'SPACE'
    })
  })
})
