import type { CSSProperties, ReactNode } from 'react'
import type {
  AnalyticsEmptyReason,
  AnalyticsError,
  AnalyticsUnavailableReason,
  AnalyticsWarning,
  MemoryAnalytics as MemoryAnalyticsData
} from '../types'
import {
  BidiText,
  bidiIsolate,
  type AnalyticsIntlFormatters,
  type AnalyticsLabels,
  type AnalyticsPanelState
} from '../i18n'
import '../memory-skills-presence.css'

export type AnalyticsPanelCommonProps = {
  state: AnalyticsPanelState
  labels: AnalyticsLabels
  formatters: AnalyticsIntlFormatters
  warnings?: readonly AnalyticsWarning[]
  emptyReason?: AnalyticsEmptyReason
  unavailableReason?: AnalyticsUnavailableReason
  error?: AnalyticsError
  onRetry?: () => void
  retryable?: boolean
  className?: string
}

export type AnalyticsPanelFrameProps = AnalyticsPanelCommonProps & {
  panelId: string
  title: string
  description: string
  basisLabel: string
  emptyMessage: string
  unavailableMessage: string
  hasData: boolean
  children: ReactNode
}

function retryVisible(
  state: AnalyticsPanelState,
  onRetry: (() => void) | undefined,
  retryable: boolean | undefined,
  error: AnalyticsError | undefined
): boolean {
  if (!onRetry || retryable === false) return false
  if (state === 'error') return error?.retryable !== false
  return state === 'partial' || state === 'unavailable'
}

export function AnalyticsPanelFrame({
  panelId,
  title,
  description,
  basisLabel,
  state,
  labels,
  warnings = [],
  emptyReason,
  unavailableReason,
  error,
  onRetry,
  retryable,
  className = '',
  emptyMessage,
  unavailableMessage,
  hasData,
  children
}: AnalyticsPanelFrameProps) {
  const headingId = `${panelId}-heading`
  const showRetry = retryVisible(state, onRetry, retryable, error)
  const renderData = hasData && (state === 'available' || state === 'partial' || state === 'empty')
  const localizedWarnings = warnings.map((warning) => ({
    key: `${warning.code}:${warning.source ?? ''}`,
    message: labels.warningCodes[warning.code],
    source: warning.source
  }))

  return (
    <section
      id={panelId}
      className={`msp-analytics-panel ${className}`.trim()}
      data-state={state}
      aria-labelledby={headingId}
      aria-busy={state === 'loading'}
    >
      <header className="msp-analytics-panel__header">
        <div className="msp-analytics-panel__heading-copy">
          <p className="msp-analytics-panel__basis">{basisLabel}</p>
          <h2 id={headingId}>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="msp-analytics-panel__status-actions">
          <span className="msp-analytics-panel__state" data-state={state}>{labels.states[state]}</span>
          {showRetry ? (
            <button
              type="button"
              className="msp-analytics-panel__retry"
              onClick={onRetry}
              aria-label={`${labels.common.retry}: ${bidiIsolate(title)}`}
            >
              {labels.common.retry}
            </button>
          ) : null}
        </div>
      </header>

      {state === 'loading' ? (
        <div className="msp-analytics-skeleton" role="status">
          <span className="sr-only">{labels.states.loading}</span>
          <i /><i /><i /><i />
        </div>
      ) : null}

      {state === 'partial' ? (
        <p className="msp-analytics-notice" data-tone="warning" role="status">
          {labels.states.partial}: {labels.states.partialDetail}
        </p>
      ) : null}

      {state === 'empty' ? (
        <p className="msp-analytics-notice" role="status">
          {emptyReason ? labels.states.emptyReasons[emptyReason] : emptyMessage}
        </p>
      ) : null}

      {state === 'unavailable' ? (
        <p className="msp-analytics-notice" role="status">
          {unavailableReason ? labels.states.unavailableReasons[unavailableReason] : unavailableMessage}
        </p>
      ) : null}

      {state === 'error' ? (
        <p className="msp-analytics-notice" data-tone="error" role="alert">
          {error?.message ? <BidiText>{error.message}</BidiText> : labels.states.genericError}
        </p>
      ) : null}

      {localizedWarnings.length > 0 && state !== 'loading' ? (
        <aside className="msp-analytics-warnings" aria-label={labels.common.warnings}>
          <h3>{labels.common.warnings}</h3>
          <ul>
            {localizedWarnings.map((warning, index) => (
              <li key={`${warning.key}:${index}`}>
                <span>{warning.message}</span>
                {warning.source ? <BidiText className="msp-analytics-source">{warning.source}</BidiText> : null}
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      {renderData ? children : null}
    </section>
  )
}

export type MemoryAnalyticsViewData = Omit<MemoryAnalyticsData, 'tombstoneCount'> & {
  /** Null means diagnostics were unavailable; it must render as unknown, never zero. */
  tombstoneCount: number | null
}

export type MemoryAnalyticsProps = AnalyticsPanelCommonProps & {
  data?: MemoryAnalyticsViewData | null
  asOfLabel?: string
}

function nullableNumber(value: number | null, formatters: AnalyticsIntlFormatters, unknown: string): string {
  return value === null ? unknown : formatters.number(value)
}

export function MemoryAnalytics({
  state,
  data = null,
  asOfLabel,
  labels,
  formatters,
  warnings,
  emptyReason,
  unavailableReason,
  error,
  onRetry,
  retryable,
  className
}: MemoryAnalyticsProps) {
  const totalForBars = data?.activeCount ?? 0

  return (
    <AnalyticsPanelFrame
      panelId="analytics-memory-inventory"
      title={labels.memory.title}
      description={labels.memory.description}
      basisLabel={asOfLabel ?? labels.common.currentInventory}
      state={state}
      labels={labels}
      formatters={formatters}
      warnings={warnings}
      emptyReason={emptyReason}
      unavailableReason={unavailableReason}
      error={error}
      onRetry={onRetry}
      retryable={retryable}
      className={`memory-analytics ${className ?? ''}`.trim()}
      emptyMessage={labels.memory.empty}
      unavailableMessage={labels.memory.unavailable}
      hasData={Boolean(data)}
    >
      {data ? (
        <div className="msp-analytics-content">
          <p className="msp-analytics-privacy-note">{labels.memory.privacyNotice}</p>

          <dl className="msp-analytics-metric-grid" aria-label={labels.common.currentInventory}>
            <div>
              <dt>{labels.memory.active}</dt>
              <dd>{formatters.number(data.activeCount)}</dd>
            </div>
            <div data-unknown={data.tombstoneCount === null}>
              <dt>{labels.memory.tombstones}</dt>
              <dd>{nullableNumber(data.tombstoneCount, formatters, labels.common.unknown)}</dd>
            </div>
          </dl>

          <div className="msp-analytics-split-grid">
            <section className="msp-analytics-subsection" aria-labelledby="memory-scope-heading">
              <h3 id="memory-scope-heading">{labels.memory.scopeDistribution}</h3>
              <div className="msp-analytics-table-wrap">
                <table>
                  <caption className="sr-only">{labels.memory.scopeDistribution}</caption>
                  <thead><tr><th scope="col">{labels.memory.scope}</th><th scope="col">{labels.common.count}</th></tr></thead>
                  <tbody>
                    {data.byScope.map((item) => {
                      const share = totalForBars > 0 ? item.count / totalForBars : 0
                      return (
                        <tr key={item.scope}>
                          <th scope="row">{labels.memory.scopes[item.scope]}</th>
                          <td>
                            <span>{formatters.number(item.count)}</span>
                            <span className="msp-analytics-bar" aria-hidden="true">
                              <i style={{ '--msp-share': share } as CSSProperties} />
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="msp-analytics-subsection" aria-labelledby="memory-confidence-heading">
              <h3 id="memory-confidence-heading">{labels.memory.confidenceDistribution}</h3>
              <div className="msp-analytics-table-wrap">
                <table>
                  <caption className="sr-only">{labels.memory.confidenceDistribution}</caption>
                  <thead><tr><th scope="col">{labels.memory.confidenceRange}</th><th scope="col">{labels.common.count}</th></tr></thead>
                  <tbody>
                    {data.confidenceBuckets.map((bucket) => {
                      const share = totalForBars > 0 ? bucket.count / totalForBars : 0
                      const range = `${formatters.percent(bucket.fromInclusive)}–${formatters.percent(bucket.toInclusive)}`
                      return (
                        <tr key={`${bucket.fromInclusive}:${bucket.toInclusive}`}>
                          <th scope="row">{range}</th>
                          <td>
                            <span>{formatters.number(bucket.count)}</span>
                            <span className="msp-analytics-bar" aria-hidden="true">
                              <i style={{ '--msp-share': share } as CSSProperties} />
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="msp-analytics-subsection" aria-labelledby="memory-tags-heading">
            <h3 id="memory-tags-heading">{labels.memory.topTags}</h3>
            {data.topTags.length > 0 ? (
              <ul className="msp-analytics-tags">
                {data.topTags.map((item) => (
                  <li key={item.tag}>
                    <BidiText>{item.tag}</BidiText>
                    <span>{formatters.number(item.count)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="msp-analytics-muted">{labels.memory.noTags}</p>}
          </section>

          <section className="msp-analytics-subsection" aria-labelledby="memory-recent-heading">
            <div className="msp-analytics-subsection__heading">
              <h3 id="memory-recent-heading">{labels.memory.recent}</h3>
              <p>{labels.memory.recentDescription}</p>
            </div>
            {data.recentlyUpdated.length > 0 ? (
              <div className="msp-analytics-table-wrap">
                <table>
                  <caption className="sr-only">{labels.memory.recent}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{labels.memory.scope}</th>
                      <th scope="col">{labels.memory.tags}</th>
                      <th scope="col">{labels.memory.confidence}</th>
                      <th scope="col">{labels.memory.updatedAt}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentlyUpdated.map((item) => (
                      <tr key={item.id}>
                        <td>{labels.memory.scopes[item.scope]}</td>
                        <td>{item.tags.length ? item.tags.map((tag, index) => <BidiText key={`${tag}:${index}`} className="msp-inline-bidi">{tag}</BidiText>) : labels.common.none}</td>
                        <td>{formatters.percent(item.confidence)}</td>
                        <td>{formatters.instant(item.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="msp-analytics-muted">{labels.memory.noRecent}</p>}
          </section>
        </div>
      ) : null}
    </AnalyticsPanelFrame>
  )
}
