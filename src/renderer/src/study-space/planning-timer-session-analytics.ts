/**
 * TimerSession → local study analytics projection (sole-authority demotion).
 *
 * When a canonical TimerSession is the UI/durable clock authority, segment
 * close facts should come from that record — not from the parallel V1
 * ActiveStudySession lifecycle. Facts keep the existing StudySessionFact
 * shape (STC-208 compatibility) so the activity ledger / daily projections
 * continue to work without remote telemetry.
 *
 * Day segments are a single-bucket reconstruction from accumulated counters
 * (TimerSession does not store pause intervals). Mid-session live focus
 * seconds on StudySnapshot may still be updated by V1 tick advance; this
 * module only projects terminal facts + completion shell stats (sessions/xp).
 *
 * Not teaching authority. localStorage analytics ledger remains rebuildable.
 */

import type {
  AnalyticsHourBuckets,
  StudyAnalyticsModeId,
  StudyAnalyticsRoomId,
  StudyAnalyticsSignalId,
  StudySessionDaySegment,
  StudySessionFact,
  StudyTaskAttribution
} from '../../../shared/teaching-types/analytics'
import type { TimerSessionRecord } from '../../../shared/study-planning'
import { xpForFocusCompletion } from '../../../shared/study-progression'
import { applyStudyProgressionAwardForSession } from './study-progression'
import type { StudySnapshot } from './types'
import {
  getLocalDateKey,
  getLocalTimezoneOffsetMinutes,
  resolvedLocalTimeZone
} from '../views/workbench/analytics/domain/dateRange'
import type { StudySessionLifecycleIntent } from './session/study-session-lifecycle'

export type TimerSessionAnalyticsContext = {
  modeId: StudyAnalyticsModeId
  roomId: StudyAnalyticsRoomId
  signalId: StudyAnalyticsSignalId
  spaceCode?: string
}

export type ProjectStudySessionFactFromTimerSessionInput = {
  session: TimerSessionRecord
  clientId: string
  context: TimerSessionAnalyticsContext
  /** Captured task title at close; required for explicit attribution. */
  taskTitleSnapshot?: string | null
  workspaceId?: string
  outcome: StudySessionFact['outcome']
  recordedAtMs?: number
  timeZone?: string
}

function emptyHourBuckets(): number[] {
  return Array.from({ length: 24 }, () => 0)
}

function putSecondsInHour(buckets: number[], hour: number, seconds: number): number[] {
  if (seconds <= 0) return buckets
  const h = ((Math.floor(hour) % 24) + 24) % 24
  const next = buckets.slice()
  next[h] = (next[h] ?? 0) + seconds
  return next
}

/**
 * Map TimerSession phase to analytics timerMode.
 * wrap_up is not core focus; treat as break shell for ledger compatibility.
 */
export function mapTimerSessionPhaseToAnalyticsMode(
  phase: TimerSessionRecord['phase']
): 'focus' | 'break' {
  return phase === 'focus' ? 'focus' : 'break'
}

export function resolveTimerSessionTaskAttribution(input: {
  session: TimerSessionRecord
  taskTitleSnapshot?: string | null
  workspaceId?: string
}): StudyTaskAttribution {
  const taskId = input.session.taskId
  const title = input.taskTitleSnapshot?.trim()
  if (taskId && title) {
    return {
      kind: 'explicit',
      capturedAt: 'session_start',
      taskId,
      taskTitleSnapshot: title,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
    }
  }
  if (input.session.attributionReason === 'task_deleted' || (taskId && !title)) {
    return { kind: 'unattributed', reason: 'task_missing' }
  }
  return { kind: 'unattributed', reason: 'no_task_selected' }
}

/**
 * Single-bucket day segment from accumulated counters (pause intervals unknown).
 */
export function projectTimerSessionDaySegments(input: {
  session: TimerSessionRecord
  endedAtMs: number
  timeZone: string
  activeSeconds: number
}): StudySessionDaySegment[] {
  const { session, endedAtMs, timeZone, activeSeconds } = input
  const startedAtMs = session.startedAtMs
  const endMs = Math.max(startedAtMs, endedAtMs)
  const localDate = getLocalDateKey(endMs, timeZone)
  const timezoneOffsetMinutes = getLocalTimezoneOffsetMinutes(endMs, timeZone)
  // Prefer start-hour for hour buckets so short segments land where focus began.
  const startHour = Number(
    new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn-hc-h23', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(new Date(startedAtMs))
      .find((p) => p.type === 'hour')?.value ?? '0'
  )
  const buckets = putSecondsInHour(emptyHourBuckets(), startHour, Math.max(0, activeSeconds))
  return [
    {
      localDate,
      timezoneOffsetMinutes,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endMs).toISOString(),
      activeSeconds: Math.max(0, Math.floor(activeSeconds)),
      pausedSeconds: 0,
      hourBuckets: buckets as unknown as AnalyticsHourBuckets
    }
  ]
}

/**
 * Project a closed TimerSession into a StudySessionFact for the local ledger.
 * Fact id = session.id so exact-retry / append dedupe against re-emits.
 * Returns null when session has no usable id / clientId missing.
 */
export function projectStudySessionFactFromTimerSession(
  input: ProjectStudySessionFactFromTimerSessionInput
): StudySessionFact | null {
  const clientId = input.clientId?.trim()
  const session = input.session
  if (!clientId || !session?.id) return null

  const timeZone = input.timeZone ?? resolvedLocalTimeZone()
  const recordedAtMs = input.recordedAtMs ?? Date.now()
  const endedAtMs = session.endedAtMs ?? recordedAtMs
  const timerMode = mapTimerSessionPhaseToAnalyticsMode(session.phase)
  const activeSeconds =
    timerMode === 'focus'
      ? Math.max(0, Math.floor(session.accumulatedFocusSeconds))
      : Math.max(0, Math.floor(session.accumulatedActiveSeconds))
  const plannedSeconds =
    session.targetSeconds != null && session.targetSeconds > 0
      ? Math.max(0, Math.floor(session.targetSeconds))
      : activeSeconds
  const completedFocusSessions: 0 | 1 =
    input.outcome === 'completed' && timerMode === 'focus' ? 1 : 0
  const xpEarned = completedFocusSessions ? xpForFocusCompletion(plannedSeconds) : 0
  const daySegments = projectTimerSessionDaySegments({
    session,
    endedAtMs,
    timeZone,
    activeSeconds
  })

  return {
    factVersion: 1,
    factKind: 'study_session',
    id: session.id,
    clientId,
    timerMode,
    outcome: input.outcome,
    startedAt: new Date(session.startedAtMs).toISOString(),
    endedAt: new Date(Math.max(session.startedAtMs, endedAtMs)).toISOString(),
    recordedAt: new Date(recordedAtMs).toISOString(),
    plannedSeconds,
    activeSeconds,
    pausedSeconds: 0,
    completedFocusSessions,
    xpEarned,
    context: {
      modeId: input.context.modeId,
      roomId: input.context.roomId,
      signalId: input.context.signalId,
      ...(input.context.spaceCode ? { spaceCode: input.context.spaceCode } : {})
    },
    taskAttribution: resolveTimerSessionTaskAttribution({
      session,
      taskTitleSnapshot: input.taskTitleSnapshot,
      workspaceId: input.workspaceId
    }),
    daySegments
  }
}

/**
 * Apply completion shell stats (sessions + capped XP) from a TimerSession-backed fact.
 * Does **not** re-add activeSeconds — V1 tick advance may already have credited
 * live focus seconds on the snapshot during the segment.
 */
export function applyTimerSessionCompletionShellStats(
  host: StudySnapshot,
  fact: StudySessionFact,
  localToday: string
): StudySnapshot {
  if (fact.timerMode !== 'focus' || fact.outcome !== 'completed' || fact.completedFocusSessions !== 1) {
    return host
  }
  const todaySessionsBase = host.lastStudyDate === localToday ? host.todaySessions : 0
  const next = {
    ...host,
    todaySessions: todaySessionsBase + 1,
    totalSessions: host.totalSessions + 1,
    lastStudyDate: host.lastStudyDate || localToday
  }
  return applyStudyProgressionAwardForSession(next, fact, localToday)
}

/**
 * Drop V1 lifecycle study_session analytics when TimerSession is authority.
 * Keeps presence / notification / task-activity analytics intents.
 */
export function filterV1SessionCompletionAnalyticsIntents(
  intents: readonly StudySessionLifecycleIntent[]
): StudySessionLifecycleIntent[] {
  const out: StudySessionLifecycleIntent[] = []
  for (const intent of intents) {
    if (intent.kind !== 'analytics') {
      out.push(intent)
      continue
    }
    const kept = intent.facts.filter((f) => f.factKind !== 'study_session')
    if (kept.length === 0) continue
    out.push({ ...intent, facts: kept })
  }
  return out
}

/**
 * Build analytics context from the live V1 shell (mode/room/signal).
 */
export function analyticsContextFromSnapshot(snapshot: StudySnapshot): TimerSessionAnalyticsContext {
  return {
    modeId: snapshot.modeId as StudyAnalyticsModeId,
    roomId: snapshot.roomId as StudyAnalyticsRoomId,
    signalId: snapshot.signalId as StudyAnalyticsSignalId,
    ...(snapshot.spaceCode ? { spaceCode: snapshot.spaceCode } : {})
  }
}

/**
 * Resolve a display title for attribution from the current task list.
 */
export function resolveTaskTitleSnapshot(
  tasks: readonly { id: string; title: string }[],
  taskId: string | null | undefined
): string | null {
  if (!taskId) return null
  const hit = tasks.find((t) => t.id === taskId)
  return hit?.title?.trim() ? hit.title : null
}


/**
 * Project + optionally apply completion shell stats. Caller appends the fact
 * to the local analytics ledger (keeps this module free of storage).
 */
export function projectTimerSessionCloseForHost(input: {
  session: TimerSessionRecord
  host: StudySnapshot
  outcome: StudySessionFact['outcome']
  workspaceId?: string
  taskTitleSnapshot?: string | null
  recordedAtMs?: number
  timeZone?: string
  /** When true, bump todaySessions/totalSessions/xp for completed focus. */
  applyShellStats?: boolean
  localToday?: string
}): {
  fact: StudySessionFact | null
  host: StudySnapshot
} {
  const timeZone = input.timeZone ?? resolvedLocalTimeZone()
  const recordedAtMs = input.recordedAtMs ?? Date.now()
  const fact = projectStudySessionFactFromTimerSession({
    session: input.session,
    clientId: input.host.clientId,
    context: analyticsContextFromSnapshot(input.host),
    taskTitleSnapshot: input.taskTitleSnapshot,
    workspaceId: input.workspaceId,
    outcome: input.outcome,
    recordedAtMs,
    timeZone
  })
  if (!fact) return { fact: null, host: input.host }
  if (input.applyShellStats === true) {
    const localToday =
      input.localToday ?? getLocalDateKey(recordedAtMs, timeZone)
    return {
      fact,
      host: applyTimerSessionCompletionShellStats(input.host, fact, localToday)
    }
  }
  return { fact, host: input.host }
}
