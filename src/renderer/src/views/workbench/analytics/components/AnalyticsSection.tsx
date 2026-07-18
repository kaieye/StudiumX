import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { AnalyticsCopy } from '../analyticsCopy'
import type { AnalyticsSectionResult } from '../types'

/**
 * Page-level fallback when a section result is absent.
 * Distinct from section-level `unavailable` (a typed reason on a successful section envelope).
 * - api-unavailable: Learning Analytics API is not provided by the app (non-retryable)
 * - request-error: request/transport/contract failure (retryable)
 */
export type AnalyticsFallbackState = 'loading' | 'api-unavailable' | 'request-error'

type DataBearing<T> = Extract<AnalyticsSectionResult<T>, { state: 'available' | 'empty' | 'partial' }>

export type AnalyticsSectionProps<T> = {
  id: string
  title: string
  description?: string
  copy: AnalyticsCopy
  result: AnalyticsSectionResult<T> | null
  fallbackState: AnalyticsFallbackState
  fallbackMessage?: string
  isRefreshing: boolean
  isStale: boolean
  /** Render body even when the section is `empty` (used by the hero). */
  renderEmpty?: boolean
  onRetry: () => void
  children: (result: DataBearing<T>) => ReactNode
  /** Extra header controls (e.g. a range toggle). */
  headerActions?: ReactNode
  /** When true the section spans the full grid width. */
  wide?: boolean
}

function stateLabel(copy: AnalyticsCopy, state: string): string {
  if (state === 'partial') return copy.section.partial
  if (state === 'error' || state === 'request-error') return copy.section.error
  return ''
}

/**
 * Whether a section-level envelope should expose Retry.
 * Shared contract:
 * - `error` carries typed `error.retryable`
 * - `unavailable` has only `reason` (no retryable flag) — keep showing Retry
 * - `partial` has no retryable flag — keep showing Retry when the message surface is used
 * Page-level fallbacks:
 * - `request-error` is retryable
 * - `api-unavailable` is not (and is never confused with section-level unavailable)
 */
export function shouldShowSectionRetry(
  result: AnalyticsSectionResult<unknown> | null,
  fallbackState: AnalyticsFallbackState
): boolean {
  if (result) {
    if (result.state === 'error') return result.error.retryable
    if (result.state === 'unavailable' || result.state === 'partial') return true
    return false
  }
  return fallbackState === 'request-error'
}

/**
 * One dashboard section: a translucent card with a consistent header, state chip,
 * and graceful empty/unavailable/error/loading handling. The body is only rendered
 * once the section carries data, so charts never see undefined inputs.
 */
export function AnalyticsSection<T>({
  id,
  title,
  description,
  copy,
  result,
  fallbackState,
  fallbackMessage,
  isRefreshing,
  isStale,
  renderEmpty = false,
  onRetry,
  children,
  headerActions,
  wide = false
}: AnalyticsSectionProps<T>) {
  // Prefer the typed section envelope. Fallbacks are only for missing results and
  // use api-unavailable / request-error so they never collide with section-level `unavailable`.
  const state = result?.state ?? fallbackState
  const hasBody = result
    ? result.state === 'available' || result.state === 'partial' || (renderEmpty && result.state === 'empty')
    : false

  const message = (() => {
    if (result?.state === 'error') return copy.section.error
    if (result?.state === 'unavailable') return copy.states.unavailableReasons[result.reason]
    if (result?.state === 'empty') return copy.section.empty
    if (!result) {
      if (fallbackState === 'loading') return copy.section.loading
      if (fallbackState === 'request-error') return fallbackMessage ?? copy.page.requestFailedDetail
      return fallbackMessage ?? copy.page.apiUnavailableDetail
    }
    return copy.section.empty
  })()

  const isErrorState = state === 'error' || state === 'request-error'
  const showRetry = shouldShowSectionRetry(result, fallbackState)
  const chip = stateLabel(copy, state)

  return (
    <section
      id={id}
      className={`analytics-section-card${wide ? ' analytics-section-card--wide' : ''}`}
      data-section-state={state}
      data-stale={isStale}
      aria-busy={state === 'loading' || isRefreshing}
    >
      <header className="analytics-section-card-header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <div className="analytics-section-card-actions">
          {chip ? (
            <span className="analytics-state-chip" data-state={state}>{chip}</span>
          ) : null}
          {headerActions}
        </div>
      </header>

      {hasBody && result ? (
        children(result as DataBearing<T>)
      ) : (
        <div className="analytics-section-message" role={isErrorState ? 'alert' : 'status'}>
          {isErrorState || state === 'partial' ? <AlertTriangle size={20} aria-hidden="true" /> : null}
          <p>{message}</p>
          {showRetry ? (
            <button type="button" className="analytics-secondary-button" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>{copy.section.retry}</span>
            </button>
          ) : null}
        </div>
      )}
    </section>
  )
}
