import { ArrowLeft } from 'lucide-react'
import { type ComponentType, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../../app-shell/appStore'
import { readStudySnapshot } from '../../../study-space/domain'
import { getAnalyticsCopy } from './analyticsCopy'
import { TokenConsumptionCard } from './components/TokenConsumptionCard'
import {
  buildAnalyticsDateRange,
  buildLearningAnalyticsQuery,
  localDateKey,
  useStudyAnalytics,
  type LearningAnalyticsClient
} from './useStudyAnalytics'
import type {
  AnalyticsSectionDataMap,
  AnalyticsSectionId,
  AnalyticsSectionResult,
  AnalyticsSectionResultMap,
  LearningAnalyticsQuery
} from './types'
import './analytics-page.css'

export type StudyAnalyticsIdentity = {
  personalClientId: string
  presenceSpaceCode?: string | null
}

type DataBearingSectionResult<K extends AnalyticsSectionId> = Extract<
  AnalyticsSectionResult<AnalyticsSectionDataMap[K]>,
  { state: 'available' | 'empty' | 'partial' }
>

export type AnalyticsSectionSlotProps<K extends AnalyticsSectionId> = {
  sectionId: K
  result: DataBearingSectionResult<K>
  query: LearningAnalyticsQuery
  isRefreshing: boolean
  isStale: boolean
  onRetry: () => void
  sectionResults?: AnalyticsSectionResultMap
}

export type StudyAnalyticsPageSlots = {
  [K in AnalyticsSectionId]?: ComponentType<AnalyticsSectionSlotProps<K>>
}

export type StudyAnalyticsPageProps = {
  onBack: () => void
  client?: LearningAnalyticsClient
  identity?: StudyAnalyticsIdentity
  slots?: StudyAnalyticsPageSlots
}

function useLocalToday(): string {
  const [today, setToday] = useState(() => localDateKey(new Date()))

  useEffect(() => {
    const now = new Date()
    const nextDay = new Date(now)
    nextDay.setHours(24, 0, 1, 0)
    const timeout = window.setTimeout(
      () => setToday(localDateKey(new Date())),
      Math.max(1_000, nextDay.getTime() - now.getTime())
    )
    return () => window.clearTimeout(timeout)
  }, [today])

  return today
}

function defaultIdentity(): StudyAnalyticsIdentity {
  const snapshot = readStudySnapshot()
  return {
    personalClientId: snapshot.clientId,
    presenceSpaceCode: snapshot.spaceCode || null
  }
}

export function StudyAnalyticsPage({
  onBack,
  client,
  identity: identityOverride
}: StudyAnalyticsPageProps) {
  const { i18n } = useTranslation()
  const copy = getAnalyticsCopy(i18n.language || 'zh-CN')
  const localToday = useLocalToday()
  const workspaces = useAppStore((state) => state.appState.workspaces)
  const [identity] = useState<StudyAnalyticsIdentity>(() => identityOverride ?? defaultIdentity())
  const workspaceIdsKey = workspaces.map((workspace) => workspace.id).join('\u001f')
  const query = useMemo(() => buildLearningAnalyticsQuery({
    range: buildAnalyticsDateRange('all', localToday),
    localToday,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
    personalClientId: identity.personalClientId,
    teaching: workspaces.length
      ? { kind: 'all_workspaces', workspaceIds: workspaces.map((workspace) => workspace.id) }
      : { kind: 'none' },
    presenceSpaceCode: identity.presenceSpaceCode
  }), [identity.personalClientId, identity.presenceSpaceCode, localToday, workspaceIdsKey])
  const analytics = useStudyAnalytics({ query, client })
  const fallbackState = analytics.phase === 'loading'
    ? 'loading'
    : analytics.phase === 'error'
      ? 'error'
      : 'unavailable'
  const liveMessage = analytics.isRefreshing
    ? copy.page.refreshing
    : analytics.phase === 'ready'
      ? copy.page.loaded
      : analytics.phase === 'error'
        ? copy.page.failed
        : analytics.phase === 'unavailable'
          ? copy.page.unavailable
          : copy.states.loading

  return (
    <div className="study-analytics-page">
      <div className="study-analytics-scroll">
        <header className="analytics-page-header analytics-page-header--compact">
          <div className="analytics-title-row analytics-title-row--compact">
            <button type="button" className="analytics-back-button" onClick={onBack} aria-label={copy.page.back}>
              <ArrowLeft size={19} aria-hidden="true" />
              <span>{copy.page.back}</span>
            </button>
            <div className="analytics-page-title">
              <p>{copy.page.eyebrow}</p>
              <h1>{copy.page.title}</h1>
            </div>
          </div>
        </header>

        <p className="analytics-live-status" aria-live="polite" aria-atomic="true">{liveMessage}</p>

        <div id="analytics-main" className="analytics-main analytics-main--token-only">
          <TokenConsumptionCard
            result={analytics.bundle?.tokens ?? null}
            localToday={localToday}
            isRefreshing={analytics.isRefreshing}
            isStale={analytics.isStale}
            fallbackState={fallbackState}
            fallbackMessage={analytics.issue?.message}
            onRetry={() => analytics.retrySection('tokens')}
          />
        </div>
      </div>
    </div>
  )
}
