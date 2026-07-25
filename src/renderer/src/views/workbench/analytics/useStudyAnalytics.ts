import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { readStudySnapshot } from '../../../study-space/domain'
import { listStudyTaskCategories, resolveStudyTaskCategory } from '../../../study-space/taskCategories'
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

/**
 * Ready-bundle contract failure. Safe for UI surfaces: message never includes the raw payload.
 * Treated as a retryable request failure, not API unavailability.
 */
export class AnalyticsBundleContractError extends Error {
  readonly code = 'analytics_bundle_contract'
  readonly retryable = true as const

  constructor(message = 'Learning Analytics returned an incomplete response.') {
    super(message)
    this.name = 'AnalyticsBundleContractError'
  }
}

export type AnalyticsRequestIssue =
  | { kind: 'api_unavailable'; message: string; retryable: false }
  | { kind: 'request_failed'; message: string; retryable: true }

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
  if (!today) throw new RangeError(`Invalid localToday: ${localToday}`)

  if (preset === 'custom') {
    const draft = custom ?? { from: '', to: '' }
    const validation = validateCustomAnalyticsRange(draft, localToday)
    if (!validation.valid || !draft.from || !draft.to) {
      throw new RangeError('Invalid custom analytics range.')
    }
    return makeRange('custom', draft.from, draft.to)
  }

  if (preset === 'today') return makeRange('today', localToday, localToday)
  if (preset === 'month') {
    const from = `${localToday.slice(0, 8)}01` as AnalyticsLocalDate
    return makeRange('month', from, localToday)
  }
  if (preset === 'all') {
    // Sentinel lower bound; personal/token sources clamp to tracking/retention.
    return makeRange('all', '0001-01-01', localToday)
  }

  // week: Monday-start inclusive through localToday.
  // The active-range chart still expands categories to a full Mon–Sun week.
  const weekday = (today.getDay() + 6) % 7
  const from = addLocalDays(localToday, -weekday)
  return makeRange('week', from, localToday)
}

export function buildLearningAnalyticsQuery(input: BuildLearningAnalyticsQueryInput): LearningAnalyticsQuery {
  const { range, localToday, timeZone, personalClientId, teaching, presenceSpaceCode } = input
  return {
    range,
    scope: {
      personalFocus: { kind: 'personal', clientId: personalClientId },
      teaching,
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

/** Bundle fields that must be present on every ready Learning Analytics response. */
export const REQUIRED_ANALYTICS_BUNDLE_SECTIONS = [
  'hero',
  'focus',
  'tasks',
  'tokens',
  'workspaceAssets',
  'review',
  'memory',
  'platform',
  'presence',
  'insights'
] as const

export type RequiredAnalyticsBundleSection = (typeof REQUIRED_ANALYTICS_BUNDLE_SECTIONS)[number]

/**
 * Runtime contract for a ready analytics bundle.
 * Missing required sections fail the whole request instead of being silently
 * treated as per-section nulls in the page shell.
 * Never includes the raw payload in the error message.
 */
export function assertAnalyticsBundle(value: unknown): asserts value is LearningAnalyticsBundle {
  if (!value || typeof value !== 'object') {
    throw new AnalyticsBundleContractError()
  }
  const bundle = value as Record<string, unknown>
  if (bundle.contractVersion !== 1) {
    throw new AnalyticsBundleContractError()
  }
  for (const section of REQUIRED_ANALYTICS_BUNDLE_SECTIONS) {
    const result = bundle[section]
    if (!result || typeof result !== 'object') {
      throw new AnalyticsBundleContractError()
    }
    const state = (result as { state?: unknown }).state
    if (typeof state !== 'string' || state.length === 0) {
      throw new AnalyticsBundleContractError()
    }
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
      tasks: (() => {
        const categories = listStudyTaskCategories()
        return study.tasks.map((task) => {
        const schedule = task.schedule
        const validSchedule = schedule
          && Number.isInteger(schedule.weekday)
          && schedule.weekday >= 0
          && schedule.weekday <= 6
          && Number.isFinite(schedule.startMinutes)
          && Number.isFinite(schedule.endMinutes)
        const category = resolveStudyTaskCategory(task.categoryId, categories)
        const categoryId = category?.id ?? task.categoryId
        const categoryName = category?.name
        return {
          taskId: task.id,
          title: task.title,
          done: task.done,
          ...(categoryId ? { categoryId } : {}),
          ...(categoryName ? { categoryName } : {}),
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
      })()
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
  if (error instanceof AnalyticsBundleContractError) return error.message
  if (error instanceof AnalyticsApiUnavailableError) return error.message
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Learning Analytics request failed.'
}

function toRequestIssue(error: unknown): AnalyticsRequestIssue {
  if (error instanceof AnalyticsApiUnavailableError) {
    return { kind: 'api_unavailable', message: requestErrorMessage(error), retryable: false }
  }
  return { kind: 'request_failed', message: requestErrorMessage(error), retryable: true }
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

    const applyFailure = (error: unknown) => {
      if (controller.signal.aborted || sequence !== requestSequence.current) return
      const issue = toRequestIssue(error)
      const unavailable = issue.kind === 'api_unavailable'
      setState((current) => {
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

    void request.then(
      (bundle) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) return
        try {
          // Enforce the ready-bundle contract for every client, not only the teachingSystem transport.
          assertAnalyticsBundle(bundle)
        } catch (error) {
          applyFailure(error)
          return
        }
        setState({
          phase: 'ready',
          bundle,
          isRefreshing: false,
          isStale: false,
          issue: null
        })
      },
      (error: unknown) => {
        applyFailure(error)
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
