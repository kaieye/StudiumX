import { describe, expect, it } from 'vitest'
import type { StudySessionFact, StudyTaskActivityFact } from '@shared/teaching-types/analytics'
import {
  appendFactsToStudyAnalyticsStore,
  appendStudyAnalyticsFacts,
  createTaskActivityFacts,
  STUDY_ANALYTICS_STORAGE_KEY_PREFIX,
  createStudyAnalyticsStore,
  getLegacyStudyAnalyticsStatus,
  readStudyAnalyticsStore,
  readStudyAnalyticsStoreWithDiagnostics,
  rebuildStudyDailyProjections,
  subscribeStudyAnalyticsStore
} from '@renderer/views/workbench/analytics/domain/activityLedger'
import {
  advanceActiveStudySession,
  createActiveStudySession,
  finalizeActiveStudySession,
  pauseActiveStudySession,
  resumeActiveStudySession
} from '@renderer/views/workbench/analytics/domain/sessionFacts'

function taskFact(id: string, localDate: string, kind: 'task_created' | 'task_completed'): StudyTaskActivityFact {
  const state = { taskId: 'task-1', title: 'Linear algebra', done: kind === 'task_completed' }
  return {
    factVersion: 1,
    factKind: 'study_activity',
    id,
    clientId: 'learner-1',
    occurredAt: `${localDate}T12:00:00.000Z`,
    recordedAt: `${localDate}T12:00:00.000Z`,
    localDate,
    timezoneOffsetMinutes: 0,
    activity: kind === 'task_created'
      ? { kind, after: state }
      : { kind, before: { ...state, done: false }, after: state }
  }
}

describe('study activity ledger', () => {
  it('splits a running session at local midnight and keeps explicit task attribution only', () => {
    const started = createActiveStudySession({
      id: 'session-1',
      clientId: 'learner-1',
      timerMode: 'focus',
      plannedSeconds: 120,
      sample: { wallMs: Date.parse('2026-07-13T15:59:30.000Z'), monotonicMs: 0 },
      timeZone: 'Asia/Shanghai',
      context: { modeId: 'deepwork', roomId: 'deep', signalId: 'reading', spaceCode: 'ROOM-1' },
      taskAttribution: {
        kind: 'explicit',
        capturedAt: 'session_start',
        taskId: 'task-1',
        taskTitleSnapshot: 'Linear algebra',
        workspaceId: 'workspace-1'
      }
    })
    const advanced = advanceActiveStudySession(started, {
      sample: { wallMs: Date.parse('2026-07-13T16:01:30.000Z'), monotonicMs: 120_000 },
      timeZone: 'Asia/Shanghai'
    })
    const fact = finalizeActiveStudySession(advanced.session, 'completed', Date.parse('2026-07-13T16:01:30.000Z'))

    expect(fact.daySegments.map((segment) => [segment.localDate, segment.activeSeconds])).toEqual([
      ['2026-07-13', 30],
      ['2026-07-14', 90]
    ])
    expect(fact.taskAttribution).toMatchObject({ kind: 'explicit', taskId: 'task-1', workspaceId: 'workspace-1' })
    expect(fact.context).toMatchObject({ modeId: 'deepwork', roomId: 'deep', signalId: 'reading', spaceCode: 'ROOM-1' })
  })

  it('deduplicates replay and rebuilds projections only from facts', () => {
    const session: StudySessionFact = {
      factVersion: 1,
      factKind: 'study_session',
      id: 'session-1',
      clientId: 'learner-1',
      timerMode: 'focus',
      outcome: 'completed',
      startedAt: '2026-07-13T10:00:00.000Z',
      endedAt: '2026-07-13T10:25:00.000Z',
      recordedAt: '2026-07-13T10:25:00.000Z',
      plannedSeconds: 1500,
      activeSeconds: 1500,
      pausedSeconds: 0,
      completedFocusSessions: 1,
      xpEarned: 50,
      context: { modeId: 'free', roomId: 'silent', signalId: 'reading' },
      taskAttribution: { kind: 'unattributed', reason: 'no_task_selected' },
      daySegments: [{
        localDate: '2026-07-13',
        timezoneOffsetMinutes: 0,
        startedAt: '2026-07-13T10:00:00.000Z',
        endedAt: '2026-07-13T10:25:00.000Z',
        activeSeconds: 1500,
        pausedSeconds: 0,
        hourBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      }]
    }
    const store = createStudyAnalyticsStore('learner-1', '2026-07-13', '2026-07-13T12:00:00.000Z')
    const appended = appendFactsToStudyAnalyticsStore(store, [session, session, taskFact('task-created', '2026-07-13', 'task_created')], '2026-07-13')
    expect(appended.store.facts).toHaveLength(2)
    expect(appended.addedFactIds).toEqual(['session-1', 'task-created'])
    expect(appended.store.dailyProjections[0]).toMatchObject({ focusSeconds: 1500, completedFocusSessions: 1, tasksCreated: 1, sourceFactCount: 2 })
    expect(rebuildStudyDailyProjections(appended.store.facts, '2026-07-13T12:30:00.000Z')).toEqual(appended.store.dailyProjections.map((item) => ({ ...item, rebuiltAt: '2026-07-13T12:30:00.000Z' })))
  })


  it('counts one source fact per local day even when DST creates multiple offset segments', () => {
    const session: StudySessionFact = {
      factVersion: 1,
      factKind: 'study_session',
      id: 'dst-session',
      clientId: 'learner-1',
      timerMode: 'focus',
      outcome: 'completed',
      startedAt: '2026-11-01T05:30:00.000Z',
      endedAt: '2026-11-01T06:30:00.000Z',
      recordedAt: '2026-11-01T06:30:00.000Z',
      plannedSeconds: 3600,
      activeSeconds: 3600,
      pausedSeconds: 0,
      completedFocusSessions: 1,
      xpEarned: 120,
      context: { modeId: 'deepwork', roomId: 'deep', signalId: 'reading' },
      taskAttribution: { kind: 'unattributed', reason: 'no_task_selected' },
      daySegments: [
        {
          localDate: '2026-11-01',
          timezoneOffsetMinutes: 240,
          startedAt: '2026-11-01T05:30:00.000Z',
          endedAt: '2026-11-01T06:00:00.000Z',
          activeSeconds: 1800,
          pausedSeconds: 0,
          hourBuckets: [0, 1800, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        },
        {
          localDate: '2026-11-01',
          timezoneOffsetMinutes: 300,
          startedAt: '2026-11-01T06:00:00.000Z',
          endedAt: '2026-11-01T06:30:00.000Z',
          activeSeconds: 1800,
          pausedSeconds: 0,
          hourBuckets: [0, 1800, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        }
      ]
    }

    expect(rebuildStudyDailyProjections([session])[0]).toMatchObject({
      focusSeconds: 3600,
      sourceFactCount: 1
    })
  })

  it('records paused wall time without adding it to active focus time', () => {
    const started = createActiveStudySession({
      id: 'paused-session',
      clientId: 'learner-1',
      timerMode: 'focus',
      plannedSeconds: 60,
      sample: { wallMs: Date.parse('2026-07-13T10:00:00.000Z'), monotonicMs: 0 },
      timeZone: 'UTC',
      context: { modeId: 'free', roomId: 'silent', signalId: 'reading' }
    })
    const paused = pauseActiveStudySession(started, {
      sample: { wallMs: Date.parse('2026-07-13T10:00:10.000Z'), monotonicMs: 10_000 },
      timeZone: 'UTC'
    })
    const resumed = resumeActiveStudySession(paused, {
      sample: { wallMs: Date.parse('2026-07-13T10:00:40.000Z'), monotonicMs: 40_000 },
      timeZone: 'UTC'
    })
    const finished = advanceActiveStudySession(resumed, {
      sample: { wallMs: Date.parse('2026-07-13T10:00:50.000Z'), monotonicMs: 50_000 },
      timeZone: 'UTC'
    })
    const fact = finalizeActiveStudySession(finished.session, 'canceled')

    expect(fact.activeSeconds).toBe(20)
    expect(fact.pausedSeconds).toBe(30)
    expect(fact.outcome).toBe('canceled')
  })

  it('creates explicit task lifecycle facts and persists replay idempotently', () => {
    const before = [{ id: 'task-1', title: 'Read', done: false }]
    const after = [{
      id: 'task-1',
      title: 'Read chapter 2',
      done: true,
      schedule: { weekday: 0, startMinutes: 540, endMinutes: 600 }
    }]
    const facts = createTaskActivityFacts(before, after, {
      clientId: 'learner-storage',
      workspaceId: 'workspace-1',
      occurredAtMs: Date.parse('2026-07-13T10:00:00.000Z'),
      timeZone: 'UTC',
      operationId: 'task-update'
    })

    expect(facts.map((fact) => fact.activity.kind)).toEqual([
      'task_title_changed',
      'task_schedule_changed',
      'task_completed'
    ])
    expect(facts.at(-1)?.activity).toMatchObject({
      kind: 'task_completed',
      after: { taskId: 'task-1', workspaceId: 'workspace-1', done: true }
    })

    const first = appendStudyAnalyticsFacts('learner-storage', facts, {
      localToday: '2026-07-13',
      updatedAt: '2026-07-13T10:00:00.000Z'
    })
    const replay = appendStudyAnalyticsFacts('learner-storage', facts, {
      localToday: '2026-07-13',
      updatedAt: '2026-07-13T10:01:00.000Z'
    })
    expect(first.addedFactIds).toHaveLength(3)
    expect(replay.addedFactIds).toHaveLength(0)
    expect(readStudyAnalyticsStore('learner-storage').facts).toHaveLength(3)
  })

  it('keeps store snapshots stable and notifies only after a ledger append', () => {
    const clientId = 'learner-subscription'
    const first = readStudyAnalyticsStore(clientId, {
      localToday: '2026-07-13',
      updatedAt: '2026-07-13T09:00:00.000Z'
    })
    const second = readStudyAnalyticsStore(clientId, {
      localToday: '2026-07-13',
      updatedAt: '2026-07-13T09:01:00.000Z'
    })
    expect(second).toBe(first)

    let notifications = 0
    const unsubscribe = subscribeStudyAnalyticsStore(clientId, () => { notifications += 1 })
    appendStudyAnalyticsFacts(clientId, [taskFact('subscription-task', '2026-07-13', 'task_created')], {
      localToday: '2026-07-13'
    })
    unsubscribe()

    expect(notifications).toBe(1)
    expect(readStudyAnalyticsStore(clientId).facts).toHaveLength(1)
  })


  it('retains an immediate canceled session as a zero-duration fact on its local day', () => {
    const started = createActiveStudySession({
      id: 'canceled-immediately',
      clientId: 'learner-canceled',
      timerMode: 'focus',
      plannedSeconds: 1500,
      sample: { wallMs: Date.parse('2026-07-13T10:00:00.000Z'), monotonicMs: 0 },
      timeZone: 'Asia/Shanghai',
      context: { modeId: 'free', roomId: 'silent', signalId: 'reading' }
    })
    const fact = finalizeActiveStudySession(started, 'canceled', Date.parse('2026-07-13T10:00:00.000Z'))
    const appended = appendFactsToStudyAnalyticsStore(
      createStudyAnalyticsStore('learner-canceled', '2026-07-13'),
      [fact],
      '2026-07-13'
    )

    expect(fact.daySegments).toHaveLength(1)
    expect(fact.daySegments[0]).toMatchObject({ localDate: '2026-07-13', activeSeconds: 0, pausedSeconds: 0 })
    expect(appended.store.facts).toHaveLength(1)
    expect(appended.store.dailyProjections[0]).toMatchObject({ focusSeconds: 0, sourceFactCount: 1 })
  })

  it('recovers valid stored facts with diagnostics and reapplies retention after the local day changes', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) }
    }
    const clientId = 'learner-recovery'
    const key = `${STUDY_ANALYTICS_STORAGE_KEY_PREFIX}:${encodeURIComponent(clientId)}`
    const cutoffFact = taskFact('cutoff-fact', '2025-06-09', 'task_created')
    values.set(key, JSON.stringify({
      ...createStudyAnalyticsStore(clientId, '2025-06-09'),
      facts: [cutoffFact, { factVersion: 1, factKind: 'study_session', id: 'invalid' }]
    }))

    const first = readStudyAnalyticsStoreWithDiagnostics(clientId, {
      storage,
      localToday: '2026-07-13',
      updatedAt: '2026-07-13T00:00:00.000Z'
    })
    const nextDay = readStudyAnalyticsStoreWithDiagnostics(clientId, {
      storage,
      localToday: '2026-07-14',
      updatedAt: '2026-07-14T00:00:00.000Z'
    })

    expect(first.store.facts.map((fact) => fact.id)).toEqual(['cutoff-fact'])
    expect(first.diagnostics.invalidFactRows).toBe(1)
    expect(first.diagnostics.warnings.map((warning) => warning.code)).toContain('facts_recovered_with_invalid_rows')
    expect(nextDay.store).not.toBe(first.store)
    expect(nextDay.store.facts).toHaveLength(0)
    expect(nextDay.diagnostics.retentionPruned).toBe(true)
  })

  it('retains exactly 400 local dates including today', () => {
    const store = createStudyAnalyticsStore('learner-1', '2025-06-01', '2026-07-13T00:00:00.000Z')
    const old = taskFact('old', '2025-06-08', 'task_created')
    const cutoff = taskFact('cutoff', '2025-06-09', 'task_created')
    const today = taskFact('today', '2026-07-13', 'task_completed')
    const appended = appendFactsToStudyAnalyticsStore(store, [old, cutoff, today], '2026-07-13')
    expect(appended.store.facts.map((fact) => fact.id)).toEqual(['cutoff', 'today'])
    expect(appended.retentionPruned).toBe(true)
  })

  it('does not report missing fact history as a legitimate zero result', () => {
    const status = getLegacyStudyAnalyticsStatus(null, {}, '2026-07-13')
    expect(status.state).toBe('unavailable')
    expect(status.coverage.complete).toBe(false)
    expect(status.warnings.map((warning) => warning.code)).toContain('range_before_tracking_started')
  })

  it('marks legacy aggregates as partial instead of treating unknown history as zero', () => {
    const status = getLegacyStudyAnalyticsStatus(null, {
      lastStudyDate: '2026-07-12',
      totalFocusSeconds: 3600,
      totalSessions: 2,
      streakDays: 2
    }, '2026-07-13')
    expect(status.state).toBe('partial')
    expect(status.coverage.trackingStartedOn).toBeNull()
    expect(status.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'legacy_aggregate_not_backfillable',
      'legacy_utc_date_semantics'
    ]))
  })
})
