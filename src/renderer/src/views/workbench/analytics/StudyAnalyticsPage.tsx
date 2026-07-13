import { ArrowLeft, Info, RefreshCw } from 'lucide-react'
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useMemo,
  useState
} from 'react'
import { useAppStore } from '../../../app-shell/appStore'
import { readStudySnapshot } from '../../../study-space/domain'
import { AnalyticsRangeFilter, AnalyticsTeachingScopeFilter } from './AnalyticsFilters'
import {
  AnalyticsSectionShell,
  type AnalyticsFallbackState
} from './AnalyticsSectionShell'
import { analyticsCopy } from './analyticsCopy'
import { analyticsFormatters } from './analyticsFormatters'
import {
  buildAnalyticsDateRange,
  buildLearningAnalyticsQuery,
  localDateKey,
  useStudyAnalytics,
  type LearningAnalyticsClient
} from './useStudyAnalytics'
import type {
  AnalyticsDataState,
  AnalyticsSectionDataMap,
  AnalyticsSectionId,
  AnalyticsSectionResult,
  AnalyticsSectionResultMap,
  LearningAnalyticsQuery,
  TeachingAnalyticsScope
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

const CORE_SECTION_IDS: readonly Exclude<AnalyticsSectionId, 'hero' | 'tasks' | 'workspace_assets' | 'review' | 'memory' | 'platform' | 'presence'>[] = [
  'focus',
  'tokens',
  'insights'
]

const DEEP_SECTION_IDS: readonly Exclude<AnalyticsSectionId, 'hero' | 'focus' | 'tokens' | 'insights'>[] = [
  'tasks',
  'workspace_assets',
  'review',
  'memory',
  'platform',
  'presence'
]

function useLocalToday(): string {
  const [today, setToday] = useState(() => localDateKey(new Date()))

  useEffect(() => {
    const scheduleNextDay = () => {
      const now = new Date()
      const nextDay = new Date(now)
      nextDay.setHours(24, 0, 1, 0)
      return window.setTimeout(() => setToday(localDateKey(new Date())), Math.max(1_000, nextDay.getTime() - now.getTime()))
    }
    const timeout = scheduleNextDay()
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

function initialTeachingScope(
  activeWorkspace: { id: string; name: string } | null,
  workspaces: Array<{ id: string }>
): TeachingAnalyticsScope {
  if (activeWorkspace) {
    return {
      kind: 'workspace',
      workspaceId: activeWorkspace.id,
      workspaceName: activeWorkspace.name
    }
  }
  if (workspaces.length) {
    return { kind: 'all_workspaces', workspaceIds: workspaces.map((workspace) => workspace.id) }
  }
  return { kind: 'none' }
}

function bundleSectionResults(bundle: ReturnType<typeof useStudyAnalytics>['bundle']): AnalyticsSectionResultMap | null {
  if (!bundle) return null
  return {
    hero: bundle.hero,
    focus: bundle.focus,
    tasks: bundle.tasks,
    tokens: bundle.tokens,
    workspace_assets: bundle.workspaceAssets,
    review: bundle.review,
    memory: bundle.memory,
    platform: bundle.platform,
    presence: bundle.presence,
    insights: bundle.insights
  }
}

function fallbackStateFor(phase: ReturnType<typeof useStudyAnalytics>['phase']): AnalyticsFallbackState {
  if (phase === 'loading') return 'loading'
  if (phase === 'error') return 'error'
  return 'unavailable'
}

function MetricCard({
  label,
  value,
  temporalLabel,
  state
}: {
  label: string
  value: string
  temporalLabel: string
  state: AnalyticsDataState
}) {
  return (
    <div className="analytics-metric-card" data-state={state} aria-label={`${temporalLabel}，${label}：${value}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{temporalLabel}</small>
    </div>
  )
}

function HeroMetrics({ result }: { result: DataBearingSectionResult<'hero'> }) {
  const { data } = result
  return (
    <div className="analytics-metric-grid" data-analytics-slot="hero">
      <MetricCard
        label={analyticsCopy.metrics.focus}
        value={analyticsFormatters.duration(data.focusSeconds)}
        temporalLabel={analyticsCopy.metrics.selectedRange}
        state={result.state}
      />
      <MetricCard
        label={analyticsCopy.metrics.sessions}
        value={`${analyticsFormatters.integer(data.completedFocusSessions)} ${analyticsCopy.metrics.sessionsUnit}`}
        temporalLabel={analyticsCopy.metrics.selectedRange}
        state={result.state}
      />
      <MetricCard
        label={analyticsCopy.metrics.streak}
        value={`${analyticsFormatters.integer(data.currentStreakDays)} ${analyticsCopy.metrics.days}`}
        temporalLabel={analyticsCopy.metrics.current}
        state={result.state}
      />
      <MetricCard
        label={analyticsCopy.metrics.level}
        value={`${analyticsFormatters.integer(data.currentLevel.level)} ${analyticsCopy.metrics.levelUnit}`}
        temporalLabel={analyticsCopy.metrics.current}
        state={result.state}
      />
      <MetricCard
        label={analyticsCopy.metrics.tokens}
        value={analyticsFormatters.compactNumber(data.totalTokens)}
        temporalLabel={analyticsCopy.metrics.selectedRange}
        state={result.state}
      />
      <MetricCard
        label={analyticsCopy.metrics.tasks}
        value={analyticsFormatters.percent(data.currentTaskCompletionRate)}
        temporalLabel={analyticsCopy.metrics.current}
        state={result.state}
      />
    </div>
  )
}

function DefaultSectionSlot<K extends Exclude<AnalyticsSectionId, 'hero'>>({ sectionId }: { sectionId: K }) {
  return (
    <div className="analytics-module-slot" data-analytics-slot={sectionId}>
      <Info size={21} aria-hidden="true" />
      <p>{analyticsCopy.placeholders[sectionId]}</p>
    </div>
  )
}

function SectionSlot<K extends AnalyticsSectionId>({
  sectionId,
  result,
  query,
  isRefreshing,
  isStale,
  onRetry,
  slots
}: AnalyticsSectionSlotProps<K> & { slots?: StudyAnalyticsPageSlots }) {
  const Slot = slots?.[sectionId] as ComponentType<AnalyticsSectionSlotProps<K>> | undefined
  if (Slot) {
    return (
      <Slot
        sectionId={sectionId}
        result={result}
        query={query}
        isRefreshing={isRefreshing}
        isStale={isStale}
        onRetry={onRetry}
      />
    )
  }
  if (sectionId === 'hero') return <HeroMetrics result={result as DataBearingSectionResult<'hero'>} />
  return <DefaultSectionSlot sectionId={sectionId as Exclude<AnalyticsSectionId, 'hero'>} />
}

export function StudyAnalyticsPage({
  onBack,
  client,
  identity: identityOverride,
  slots
}: StudyAnalyticsPageProps) {
  const localToday = useLocalToday()
  const activeWorkspace = useAppStore((state) => state.appState.activeWorkspace)
  const workspaces = useAppStore((state) => state.appState.workspaces)
  const [identity] = useState<StudyAnalyticsIdentity>(() => identityOverride ?? defaultIdentity())
  const [range, setRange] = useState(() => buildAnalyticsDateRange('week', localToday))
  const [teachingScope, setTeachingScope] = useState<TeachingAnalyticsScope>(() =>
    initialTeachingScope(activeWorkspace, workspaces)
  )

  const workspaceIdsKey = workspaces.map((workspace) => workspace.id).join('\u001f')
  useEffect(() => {
    setTeachingScope((current) => {
      if (!workspaces.length) return current.kind === 'none' ? current : { kind: 'none' }
      if (current.kind === 'all_workspaces') {
        const workspaceIds = workspaces.map((workspace) => workspace.id)
        return workspaceIds.join('\u001f') === current.workspaceIds.join('\u001f')
          ? current
          : { kind: 'all_workspaces', workspaceIds }
      }
      if (activeWorkspace) {
        if (
          current.kind === 'workspace' &&
          current.workspaceId === activeWorkspace.id &&
          current.workspaceName === activeWorkspace.name
        ) {
          return current
        }
        return {
          kind: 'workspace',
          workspaceId: activeWorkspace.id,
          workspaceName: activeWorkspace.name
        }
      }
      return { kind: 'all_workspaces', workspaceIds: workspaces.map((workspace) => workspace.id) }
    })
  }, [activeWorkspace?.id, activeWorkspace?.name, workspaceIdsKey])

  useEffect(() => {
    setRange((current) => current.preset === 'custom'
      ? current
      : buildAnalyticsDateRange(current.preset, localToday))
  }, [localToday])

  const query = useMemo(() => buildLearningAnalyticsQuery({
    range,
    localToday,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
    personalClientId: identity.personalClientId,
    teaching: teachingScope,
    presenceSpaceCode: identity.presenceSpaceCode
  }), [identity.personalClientId, identity.presenceSpaceCode, localToday, range, teachingScope])

  const analytics = useStudyAnalytics({ query, client })
  const results = bundleSectionResults(analytics.bundle)
  const fallbackState = fallbackStateFor(analytics.phase)
  const fallbackMessage = analytics.issue?.kind === 'unavailable'
    ? analyticsCopy.page.unavailableSection
    : analytics.issue?.message
  const issueMessage = analytics.issue?.kind === 'unavailable'
    ? analyticsCopy.page.unavailableDetail
    : analytics.issue?.message
  const generatedAt = analytics.bundle
    ? analyticsFormatters.instant(analytics.bundle.generatedAt)
    : analyticsCopy.page.notGenerated
  const rangeSummary = analyticsFormatters.range(range)
  const liveMessage = analytics.isRefreshing
    ? analyticsCopy.page.refreshing
    : analytics.phase === 'ready'
      ? analyticsCopy.page.loaded
      : analytics.phase === 'unavailable'
        ? analyticsCopy.page.unavailable
        : analytics.phase === 'error'
          ? analyticsCopy.page.failed
          : analyticsCopy.states.loading

  const renderSection = <K extends AnalyticsSectionId>(sectionId: K): ReactNode => {
    const result = results?.[sectionId] as AnalyticsSectionResult<AnalyticsSectionDataMap[K]> | null ?? null
    const retry = () => analytics.retrySection(sectionId)
    return (
      <AnalyticsSectionShell
        key={sectionId}
        sectionId={sectionId}
        title={analyticsCopy.sections[sectionId]}
        description={sectionId === 'hero'
          ? analyticsCopy.sections.overviewDescription
          : analyticsCopy.placeholders[sectionId as Exclude<AnalyticsSectionId, 'hero'>]}
        result={result}
        fallbackState={fallbackState}
        fallbackMessage={fallbackMessage}
        isRefreshing={analytics.isRefreshing}
        isStale={analytics.isStale}
        renderEmptyData={sectionId === 'hero'}
        onRetry={retry}
      >
        {(dataResult) => (
          <SectionSlot
            sectionId={sectionId}
            result={dataResult as DataBearingSectionResult<K>}
            query={query}
            isRefreshing={analytics.isRefreshing}
            isStale={analytics.isStale}
            onRetry={retry}
            slots={slots}
          />
        )}
      </AnalyticsSectionShell>
    )
  }

  return (
    <div className="study-analytics-page">
      <a className="analytics-skip-link" href="#analytics-main">{analyticsCopy.page.skip}</a>
      <div className="study-analytics-scroll">
        <header className="analytics-page-header">
          <div className="analytics-title-row">
            <button type="button" className="analytics-back-button" onClick={onBack} aria-label={analyticsCopy.page.back}>
              <ArrowLeft size={19} aria-hidden="true" />
              <span>{analyticsCopy.page.back}</span>
            </button>
            <div className="analytics-page-title">
              <p>{analyticsCopy.page.eyebrow}</p>
              <h1>{analyticsCopy.page.title}</h1>
            </div>
            <button
              type="button"
              className="analytics-refresh-button"
              onClick={analytics.refresh}
              disabled={analytics.isRefreshing}
              aria-label={analyticsCopy.page.refresh}
            >
              <RefreshCw size={18} aria-hidden="true" />
              <span>{analyticsCopy.page.refresh}</span>
            </button>
          </div>

          <div className="analytics-page-intro">
            <p>{analyticsCopy.page.description}</p>
            <p>{analyticsCopy.page.dataNote}</p>
            <dl>
              <div>
                <dt>{analyticsCopy.ranges.summaryPrefix}</dt>
                <dd>{rangeSummary}</dd>
              </div>
              <div>
                <dt>{analyticsCopy.page.updated}</dt>
                <dd>{generatedAt}</dd>
              </div>
            </dl>
          </div>

          <div className="analytics-filter-layout">
            <AnalyticsRangeFilter value={range} localToday={localToday} onChange={setRange} />
            <AnalyticsTeachingScopeFilter
              value={teachingScope}
              activeWorkspace={activeWorkspace ? { id: activeWorkspace.id, name: activeWorkspace.name } : null}
              workspaces={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))}
              presenceSpaceCode={identity.presenceSpaceCode}
              onChange={setTeachingScope}
            />
          </div>
        </header>

        <p className="analytics-live-status" aria-live="polite" aria-atomic="true">{liveMessage}</p>

        {analytics.phase === 'unavailable' && !analytics.bundle ? (
          <div className="analytics-global-banner" data-tone="info" role="status">
            <Info size={22} aria-hidden="true" />
            <div>
              <strong>{analyticsCopy.page.unavailable}</strong>
              <p>{analyticsCopy.page.unavailableDetail}</p>
            </div>
            <button type="button" className="analytics-secondary-button" onClick={analytics.refresh}>
              {analyticsCopy.page.retry}
            </button>
          </div>
        ) : null}

        {analytics.phase === 'error' && !analytics.bundle ? (
          <div className="analytics-global-banner" data-tone="error" role="alert">
            <Info size={22} aria-hidden="true" />
            <div>
              <strong>{analyticsCopy.page.failed}</strong>
              <p>{issueMessage}</p>
            </div>
            <button type="button" className="analytics-secondary-button" onClick={analytics.refresh}>
              {analyticsCopy.page.retry}
            </button>
          </div>
        ) : null}

        {analytics.bundle && analytics.issue ? (
          <div className="analytics-global-banner" data-tone="warning" role="status">
            <Info size={22} aria-hidden="true" />
            <div>
              <strong>{analyticsCopy.page.staleAfterFailure}</strong>
              <p>{issueMessage}</p>
            </div>
            <button type="button" className="analytics-secondary-button" onClick={analytics.refresh}>
              {analyticsCopy.page.retry}
            </button>
          </div>
        ) : analytics.isStale ? (
          <div className="analytics-global-banner" data-tone="info" role="status">
            <Info size={22} aria-hidden="true" />
            <p>{analyticsCopy.page.stale}</p>
          </div>
        ) : null}

        <main id="analytics-main" className="analytics-main" tabIndex={-1}>
          <section className="analytics-page-section" aria-labelledby="analytics-overview-heading">
            <div className="analytics-section-heading">
              <div>
                <h2 id="analytics-overview-heading">{analyticsCopy.sections.overview}</h2>
                <p>{analyticsCopy.sections.overviewDescription}</p>
              </div>
            </div>
            {renderSection('hero')}
          </section>

          <section className="analytics-page-section" aria-labelledby="analytics-core-heading">
            <div className="analytics-section-heading">
              <div>
                <h2 id="analytics-core-heading">{analyticsCopy.sections.core}</h2>
                <p>{analyticsCopy.sections.coreDescription}</p>
              </div>
            </div>
            <div className="analytics-core-grid">
              {CORE_SECTION_IDS.map((sectionId) => renderSection(sectionId))}
            </div>
          </section>

          <section className="analytics-page-section analytics-deep-section" aria-labelledby="analytics-deep-heading">
            <div className="analytics-section-heading">
              <div>
                <h2 id="analytics-deep-heading">{analyticsCopy.sections.deep}</h2>
                <p>{analyticsCopy.sections.deepDescription}</p>
              </div>
            </div>
            <details className="analytics-deep-disclosure">
              <summary>
                <span className="analytics-deep-open-label">{analyticsCopy.sections.deepOpen}</span>
                <span className="analytics-deep-close-label">{analyticsCopy.sections.deepClose}</span>
              </summary>
              <div className="analytics-deep-grid">
                {DEEP_SECTION_IDS.map((sectionId) => renderSection(sectionId))}
              </div>
            </details>
          </section>
        </main>
      </div>
    </div>
  )
}
