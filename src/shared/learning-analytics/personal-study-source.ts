import type {
  AnalyticsCoverage,
  AnalyticsDateRange,
  AnalyticsHourBuckets,
  AnalyticsSectionResult,
  AnalyticsSourceCoverage,
  AnalyticsWarning,
  FocusActiveRangeSeries,
  FocusAnalytics,
  LearningAnalyticsHero,
  LearningAnalyticsQuery,
  PersonalStudyAnalyticsSnapshot,
  StudyActivityFact,
  StudyAnalyticsFact,
  StudyDailyProjection,
  StudySessionFact,
  StudyTaskActivityFact,
  StudyTaskScheduleSnapshot,
  StudyTaskStateSnapshot,
  TaskAnalytics,
  TokenAnalytics
} from '../teaching-types/analytics'

export const PERSONAL_STUDY_SNAPSHOT_MAX_FACTS = 4_000 as const
export const PERSONAL_STUDY_SNAPSHOT_MAX_TASKS = 500 as const
export const PERSONAL_STUDY_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1_000

export type PersonalStudySnapshotValidation =
  | { state: 'missing'; cacheIdentity: 'missing'; warnings: AnalyticsWarning[] }
  | { state: 'invalid'; cacheIdentity: string; warnings: AnalyticsWarning[] }
  | {
      state: 'valid'
      cacheIdentity: string
      snapshot: PersonalStudyAnalyticsSnapshot
      rejectedFacts: number
      retentionPruned: boolean
      warnings: AnalyticsWarning[]
    }

const EMPTY_HOURS = (): AnalyticsHourBuckets => Array.from({ length: 24 }, () => 0) as unknown as AnalyticsHourBuckets
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function warning(code: AnalyticsWarning['code'], message: string, details?: Record<string, string | number | boolean | null>): AnalyticsWarning {
  return { code, severity: code === 'facts_recovered_with_invalid_rows' ? 'warning' : 'info', source: 'study_snapshot', message, ...(details ? { details } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function isFiniteNonNegative(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum && Math.floor(value) === value
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function isAnalyticsLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = LOCAL_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(0)
  date.setUTCHours(12, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function addAnalyticsLocalDays(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setUTCHours(12, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day + amount)
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function countInclusiveLocalDays(from: string, to: string): number {
  const start = Date.parse(`${from}T12:00:00.000Z`)
  const end = Date.parse(`${to}T12:00:00.000Z`)
  return Math.floor((end - start) / 86_400_000) + 1
}

function inRange(date: string, range: AnalyticsDateRange): boolean {
  return date >= range.from && date <= range.to
}

function isHourBuckets(value: unknown): value is AnalyticsHourBuckets {
  return Array.isArray(value) && value.length === 24 && value.every((item) => isFiniteNonNegative(item, 86_400))
}

function isTaskSchedule(value: unknown): value is StudyTaskScheduleSnapshot {
  if (!isRecord(value)) return false
  return Number.isInteger(value.weekday) && Number(value.weekday) >= 0 && Number(value.weekday) <= 6
    && isFiniteNonNegative(value.startMinutes, 1_440) && isFiniteNonNegative(value.endMinutes, 1_440)
    && (value.colorId === undefined || boundedString(value.colorId, 64))
}

function isTaskState(value: unknown): value is StudyTaskStateSnapshot {
  if (!isRecord(value)) return false
  return boundedString(value.taskId) && boundedString(value.title, 160) && typeof value.done === 'boolean'
    && (value.schedule === undefined || isTaskSchedule(value.schedule))
    && (value.workspaceId === undefined || boundedString(value.workspaceId))
    && (value.categoryId === undefined || boundedString(value.categoryId, 64))
    && (value.categoryName === undefined || boundedString(value.categoryName, 64))
}

function hasUniqueTaskIds(tasks: StudyTaskStateSnapshot[]): boolean {
  return new Set(tasks.map((task) => task.taskId)).size === tasks.length
}

function isActivity(value: unknown): value is StudyActivityFact['activity'] {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  switch (value.kind) {
    case 'task_created': return isTaskState(value.after)
    case 'task_completed':
    case 'task_reopened':
    case 'task_schedule_changed':
    case 'task_title_changed': return isTaskState(value.before) && isTaskState(value.after)
    case 'task_deleted': return isTaskState(value.before)
    case 'review_answered': return boundedString(value.workspaceId) && boundedString(value.lessonId) && typeof value.correct === 'boolean'
    case 'workspace_changed':
    case 'lesson_generated': return boundedString(value.workspaceId)
    case 'skill_used': return boundedString(value.skillId)
    default: return false
  }
}

function isFact(value: unknown): value is StudyAnalyticsFact {
  if (!isRecord(value) || value.factVersion !== 1 || !boundedString(value.id) || !boundedString(value.clientId)) return false
  if (value.factKind === 'study_activity') {
    return isInstant(value.occurredAt) && isInstant(value.recordedAt) && isAnalyticsLocalDate(value.localDate)
      && typeof value.timezoneOffsetMinutes === 'number' && Number.isFinite(value.timezoneOffsetMinutes) && isActivity(value.activity)
  }
  if (value.factKind !== 'study_session') return false
  if ((value.timerMode !== 'focus' && value.timerMode !== 'break')
    || (value.outcome !== 'completed' && value.outcome !== 'interrupted' && value.outcome !== 'canceled')
    || !isInstant(value.startedAt) || !isInstant(value.endedAt) || !isInstant(value.recordedAt)
    || !isFiniteNonNegative(value.plannedSeconds, 31_536_000) || !isFiniteNonNegative(value.activeSeconds, 31_536_000)
    || !isFiniteNonNegative(value.pausedSeconds, 31_536_000) || !isFiniteNonNegative(value.xpEarned, 1_000_000)
    || (value.completedFocusSessions !== 0 && value.completedFocusSessions !== 1)
    || !isRecord(value.context) || !boundedString(value.context.modeId, 64) || !boundedString(value.context.roomId, 64) || !boundedString(value.context.signalId, 64)
    || (value.context.spaceCode !== undefined && !boundedString(value.context.spaceCode, 128))
    || !isRecord(value.taskAttribution) || !Array.isArray(value.daySegments) || value.daySegments.length === 0 || value.daySegments.length > 8) return false
  const attribution = value.taskAttribution
  const attributionIsValid = attribution.kind === 'unattributed'
    ? attribution.reason === 'no_task_selected' || attribution.reason === 'legacy_session' || attribution.reason === 'task_missing'
    : attribution.kind === 'explicit' && attribution.capturedAt === 'session_start' && boundedString(attribution.taskId) && boundedString(attribution.taskTitleSnapshot, 160) && (attribution.workspaceId === undefined || boundedString(attribution.workspaceId))
  if (!attributionIsValid) return false
  const segments = value.daySegments as Array<Record<string, unknown>>
  if (!segments.every((segment) => isAnalyticsLocalDate(segment.localDate)
    && typeof segment.timezoneOffsetMinutes === 'number' && Number.isInteger(segment.timezoneOffsetMinutes) && Number(segment.timezoneOffsetMinutes) >= -840 && Number(segment.timezoneOffsetMinutes) <= 840
    && isInstant(segment.startedAt) && isInstant(segment.endedAt) && Date.parse(String(segment.startedAt)) <= Date.parse(String(segment.endedAt))
    && isFiniteNonNegative(segment.activeSeconds, 31_536_000) && isFiniteNonNegative(segment.pausedSeconds, 31_536_000)
    && isHourBuckets(segment.hourBuckets)
    && (segment.hourBuckets as readonly number[]).reduce((total, seconds) => total + seconds, 0) === Number(segment.activeSeconds))) return false
  return Date.parse(value.startedAt) <= Date.parse(value.endedAt)
    && (value.completedFocusSessions === 0 || (value.timerMode === 'focus' && value.outcome === 'completed'))
    && segments.reduce((total, segment) => total + Number(segment.activeSeconds), 0) === value.activeSeconds
    && segments.reduce((total, segment) => total + Number(segment.pausedSeconds), 0) === value.pausedSeconds
}

function trimFactToRetention(fact: StudyAnalyticsFact, cutoffDate: string): StudyAnalyticsFact | null {
  if (fact.factKind !== 'study_session') return fact.localDate >= cutoffDate ? fact : null
  const daySegments = fact.daySegments.filter((segment) => segment.localDate >= cutoffDate)
  if (daySegments.length === 0) return null
  if (daySegments.length === fact.daySegments.length) return fact
  return { ...fact, startedAt: daySegments[0].startedAt, activeSeconds: daySegments.reduce((total, segment) => total + segment.activeSeconds, 0), pausedSeconds: daySegments.reduce((total, segment) => total + segment.pausedSeconds, 0), daySegments }
}

/** Validates only the bounded renderer snapshot; invalid input never reaches aggregation. */
export function validatePersonalStudySnapshot(value: unknown, input: { clientId: string; localToday: string; now: Date }): PersonalStudySnapshotValidation {
  if (value === undefined || value === null) return { state: 'missing', cacheIdentity: 'missing', warnings: [] }
  if (!isRecord(value)) return { state: 'invalid', cacheIdentity: 'invalid:shape', warnings: [warning('source_scan_incomplete', 'Personal Study snapshot was malformed and was ignored.')] }
  const identity = boundedString(value.identity, 128) ? value.identity : 'invalid:identity'
  const invalid = (message: string) => ({ state: 'invalid' as const, cacheIdentity: `invalid:${identity}`, warnings: [warning('source_scan_incomplete', message)] })
  if (value.version !== 1 || !boundedString(value.identity, 128) || !boundedString(value.clientId) || !isInstant(value.capturedAt) || !isAnalyticsLocalDate(value.trackingStartedOn) || !isRecord(value.current) || !Array.isArray(value.facts)) return invalid('Personal Study snapshot was malformed and was ignored.')
  if (value.clientId !== input.clientId) return invalid('Personal Study snapshot belonged to a different learner and was ignored.')
  if (value.trackingStartedOn > input.localToday) return invalid('Personal Study snapshot claimed a future tracking start and was ignored.')
  const capturedAt = Date.parse(value.capturedAt)
  if (capturedAt > input.now.getTime() + 30_000 || input.now.getTime() - capturedAt > PERSONAL_STUDY_SNAPSHOT_MAX_AGE_MS) return invalid('Personal Study snapshot was stale and was ignored.')
  if (value.facts.length > PERSONAL_STUDY_SNAPSHOT_MAX_FACTS) return invalid('Personal Study snapshot exceeded its safe fact limit and was ignored.')
  if (!isFiniteNonNegative(value.current.xp, 1_000_000_000) || !isFiniteNonNegative(value.current.streakDays, 100_000) || !Array.isArray(value.current.tasks) || value.current.tasks.length > PERSONAL_STUDY_SNAPSHOT_MAX_TASKS || !value.current.tasks.every(isTaskState) || !hasUniqueTaskIds(value.current.tasks)) return invalid('Personal Study current-state snapshot was malformed and was ignored.')
  const cutoffDate = addAnalyticsLocalDays(input.localToday, -399)
  const ids = new Set<string>()
  let rejectedFacts = 0
  let retentionPruned = Boolean(isRecord(value.diagnostics) && value.diagnostics.retentionPruned === true)
  const accepted: StudyAnalyticsFact[] = []
  for (const rawFact of value.facts) {
    const hasFutureDate = rawFact && typeof rawFact === 'object' && !Array.isArray(rawFact)
      && ((rawFact as { factKind?: unknown }).factKind === 'study_activity'
        ? typeof (rawFact as { localDate?: unknown }).localDate === 'string' && (rawFact as { localDate: string }).localDate > input.localToday
        : Array.isArray((rawFact as { daySegments?: unknown }).daySegments) && (rawFact as { daySegments: Array<{ localDate?: unknown }> }).daySegments.some((segment) => typeof segment?.localDate === 'string' && segment.localDate > input.localToday))
    if (!isFact(rawFact) || rawFact.clientId !== input.clientId || ids.has(rawFact.id) || hasFutureDate) { rejectedFacts += 1; continue }
    ids.add(rawFact.id)
    const retained = trimFactToRetention(rawFact, cutoffDate)
    if (!retained) { retentionPruned = true; continue }
    if (retained !== rawFact) retentionPruned = true
    accepted.push(retained)
  }
  const upstreamRejected = isRecord(value.diagnostics) && isFiniteNonNegative(value.diagnostics.invalidFactRows, PERSONAL_STUDY_SNAPSHOT_MAX_FACTS) ? value.diagnostics.invalidFactRows : 0
  // Historical recovery notes stay in diagnostics for operators, but section
  // completeness only depends on rows rejected during this validation pass.
  const warnings: AnalyticsWarning[] = []
  if (rejectedFacts > 0) warnings.push(warning('facts_recovered_with_invalid_rows', 'Invalid personal Study fact rows were ignored before analytics aggregation.', { invalidFactRows: rejectedFacts, historicalInvalidFactRows: upstreamRejected }))
  else if (upstreamRejected > 0) warnings.push(warning('facts_recovered_with_invalid_rows', 'Previously recovered invalid personal Study fact rows were already filtered from the snapshot.', { invalidFactRows: 0, historicalInvalidFactRows: upstreamRejected }))
  if (retentionPruned) warnings.push(warning('retention_pruned', 'Personal Study facts outside the rolling 400-day retention window were ignored.'))
  return { state: 'valid', cacheIdentity: identity, snapshot: { version: 1, identity, capturedAt: new Date(capturedAt).toISOString(), clientId: input.clientId, trackingStartedOn: value.trackingStartedOn, facts: accepted, current: { xp: value.current.xp, streakDays: value.current.streakDays, tasks: value.current.tasks }, diagnostics: { invalidFactRows: rejectedFacts + upstreamRejected, retentionPruned } }, rejectedFacts, retentionPruned, warnings }
}

export function rebuildPersonalStudyDailyProjections(facts: StudyAnalyticsFact[], rebuiltAt: string): StudyDailyProjection[] {
  type MutableProjection = StudyDailyProjection & { buckets: number[] }
  const projections = new Map<string, MutableProjection>()
  const read = (date: string): MutableProjection => {
    const existing = projections.get(date)
    if (existing) return existing
    const created: MutableProjection = { projectionVersion: 1, date, focusSeconds: 0, breakSeconds: 0, completedFocusSessions: 0, interruptedFocusSessions: 0, xpEarned: 0, hourBuckets: EMPTY_HOURS(), tasksCreated: 0, tasksCompleted: 0, tasksReopened: 0, tasksDeleted: 0, reviewAnswered: 0, reviewCorrect: 0, sourceFactCount: 0, rebuiltAt, buckets: Array.from({ length: 24 }, () => 0) }
    projections.set(date, created)
    return created
  }
  const seen = new Set<string>()
  for (const fact of facts) {
    if (seen.has(fact.id)) continue
    seen.add(fact.id)
    if (fact.factKind === 'study_session') {
      const dates = new Set<string>()
      const last = fact.daySegments.at(-1)
      for (const segment of fact.daySegments) {
        const projection = read(segment.localDate)
        if (!dates.has(segment.localDate)) { dates.add(segment.localDate); projection.sourceFactCount += 1 }
        if (fact.timerMode === 'focus') {
          projection.focusSeconds += segment.activeSeconds
          for (let hour = 0; hour < 24; hour += 1) projection.buckets[hour] += segment.hourBuckets[hour] ?? 0
        } else projection.breakSeconds += segment.activeSeconds
        if (segment === last) { projection.completedFocusSessions += fact.completedFocusSessions; projection.interruptedFocusSessions += fact.timerMode === 'focus' && fact.outcome === 'interrupted' ? 1 : 0; projection.xpEarned += fact.xpEarned }
      }
      continue
    }
    const projection = read(fact.localDate)
    projection.sourceFactCount += 1
    if (fact.activity.kind === 'task_created') projection.tasksCreated += 1
    else if (fact.activity.kind === 'task_completed') projection.tasksCompleted += 1
    else if (fact.activity.kind === 'task_reopened') projection.tasksReopened += 1
    else if (fact.activity.kind === 'task_deleted') projection.tasksDeleted += 1
    else if (fact.activity.kind === 'review_answered') { projection.reviewAnswered += 1; if (fact.activity.correct) projection.reviewCorrect += 1 }
  }
  return [...projections.values()].sort((left, right) => left.date.localeCompare(right.date)).map(({ buckets, ...item }) => ({ ...item, hourBuckets: buckets as unknown as AnalyticsHourBuckets }))
}

function level(xp: number): LearningAnalyticsHero['currentLevel'] { const current = xp % 120; return { level: Math.max(1, Math.floor(xp / 120) + 1), xpAtLevelStart: xp - current, xpAtNextLevel: 120, currentXp: xp, progress: current / 120 } }
function plantStage(xp: number): string { if (xp >= 720) return '成林'; if (xp >= 420) return '开花'; if (xp >= 180) return '抽枝'; if (xp >= 60) return '发芽'; return '种子' }

function coverage(query: LearningAnalyticsQuery, validation: Extract<PersonalStudySnapshotValidation, { state: 'valid' }>, projections: StudyDailyProjection[]): AnalyticsCoverage {
  const snapshot = validation.snapshot
  const cutoffDate = addAnalyticsLocalDays(query.calendarContext.localToday, -399)
  const dataDates = projections.map((item) => item.date).sort()
  const lowerBound = snapshot.trackingStartedOn > cutoffDate ? snapshot.trackingStartedOn : cutoffDate
  const effectiveFrom = query.range.from > lowerBound ? query.range.from : lowerBound
  const effectiveTo = query.range.to < query.calendarContext.localToday ? query.range.to : query.calendarContext.localToday
  const effectiveRange = effectiveFrom <= effectiveTo ? { ...query.range, from: effectiveFrom, to: effectiveTo } : null
  // Clamping the requested range to tracking/retention is expected for presets like
  // `week`/`all` and must not mark honest complete data as partial. Only genuine
  // fact loss from this validation pass (newly rejected rows) reduces completeness.
  // Retention pruning is expected policy, not incomplete source discovery.
  const sourceState: AnalyticsSourceCoverage['state'] =
    validation.rejectedFacts > 0 ? 'partial' : 'complete'
  return { rangeApplied: true, requestedRange: query.range, effectiveRange, trackingStartedOn: snapshot.trackingStartedOn, dataStartDate: dataDates[0] ?? null, dataEndDate: dataDates.at(-1) ?? null, retention: { policy: 'rolling_local_days', days: 400, includesToday: true, cutoffDate }, complete: sourceState === 'complete', sources: [{ source: 'study_fact_store', state: sourceState, scanned: snapshot.facts.length + validation.rejectedFacts, included: snapshot.facts.length, missing: 0, rejected: validation.rejectedFacts, earliestLocalDate: dataDates[0], latestLocalDate: dataDates.at(-1) }] }
}

function projectionRows(query: LearningAnalyticsQuery, validation: Extract<PersonalStudySnapshotValidation, { state: 'valid' }>, projections: StudyDailyProjection[]): Array<StudyDailyProjection & { covered: boolean }> {
  const map = new Map(projections.map((item) => [item.date, item]))
  const cutoffDate = addAnalyticsLocalDays(query.calendarContext.localToday, -399)
  const coverageStart = validation.snapshot.trackingStartedOn > cutoffDate ? validation.snapshot.trackingStartedOn : cutoffDate
  // Expand only the effective window (clamped to tracking/retention/today). Requested
  // `all` uses sentinel from=0001-01-01 and must not allocate ~2M empty day rows.
  const rowFrom = query.range.from > coverageStart ? query.range.from : coverageStart
  const rowTo = query.range.to < query.calendarContext.localToday ? query.range.to : query.calendarContext.localToday
  if (rowFrom > rowTo) return []
  return Array.from({ length: countInclusiveLocalDays(rowFrom, rowTo) }, (_, index) => {
    const date = addAnalyticsLocalDays(rowFrom, index)
    const existing = map.get(date)
    return { ...(existing ?? { projectionVersion: 1 as const, date, focusSeconds: 0, breakSeconds: 0, completedFocusSessions: 0, interruptedFocusSessions: 0, xpEarned: 0, hourBuckets: EMPTY_HOURS(), tasksCreated: 0, tasksCompleted: 0, tasksReopened: 0, tasksDeleted: 0, reviewAnswered: 0, reviewCorrect: 0, sourceFactCount: 0, rebuiltAt: validation.snapshot.capturedAt }), covered: date >= coverageStart && date <= query.calendarContext.localToday }
  })
}

/** Always 365 local days ending today, independent of the selected range preset. */
function heatmapCells(
  query: LearningAnalyticsQuery,
  validation: Extract<PersonalStudySnapshotValidation, { state: 'valid' }>,
  projections: StudyDailyProjection[]
): FocusAnalytics['heatmap'] {
  const map = new Map(projections.map((item) => [item.date, item]))
  const localToday = query.calendarContext.localToday
  const cutoffDate = addAnalyticsLocalDays(localToday, -399)
  const coverageStart = validation.snapshot.trackingStartedOn > cutoffDate ? validation.snapshot.trackingStartedOn : cutoffDate
  const heatmapFrom = addAnalyticsLocalDays(localToday, -364)
  return Array.from({ length: 365 }, (_, index) => {
    const date = addAnalyticsLocalDays(heatmapFrom, index)
    const existing = map.get(date)
    return {
      date,
      focusSeconds: existing?.focusSeconds ?? 0,
      completedFocusSessions: existing?.completedFocusSessions ?? 0,
      tasksCompleted: existing?.tasksCompleted ?? 0,
      isCovered: date >= coverageStart && date <= localToday
    }
  })
}


function localMinutesOfDay(instant: string, timezoneOffsetMinutes: number): number {
  const ms = Date.parse(instant)
  if (!Number.isFinite(ms)) return 0
  // Date#getTimezoneOffset semantics: local = UTC + (-offsetMinutes) minutes
  const localMs = ms - timezoneOffsetMinutes * 60_000
  const date = new Date(localMs)
  return date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
}

function mergeRanges(
  items: Array<{ start: number; end: number; activeSeconds: number }>
): Array<{ start: number; end: number; activeSeconds: number }> {
  if (items.length === 0) return []
  const sorted = [...items].sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: Array<{ start: number; end: number; activeSeconds: number }> = []
  for (const item of sorted) {
    const previous = merged.at(-1)
    if (!previous || item.start > previous.end + 1e-6) {
      merged.push({ ...item })
      continue
    }
    previous.end = Math.max(previous.end, item.end)
    previous.activeSeconds += item.activeSeconds
  }
  return merged
}

/**
 * Build floating active-range capsules for the selected window.
 * Single-day ranges use hour × minute; multi-day ranges use date × hour-of-day.
 */
export function buildFocusActiveRanges(
  sessions: readonly StudySessionFact[],
  range: AnalyticsDateRange,
  categories: readonly string[]
): FocusActiveRangeSeries {
  // Prefer multi-day layout when the caller supplies more than one category
  // (week preset expands Mon–Sun even when the query range ends at localToday).
  const singleDay = range.from === range.to && categories.length <= 1
  if (singleDay) {
    const hourCategories = Array.from({ length: 24 }, (_, hour) => String(hour))
    const buckets = new Map<number, Array<{ start: number; end: number; activeSeconds: number }>>()
    for (const fact of sessions) {
      if (fact.timerMode !== 'focus') continue
      for (const segment of fact.daySegments) {
        if (!inRange(segment.localDate, range) || segment.activeSeconds <= 0) continue
        const startMin = localMinutesOfDay(segment.startedAt, segment.timezoneOffsetMinutes)
        const endMin = Math.max(startMin, localMinutesOfDay(segment.endedAt, segment.timezoneOffsetMinutes))
        // Split across hour boundaries so each capsule lives in one hour column.
        let cursor = startMin
        let remaining = segment.activeSeconds
        while (cursor < endMin - 1e-9 && remaining > 0) {
          const hour = Math.min(23, Math.max(0, Math.floor(cursor / 60)))
          const hourEnd = (hour + 1) * 60
          const sliceEnd = Math.min(endMin, hourEnd)
          const durationMin = Math.max(0, sliceEnd - cursor)
          if (durationMin <= 0) break
          const activeSeconds = Math.min(remaining, Math.max(1, Math.round(durationMin * 60)))
          const list = buckets.get(hour) ?? []
          list.push({
            start: cursor - hour * 60,
            end: Math.min(60, sliceEnd - hour * 60),
            activeSeconds
          })
          buckets.set(hour, list)
          remaining -= activeSeconds
          cursor = sliceEnd
          if (cursor >= 24 * 60) break
        }
      }
    }
    const ranges = hourCategories.flatMap((category) => {
      const hour = Number(category)
      return mergeRanges(buckets.get(hour) ?? []).map((item, index) => ({
        id: `h${hour}-${index}`,
        category,
        start: item.start,
        end: Math.max(item.start + 0.5, item.end),
        activeSeconds: item.activeSeconds
      }))
    })
    return {
      mode: 'hour_of_day',
      categories: hourCategories,
      ranges,
      yMax: 60,
      yUnit: 'minute'
    }
  }

  const dayCategories = categories.length > 0
    ? categories
    : (() => {
        // Guard against unbounded `all` sentinel ranges when callers pass no categories.
        const dates: string[] = []
        let cursor = range.from
        let guard = 0
        while (cursor <= range.to && guard < 400) {
          dates.push(cursor)
          cursor = addAnalyticsLocalDays(cursor, 1)
          guard += 1
        }
        return dates
      })()
  const buckets = new Map<string, Array<{ start: number; end: number; activeSeconds: number }>>()
  for (const fact of sessions) {
    if (fact.timerMode !== 'focus') continue
    for (const segment of fact.daySegments) {
      if (!inRange(segment.localDate, range) || segment.activeSeconds <= 0) continue
      const startMin = localMinutesOfDay(segment.startedAt, segment.timezoneOffsetMinutes)
      const endMin = Math.max(startMin, localMinutesOfDay(segment.endedAt, segment.timezoneOffsetMinutes))
      const startHour = Math.min(24, Math.max(0, startMin / 60))
      const endHour = Math.min(24, Math.max(startHour, endMin / 60))
      if (endHour <= startHour) continue
      const list = buckets.get(segment.localDate) ?? []
      list.push({ start: startHour, end: endHour, activeSeconds: segment.activeSeconds })
      buckets.set(segment.localDate, list)
    }
  }
  const ranges = dayCategories.flatMap((category) =>
    mergeRanges(buckets.get(category) ?? []).map((item, index) => ({
      id: `${category}-${index}`,
      category,
      start: item.start,
      end: Math.max(item.start + 1 / 60, item.end),
      activeSeconds: item.activeSeconds
    }))
  )
  return {
    mode: 'day_of_range',
    categories: dayCategories,
    ranges,
    yMax: 24,
    yUnit: 'hour'
  }
}

function sessionSecondsInRange(fact: StudySessionFact, range: AnalyticsDateRange): number { return fact.daySegments.filter((segment) => inRange(segment.localDate, range)).reduce((sum, segment) => sum + segment.activeSeconds, 0) }
function sessionEndsInRange(fact: StudySessionFact, range: AnalyticsDateRange): boolean { return Boolean(fact.daySegments.at(-1) && inRange(fact.daySegments.at(-1)!.localDate, range)) }

function unavailableCoverage(query: LearningAnalyticsQuery): AnalyticsCoverage {
  return {
    rangeApplied: true,
    requestedRange: query.range,
    effectiveRange: null,
    trackingStartedOn: null,
    dataStartDate: null,
    dataEndDate: null,
    retention: {
      policy: 'rolling_local_days',
      days: 400,
      includesToday: true,
      cutoffDate: addAnalyticsLocalDays(query.calendarContext.localToday, -399)
    },
    complete: false,
    sources: [{ source: 'study_snapshot', state: 'unavailable', scanned: 0, included: 0, missing: 1, rejected: 0 }]
  }
}

function unavailable<T>(query: LearningAnalyticsQuery, reason: 'history_not_recorded' | 'not_applicable', warnings: AnalyticsWarning[]): AnalyticsSectionResult<T> {
  return {
    state: 'unavailable',
    reason,
    temporal: { kind: 'range', range: query.range },
    coverage: unavailableCoverage(query),
    warnings
  }
}

/**
 * X-axis categories for the active-range chart.
 * - `week`: always a full Monday–Sunday week (future days stay empty columns)
 * - other multi-day ranges: expand the requested window, clamped for `all`/retention
 */
function focusRangeCategories(query: LearningAnalyticsQuery): string[] {
  if (query.range.from === query.range.to) return [query.range.from]
  const localToday = query.calendarContext.localToday
  const cutoffDate = addAnalyticsLocalDays(localToday, -399)

  if (query.range.preset === 'week') {
    // Anchor to the Monday of the requested week (range.from is already Monday for the preset).
    const weekStart = query.range.from
    return Array.from({ length: 7 }, (_, index) => addAnalyticsLocalDays(weekStart, index))
  }

  let from = query.range.from
  let to = query.range.to
  // `all` (and any extreme lower bound) must not allocate unbounded day columns.
  if (query.range.preset === 'all' || from < cutoffDate) {
    from = from > cutoffDate ? from : cutoffDate
  }
  if (to > localToday) to = localToday
  if (from > to) return [localToday]
  if (countInclusiveLocalDays(from, to) > 400) {
    from = addAnalyticsLocalDays(to, -399)
  }
  return Array.from({ length: countInclusiveLocalDays(from, to) }, (_, index) => addAnalyticsLocalDays(from, index))
}

/** Blank focus payload so the page can always mount heatmap + active-range cards. */
function emptyFocusScaffold(query: LearningAnalyticsQuery, trackingStartedOn: string | null = null): FocusAnalytics {
  const localToday = query.calendarContext.localToday
  const heatmapFrom = addAnalyticsLocalDays(localToday, -364)
  const cutoffDate = addAnalyticsLocalDays(localToday, -399)
  const coverageStart = trackingStartedOn && trackingStartedOn > cutoffDate ? trackingStartedOn : cutoffDate
  const hasCoverage = Boolean(trackingStartedOn)
  return {
    daily: [],
    heatmap: Array.from({ length: 365 }, (_, index) => {
      const date = addAnalyticsLocalDays(heatmapFrom, index)
      return {
        date,
        focusSeconds: 0,
        completedFocusSessions: 0,
        tasksCompleted: 0,
        isCovered: hasCoverage && date >= coverageStart && date <= localToday
      }
    }),
    trend: [],
    hourBuckets: EMPTY_HOURS(),
    activeRanges: buildFocusActiveRanges([], query.range, focusRangeCategories(query)),
    sessionStructure: {
      focusSeconds: 0,
      breakSeconds: 0,
      completed: 0,
      interrupted: 0,
      canceled: 0,
      averageCompletedFocusSeconds: null,
      completionRate: null
    },
    currentGrowth: {
      xp: 0,
      level: level(0),
      streakDays: 0,
      badges: [],
      plantStage: plantStage(0)
    }
  }
}

function emptyFocusSection(
  query: LearningAnalyticsQuery,
  warnings: AnalyticsWarning[],
  options?: {
    trackingStartedOn?: string | null
    coverage?: AnalyticsCoverage
    reason?: 'no_activity' | 'not_started'
  }
): AnalyticsSectionResult<FocusAnalytics> {
  return {
    state: 'empty',
    data: emptyFocusScaffold(query, options?.trackingStartedOn ?? null),
    reason: options?.reason ?? 'not_started',
    temporal: { kind: 'range', range: query.range },
    coverage: options?.coverage ?? unavailableCoverage(query),
    warnings
  }
}

export function buildPersonalStudyAnalytics(input: { query: LearningAnalyticsQuery; validation: PersonalStudySnapshotValidation; generatedAt: string; tokens: AnalyticsSectionResult<TokenAnalytics> }): { hero: AnalyticsSectionResult<LearningAnalyticsHero>; focus: AnalyticsSectionResult<FocusAnalytics>; tasks: AnalyticsSectionResult<TaskAnalytics> } {
  const { query, validation, generatedAt, tokens } = input
  if (query.scope.personalFocus.kind !== 'personal') return { hero: unavailable<LearningAnalyticsHero>(query, 'not_applicable', []), focus: unavailable<FocusAnalytics>(query, 'not_applicable', []), tasks: unavailable<TaskAnalytics>(query, 'not_applicable', []) }
  if (validation.state !== 'valid') {
    const warnings = validation.state === 'missing' ? [warning('source_not_configured', 'No personal Study snapshot was supplied for this analytics request.')] : validation.warnings
    // Focus always carries a blank skeleton so heatmap / active-range cards stay mounted.
    return {
      hero: unavailable<LearningAnalyticsHero>(query, 'history_not_recorded', warnings),
      focus: emptyFocusSection(query, warnings, { reason: 'not_started' }),
      tasks: unavailable<TaskAnalytics>(query, 'history_not_recorded', warnings)
    }
  }
  const projections = rebuildPersonalStudyDailyProjections(validation.snapshot.facts, validation.snapshot.capturedAt)
  const rows = projectionRows(query, validation, projections)
  const sectionCoverage = coverage(query, validation, projections)
  const warnings = [...validation.warnings]
  if (query.range.from < addAnalyticsLocalDays(query.calendarContext.localToday, -399)) warnings.push(warning('range_before_retention_window', 'Part of the requested range predates the rolling 400-day personal Study retention window.'))
  if (query.range.from < validation.snapshot.trackingStartedOn) warnings.push(warning('range_before_tracking_started', 'Part of the requested range predates local personal Study fact tracking.'))
  const sessions = validation.snapshot.facts.filter((fact): fact is StudySessionFact => fact.factKind === 'study_session')
  const rangedSessions = sessions.filter((fact) => fact.daySegments.some((segment) => inRange(segment.localDate, query.range)))
  const terminalFocus = rangedSessions.filter((fact) => fact.timerMode === 'focus' && sessionEndsInRange(fact, query.range))
  const completedFacts = terminalFocus.filter((fact) => fact.outcome === 'completed')
  const completed = completedFacts.length
  const interrupted = terminalFocus.filter((fact) => fact.outcome === 'interrupted').length
  const canceled = terminalFocus.filter((fact) => fact.outcome === 'canceled').length
  const focusSeconds = rows.reduce((sum, row) => sum + row.focusSeconds, 0)
  const breakSeconds = rows.reduce((sum, row) => sum + row.breakSeconds, 0)
  const growthLevel = level(validation.snapshot.current.xp)
  const focusData: FocusAnalytics = { daily: rows.map(({ covered: _covered, ...row }) => row), heatmap: heatmapCells(query, validation, projections), trend: rows.map((row) => ({ date: row.date, focusSeconds: row.focusSeconds, completedFocusSessions: row.completedFocusSessions })), hourBuckets: rows.reduce((hours, row) => hours.map((value, index) => value + (row.hourBuckets[index] ?? 0)) as unknown as AnalyticsHourBuckets, EMPTY_HOURS()), activeRanges: buildFocusActiveRanges(rangedSessions, query.range, focusRangeCategories(query)), sessionStructure: { focusSeconds, breakSeconds, completed, interrupted, canceled, averageCompletedFocusSeconds: completed > 0 ? completedFacts.reduce((sum, fact) => sum + fact.activeSeconds, 0) / completed : null, completionRate: terminalFocus.length > 0 ? completed / terminalFocus.length : null }, currentGrowth: { xp: validation.snapshot.current.xp, level: growthLevel, streakDays: validation.snapshot.current.streakDays, badges: [], plantStage: plantStage(validation.snapshot.current.xp) } }
  // Zero sessions still return empty + data (blank heatmap / empty active ranges), never data-less unavailable.
  const focus: AnalyticsSectionResult<FocusAnalytics> = rangedSessions.length === 0
    ? {
        state: 'empty',
        data: focusData,
        reason: 'no_activity',
        temporal: { kind: 'range', range: query.range },
        coverage: sectionCoverage,
        warnings
      }
    : {
        state: sectionCoverage.complete ? 'available' : 'partial',
        data: focusData,
        temporal: { kind: 'range', range: query.range },
        coverage: sectionCoverage,
        warnings
      }
  const activities = validation.snapshot.facts.filter((fact): fact is StudyTaskActivityFact => fact.factKind === 'study_activity' && fact.activity.kind.startsWith('task_') && inRange(fact.localDate, query.range))
  const currentTasks = validation.snapshot.current.tasks
  const currentTaskById = new Map(currentTasks.map((task) => [task.taskId, task]))
  const byTask = new Map<string, {
    title: string
    seconds: number
    completedInRange: boolean
    currentlyDone: boolean | null
    categoryId: string | null
    categoryName: string | null
  }>()
  for (const fact of sessions) {
    if (fact.timerMode !== 'focus' || fact.taskAttribution.kind !== 'explicit' || !fact.daySegments.some((segment) => inRange(segment.localDate, query.range))) continue
    const attribution = fact.taskAttribution
    const currentTask = currentTaskById.get(attribution.taskId)
    const item = byTask.get(attribution.taskId) ?? {
      title: attribution.taskTitleSnapshot,
      seconds: 0,
      completedInRange: false,
      currentlyDone: currentTask?.done ?? null,
      categoryId: currentTask?.categoryId ?? null,
      categoryName: currentTask?.categoryName ?? null
    }
    item.seconds += sessionSecondsInRange(fact, query.range)
    item.completedInRange ||= fact.outcome === 'completed' && sessionEndsInRange(fact, query.range)
    byTask.set(attribution.taskId, item)
  }
  const topByAttributedFocus = [...byTask.entries()]
    .sort((left, right) => right[1].seconds - left[1].seconds)
    .slice(0, 10)
    .map(([taskId, item]) => ({
      taskId,
      title: item.title,
      focusSeconds: item.seconds,
      completedInRange: item.completedInRange,
      currentlyDone: item.currentlyDone,
      categoryId: item.categoryId,
      categoryName: item.categoryName
    }))
  const byCategory = new Map<string, { categoryId: string; label: string; focusSeconds: number }>()
  for (const item of byTask.values()) {
    const categoryId = item.categoryId && item.categoryId.trim() ? item.categoryId : 'uncategorized'
    const label = item.categoryName?.trim()
      || (categoryId === 'uncategorized' ? 'Uncategorized' : categoryId)
    const bucket = byCategory.get(categoryId) ?? { categoryId, label, focusSeconds: 0 }
    bucket.focusSeconds += item.seconds
    byCategory.set(categoryId, bucket)
  }
  const byCategoryFocus = [...byCategory.values()].sort((left, right) => right.focusSeconds - left.focusSeconds)

  // Checklist completion share: range-filtered task_completed activity facts.
  // Prefer category/title from the fact snapshot, fall back to current tasks.
  const byCompletion = new Map<string, {
    title: string
    completionCount: number
    categoryId: string | null
    categoryName: string | null
  }>()
  for (const fact of activities) {
    if (fact.activity.kind !== 'task_completed') continue
    const after = fact.activity.after
    const currentTask = currentTaskById.get(after.taskId)
    const categoryId = after.categoryId ?? currentTask?.categoryId ?? null
    const categoryName = after.categoryName ?? currentTask?.categoryName ?? null
    const item = byCompletion.get(after.taskId) ?? {
      title: after.title || currentTask?.title || after.taskId,
      completionCount: 0,
      categoryId,
      categoryName
    }
    item.completionCount += 1
    // Prefer non-empty category when a later completion has richer snapshot data.
    if (!item.categoryId && categoryId) {
      item.categoryId = categoryId
      item.categoryName = categoryName
    }
    if (after.title) item.title = after.title
    byCompletion.set(after.taskId, item)
  }
  // Inventory fallback: when the range has no task_completed facts but the learner has
  // currently-done tasks, surface those as unit completion share so checklist UX is not empty.
  if (byCompletion.size === 0) {
    for (const task of currentTasks) {
      if (!task.done) continue
      byCompletion.set(task.taskId, {
        title: task.title,
        completionCount: 1,
        categoryId: task.categoryId ?? null,
        categoryName: task.categoryName ?? null
      })
    }
  }
  const topByCompletion = [...byCompletion.entries()]
    .sort((left, right) => right[1].completionCount - left[1].completionCount || left[1].title.localeCompare(right[1].title))
    .slice(0, 10)
    .map(([taskId, item]) => ({
      taskId,
      title: item.title,
      completionCount: item.completionCount,
      categoryId: item.categoryId,
      categoryName: item.categoryName
    }))
  const byCategoryCompletionMap = new Map<string, { categoryId: string; label: string; completionCount: number }>()
  for (const item of byCompletion.values()) {
    const categoryId = item.categoryId && item.categoryId.trim() ? item.categoryId : 'uncategorized'
    const label = item.categoryName?.trim()
      || (categoryId === 'uncategorized' ? 'Uncategorized' : categoryId)
    const bucket = byCategoryCompletionMap.get(categoryId) ?? { categoryId, label, completionCount: 0 }
    bucket.completionCount += item.completionCount
    byCategoryCompletionMap.set(categoryId, bucket)
  }
  const byCategoryCompletion = [...byCategoryCompletionMap.values()]
    .sort((left, right) => right.completionCount - left.completionCount || left.label.localeCompare(right.label))

  const taskData: TaskAnalytics = {
    current: {
      asOf: generatedAt,
      total: currentTasks.length,
      open: currentTasks.filter((task) => !task.done).length,
      completed: currentTasks.filter((task) => task.done).length,
      overdue: 0,
      completionRate: currentTasks.length ? currentTasks.filter((task) => task.done).length / currentTasks.length : null
    },
    flow: {
      created: activities.filter((fact) => fact.activity.kind === 'task_created').length,
      completed: activities.filter((fact) => fact.activity.kind === 'task_completed').length,
      reopened: activities.filter((fact) => fact.activity.kind === 'task_reopened').length,
      deleted: activities.filter((fact) => fact.activity.kind === 'task_deleted').length,
      byDay: rows.map((row) => ({
        date: row.date,
        created: row.tasksCreated,
        completed: row.tasksCompleted,
        reopened: row.tasksReopened,
        deleted: row.tasksDeleted
      }))
    },
    plan: {
      plannedSeconds: 0,
      scheduledOccurrences: 0,
      attributedFocusSeconds: [...byTask.values()].reduce((sum, item) => sum + item.seconds, 0),
      executionRate: null
    },
    topByAttributedFocus,
    byCategoryFocus,
    topByCompletion,
    byCategoryCompletion,
    unattributedFocusSeconds: sessions
      .filter((fact) => fact.timerMode === 'focus' && fact.taskAttribution.kind === 'unattributed')
      .reduce((sum, fact) => sum + sessionSecondsInRange(fact, query.range), 0)
  }

  const taskWarnings = [...warnings, warning('schedule_history_missing', 'Task plan history is not reconstructable; planned time and execution rate remain unavailable.')]
  if (taskData.plan.attributedFocusSeconds === 0) taskWarnings.push(warning('task_attribution_missing', 'No explicit task-attributed focus facts were available.'))
  const taskTemporal = { kind: 'mixed' as const, range: query.range, asOf: generatedAt, rangeFields: ['flow', 'plan'], rangeInvariantFields: ['current'] }
  // Current task inventory is range-invariant. Missing in-range activity facts is an
  // empty flow (not partial) when the snapshot itself is complete; only real coverage
  // loss (rejected/pruned facts) should force partial.
  const tasks: AnalyticsSectionResult<TaskAnalytics> =
    activities.length === 0 && currentTasks.length === 0
      ? { state: 'empty', data: taskData, reason: 'scope_has_no_items', temporal: taskTemporal, coverage: sectionCoverage, warnings: taskWarnings }
      : {
          state: sectionCoverage.complete ? 'available' : 'partial',
          data: taskData,
          temporal: taskTemporal,
          coverage: sectionCoverage,
          warnings: taskWarnings
        }
  const tokenTotal = 'data' in tokens ? tokens.data.totals.totalTokens : 0
  const heroData: LearningAnalyticsHero = { focusSeconds, completedFocusSessions: completed, currentStreakDays: validation.snapshot.current.streakDays, currentXp: validation.snapshot.current.xp, currentLevel: growthLevel, totalTokens: tokenTotal, currentTaskCompletionRate: taskData.current.completionRate, insightLine: 'Based on currently available local Study and Teaching data.' }
  const heroTemporal = { kind: 'mixed' as const, range: query.range, asOf: generatedAt, rangeFields: ['focusSeconds', 'totalTokens'], rangeInvariantFields: ['currentStreakDays', 'currentXp', 'currentLevel', 'currentTaskCompletionRate'] }
  // Hero can honestly show zeroes when focus is empty; empty is not partial.
  // Only unavailable focus history or incomplete coverage should degrade the hero.
  const hero: AnalyticsSectionResult<LearningAnalyticsHero> =
    focus.state === 'unavailable'
      ? { state: 'unavailable', reason: 'history_not_recorded', temporal: heroTemporal, coverage: sectionCoverage, warnings }
      : {
          state: sectionCoverage.complete ? 'available' : 'partial',
          data: heroData,
          temporal: heroTemporal,
          coverage: sectionCoverage,
          warnings: [...warnings, ...taskWarnings]
        }
  return { hero, focus, tasks }
}

