import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { readStudySnapshot } from '../../../study-space/domain'
import { createPersonalStudyAnalyticsSnapshot, subscribeStudyAnalyticsStore } from './domain/activityLedger'
import type {
  AnalyticsDateRange,
  AnalyticsLocalDate,
  AnalyticsRangePreset,
  AnalyticsSectionId,
  LearningAnalyticsBundle,
  LearningAnalyticsQuery,
  LearningAnalyticsRequest,
  TeachingAnalyticsScope
} from './types'

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export type AnalyticsCustomRangeDraft = {
  from: AnalyticsLocalDate | ''
  to: AnalyticsLocalDate | ''
}

export type AnalyticsCustomRangeValidation =
  | { valid: true }
  | {
      valid: false
      code: 'required' | 'invalid_date' | 'from_after_to' | 'future_date'
      field?: 'from' | 'to'
    }

export type BuildLearningAnalyticsQueryInput = {
  range: AnalyticsDateRange
  localToday: AnalyticsLocalDate
  timeZone: string
  personalClientId: string
  teaching: TeachingAnalyticsScope
  presenceSpaceCode?: string | null
}

export interface LearningAnalyticsClient {
  getLearningAnalytics: (
    query: LearningAnalyticsQuery,
    signal: AbortSignal
  ) => Promise<LearningAnalyticsBundle>
  /** Optional transport for a selective section retry. */
  refreshLearningAnalyticsSections?: (
    query: LearningAnalyticsQuery,
    sectionIds: readonly AnalyticsSectionId[],
    signal: AbortSignal
  ) => Promise<LearningAnalyticsBundle>
}

export class AnalyticsApiUnavailableError extends Error {
  readonly code = 'analytics_api_unavailable'

  constructor(message = 'Learning Analytics API is unavailable.') {
    super(message)
    this.name = 'AnalyticsApiUnavailableError'
  }
}

export type AnalyticsRequestIssue =
  | { kind: 'unavailable'; message: string; retryable: true }
  | { kind: 'error'; message: string; retryable: boolean }

export type UseStudyAnalyticsResult = {
  phase: 'loading' | 'ready' | 'unavailable' | 'error'
  bundle: LearningAnalyticsBundle | null
  isRefreshing: boolean
  isStale: boolean
  issue: AnalyticsRequestIssue | null
  refresh: () => void
  retrySection: (sectionId: AnalyticsSectionId) => void
}

export type UseStudyAnalyticsOptions = {
  query: LearningAnalyticsQuery
  client?: LearningAnalyticsClient
  enabled?: boolean
}

type AnalyticsCapableSystemApi = {
  getLearningAnalytics?: (request: LearningAnalyticsRequest) => Promise<LearningAnalyticsBundle>
  learningAnalytics?: {
    get?: (request: LearningAnalyticsRequest) => Promise<LearningAnalyticsBundle>
  }
}

function parseLocalDate(value: AnalyticsLocalDate): Date | null {
  const match = LOCAL_DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(year, monthIndex, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

export function localDateKey(date: Date): AnalyticsLocalDate {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addLocalDays(value: AnalyticsLocalDate, amount: number): AnalyticsLocalDate {
  const date = parseLocalDate(value)
  if (!date) throw new RangeError(`Invalid local date: ${value}`)
  date.setDate(date.getDate() + amount)
  return localDateKey(date)
}

function makeRange(
  preset: AnalyticsRangePreset,
  from: AnalyticsLocalDate,
  to: AnalyticsLocalDate
): AnalyticsDateRange {
  return {
    preset,
    from,
    to,
    fromInclusive: true,
    toInclusive: true,
    calendar: 'local_gregorian',
    weekStartsOn: 1
  }
}

export function validateCustomAnalyticsRange(
  draft: AnalyticsCustomRangeDraft,
  localToday: AnalyticsLocalDate
): AnalyticsCustomRangeValidation {
  if (!draft.from) return { valid: false, code: 'required', field: 'from' }
  if (!draft.to) return { valid: false, code: 'required', field: 'to' }
  if (!parseLocalDate(draft.from)) return { valid: false, code: 'invalid_date', field: 'from' }
  if (!parseLocalDate(draft.to)) return { valid: false, code: 'invalid_date', field: 'to' }
  if (!parseLocalDate(localToday)) return { valid: false, code: 'invalid_date' }
  if (draft.from > draft.to) return { valid: false, code: 'from_after_to' }
  if (draft.to > localToday || draft.from > localToday) {
    return { valid: false, code: 'future_date' }
  }
  return { valid: true }
}

export function buildAnalyticsDateRange(
  preset: AnalyticsRangePreset,
  localToday: AnalyticsLocalDate,
  custom?: AnalyticsCustomRangeDraft
): AnalyticsDateRange {
  const today = parseLocalDate(localToday)
  if (!today) throw new RangeError(`Invalid local today: ${localToday}`)

  if (preset === 'custom') {
    const validation = validateCustomAnalyticsRange(custom ?? { from: '', to: '' }, localToday)
    if (!validation.valid || !custom?.from || !custom.to) {
      throw new RangeError(`Invalid custom analytics range: ${validation.valid ? 'required' : validation.code}`)
    }
    return makeRange('custom', custom.from, custom.to)
  }
  if (preset === 'all') return makeRange('all', '0001-01-01', localToday)
  if (preset === 'today') return makeRange('today', localToday, localToday)
  if (preset === 'month') {
    const monthStart = new Date(today)
    monthStart.setDate(1)
    return makeRange('month', localDateKey(monthStart), localToday)
  }
  if (preset === '90d') return makeRange('90d', addLocalDays(localToday, -89), localToday)

  const mondayOffset = (today.getDay() + 6) % 7
  return makeRange('week', addLocalDays(localToday, -mondayOffset), localToday)
}

export function buildLearningAnalyticsQuery({
  range,
  localToday,
  timeZone,
  personalClientId,
  teaching,
  presenceSpaceCode
}: BuildLearningAnalyticsQueryInput): LearningAnalyticsQuery {
  const normalizedTeaching: TeachingAnalyticsScope = teaching.kind === 'all_workspaces'
    ? { ...teaching, workspaceIds: [...new Set(teaching.workspaceIds)].sort() }
    : teaching

  return {
    range,
    scope: {
      personalFocus: { kind: 'personal', clientId: personalClientId },
      teaching: normalizedTeaching,
      presence: presenceSpaceCode
        ? { kind: 'live_space', spaceCode: presenceSpaceCode }
        : { kind: 'none' }
    },
    calendarContext: {
      localToday,
      timeZone: timeZone || 'Etc/UTC',
      weekStartsOn: 1
    }
  }
}

export function analyticsQueryKey(query: LearningAnalyticsQuery): string {
  return JSON.stringify(query)
}

function assertAnalyticsBundle(value: unknown): asserts value is LearningAnalyticsBundle {
  if (!value || typeof value !== 'object' || (value as { contractVersion?: unknown }).contractVersion !== 1) {
    throw new Error('Learning Analytics returned an unsupported response.')
  }
}

function personalStudyRequest(query: LearningAnalyticsQuery): LearningAnalyticsRequest {
  if (query.scope.personalFocus.kind !== 'personal') return { query }
  const study = readStudySnapshot()
  return {
    query,
    personalStudy: createPersonalStudyAnalyticsSnapshot(query.scope.personalFocus.clientId, {
      xp: study.xp,
      streakDays: study.streakDays,
      tasks: study.tasks.map((task) => {
        const schedule = task.schedule
        const validSchedule = schedule
          && Number.isInteger(schedule.weekday)
          && schedule.weekday >= 0
          && schedule.weekday <= 6
          && Number.isFinite(schedule.startMinutes)
          && Number.isFinite(schedule.endMinutes)
        return {
          taskId: task.id,
          title: task.title,
          done: task.done,
          ...(validSchedule ? {
            schedule: {
              weekday: schedule.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
              startMinutes: schedule.startMinutes,
              endMinutes: schedule.endMinutes,
              ...(schedule.colorId ? { colorId: schedule.colorId } : {})
            }
          } : {})
        }
      })
    })
  }
}

const ALL_ANALYTICS_SECTION_IDS: readonly AnalyticsSectionId[] = [
  'hero',
  'focus',
  'tasks',
  'tokens',
  'workspace_assets',
  'review',
  'memory',
  'platform',
  'presence',
  'insights'
]

export const teachingSystemAnalyticsClient: LearningAnalyticsClient = {
  async getLearningAnalytics(query, signal) {
    return requestAnalyticsBundle(query, signal, { sectionIds: ALL_ANALYTICS_SECTION_IDS })
  },
  async refreshLearningAnalyticsSections(query, sectionIds, signal) {
    return requestAnalyticsBundle(query, signal, { refreshSectionIds: sectionIds })
  }
}

type AnalyticsBundleRequestOptions = {
  sectionIds?: readonly AnalyticsSectionId[]
  refreshSectionIds?: readonly AnalyticsSectionId[]
}

async function requestAnalyticsBundle(query: LearningAnalyticsQuery, signal: AbortSignal, options: AnalyticsBundleRequestOptions = {}): Promise<LearningAnalyticsBundle> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const system = typeof window === 'undefined'
    ? undefined
    : window.teachingSystem as unknown as AnalyticsCapableSystemApi | undefined
  const request: LearningAnalyticsRequest = {
    ...personalStudyRequest(query),
    ...(options.sectionIds?.length ? { sectionIds: [...new Set(options.sectionIds)] } : {}),
    ...(options.refreshSectionIds?.length ? { refreshSectionIds: [...new Set(options.refreshSectionIds)] } : {})
  }
  let bundle: LearningAnalyticsBundle
  if (system?.getLearningAnalytics) {
    bundle = await system.getLearningAnalytics(request)
  } else if (system?.learningAnalytics?.get) {
    bundle = await system.learningAnalytics.get(request)
  } else {
    throw new AnalyticsApiUnavailableError()
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  assertAnalyticsBundle(bundle)
  return bundle
}

function requestErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Learning Analytics request failed.'
}

export function useStudyAnalytics({
  query,
  client = teachingSystemAnalyticsClient,
  enabled = true
}: UseStudyAnalyticsOptions): UseStudyAnalyticsResult {
  const queryKey = useMemo(() => analyticsQueryKey(query), [query])
  const [refreshVersion, requestRefresh] = useReducer((value: number) => value + 1, 0)
  const [state, setState] = useState<Omit<UseStudyAnalyticsResult, 'refresh' | 'retrySection'>>({
    phase: 'loading',
    bundle: null,
    isRefreshing: false,
    isStale: false,
    issue: null
  })
  const requestSequence = useRef(0)
  const queryRef = useRef(query)
  const retrySectionRef = useRef<AnalyticsSectionId | null>(null)
  queryRef.current = query

  const personalClientId = query.scope.personalFocus.kind === 'personal'
    ? query.scope.personalFocus.clientId
    : null

  useEffect(() => {
    if (!enabled || client !== teachingSystemAnalyticsClient || !personalClientId) return
    return subscribeStudyAnalyticsStore(personalClientId, () => {
      retrySectionRef.current = null
      requestRefresh()
    })
  }, [client, enabled, personalClientId])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const sequence = ++requestSequence.current

    setState((current) => {
      if (!current.bundle) {
        return {
          phase: 'loading',
          bundle: null,
          isRefreshing: false,
          isStale: false,
          issue: null
        }
      }
      return {
        ...current,
        phase: 'ready',
        isRefreshing: true,
        isStale: analyticsQueryKey(current.bundle.query) !== queryKey,
        issue: null
      }
    })

    const sectionId = retrySectionRef.current
    retrySectionRef.current = null
    const request = sectionId && client.refreshLearningAnalyticsSections
      ? client.refreshLearningAnalyticsSections(queryRef.current, [sectionId], controller.signal)
      : client.getLearningAnalytics(queryRef.current, controller.signal)
    void request.then(
      (bundle) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) return
        setState({
          phase: 'ready',
          bundle,
          isRefreshing: false,
          isStale: false,
          issue: null
        })
      },
      (error: unknown) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) return
        const unavailable = error instanceof AnalyticsApiUnavailableError
        setState((current) => {
          const issue: AnalyticsRequestIssue = unavailable
            ? { kind: 'unavailable', message: requestErrorMessage(error), retryable: true }
            : { kind: 'error', message: requestErrorMessage(error), retryable: true }
          if (current.bundle) {
            return {
              phase: 'ready',
              bundle: current.bundle,
              isRefreshing: false,
              isStale: true,
              issue
            }
          }
          return {
            phase: unavailable ? 'unavailable' : 'error',
            bundle: null,
            isRefreshing: false,
            isStale: false,
            issue
          }
        })
      }
    )

    return () => controller.abort()
  }, [client, enabled, queryKey, refreshVersion])

  const refresh = useCallback(() => {
    retrySectionRef.current = null
    requestRefresh()
  }, [])
  const retrySection = useCallback((sectionId: AnalyticsSectionId) => {
    retrySectionRef.current = sectionId
    requestRefresh()
  }, [])

  return {
    ...state,
    refresh,
    retrySection
  }
}
