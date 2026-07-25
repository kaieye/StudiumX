import { ArrowLeft, FlaskConical, RefreshCw } from 'lucide-react'
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
  LevelBody,
  ReviewBody,
  TaskBody,
  TokenBody
} from './components/SectionBodies'
import { createDemoLearningAnalyticsBundle } from './demoLearningAnalyticsBundle'
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
  const [demoMode, setDemoMode] = useState(false)

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

  // Pause real API traffic while demo is open so the shell stays stable.
  const analytics = useStudyAnalytics({ query, client, enabled: !demoMode })
  const demoBundle = useMemo(
    () => (demoMode ? createDemoLearningAnalyticsBundle(query) : null),
    [demoMode, query]
  )
  const bundle: LearningAnalyticsBundle | null = demoMode ? demoBundle : analytics.bundle
  const phase = demoMode ? 'ready' as const : analytics.phase
  const fallbackState = fallbackStateFor(phase)
  const fallbackMessage = demoMode
    ? undefined
    : analytics.phase === 'unavailable'
      ? copy.page.apiUnavailableDetail
      : analytics.phase === 'error'
        ? copy.page.requestFailedDetail
        : analytics.phase === 'ready'
          ? copy.section.error
          : undefined

  const liveMessage = demoMode
    ? copy.page.demoLoaded
    : analytics.isRefreshing
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
    isRefreshing: demoMode ? false : analytics.isRefreshing,
    isStale: demoMode ? false : analytics.isStale
  }
  const ctx = { copy, fmt, localToday }

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
            <div className="analytics-header-actions">
              <button
                type="button"
                className="analytics-demo-button"
                onClick={() => setDemoMode((value) => !value)}
                aria-pressed={demoMode}
                aria-label={demoMode ? copy.page.demoExit : copy.page.demo}
              >
                <FlaskConical size={18} aria-hidden="true" />
                <span>{demoMode ? copy.page.demoExit : copy.page.demo}</span>
              </button>
              <button
                type="button"
                className="analytics-refresh-button"
                onClick={analytics.refresh}
                disabled={demoMode || analytics.isRefreshing}
                aria-label={copy.page.refresh}
              >
                <RefreshCw size={18} aria-hidden="true" />
                <span>{copy.page.refresh}</span>
              </button>
            </div>
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
          <div className="analytics-hero-row">
            <AnalyticsSection
              {...shared}
              id="analytics-section-hero"
              title={copy.hero.title}
              result={bundle?.hero ?? null}
              renderEmpty
              onRetry={() => analytics.retrySection('hero')}
            >
              {(result) => <HeroBody {...ctx} data={result.data} />}
            </AnalyticsSection>

            <AnalyticsSection
              {...shared}
              id="analytics-section-level"
              title={copy.hero.levelProgressTitle}
              result={bundle?.hero ?? null}
              renderEmpty
              onRetry={() => analytics.retrySection('hero')}
            >
              {(result) => <LevelBody {...ctx} data={result.data} />}
            </AnalyticsSection>
          </div>

          <AnalyticsSection
            {...shared}
            id="analytics-section-focus"
            title={copy.focus.title}
            result={bundle?.focus ?? null}
            renderEmpty
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
