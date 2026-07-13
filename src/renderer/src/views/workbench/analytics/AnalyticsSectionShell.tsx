import { AlertCircle, CircleHelp, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnalyticsDataState,
  AnalyticsSectionId,
  AnalyticsSectionResult
} from './types'
import { getAnalyticsCopy } from './analyticsCopy'

export type AnalyticsFallbackState = 'loading' | 'unavailable' | 'error'

export type AnalyticsSectionShellProps<T> = {
  sectionId: AnalyticsSectionId
  title: string
  description: string
  result: AnalyticsSectionResult<T> | null
  fallbackState: AnalyticsFallbackState
  fallbackMessage?: string
  isRefreshing?: boolean
  isStale?: boolean
  renderEmptyData?: boolean
  onRetry: () => void
  children?: (result: Extract<AnalyticsSectionResult<T>, { state: 'available' | 'empty' | 'partial' }>) => ReactNode
}

function AnalyticsCoverageDetails<T>({ result }: { result: AnalyticsSectionResult<T> }) {
  const { i18n } = useTranslation()
  const copy = getAnalyticsCopy(i18n.language)
  const { coverage, warnings } = result
  return (
    <details className="analytics-coverage-details">
      <summary>{copy.coverage.summary}</summary>
      <dl>
        <div>
          <dt>{copy.coverage.requested}</dt>
          <dd>{coverage.requestedRange.from} — {coverage.requestedRange.to}</dd>
        </div>
        <div>
          <dt>{copy.coverage.effective}</dt>
          <dd>{coverage.effectiveRange ? `${coverage.effectiveRange.from} — ${coverage.effectiveRange.to}` : copy.coverage.noDate}</dd>
        </div>
        <div>
          <dt>{copy.coverage.tracking}</dt>
          <dd>{coverage.trackingStartedOn ?? copy.coverage.noDate}</dd>
        </div>
        <div>
          <dt>{copy.coverage.dataStart}</dt>
          <dd>{coverage.dataStartDate ?? copy.coverage.noDate}</dd>
        </div>
        <div>
          <dt>{copy.coverage.dataEnd}</dt>
          <dd>{coverage.dataEndDate ?? copy.coverage.noDate}</dd>
        </div>
        <div>
          <dt>{copy.coverage.complete}</dt>
          <dd>{coverage.complete ? copy.coverage.complete : copy.coverage.incomplete}</dd>
        </div>
      </dl>
      {warnings.length ? (
        <div className="analytics-warning-list">
          <strong>{copy.coverage.warningTitle}</strong>
          <ul>
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} data-severity={warning.severity}>
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  )
}

function AnalyticsSectionLoading({ sectionId }: { sectionId: AnalyticsSectionId }) {
  const itemCount = sectionId === 'hero' ? 6 : 3
  return (
    <div
      className="analytics-section-skeleton"
      data-layout={sectionId === 'hero' ? 'hero' : 'section'}
      aria-hidden="true"
    >
      {Array.from({ length: itemCount }, (_, index) => <span key={index} />)}
    </div>
  )
}

export function AnalyticsSectionShell<T>({
  sectionId,
  title,
  description,
  result,
  fallbackState,
  fallbackMessage,
  isRefreshing = false,
  isStale = false,
  renderEmptyData = false,
  onRetry,
  children
}: AnalyticsSectionShellProps<T>) {
  const { i18n } = useTranslation()
  const copy = getAnalyticsCopy(i18n.language)
  const state = result?.state ?? fallbackState
  const headingId = `analytics-${sectionId.replace('_', '-')}-title`
  const retryVisible = state === 'error' || state === 'partial' || state === 'unavailable'

  return (
    <article
      id={`analytics-${sectionId.replace('_', '-')}`}
      className="analytics-section-card"
      data-section-state={state}
      aria-labelledby={headingId}
      aria-busy={isRefreshing || fallbackState === 'loading'}
    >
      <div className="analytics-section-card-header">
        <div>
          <h3 id={headingId}>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="analytics-section-card-actions">
          <span className="analytics-state-chip" data-state={state}>
            {copy.states[state]}
          </span>
          {retryVisible ? (
            <button
              type="button"
              className="analytics-icon-button"
              onClick={onRetry}
              aria-label={`${copy.states.sectionRetry}：${title}`}
              title={copy.states.sectionRetry}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {isStale ? <p className="analytics-inline-notice">{copy.page.stale}</p> : null}

      {!result && fallbackState === 'loading' ? <AnalyticsSectionLoading sectionId={sectionId} /> : null}
      {!result && fallbackState === 'unavailable' ? (
        <div className="analytics-section-message">
          <CircleHelp size={22} aria-hidden="true" />
          <p>{fallbackMessage ?? copy.page.unavailableDetail}</p>
        </div>
      ) : null}
      {!result && fallbackState === 'error' ? (
        <div className="analytics-section-message" role="alert">
          <AlertCircle size={22} aria-hidden="true" />
          <p>{fallbackMessage ?? copy.page.failed}</p>
          <button type="button" className="analytics-secondary-button" onClick={onRetry}>
            {copy.page.retry}
          </button>
        </div>
      ) : null}

      {result?.state === 'empty' ? (
        <div className="analytics-section-message">
          <CircleHelp size={22} aria-hidden="true" />
          <p>{copy.states.emptyReasons[result.reason]}</p>
        </div>
      ) : null}
      {result?.state === 'unavailable' ? (
        <div className="analytics-section-message">
          <CircleHelp size={22} aria-hidden="true" />
          <p>{copy.states.unavailableReasons[result.reason]}</p>
        </div>
      ) : null}
      {result?.state === 'error' ? (
        <div className="analytics-section-message" role="alert">
          <AlertCircle size={22} aria-hidden="true" />
          <p>{result.error.message}</p>
          {result.error.retryable ? (
            <button type="button" className="analytics-secondary-button" onClick={onRetry}>
              {copy.page.retry}
            </button>
          ) : null}
        </div>
      ) : null}
      {result && (result.state === 'available' || result.state === 'partial' || (renderEmptyData && result.state === 'empty')) && children
        ? children(result)
        : null}
      {result ? <AnalyticsCoverageDetails result={result} /> : null}
    </article>
  )
}
