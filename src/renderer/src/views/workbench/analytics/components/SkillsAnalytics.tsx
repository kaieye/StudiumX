import type { PlatformAnalytics } from '../types'
import {
  BidiText,
  type AnalyticsIntlFormatters
} from '../i18n'
import {
  AnalyticsPanelFrame,
  type AnalyticsPanelCommonProps
} from './MemoryAnalytics'
import '../memory-skills-presence.css'

export type SkillsAnalyticsViewData = {
  skills: {
    installed: number | null
    byCategory: PlatformAnalytics['skills']['byCategory']
    usedInRange: number | null
  }
  pet: {
    appearanceId: string | null
    plantStage: string | null
  }
  model: {
    providerLabel: string | null
    modelLabel: string | null
    lessonRunsInRange: number | null
    failedLessonRunsInRange: number | null
  }
  workspaceChanges: PlatformAnalytics['workspaceChanges']
  connectors: Array<{
    id: string
    configured: boolean | null
    usedInRange: number | null
  }>
}

export type SkillsAnalyticsProps = AnalyticsPanelCommonProps & {
  data?: SkillsAnalyticsViewData | null
  asOfLabel?: string
  rangeLabel: string
}

function nullableNumber(value: number | null, formatters: AnalyticsIntlFormatters, unknown: string): string {
  return value === null ? unknown : formatters.number(value)
}

function sourceLabel(value: string | null, unknown: string) {
  if (!value || value.trim().toLowerCase() === 'unknown') return unknown
  return <BidiText>{value}</BidiText>
}

export function SkillsAnalytics({
  state,
  data = null,
  asOfLabel,
  rangeLabel,
  labels,
  formatters,
  warnings,
  emptyReason,
  unavailableReason,
  error,
  onRetry,
  retryable,
  className
}: SkillsAnalyticsProps) {
  const rangeValues = data
    ? [
        data.skills.usedInRange,
        data.model.lessonRunsInRange,
        data.model.failedLessonRunsInRange,
        data.workspaceChanges.changesInRange,
        ...data.connectors.map((connector) => connector.usedInRange)
      ]
    : []
  const hasTimestampedRangeUsage = rangeValues.some((value) => value !== null)

  return (
    <AnalyticsPanelFrame
      panelId="analytics-skills-platform"
      title={labels.skills.title}
      description={labels.skills.description}
      basisLabel={labels.common.currentInventory}
      state={state}
      labels={labels}
      formatters={formatters}
      warnings={warnings}
      emptyReason={emptyReason}
      unavailableReason={unavailableReason}
      error={error}
      onRetry={onRetry}
      retryable={retryable}
      className={`skills-analytics ${className ?? ''}`.trim()}
      emptyMessage={labels.skills.empty}
      unavailableMessage={labels.skills.unavailable}
      hasData={Boolean(data)}
    >
      {data ? (
        <div className="msp-analytics-content msp-analytics-basis-columns">
          <section
            className="msp-analytics-basis-card"
            aria-labelledby="skills-current-heading"
            data-temporal-basis="current"
          >
            <div className="msp-analytics-subsection__heading">
              <p className="msp-analytics-panel__basis">{asOfLabel ?? labels.common.currentSnapshot}</p>
              <h3 id="skills-current-heading">{labels.skills.currentConfiguration}</h3>
            </div>

            <dl className="msp-analytics-metric-grid msp-analytics-metric-grid--compact" aria-label={labels.skills.currentConfiguration}>
              <div data-unknown={data.skills.installed === null}>
                <dt>{labels.skills.installed}</dt>
                <dd>{nullableNumber(data.skills.installed, formatters, labels.common.unknown)}</dd>
              </div>
              <div><dt>{labels.skills.provider}</dt><dd>{sourceLabel(data.model.providerLabel, labels.common.unknown)}</dd></div>
              <div><dt>{labels.skills.model}</dt><dd>{sourceLabel(data.model.modelLabel, labels.common.unknown)}</dd></div>
              <div><dt>{labels.skills.petAppearance}</dt><dd>{sourceLabel(data.pet.appearanceId, labels.common.unknown)}</dd></div>
              <div><dt>{labels.skills.plantStage}</dt><dd>{sourceLabel(data.pet.plantStage, labels.common.unknown)}</dd></div>
            </dl>

            <section className="msp-analytics-subsection" aria-labelledby="skills-category-heading">
              <h4 id="skills-category-heading">{labels.skills.categories}</h4>
              {data.skills.byCategory.length > 0 ? (
                <div className="msp-analytics-table-wrap">
                  <table>
                    <caption className="sr-only">{labels.skills.categories}</caption>
                    <thead><tr><th scope="col">{labels.skills.category}</th><th scope="col">{labels.common.count}</th></tr></thead>
                    <tbody>
                      {data.skills.byCategory.map((item) => (
                        <tr key={item.category}>
                          <th scope="row"><BidiText>{item.category}</BidiText></th>
                          <td>{formatters.number(item.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="msp-analytics-muted">{labels.skills.noCategories}</p>}
            </section>

            <section className="msp-analytics-subsection" aria-labelledby="skills-connectors-heading">
              <h4 id="skills-connectors-heading">{labels.skills.connectors}</h4>
              {data.connectors.length > 0 ? (
                <div className="msp-analytics-table-wrap">
                  <table>
                    <caption className="sr-only">{labels.skills.connectors}</caption>
                    <thead><tr><th scope="col">{labels.skills.connector}</th><th scope="col">{labels.common.status}</th></tr></thead>
                    <tbody>
                      {data.connectors.map((connector) => (
                        <tr key={connector.id}>
                          <th scope="row"><BidiText>{connector.id}</BidiText></th>
                          <td>
                            {connector.configured === null
                              ? labels.common.unknown
                              : connector.configured ? labels.skills.configured : labels.skills.notConfigured}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="msp-analytics-muted">{labels.skills.noConnectors}</p>}
            </section>
          </section>

          <section
            className="msp-analytics-basis-card"
            aria-labelledby="skills-range-heading"
            data-temporal-basis="range"
          >
            <div className="msp-analytics-subsection__heading">
              <p className="msp-analytics-panel__basis"><BidiText>{rangeLabel}</BidiText></p>
              <h3 id="skills-range-heading">{labels.skills.rangeUsage}</h3>
            </div>

            {!hasTimestampedRangeUsage ? (
              <p className="msp-analytics-notice" data-tone="info">{labels.skills.rangeHistoryUnavailable}</p>
            ) : null}

            <dl className="msp-analytics-metric-grid msp-analytics-metric-grid--compact" aria-label={labels.skills.rangeUsage}>
              <div data-unknown={data.skills.usedInRange === null}>
                <dt>{labels.skills.skillsUsed}</dt>
                <dd>{nullableNumber(data.skills.usedInRange, formatters, labels.skills.rangeHistoryUnavailable)}</dd>
              </div>
              <div data-unknown={data.model.lessonRunsInRange === null}>
                <dt>{labels.skills.lessonRuns}</dt>
                <dd>{nullableNumber(data.model.lessonRunsInRange, formatters, labels.skills.rangeHistoryUnavailable)}</dd>
              </div>
              <div data-unknown={data.model.failedLessonRunsInRange === null}>
                <dt>{labels.skills.failedLessonRuns}</dt>
                <dd>{nullableNumber(data.model.failedLessonRunsInRange, formatters, labels.skills.rangeHistoryUnavailable)}</dd>
              </div>
              <div data-unknown={data.workspaceChanges.changesInRange === null}>
                <dt>{labels.skills.workspaceChanges}</dt>
                <dd>{nullableNumber(data.workspaceChanges.changesInRange, formatters, labels.skills.rangeHistoryUnavailable)}</dd>
              </div>
            </dl>

            <section className="msp-analytics-subsection" aria-labelledby="skills-connector-usage-heading">
              <h4 id="skills-connector-usage-heading">{labels.skills.connectorUsage}</h4>
              {data.connectors.length > 0 ? (
                <div className="msp-analytics-table-wrap">
                  <table>
                    <caption className="sr-only">{labels.skills.connectorUsage}</caption>
                    <thead><tr><th scope="col">{labels.skills.connector}</th><th scope="col">{labels.common.count}</th></tr></thead>
                    <tbody>
                      {data.connectors.map((connector) => (
                        <tr key={connector.id}>
                          <th scope="row"><BidiText>{connector.id}</BidiText></th>
                          <td>{nullableNumber(connector.usedInRange, formatters, labels.skills.rangeHistoryUnavailable)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="msp-analytics-muted">{labels.skills.noConnectors}</p>}
            </section>

            <section className="msp-analytics-subsection" aria-labelledby="skills-change-history-heading">
              <h4 id="skills-change-history-heading">{labels.skills.workspaceChanges}</h4>
              {data.workspaceChanges.byDay.length > 0 ? (
                <div className="msp-analytics-table-wrap">
                  <table>
                    <caption className="sr-only">{labels.skills.workspaceChanges}</caption>
                    <thead><tr><th scope="col">{labels.skills.date}</th><th scope="col">{labels.common.count}</th></tr></thead>
                    <tbody>
                      {data.workspaceChanges.byDay.map((item) => (
                        <tr key={item.date}><th scope="row">{formatters.localDate(item.date)}</th><td>{formatters.number(item.count)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="msp-analytics-muted">{hasTimestampedRangeUsage ? labels.skills.noWorkspaceChanges : labels.skills.rangeHistoryUnavailable}</p>}
            </section>
          </section>
        </div>
      ) : null}
    </AnalyticsPanelFrame>
  )
}
