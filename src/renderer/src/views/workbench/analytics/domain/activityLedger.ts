import type {
  AnalyticsCoverage,
  AnalyticsDataState,
  AnalyticsHourBuckets,
  AnalyticsLocalDate,
  AnalyticsWarning,
  AnalyticsWeekdayIndex,
  StudyActivityFact,
  StudyAnalyticsFact,
  StudyAnalyticsModeId,
  StudyAnalyticsRoomId,
  StudyAnalyticsSignalId,
  StudyAnalyticsStoreV1,
  StudyDailyProjection,
  StudySessionFact,
  StudyTaskActivityFact,
  StudyTaskScheduleSnapshot,
  StudyTaskStateSnapshot
} from '../../../../../../shared/teaching-types/analytics'
import {
  addLocalDays,
  compareLocalDates,
  createAnalyticsDateRange,
  getLocalDateKey,
  getLocalTimezoneOffsetMinutes,
  resolvedLocalTimeZone
} from './dateRange'

export const STUDY_ANALYTICS_RETENTION_DAYS = 400 as const
export const STUDY_ANALYTICS_STORAGE_KEY_PREFIX = 'studiumx:study-analytics:v1' as const
export const STUDY_ANALYTICS_CHANGED_EVENT = 'studiumx:study-analytics:changed' as const

type StudyAnalyticsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type StudyAnalyticsStoreReadDiagnostics = {
  invalidFactRows: number
  retentionPruned: boolean
  warnings: AnalyticsWarning[]
}

type CachedStore = {
  raw: string | null
  localToday: AnalyticsLocalDate
  store: StudyAnalyticsStoreV1
  diagnostics: StudyAnalyticsStoreReadDiagnostics
}

const storeCaches = new WeakMap<object, Map<string, CachedStore>>()

function cacheFor(storage: StudyAnalyticsStorage): Map<string, CachedStore> {
  const key = storage as object
  const cached = storeCaches.get(key)
  if (cached) return cached
  const created = new Map<string, CachedStore>()
  storeCaches.set(key, created)
  return created
}

function emptyHourBuckets(): number[] {
  return Array.from({ length: 24 }, () => 0)
}

function createProjection(date: string, rebuiltAt: string): StudyDailyProjection & { buckets: number[] } {
  return {
    projectionVersion: 1,
    date,
    focusSeconds: 0,
    breakSeconds: 0,
    completedFocusSessions: 0,
    interruptedFocusSessions: 0,
    xpEarned: 0,
    modeSeconds: {},
    roomSeconds: {},
    signalSeconds: {},
    hourBuckets: emptyHourBuckets() as unknown as AnalyticsHourBuckets,
    tasksCreated: 0,
    tasksCompleted: 0,
    tasksReopened: 0,
    tasksDeleted: 0,
    reviewAnswered: 0,
    reviewCorrect: 0,
    sourceFactCount: 0,
    rebuiltAt,
    buckets: emptyHourBuckets()
  }
}

function addRecordValue<K extends string>(record: Partial<Record<K, number>>, key: K, value: number): void {
  record[key] = (record[key] ?? 0) + value
}

/** Rebuilds the disposable projection from immutable facts only. Duplicate fact IDs are ignored. */
export function rebuildStudyDailyProjections(
  facts: StudyAnalyticsFact[],
  rebuiltAt = new Date().toISOString()
): StudyDailyProjection[] {
  const projections = new Map<string, ReturnType<typeof createProjection>>()
  const seenFactIds = new Set<string>()
  const read = (date: string) => {
    const existing = projections.get(date)
    if (existing) return existing
    const projection = createProjection(date, rebuiltAt)
    projections.set(date, projection)
    return projection
  }

  for (const fact of facts) {
    if (seenFactIds.has(fact.id)) continue
    seenFactIds.add(fact.id)

    if (fact.factKind === 'study_session') {
      const lastSegment = fact.daySegments.at(-1)
      const countedDates = new Set<string>()
      for (const segment of fact.daySegments) {
        const projection = read(segment.localDate)
        if (!countedDates.has(segment.localDate)) {
          countedDates.add(segment.localDate)
          projection.sourceFactCount += 1
        }
        const activeSeconds = segment.activeSeconds
        if (fact.timerMode === 'focus') {
          projection.focusSeconds += activeSeconds
          addRecordValue<StudyAnalyticsModeId>(projection.modeSeconds, fact.context.modeId, activeSeconds)
          addRecordValue<StudyAnalyticsRoomId>(projection.roomSeconds, fact.context.roomId, activeSeconds)
          addRecordValue<StudyAnalyticsSignalId>(projection.signalSeconds, fact.context.signalId, activeSeconds)
          for (let hour = 0; hour < 24; hour += 1) {
            projection.buckets[hour] += segment.hourBuckets[hour] ?? 0
          }
        } else {
          projection.breakSeconds += activeSeconds
        }
        if (segment === lastSegment) {
          projection.completedFocusSessions += fact.completedFocusSessions
          projection.interruptedFocusSessions += fact.timerMode === 'focus' && fact.outcome === 'interrupted' ? 1 : 0
          projection.xpEarned += fact.xpEarned
        }
      }
      continue
    }

    const projection = read(fact.localDate)
    projection.sourceFactCount += 1
    switch (fact.activity.kind) {
      case 'task_created': projection.tasksCreated += 1; break
      case 'task_completed': projection.tasksCompleted += 1; break
      case 'task_reopened': projection.tasksReopened += 1; break
      case 'task_deleted': projection.tasksDeleted += 1; break
      case 'review_answered':
        projection.reviewAnswered += 1
        if (fact.activity.correct) projection.reviewCorrect += 1
        break
      default: break
    }
  }

  return [...projections.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(({ buckets, ...projection }) => ({
      ...projection,
      hourBuckets: buckets as unknown as AnalyticsHourBuckets
    }))
}

export function createStudyAnalyticsStore(
  clientId: string,
  trackingStartedOn = getLocalDateKey(),
  updatedAt = new Date().toISOString()
): StudyAnalyticsStoreV1 {
  return {
    version: 1,
    clientId,
    trackingStartedOn,
    retention: { policy: 'rolling_local_days', days: STUDY_ANALYTICS_RETENTION_DAYS },
    facts: [],
    dailyProjections: [],
    updatedAt
  }
}

function factDates(fact: StudyAnalyticsFact): string[] {
  return fact.factKind === 'study_session'
    ? fact.daySegments.map((segment) => segment.localDate)
    : [fact.localDate]
}

function trimSessionToCutoff(fact: StudySessionFact, cutoffDate: string): StudySessionFact | null {
  const daySegments = fact.daySegments.filter((segment) => segment.localDate >= cutoffDate)
  if (daySegments.length === 0) return null
  if (daySegments.length === fact.daySegments.length) return fact
  return {
    ...fact,
    startedAt: daySegments[0].startedAt,
    activeSeconds: daySegments.reduce((sum, segment) => sum + segment.activeSeconds, 0),
    pausedSeconds: daySegments.reduce((sum, segment) => sum + segment.pausedSeconds, 0),
    daySegments
  }
}

export function pruneStudyAnalyticsFacts(
  facts: StudyAnalyticsFact[],
  localToday: string
): { facts: StudyAnalyticsFact[]; cutoffDate: string; pruned: boolean } {
  const cutoffDate = addLocalDays(localToday, -(STUDY_ANALYTICS_RETENTION_DAYS - 1))
  let pruned = false
  const retained: StudyAnalyticsFact[] = []
  for (const fact of facts) {
    if (fact.factKind === 'study_session') {
      const trimmed = trimSessionToCutoff(fact, cutoffDate)
      if (!trimmed) {
        pruned = true
        continue
      }
      if (trimmed !== fact) pruned = true
      retained.push(trimmed)
      continue
    }
    if (fact.localDate < cutoffDate) {
      pruned = true
      continue
    }
    retained.push(fact)
  }
  return { facts: retained, cutoffDate, pruned }
}

export function appendFactsToStudyAnalyticsStore(
  store: StudyAnalyticsStoreV1,
  incomingFacts: StudyAnalyticsFact[],
  localToday = getLocalDateKey(),
  updatedAt = new Date().toISOString()
): {
  store: StudyAnalyticsStoreV1
  addedFactIds: string[]
  duplicateFactIds: string[]
  retentionPruned: boolean
} {
  const factsById = new Map(store.facts.map((fact) => [fact.id, fact]))
  const addedFactIds: string[] = []
  const duplicateFactIds: string[] = []
  for (const fact of incomingFacts) {
    if (factsById.has(fact.id)) {
      duplicateFactIds.push(fact.id)
      continue
    }
    factsById.set(fact.id, fact)
    addedFactIds.push(fact.id)
  }
  const pruned = pruneStudyAnalyticsFacts([...factsById.values()], localToday)
  const facts = pruned.facts.sort((left, right) => {
    const leftDate = factDates(left)[0] ?? ''
    const rightDate = factDates(right)[0] ?? ''
    return leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id)
  })
  return {
    store: {
      ...store,
      facts,
      dailyProjections: rebuildStudyDailyProjections(facts, updatedAt),
      updatedAt
    },
    addedFactIds,
    duplicateFactIds,
    retentionPruned: pruned.pruned
  }
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isLocalDate(value: unknown): value is AnalyticsLocalDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    compareLocalDates(value, value)
    return true
  } catch {
    return false
  }
}

function isHourBuckets(value: unknown): value is AnalyticsHourBuckets {
  return Array.isArray(value)
    && value.length === 24
    && value.every(isNonNegativeNumber)
}

function isTaskSchedule(value: unknown): value is StudyTaskScheduleSnapshot {
  if (!value || typeof value !== 'object') return false
  const schedule = value as Partial<StudyTaskScheduleSnapshot>
  return Number.isInteger(schedule.weekday)
    && Number(schedule.weekday) >= 0
    && Number(schedule.weekday) <= 6
    && isNonNegativeNumber(schedule.startMinutes)
    && isNonNegativeNumber(schedule.endMinutes)
    && (schedule.colorId === undefined || typeof schedule.colorId === 'string')
}

function isTaskState(value: unknown): value is StudyTaskStateSnapshot {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<StudyTaskStateSnapshot>
  return typeof task.taskId === 'string'
    && typeof task.title === 'string'
    && typeof task.done === 'boolean'
    && (task.schedule === undefined || isTaskSchedule(task.schedule))
    && (task.workspaceId === undefined || typeof task.workspaceId === 'string')
}

function isStudyActivity(value: unknown): value is StudyActivityFact['activity'] {
  if (!value || typeof value !== 'object') return false
  const activity = value as { kind?: unknown; before?: unknown; after?: unknown; correct?: unknown; workspaceId?: unknown; lessonId?: unknown; skillId?: unknown }
  switch (activity.kind) {
    case 'task_created': return isTaskState(activity.after)
    case 'task_completed':
    case 'task_reopened':
    case 'task_schedule_changed':
    case 'task_title_changed':
      return isTaskState(activity.before) && isTaskState(activity.after)
    case 'task_deleted': return isTaskState(activity.before)
    case 'review_answered':
      return typeof activity.workspaceId === 'string'
        && typeof activity.lessonId === 'string'
        && typeof activity.correct === 'boolean'
    case 'workspace_changed':
    case 'lesson_generated': return typeof activity.workspaceId === 'string'
    case 'skill_used': return typeof activity.skillId === 'string'
    default: return false
  }
}

function isSessionContext(value: unknown): value is StudySessionFact['context'] {
  if (!value || typeof value !== 'object') return false
  const context = value as Partial<StudySessionFact['context']>
  return typeof context.modeId === 'string'
    && typeof context.roomId === 'string'
    && typeof context.signalId === 'string'
    && (context.spaceCode === undefined || typeof context.spaceCode === 'string')
}

function isTaskAttribution(value: unknown): value is StudySessionFact['taskAttribution'] {
  if (!value || typeof value !== 'object') return false
  const attribution = value as Record<string, unknown>
  if (attribution.kind === 'unattributed') {
    return attribution.reason === 'no_task_selected'
      || attribution.reason === 'legacy_session'
      || attribution.reason === 'task_missing'
  }
  return attribution.kind === 'explicit'
    && attribution.capturedAt === 'session_start'
    && typeof attribution.taskId === 'string'
    && typeof attribution.taskTitleSnapshot === 'string'
    && (attribution.workspaceId === undefined || typeof attribution.workspaceId === 'string')
}

function isStudyAnalyticsFact(value: unknown): value is StudyAnalyticsFact {
  if (!value || typeof value !== 'object') return false
  const fact = value as Record<string, unknown>
  if (fact.factVersion !== 1 || typeof fact.id !== 'string' || typeof fact.clientId !== 'string') return false
  if (fact.factKind === 'study_activity') {
    return isInstant(fact.occurredAt)
      && isInstant(fact.recordedAt)
      && isLocalDate(fact.localDate)
      && typeof fact.timezoneOffsetMinutes === 'number'
      && Number.isFinite(fact.timezoneOffsetMinutes)
      && isStudyActivity(fact.activity)
  }
  if (fact.factKind !== 'study_session') return false
  if (
    (fact.timerMode !== 'focus' && fact.timerMode !== 'break')
    || (fact.outcome !== 'completed' && fact.outcome !== 'interrupted' && fact.outcome !== 'canceled')
    || !isInstant(fact.startedAt)
    || !isInstant(fact.endedAt)
    || !isInstant(fact.recordedAt)
    || !isNonNegativeNumber(fact.plannedSeconds)
    || !isNonNegativeNumber(fact.activeSeconds)
    || !isNonNegativeNumber(fact.pausedSeconds)
    || !isNonNegativeNumber(fact.xpEarned)
    || (fact.completedFocusSessions !== 0 && fact.completedFocusSessions !== 1)
    || !isSessionContext(fact.context)
    || !isTaskAttribution(fact.taskAttribution)
    || !Array.isArray(fact.daySegments)
  ) return false
  const segments = fact.daySegments as Array<Record<string, unknown>>
  if (!segments.every((segment) => (
    isLocalDate(segment.localDate)
    && typeof segment.timezoneOffsetMinutes === 'number'
    && Number.isFinite(segment.timezoneOffsetMinutes)
    && isInstant(segment.startedAt)
    && isInstant(segment.endedAt)
    && isNonNegativeNumber(segment.activeSeconds)
    && isNonNegativeNumber(segment.pausedSeconds)
    && isHourBuckets(segment.hourBuckets)
  ))) return false
  const activeSeconds = segments.reduce((sum, segment) => sum + Number(segment.activeSeconds), 0)
  const pausedSeconds = segments.reduce((sum, segment) => sum + Number(segment.pausedSeconds), 0)
  return activeSeconds === fact.activeSeconds && pausedSeconds === fact.pausedSeconds
}

function analyticsStorageKey(clientId: string): string {
  return `${STUDY_ANALYTICS_STORAGE_KEY_PREFIX}:${encodeURIComponent(clientId)}`
}

function browserStorage(): StudyAnalyticsStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function emptyReadDiagnostics(): StudyAnalyticsStoreReadDiagnostics {
  return { invalidFactRows: 0, retentionPruned: false, warnings: [] }
}

function normalizeStoredStore(
  value: unknown,
  clientId: string,
  localToday: AnalyticsLocalDate,
  updatedAt: string
): { store: StudyAnalyticsStoreV1; diagnostics: StudyAnalyticsStoreReadDiagnostics } {
  if (!value || typeof value !== 'object') {
    return { store: createStudyAnalyticsStore(clientId, localToday, updatedAt), diagnostics: emptyReadDiagnostics() }
  }
  const raw = value as Partial<StudyAnalyticsStoreV1>
  if (raw.version !== 1 || raw.clientId !== clientId || !Array.isArray(raw.facts)) {
    return { store: createStudyAnalyticsStore(clientId, localToday, updatedAt), diagnostics: emptyReadDiagnostics() }
  }
  const trackingStartedOn = isLocalDate(raw.trackingStartedOn) ? raw.trackingStartedOn : localToday
  const validFacts = raw.facts.filter(isStudyAnalyticsFact)
  const invalidFactRows = raw.facts.length - validFacts.length
  const pruned = pruneStudyAnalyticsFacts(validFacts, localToday)
  const warnings: AnalyticsWarning[] = invalidFactRows > 0 ? [{
    code: 'facts_recovered_with_invalid_rows',
    severity: 'warning',
    source: 'study_fact_store',
    message: 'Some invalid local analytics fact rows were ignored while the remaining history was recovered.',
    details: { invalidFactRows }
  }] : []
  return {
    store: {
      version: 1,
      clientId,
      trackingStartedOn,
      retention: { policy: 'rolling_local_days', days: STUDY_ANALYTICS_RETENTION_DAYS },
      facts: pruned.facts,
      dailyProjections: rebuildStudyDailyProjections(pruned.facts, updatedAt),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : updatedAt
    },
    diagnostics: { invalidFactRows, retentionPruned: pruned.pruned, warnings }
  }
}

export type ReadStudyAnalyticsStoreOptions = {
  storage?: StudyAnalyticsStorage | null
  localToday?: AnalyticsLocalDate
  updatedAt?: string
}

/** Returns a referentially stable store until the serialized ledger or local retention day changes. */
export function readStudyAnalyticsStoreWithDiagnostics(
  clientId: string,
  options: ReadStudyAnalyticsStoreOptions = {}
): { store: StudyAnalyticsStoreV1; diagnostics: StudyAnalyticsStoreReadDiagnostics } {
  const storage = options.storage === undefined ? browserStorage() : options.storage
  const localToday = options.localToday ?? getLocalDateKey()
  const updatedAt = options.updatedAt ?? new Date().toISOString()
  if (!storage) {
    return { store: createStudyAnalyticsStore(clientId, localToday, updatedAt), diagnostics: emptyReadDiagnostics() }
  }

  const key = analyticsStorageKey(clientId)
  const cache = cacheFor(storage)
  try {
    const raw = storage.getItem(key)
    const cached = cache.get(key)
    if (cached && cached.raw === raw && cached.localToday === localToday) {
      return { store: cached.store, diagnostics: cached.diagnostics }
    }
    const parsed = raw ? JSON.parse(raw) : null
    const normalized = normalizeStoredStore(parsed, clientId, localToday, updatedAt)
    cache.set(key, { raw, localToday, ...normalized })
    return normalized
  } catch {
    const store = createStudyAnalyticsStore(clientId, localToday, updatedAt)
    const diagnostics = emptyReadDiagnostics()
    cache.set(key, { raw: null, localToday, store, diagnostics })
    return { store, diagnostics }
  }
}

export function readStudyAnalyticsStore(
  clientId: string,
  options: ReadStudyAnalyticsStoreOptions = {}
): StudyAnalyticsStoreV1 {
  return readStudyAnalyticsStoreWithDiagnostics(clientId, options).store
}

export function persistStudyAnalyticsStore(
  store: StudyAnalyticsStoreV1,
  storage: StudyAnalyticsStorage | null = browserStorage(),
  localToday: AnalyticsLocalDate = getLocalDateKey()
): boolean {
  if (!storage) return false
  const key = analyticsStorageKey(store.clientId)
  try {
    const raw = JSON.stringify(store)
    storage.setItem(key, raw)
    cacheFor(storage).set(key, { raw, localToday, store, diagnostics: emptyReadDiagnostics() })
    return true
  } catch {
    return false
  }
}

function emitStudyAnalyticsChanged(clientId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STUDY_ANALYTICS_CHANGED_EVENT, { detail: { clientId } }))
}

export type AppendStudyAnalyticsFactsOptions = {
  storage?: StudyAnalyticsStorage | null
  localToday?: AnalyticsLocalDate
  updatedAt?: string
}

/** Synchronous renderer ledger append. Same fact IDs are safe to replay. */
export function appendStudyAnalyticsFacts(
  clientId: string,
  facts: StudyAnalyticsFact[],
  options: AppendStudyAnalyticsFactsOptions = {}
): ReturnType<typeof appendFactsToStudyAnalyticsStore> {
  const storage = options.storage === undefined ? browserStorage() : options.storage
  const localToday = options.localToday ?? getLocalDateKey()
  const updatedAt = options.updatedAt ?? new Date().toISOString()
  const current = readStudyAnalyticsStore(clientId, { storage, localToday, updatedAt })
  const result = appendFactsToStudyAnalyticsStore(current, facts, localToday, updatedAt)
  if ((result.addedFactIds.length > 0 || result.retentionPruned) && persistStudyAnalyticsStore(result.store, storage, localToday)) {
    emitStudyAnalyticsChanged(clientId)
  }
  return result
}

/** Ledger notifications occur only for fact/store changes, never for the timer's one-second UI tick. */
export function subscribeStudyAnalyticsStore(clientId: string, listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const key = analyticsStorageKey(clientId)
  const storage = browserStorage()
  const onChanged = (event: Event): void => {
    const detail = (event as CustomEvent<{ clientId?: string }>).detail
    if (detail?.clientId === clientId) listener()
  }
  const onStorage = (event: StorageEvent): void => {
    if (event.key === key) {
      if (storage) cacheFor(storage).delete(key)
      listener()
    }
  }
  window.addEventListener(STUDY_ANALYTICS_CHANGED_EVENT, onChanged)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(STUDY_ANALYTICS_CHANGED_EVENT, onChanged)
    window.removeEventListener('storage', onStorage)
  }
}

export function createStudyAnalyticsFactId(prefix: string, occurredAtMs = Date.now()): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }
  return `${prefix}:${occurredAtMs}:${Math.random().toString(36).slice(2)}`
}

export type StudyTaskLedgerItem = {
  id: string
  title: string
  done: boolean
  schedule?: {
    weekday: number
    startMinutes: number
    endMinutes: number
    colorId?: string
  }
}

export type CreateTaskActivityFactsOptions = {
  clientId: string
  workspaceId?: string
  occurredAtMs?: number
  recordedAtMs?: number
  timeZone?: string
  operationId?: string
}

function taskScheduleSnapshot(task: StudyTaskLedgerItem): StudyTaskScheduleSnapshot | undefined {
  const schedule = task.schedule
  if (!schedule) return undefined
  const weekday = Math.max(0, Math.min(6, Math.floor(schedule.weekday))) as AnalyticsWeekdayIndex
  return {
    weekday,
    startMinutes: Math.max(0, Math.floor(schedule.startMinutes)),
    endMinutes: Math.max(1, Math.floor(schedule.endMinutes)),
    ...(schedule.colorId ? { colorId: schedule.colorId } : {})
  }
}

function taskStateSnapshot(task: StudyTaskLedgerItem, workspaceId?: string): StudyTaskStateSnapshot {
  const schedule = taskScheduleSnapshot(task)
  return {
    taskId: task.id,
    title: task.title,
    done: task.done,
    ...(schedule ? { schedule } : {}),
    ...(workspaceId ? { workspaceId } : {})
  }
}

function schedulesEqual(left?: StudyTaskScheduleSnapshot, right?: StudyTaskScheduleSnapshot): boolean {
  return left?.weekday === right?.weekday
    && left?.startMinutes === right?.startMinutes
    && left?.endMinutes === right?.endMinutes
    && left?.colorId === right?.colorId
}

/** Produces append-only task lifecycle facts from an explicit before/after mutation. */
export function createTaskActivityFacts(
  beforeTasks: StudyTaskLedgerItem[],
  afterTasks: StudyTaskLedgerItem[],
  options: CreateTaskActivityFactsOptions
): StudyTaskActivityFact[] {
  const occurredAtMs = options.occurredAtMs ?? Date.now()
  const recordedAtMs = options.recordedAtMs ?? occurredAtMs
  const timeZone = options.timeZone ?? resolvedLocalTimeZone()
  const operationId = options.operationId ?? createStudyAnalyticsFactId('task-operation', occurredAtMs)
  const base = {
    factVersion: 1 as const,
    factKind: 'study_activity' as const,
    clientId: options.clientId,
    occurredAt: new Date(occurredAtMs).toISOString(),
    recordedAt: new Date(recordedAtMs).toISOString(),
    localDate: getLocalDateKey(occurredAtMs, timeZone),
    timezoneOffsetMinutes: getLocalTimezoneOffsetMinutes(occurredAtMs, timeZone)
  }
  const beforeById = new Map(beforeTasks.map((task) => [task.id, task]))
  const afterById = new Map(afterTasks.map((task) => [task.id, task]))
  const facts: StudyTaskActivityFact[] = []
  let sequence = 0
  const push = (taskId: string, activity: StudyTaskActivityFact['activity']): void => {
    facts.push({
      ...base,
      id: `${operationId}:${sequence}:${activity.kind}:${encodeURIComponent(taskId)}`,
      activity
    })
    sequence += 1
  }

  for (const afterTask of afterTasks) {
    const beforeTask = beforeById.get(afterTask.id)
    const target = taskStateSnapshot(afterTask, options.workspaceId)
    if (!beforeTask) {
      push(afterTask.id, { kind: 'task_created', after: target })
      continue
    }

    let current = taskStateSnapshot(beforeTask, options.workspaceId)
    if (current.title !== target.title) {
      const after = { ...current, title: target.title }
      push(afterTask.id, { kind: 'task_title_changed', before: current, after })
      current = after
    }
    if (!schedulesEqual(current.schedule, target.schedule)) {
      const after = { ...current, ...(target.schedule ? { schedule: target.schedule } : {}) }
      if (!target.schedule) delete after.schedule
      push(afterTask.id, { kind: 'task_schedule_changed', before: current, after })
      current = after
    }
    if (current.done !== target.done) {
      const after = { ...current, done: target.done }
      push(afterTask.id, {
        kind: target.done ? 'task_completed' : 'task_reopened',
        before: current,
        after
      })
    }
  }

  for (const beforeTask of beforeTasks) {
    if (!afterById.has(beforeTask.id)) {
      push(beforeTask.id, { kind: 'task_deleted', before: taskStateSnapshot(beforeTask, options.workspaceId) })
    }
  }
  return facts
}

export type LegacyStudyAnalyticsSnapshot = {
  lastStudyDate?: string
  totalFocusSeconds?: number
  totalSessions?: number
  streakDays?: number
}

export function getLegacyStudyAnalyticsStatus(
  store: StudyAnalyticsStoreV1 | null,
  legacy: LegacyStudyAnalyticsSnapshot,
  localToday = getLocalDateKey()
): {
  state: AnalyticsDataState
  coverage: AnalyticsCoverage
  warnings: AnalyticsWarning[]
} {
  const range = createAnalyticsDateRange('all', localToday)
  const cutoffDate = addLocalDays(localToday, -(STUDY_ANALYTICS_RETENTION_DAYS - 1))
  const dates = store?.facts.flatMap(factDates).sort() ?? []
  const knownFocusSeconds = store?.facts.reduce((sum, fact) => (
    fact.factKind === 'study_session' && fact.timerMode === 'focus' ? sum + fact.activeSeconds : sum
  ), 0) ?? 0
  const knownSessions = store?.facts.reduce((sum, fact) => (
    fact.factKind === 'study_session' ? sum + fact.completedFocusSessions : sum
  ), 0) ?? 0
  const hasLegacyTotals = (legacy.totalFocusSeconds ?? 0) > knownFocusSeconds
    || (legacy.totalSessions ?? 0) > knownSessions
    || (!store && (legacy.streakDays ?? 0) > 0)
  const warnings: AnalyticsWarning[] = []
  if (!store || range.from < store.trackingStartedOn) {
    warnings.push({
      code: 'range_before_tracking_started',
      severity: 'warning',
      source: 'study_fact_store',
      message: store
        ? 'The requested historical range begins before local analytics fact tracking started.'
        : 'Local analytics fact tracking has not established a reconstructable historical range.'
    })
  }
  if (store && store.trackingStartedOn < cutoffDate) {
    warnings.push({
      code: 'range_before_retention_window',
      severity: 'warning',
      source: 'study_fact_store',
      message: 'The requested historical range extends beyond the rolling 400-day local retention window.'
    })
  }
  if (hasLegacyTotals) {
    warnings.push({
      code: 'legacy_aggregate_not_backfillable',
      severity: 'warning',
      source: 'study_snapshot',
      message: 'Earlier cumulative study totals do not contain reconstructable daily facts.'
    })
  }
  if (legacy.lastStudyDate && hasLegacyTotals) {
    warnings.push({
      code: 'legacy_utc_date_semantics',
      severity: 'warning',
      source: 'study_snapshot',
      message: 'The legacy streak date may have been recorded using UTC calendar boundaries.'
    })
  }
  const trackingStartedOn = store?.trackingStartedOn ?? null
  const complete = Boolean(store) && warnings.length === 0
  return {
    state: !store && !hasLegacyTotals
      ? 'unavailable'
      : warnings.length > 0
        ? 'partial'
        : dates.length > 0 ? 'available' : 'empty',
    warnings,
    coverage: {
      rangeApplied: true,
      requestedRange: range,
      effectiveRange: store ? { ...range, from: store.trackingStartedOn < cutoffDate ? cutoffDate : store.trackingStartedOn } : null,
      trackingStartedOn,
      dataStartDate: dates[0] ?? null,
      dataEndDate: dates.at(-1) ?? null,
      retention: {
        policy: 'rolling_local_days',
        days: STUDY_ANALYTICS_RETENTION_DAYS,
        includesToday: true,
        cutoffDate
      },
      complete,
      sources: [
        {
          source: 'study_fact_store',
          state: store ? (complete ? 'complete' : 'partial') : 'unavailable',
          scanned: store?.facts.length ?? 0,
          included: store?.facts.length ?? 0,
          missing: warnings.length,
          rejected: 0,
          earliestLocalDate: dates[0],
          latestLocalDate: dates.at(-1)
        }
      ]
    }
  }
}

export function createTaskActivityFact(input: Omit<StudyActivityFact, 'factVersion' | 'factKind'>): StudyActivityFact {
  return { factVersion: 1, factKind: 'study_activity', ...input } as StudyActivityFact
}
