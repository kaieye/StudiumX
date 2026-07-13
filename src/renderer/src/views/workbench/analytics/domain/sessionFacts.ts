import type {
  AnalyticsHourBuckets,
  StudyAnalyticsModeId,
  StudyAnalyticsRoomId,
  StudyAnalyticsSignalId,
  StudySessionDaySegment,
  StudySessionFact,
  StudyTaskAttribution
} from '../../../../../../shared/teaching-types/analytics'
import {
  getLocalCalendarParts,
  getLocalDateKey,
  getLocalTimezoneOffsetMinutes,
  resolvedLocalTimeZone
} from './dateRange'
import {
  advanceReliableTimer,
  createReliableTimer,
  pauseReliableTimer,
  resumeReliableTimer,
  type ReliableTimerSample,
  type ReliableTimerState
} from './reliableTimer'

export type StudyTimedInterval = {
  startMs: number
  endMs: number
  timeZone: string
}

export type ActiveStudySessionV1 = {
  version: 1
  id: string
  clientId: string
  timerMode: 'focus' | 'break'
  plannedSeconds: number
  startedAtMs: number
  context: {
    modeId: StudyAnalyticsModeId
    roomId: StudyAnalyticsRoomId
    signalId: StudyAnalyticsSignalId
    spaceCode?: string
  }
  taskAttribution: StudyTaskAttribution
  timer: ReliableTimerState
  activeIntervals: StudyTimedInterval[]
  pausedIntervals: StudyTimedInterval[]
  currentTimeZone: string
}

export type CreateActiveStudySessionInput = {
  id: string
  clientId: string
  timerMode: 'focus' | 'break'
  plannedSeconds: number
  sample: ReliableTimerSample
  timeZone?: string
  context: ActiveStudySessionV1['context']
  taskAttribution?: StudyTaskAttribution
}

export function createActiveStudySession(input: CreateActiveStudySessionInput): ActiveStudySessionV1 {
  const timeZone = input.timeZone ?? resolvedLocalTimeZone()
  return {
    version: 1,
    id: input.id,
    clientId: input.clientId,
    timerMode: input.timerMode,
    plannedSeconds: Math.max(0, Math.floor(input.plannedSeconds)),
    startedAtMs: input.sample.wallMs,
    context: input.context,
    taskAttribution: input.taskAttribution ?? { kind: 'unattributed', reason: 'no_task_selected' },
    timer: createReliableTimer({ ...input.sample, plannedActiveMs: Math.max(0, Math.floor(input.plannedSeconds)) * 1000 }),
    activeIntervals: [],
    pausedIntervals: [],
    currentTimeZone: timeZone
  }
}

function appendTimedInterval(
  intervals: StudyTimedInterval[],
  interval: StudyTimedInterval | null
): StudyTimedInterval[] {
  if (!interval) return intervals
  const previous = intervals.at(-1)
  if (previous && previous.timeZone === interval.timeZone && previous.endMs === interval.startMs) {
    return [...intervals.slice(0, -1), { ...previous, endMs: interval.endMs }]
  }
  return [...intervals, interval]
}

function activeSecondsByLocalDate(intervals: StudyTimedInterval[]): Partial<Record<string, number>> {
  const values: Partial<Record<string, number>> = {}
  for (const segment of buildStudySessionDaySegments(intervals, [])) {
    values[segment.localDate] = (values[segment.localDate] ?? 0) + segment.activeSeconds
  }
  return values
}

function subtractDateSeconds(
  before: Partial<Record<string, number>>,
  after: Partial<Record<string, number>>
): Partial<Record<string, number>> {
  const delta: Partial<Record<string, number>> = {}
  for (const [date, seconds] of Object.entries(after)) {
    const value = Math.max(0, (seconds ?? 0) - (before[date] ?? 0))
    if (value > 0) delta[date] = value
  }
  return delta
}

export function advanceActiveStudySession(
  session: ActiveStudySessionV1,
  input: { sample: ReliableTimerSample; timeZone?: string }
): {
  session: ActiveStudySessionV1
  activeDeltaSeconds: number
  activeSecondsByLocalDate: Partial<Record<string, number>>
  completed: boolean
  activeInterval: StudyTimedInterval | null
} {
  const timeZone = input.timeZone ?? session.currentTimeZone
  const result = advanceReliableTimer(session.timer, input.sample)
  const activeInterval = result.activeInterval ? { ...result.activeInterval, timeZone } : null
  const activeIntervals = appendTimedInterval(session.activeIntervals, activeInterval)
  const beforeSeconds = activeSecondsByLocalDate(session.activeIntervals)
  const afterSeconds = activeSecondsByLocalDate(activeIntervals)
  return {
    session: {
      ...session,
      timer: result.timer,
      currentTimeZone: timeZone,
      activeIntervals
    },
    activeDeltaSeconds: Math.floor(result.timer.activeElapsedMs / 1000)
      - Math.floor(session.timer.activeElapsedMs / 1000),
    activeSecondsByLocalDate: subtractDateSeconds(beforeSeconds, afterSeconds),
    completed: result.completed,
    activeInterval
  }
}

export function remainingActiveStudySessionSeconds(session: ActiveStudySessionV1): number {
  return Math.max(0, Math.ceil((session.timer.plannedActiveMs - session.timer.activeElapsedMs) / 1000))
}

export function pauseActiveStudySession(
  session: ActiveStudySessionV1,
  input: { sample: ReliableTimerSample; timeZone?: string }
): ActiveStudySessionV1 {
  const advanced = advanceActiveStudySession(session, input).session
  return { ...advanced, timer: pauseReliableTimer(advanced.timer, input.sample) }
}

export function resumeActiveStudySession(
  session: ActiveStudySessionV1,
  input: { sample: ReliableTimerSample; timeZone?: string }
): ActiveStudySessionV1 {
  const timeZone = input.timeZone ?? session.currentTimeZone
  const pauseStartMs = session.timer.effectiveWallMs
  const timer = resumeReliableTimer(session.timer, input.sample)
  const pauseEndMs = timer.effectiveWallMs
  return {
    ...session,
    timer,
    currentTimeZone: timeZone,
    pausedIntervals: pauseEndMs > pauseStartMs
      ? [...session.pausedIntervals, { startMs: pauseStartMs, endMs: pauseEndMs, timeZone }]
      : session.pausedIntervals
  }
}

type ContextChunk = StudyTimedInterval & {
  localDate: string
  timezoneOffsetMinutes: number
  localHour?: number
  kind: 'active' | 'paused'
  seconds: number
}

function contextKey(instantMs: number, timeZone: string, includeHour: boolean): string {
  const date = getLocalDateKey(instantMs, timeZone)
  const offset = getLocalTimezoneOffsetMinutes(instantMs, timeZone)
  const hour = includeHour ? getLocalCalendarParts(instantMs, timeZone).hour : ''
  return `${date}|${offset}|${hour}`
}

function splitInterval(interval: StudyTimedInterval, kind: ContextChunk['kind'], includeHour: boolean): Omit<ContextChunk, 'seconds'>[] {
  const chunks: Omit<ContextChunk, 'seconds'>[] = []
  let cursor = interval.startMs
  const maxProbeMs = includeHour ? 2 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000
  while (cursor < interval.endMs) {
    const probeEnd = Math.min(interval.endMs, cursor + maxProbeMs)
    const startKey = contextKey(cursor, interval.timeZone, includeHour)
    let chunkEnd = probeEnd
    if (contextKey(probeEnd - 1, interval.timeZone, includeHour) !== startKey) {
      let low = cursor + 1
      let high = probeEnd
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (contextKey(middle, interval.timeZone, includeHour) === startKey) low = middle + 1
        else high = middle
      }
      chunkEnd = low
    }
    const localDate = getLocalDateKey(cursor, interval.timeZone)
    const timezoneOffsetMinutes = getLocalTimezoneOffsetMinutes(cursor, interval.timeZone)
    chunks.push({
      startMs: cursor,
      endMs: chunkEnd,
      timeZone: interval.timeZone,
      localDate,
      timezoneOffsetMinutes,
      ...(includeHour ? { localHour: getLocalCalendarParts(cursor, interval.timeZone).hour } : {}),
      kind
    })
    cursor = chunkEnd
  }
  return chunks
}

function allocateWholeSeconds<T extends { startMs: number; endMs: number }>(chunks: T[]): Array<T & { seconds: number }> {
  const totalMs = chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.endMs - chunk.startMs), 0)
  const targetSeconds = Math.floor(totalMs / 1000)
  const allocated = chunks.map((chunk, index) => {
    const durationMs = Math.max(0, chunk.endMs - chunk.startMs)
    return { chunk, index, seconds: Math.floor(durationMs / 1000), remainder: durationMs % 1000 }
  })
  let remaining = targetSeconds - allocated.reduce((sum, item) => sum + item.seconds, 0)
  for (const item of [...allocated].sort((left, right) => right.remainder - left.remainder || left.index - right.index)) {
    if (remaining <= 0) break
    item.seconds += 1
    remaining -= 1
  }
  return allocated.map(({ chunk, seconds }) => ({ ...chunk, seconds }))
}

function emptyHourBuckets(): number[] {
  return Array.from({ length: 24 }, () => 0)
}

export function buildStudySessionDaySegments(
  activeIntervals: StudyTimedInterval[],
  pausedIntervals: StudyTimedInterval[]
): StudySessionDaySegment[] {
  const activeChunks = allocateWholeSeconds(activeIntervals.flatMap((interval) => splitInterval(interval, 'active', true)))
  const pausedChunks = allocateWholeSeconds(pausedIntervals.flatMap((interval) => splitInterval(interval, 'paused', false)))
  const chunks: ContextChunk[] = [...activeChunks, ...pausedChunks].sort((left, right) => left.startMs - right.startMs)
  const segments: Array<StudySessionDaySegment & { buckets: number[] }> = []
  for (const chunk of chunks) {
    const previous = segments.at(-1)
    const sameSegment = previous
      && previous.localDate === chunk.localDate
      && previous.timezoneOffsetMinutes === chunk.timezoneOffsetMinutes
      && Date.parse(previous.endedAt) <= chunk.startMs
    const segment = sameSegment ? previous : {
      localDate: chunk.localDate,
      timezoneOffsetMinutes: chunk.timezoneOffsetMinutes,
      startedAt: new Date(chunk.startMs).toISOString(),
      endedAt: new Date(chunk.endMs).toISOString(),
      activeSeconds: 0,
      pausedSeconds: 0,
      hourBuckets: emptyHourBuckets() as unknown as AnalyticsHourBuckets,
      buckets: emptyHourBuckets()
    }
    segment.startedAt = new Date(Math.min(Date.parse(segment.startedAt), chunk.startMs)).toISOString()
    segment.endedAt = new Date(Math.max(Date.parse(segment.endedAt), chunk.endMs)).toISOString()
    if (chunk.kind === 'active') {
      segment.activeSeconds += chunk.seconds
      if (chunk.localHour !== undefined) segment.buckets[chunk.localHour] += chunk.seconds
    } else {
      segment.pausedSeconds += chunk.seconds
    }
    if (!sameSegment) segments.push(segment)
  }
  return segments.map(({ buckets, ...segment }) => ({
    ...segment,
    hourBuckets: buckets as unknown as AnalyticsHourBuckets
  }))
}

export function finalizeActiveStudySession(
  session: ActiveStudySessionV1,
  outcome: StudySessionFact['outcome'],
  recordedAtMs = Date.now()
): StudySessionFact {
  const capturedSegments = buildStudySessionDaySegments(session.activeIntervals, session.pausedIntervals)
  const endedAtMs = Math.max(session.startedAtMs, session.timer.effectiveWallMs)
  const daySegments = capturedSegments.length > 0 ? capturedSegments : [{
    localDate: getLocalDateKey(endedAtMs, session.currentTimeZone),
    timezoneOffsetMinutes: getLocalTimezoneOffsetMinutes(endedAtMs, session.currentTimeZone),
    startedAt: new Date(endedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    activeSeconds: 0,
    pausedSeconds: 0,
    hourBuckets: emptyHourBuckets() as unknown as AnalyticsHourBuckets
  }]
  const activeSeconds = daySegments.reduce((sum, segment) => sum + segment.activeSeconds, 0)
  const pausedSeconds = daySegments.reduce((sum, segment) => sum + segment.pausedSeconds, 0)
  const completedFocusSessions = outcome === 'completed' && session.timerMode === 'focus' ? 1 : 0
  const xpEarned = completedFocusSessions ? Math.max(10, Math.round(session.plannedSeconds / 30)) : 0
  return {
    factVersion: 1,
    factKind: 'study_session',
    id: session.id,
    clientId: session.clientId,
    timerMode: session.timerMode,
    outcome,
    startedAt: new Date(session.startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    recordedAt: new Date(recordedAtMs).toISOString(),
    plannedSeconds: session.plannedSeconds,
    activeSeconds,
    pausedSeconds,
    completedFocusSessions,
    xpEarned,
    context: session.context,
    taskAttribution: session.taskAttribution,
    daySegments
  }
}
