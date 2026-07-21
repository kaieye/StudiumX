import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../../app-shell/appStore'
import { readStudySnapshot } from '../../../study-space/domain'
import { getAnalyticsCopy } from './analyticsCopy'
import { createAnalyticsFormatters, resolveAnalyticsLocale } from './chartFormatters'
import { AnalyticsSection, type AnalyticsFallbackState } from './components/AnalyticsSection'
import {
  FocusBody,
  HeroBody,
  ReviewBody,
  TaskBody,
  TokenBody
} from './components/SectionBodies'
import {
  buildAnalyticsDateRange,
  buildLearningAnalyticsQuery,
  localDateKey,
  useStudyAnalytics,
  type LearningAnalyticsClient
} from './useStudyAnalytics'
import type { AnalyticsRangePreset, LearningAnalyticsBundle } from './types'
import './analytics-page.css'

export type StudyAnalyticsIdentity = {
  personalClientId: string
  presenceSpaceCode?: string | null
}

export type StudyAnalyticsPageProps = {
  onBack: () => void
  client?: LearningAnalyticsClient
  identity?: StudyAnalyticsIdentity
}

const RANGE_PRESETS: readonly Exclude<AnalyticsRangePreset, 'custom'>[] = [
  'today',
  'week',
  'month',
  '90d',
  'all'
]

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

function fallbackStateFor(phase: ReturnType<typeof useStudyAnalytics>['phase']): AnalyticsFallbackState {
  if (phase === 'loading') return 'loading'
  if (phase === 'unavailable') return 'api-unavailable'
  return 'request-error'
}

function statusTone(
  phase: ReturnType<typeof useStudyAnalytics>['phase'],
  isRefreshing: boolean
): 'ok' | 'warn' | 'alert' | 'idle' {
  if (isRefreshing || phase === 'loading') return 'warn'
  if (phase === 'ready') return 'ok'
  if (phase === 'error' || phase === 'unavailable') return 'alert'
  return 'idle'
}

export function StudyAnalyticsPage({
  onBack,
  client,
  identity: identityOverride
}: StudyAnalyticsPageProps) {
  const { i18n } = useTranslation()
  const locale = resolveAnalyticsLocale(i18n.language)
  const copy = getAnalyticsCopy(i18n.language || 'zh-CN')
  const fmt = useMemo(() => createAnalyticsFormatters(locale), [locale])
  const localToday = useLocalToday()
  const workspaces = useAppStore((state) => state.appState.workspaces)
  const [identity] = useState<StudyAnalyticsIdentity>(() => identityOverride ?? defaultIdentity())
  const [preset, setPreset] = useState<Exclude<AnalyticsRangePreset, 'custom'>>('week')

  const workspaceIdsKey = workspaces.map((workspace) => workspace.id).join('\u001f')
  const query = useMemo(() => buildLearningAnalyticsQuery({
    range: buildAnalyticsDateRange(preset, localToday),
    localToday,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
    personalClientId: identity.personalClientId,
    teaching: workspaces.length
      ? { kind: 'all_workspaces', workspaceIds: workspaces.map((workspace) => workspace.id) }
      : { kind: 'none' },
    presenceSpaceCode: identity.presenceSpaceCode
  }), [identity.personalClientId, identity.presenceSpaceCode, localToday, preset, workspaceIdsKey])

  const analytics = useStudyAnalytics({ query, client })
  const bundle: LearningAnalyticsBundle | null = analytics.bundle
  const fallbackState = fallbackStateFor(analytics.phase)
  const fallbackMessage = analytics.phase === 'unavailable'
    ? copy.page.apiUnavailableDetail
    : analytics.phase === 'error'
      ? copy.page.requestFailedDetail
      : analytics.phase === 'ready'
        ? copy.section.error
        : undefined

  const liveMessage = analytics.isRefreshing
    ? copy.page.refreshing
    : analytics.phase === 'ready'
      ? analytics.issue?.kind === 'request_failed'
        ? copy.page.failed
        : copy.page.loaded
      : analytics.phase === 'error'
        ? copy.page.failed
        : analytics.phase === 'unavailable'
          ? copy.page.apiUnavailable
          : copy.states.loading

  const shared = {
    copy,
    fallbackState,
    fallbackMessage,
    isRefreshing: analytics.isRefreshing,
    isStale: analytics.isStale
  }
  const ctx = { copy, fmt, localToday }
  const ledTone = statusTone(analytics.phase, analytics.isRefreshing)

  return (
    <div className="study-analytics-page">
      <a className="analytics-skip-link" href="#analytics-main">{copy.page.skip}</a>
      <div className="study-analytics-scroll">
        <header className="analytics-page-header">
          <div className="analytics-title-row">
            <button type="button" className="analytics-back-button" onClick={onBack} aria-label={copy.page.back}>
              <ArrowLeft size={19} aria-hidden="true" />
              <span>{copy.page.back}</span>
            </button>
            <div className="analytics-page-title">
              <p>{copy.page.eyebrow}</p>
              <h1>{copy.page.title}</h1>
            </div>
            <button
              type="button"
              className="analytics-refresh-button"
              onClick={analytics.refresh}
              disabled={analytics.isRefreshing}
              aria-label={copy.page.refresh}
            >
              <RefreshCw size={18} aria-hidden="true" />
              <span>{copy.page.refresh}</span>
            </button>
          </div>

          <div className="analytics-instrument-strip" aria-hidden="true">
            <span className="analytics-instrument-meta">
              <span className="analytics-glyph-led" data-tone={ledTone} />
              System Status
            </span>
            <span className="analytics-instrument-meta">Channel · Study Analytics</span>
            <span className="analytics-instrument-meta">Range · {copy.ranges[preset]}</span>
            <span className="analytics-instrument-meta">Clock · {localToday}</span>
          </div>

          <div className="analytics-range-bar" role="group" aria-label={copy.page.rangeLabel}>
            {RANGE_PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                className="analytics-filter-button"
                aria-pressed={preset === value}
                onClick={() => setPreset(value)}
              >
                {copy.ranges[value]}
              </button>
            ))}
          </div>
        </header>

        <p className="analytics-live-status" aria-live="polite" aria-atomic="true">{liveMessage}</p>

        <div id="analytics-main" className="analytics-main" tabIndex={-1}>
          <AnalyticsSection
            {...shared}
            id="analytics-section-hero"
            title={copy.hero.title}
            result={bundle?.hero ?? null}
            renderEmpty
            wide
            onRetry={() => analytics.retrySection('hero')}
          >
            {(result) => <HeroBody {...ctx} data={result.data} />}
          </AnalyticsSection>

          <AnalyticsSection
            {...shared}
            id="analytics-section-focus"
            title={copy.focus.title}
            description={copy.focus.description}
            result={bundle?.focus ?? null}
            wide
            onRetry={() => analytics.retrySection('focus')}
          >
            {(result) => <FocusBody {...ctx} data={result.data} />}
          </AnalyticsSection>

          <AnalyticsSection
            {...shared}
            id="analytics-section-tokens"
            title={copy.tokens.title}
            description={copy.tokens.description}
            result={bundle?.tokens ?? null}
            wide
            onRetry={() => analytics.retrySection('tokens')}
          >
            {(result) => <TokenBody {...ctx} data={result.data} />}
          </AnalyticsSection>

          <div className="analytics-grid">
            <AnalyticsSection
              {...shared}
              id="analytics-section-tasks"
              title={copy.tasks.title}
              description={copy.tasks.description}
              result={bundle?.tasks ?? null}
              onRetry={() => analytics.retrySection('tasks')}
            >
              {(result) => <TaskBody {...ctx} data={result.data} />}
            </AnalyticsSection>

            <AnalyticsSection
              {...shared}
              id="analytics-section-review"
              title={copy.review.title}
              description={copy.review.description}
              result={bundle?.review ?? null}
              onRetry={() => analytics.retrySection('review')}
            >
              {(result) => <ReviewBody {...ctx} data={result.data} />}
            </AnalyticsSection>
          </div>
        </div>
      </div>
    </div>
  )
}
