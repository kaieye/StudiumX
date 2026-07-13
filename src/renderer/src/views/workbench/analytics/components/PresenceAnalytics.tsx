import type { PresenceSnapshotAnalytics } from '../types'
import { BidiText } from '../i18n'
import {
  AnalyticsPanelFrame,
  type AnalyticsPanelCommonProps
} from './MemoryAnalytics'
import '../memory-skills-presence.css'

export type PresenceAnalyticsProps = AnalyticsPanelCommonProps & {
  data?: PresenceSnapshotAnalytics | null
}

const EVENT_TYPES = ['checkin', 'focus_start', 'task_done', 'cheer'] as const

export function PresenceAnalytics({
  state,
  data = null,
  labels,
  formatters,
  warnings,
  emptyReason,
  unavailableReason,
  error,
  onRetry,
  retryable,
  className
}: PresenceAnalyticsProps) {
  return (
    <AnalyticsPanelFrame
      panelId="analytics-presence-snapshot"
      title={labels.presence.title}
      description={labels.presence.description}
      basisLabel={labels.common.currentSnapshot}
      state={state}
      labels={labels}
      formatters={formatters}
      warnings={warnings}
      emptyReason={emptyReason}
      unavailableReason={unavailableReason}
      error={error}
      onRetry={onRetry}
      retryable={retryable}
      className={`presence-analytics ${className ?? ''}`.trim()}
      emptyMessage={labels.presence.empty}
      unavailableMessage={labels.presence.unavailable}
      hasData={Boolean(data)}
    >
      {data ? (
        <div className="msp-analytics-content" data-temporal-basis="live-snapshot">
          <p className="msp-analytics-notice" data-tone="info">{labels.presence.snapshotOnly}</p>

          <dl className="msp-analytics-snapshot-meta">
            <div><dt>{labels.presence.capturedAt}</dt><dd>{formatters.instant(data.capturedAt)}</dd></div>
            <div><dt>{labels.presence.space}</dt><dd><BidiText>{data.spaceCode}</BidiText></dd></div>
          </dl>

          <dl className="msp-analytics-metric-grid" aria-label={labels.common.currentSnapshot}>
            <div><dt>{labels.presence.online}</dt><dd>{formatters.number(data.online)}</dd></div>
            <div data-unknown={data.roomCapacityPercent === null}>
              <dt>{labels.presence.capacity}</dt>
              <dd>{data.roomCapacityPercent === null ? labels.common.unknown : formatters.percent(data.roomCapacityPercent)}</dd>
            </div>
            <div><dt>{labels.presence.peerFocusToday}</dt><dd>{formatters.duration(data.peerFocusSecondsToday)}</dd></div>
            <div data-unknown={data.selfPercentile === null}>
              <dt>{labels.presence.selfPercentile}</dt>
              <dd>{data.selfPercentile === null ? labels.common.unknown : formatters.percent(data.selfPercentile)}</dd>
            </div>
          </dl>

          <section className="msp-analytics-subsection" aria-labelledby="presence-events-heading">
            <h3 id="presence-events-heading">{labels.presence.events}</h3>
            <div className="msp-analytics-table-wrap">
              <table>
                <caption className="sr-only">{labels.presence.events}</caption>
                <thead><tr><th scope="col">{labels.presence.event}</th><th scope="col">{labels.common.count}</th></tr></thead>
                <tbody>
                  {EVENT_TYPES.map((eventType) => {
                    const value = data.eventCounts[eventType]
                    return (
                      <tr key={eventType} data-unknown={value === undefined}>
                        <th scope="row">{labels.presence.eventTypes[eventType]}</th>
                        <td>{value === undefined ? labels.common.unknown : formatters.number(value)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="msp-analytics-muted">{labels.presence.noHistory}</p>
        </div>
      ) : null}
    </AnalyticsPanelFrame>
  )
}
