/**
 * Consent-gated upload of derived Learning Analytics chart data.
 *
 * The desktop still calculates every metric locally from the personal ledger
 * and workspace sources. This module only mirrors a narrow, display-ready
 * aggregate to the sync service so Web can render the same focus/task charts.
 * It never uploads raw activity facts, user-authored task titles, teaching
 * evidence, conversations, workspace metadata, review/memory content, or tool
 * payloads.
 */

import { useEffect, useRef } from 'react'
import type {
  AnalyticsRangePreset,
  LearningAnalyticsBundle,
  LearningAnalyticsQuery,
  LearningAnalyticsRequest,
  SyncedAnalyticsVisualizationsV1
} from '../../../shared/teaching-types/analytics'
import { readStudySnapshot, todayKey } from '../study-space/domain'
import {
  buildAnalyticsDateRange,
  buildLearningAnalyticsQuery,
  createPersonalStudyAnalyticsRequest
} from '../views/workbench/analytics/useStudyAnalytics'
import {
  createSyncApiClient,
  SyncApiError,
  type SyncAnalyticsSummaryBody,
  type SyncApiClient,
  type SyncApiClientOptions
} from './sync-api-client'
import {
  clearSyncAuth,
  getSyncAccessToken,
  getSyncState,
  setSyncAuth,
  useSyncState
} from './sync-store'

const UPLOAD_INTERVAL_MS = 5 * 60 * 1000
const SYNCED_PRESETS: readonly Exclude<AnalyticsRangePreset, 'custom'>[] = ['today', 'week', 'month', 'all']

type AnalyticsSystem = {
  platform?: NodeJS.Platform | 'web'
  getLearningAnalytics?: (request: LearningAnalyticsRequest) => Promise<LearningAnalyticsBundle>
}

function serverRangeKey(preset: AnalyticsRangePreset): SyncAnalyticsSummaryBody['rangeKey'] {
  switch (preset) {
    case 'today': return 'today'
    case 'week': return 'sevenDays'
    case 'month': return 'thirtyDays'
    case 'all': return 'allTime'
    case 'custom': return 'thirtyDays'
  }
}

function sectionData<T>(section: { state: string; data?: T }): T | null {
  return section.state === 'available' || section.state === 'partial'
    ? section.data ?? null
    : null
}

/** Convert a locally-derived bundle into the deliberately narrow sync DTO. */
export function buildAnalyticsVisualizationSummary(bundle: LearningAnalyticsBundle): SyncAnalyticsSummaryBody | null {
  const hero = sectionData(bundle.hero)
  const focus = sectionData(bundle.focus)
  if (!hero || !focus) return null

  const tasks = sectionData(bundle.tasks)
  // `dailyXp` is local bookkeeping. It is neither needed by Web charts nor
  // part of the consented cross-device aggregate.
  const { dailyXp: _dailyXp, ...currentGrowth } = focus.currentGrowth
  const payload: SyncedAnalyticsVisualizationsV1 = {
    version: 1,
    focus: {
      daily: focus.daily,
      heatmap: focus.heatmap,
      trend: focus.trend,
      hourBuckets: focus.hourBuckets,
      activeRanges: focus.activeRanges,
      sessionStructure: focus.sessionStructure,
      currentGrowth
    },
    ...(tasks ? {
      tasks: {
        current: tasks.current,
        flow: tasks.flow,
        plan: tasks.plan,
        unattributedFocusSeconds: tasks.unattributedFocusSeconds
      }
    } : {})
  }

  return {
    rangeKey: serverRangeKey(bundle.query.range.preset),
    focusSeconds: Math.max(0, Math.floor(hero.focusSeconds)),
    plannedFocusSeconds: Math.max(0, Math.floor(tasks?.plan.plannedSeconds ?? 0)),
    completedFocusSessions: Math.max(0, Math.floor(hero.completedFocusSessions)),
    periodStartDate: bundle.query.range.from,
    periodEndDate: bundle.query.range.to,
    payload
  }
}

function createQuery(preset: Exclude<AnalyticsRangePreset, 'custom'>): LearningAnalyticsQuery {
  const localToday = todayKey(new Date())
  return buildLearningAnalyticsQuery({
    range: buildAnalyticsDateRange(preset, localToday),
    localToday,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
    personalClientId: readStudySnapshot().clientId,
    // Server-held aggregates must not be made authoritative for workspace or
    // teaching sources. The portable chart payload is derived from the
    // personal-study source only.
    teaching: { kind: 'none' },
    presenceSpaceCode: null
  })
}

/**
 * Mirror four browser-selectable ranges on an initial run and at a relaxed
 * cadence. A separate one-minute today upload keeps the peer leaderboard
 * fresh; the server preserves this detailed payload when that heartbeat body
 * intentionally omits `payload`.
 */
export function useAnalyticsVisualizationSync(
  createClient: (options: SyncApiClientOptions) => SyncApiClient = createSyncApiClient
): void {
  const syncState = useSyncState()
  const enabled = Boolean(syncState.accessToken) && syncState.analyticsSyncEnabled === true
  const runningRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const system = typeof window === 'undefined'
      ? undefined
      : window.teachingSystem as unknown as AnalyticsSystem | undefined
    if (!system?.getLearningAnalytics || system.platform === 'web') return
    const getLearningAnalytics = system.getLearningAnalytics

    const client = createClient({
      baseUrl: syncState.baseUrl,
      getAccessToken: getSyncAccessToken,
      getRefreshToken: () => getSyncState().refreshToken,
      onTokenRefreshed: (accessToken, refreshToken) =>
        setSyncAuth({ accessToken, refreshToken, user: getSyncState().user }),
      onTokenExpired: clearSyncAuth
    })
    let stopped = false

    const uploadAll = async () => {
      if (stopped || runningRef.current) return
      runningRef.current = true
      try {
        for (const preset of SYNCED_PRESETS) {
          if (stopped) return
          const query = createQuery(preset)
          const bundle = await getLearningAnalytics(createPersonalStudyAnalyticsRequest(query))
          const summary = buildAnalyticsVisualizationSummary(bundle)
          if (summary) await client.putAnalyticsSummary(summary)
        }
      } catch (error) {
        // A disabled server gate is shared with the existing settings state;
        // transient/auth failures follow the normal sync-client retry/session path.
        if (error instanceof SyncApiError && error.status === 403) stopped = true
      } finally {
        runningRef.current = false
      }
    }

    void uploadAll()
    const timer = window.setInterval(() => void uploadAll(), UPLOAD_INTERVAL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [createClient, enabled, syncState.accessToken, syncState.baseUrl])
}
