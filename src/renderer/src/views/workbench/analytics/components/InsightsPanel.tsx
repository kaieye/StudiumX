import type {
  AnalyticsCoverage,
  AnalyticsDataState,
  AnalyticsInsight,
  AnalyticsSectionId,
  InsightsAnalytics
} from '../types'
import { BidiText } from '../i18n'
import {
  AnalyticsPanelFrame,
  type AnalyticsPanelCommonProps
} from './MemoryAnalytics'
import '../memory-skills-presence.css'

export type InsightEvidenceStates = Partial<Record<AnalyticsSectionId, AnalyticsDataState>>

export type InsightsPanelProps = AnalyticsPanelCommonProps & {
  data?: InsightsAnalytics | null
  evidenceStates: InsightEvidenceStates
  coverage?: AnalyticsCoverage | null
  onNavigate?: (route: string) => void
}

function isVerifiableEvidenceState(state: AnalyticsDataState | undefined): boolean {
  return state === 'available' || state === 'partial' || state === 'empty'
}

function hasVerifiedEvidence(item: AnalyticsInsight, evidenceStates: InsightEvidenceStates): boolean {
  return item.evidenceSectionIds.length > 0 && item.evidenceSectionIds.every(
    (sectionId) => isVerifiableEvidenceState(evidenceStates[sectionId])
  )
}

function coverageStateLabel(
  state: AnalyticsCoverage['sources'][number]['state'],
  labels: InsightsPanelProps['labels']
): string {
  if (state === 'complete') return labels.common.complete
  return labels.states[state]
}

export function InsightsPanel({
  state,
  data = null,
  evidenceStates,
  coverage = null,
  onNavigate,
  labels,
  formatters,
  warnings,
  emptyReason,
  unavailableReason,
  error,
  onRetry,
  retryable,
  className
}: InsightsPanelProps) {
  const verifiedItems = (data?.items ?? []).filter((item) => {
    if (!item.text.trim() || !item.explanation.trim()) return false
    if (!hasVerifiedEvidence(item, evidenceStates)) return false
    if (item.kind === 'action' && !item.action) return false
    return true
  })

  return (
    <AnalyticsPanelFrame
      panelId="analytics-insights-panel"
      title={labels.insights.title}
      description={labels.insights.description}
      basisLabel={labels.insights.dataBacked}
      state={state}
      labels={labels}
      formatters={formatters}
      warnings={warnings}
      emptyReason={emptyReason}
      unavailableReason={unavailableReason}
      error={error}
      onRetry={onRetry}
      retryable={retryable}
      className={`insights-panel ${className ?? ''}`.trim()}
      emptyMessage={labels.insights.empty}
      unavailableMessage={labels.insights.unavailable}
      hasData={Boolean(data)}
    >
      <div className="msp-analytics-content">
        {verifiedItems.length > 0 ? (
          <ol className="msp-insight-list">
            {verifiedItems.map((item) => (
              <li key={item.id} data-kind={item.kind}>
                <article aria-labelledby={`insight-${item.id}-title`}>
                  <div className="msp-insight-list__header">
                    <span>{labels.insights[item.kind]}</span>
                    <span>{labels.insights.dataBacked}</span>
                  </div>
                  <h3 id={`insight-${item.id}-title`}><BidiText>{item.text}</BidiText></h3>
                  <p><BidiText>{item.explanation}</BidiText></p>
                  <dl className="msp-insight-evidence">
                    <div>
                      <dt>{labels.insights.evidence}</dt>
                      <dd>
                        {item.evidenceSectionIds.map((sectionId) => (
                          <span key={sectionId}>{labels.sections[sectionId]}</span>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt>{labels.insights.evidenceState}</dt>
                      <dd>
                        {item.evidenceSectionIds.map((sectionId) => (
                          <span key={sectionId}>{labels.states[evidenceStates[sectionId] ?? 'unavailable']}</span>
                        ))}
                      </dd>
                    </div>
                  </dl>
                  {item.kind === 'action' && item.action && onNavigate ? (
                    <button
                      type="button"
                      className="msp-analytics-action"
                      onClick={() => onNavigate(item.action!.route)}
                    >
                      <BidiText>{item.action.label}</BidiText>
                    </button>
                  ) : null}
                </article>
              </li>
            ))}
          </ol>
        ) : <p className="msp-analytics-muted">{labels.insights.noEvidenceBackedItems}</p>}

        {coverage ? (
          <section className="msp-analytics-subsection msp-insight-coverage" aria-labelledby="insight-coverage-heading">
            <div className="msp-analytics-subsection__heading">
              <h3 id="insight-coverage-heading">{labels.insights.coverageTitle}</h3>
              <p>{coverage.complete ? labels.common.complete : labels.common.incomplete}</p>
            </div>
            {coverage.sources.length > 0 ? (
              <div className="msp-analytics-table-wrap">
                <table>
                  <caption>{labels.insights.sourceCoverageCaption}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{labels.common.source}</th>
                      <th scope="col">{labels.common.status}</th>
                      <th scope="col">{labels.common.included}</th>
                      <th scope="col">{labels.common.missing}</th>
                      <th scope="col">{labels.common.rejected}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.sources.map((source, index) => (
                      <tr key={`${source.source}:${index}`}>
                        <th scope="row"><BidiText>{source.source}</BidiText></th>
                        <td>{coverageStateLabel(source.state, labels)}</td>
                        <td>{formatters.number(source.included)}</td>
                        <td>{formatters.number(source.missing)}</td>
                        <td>{formatters.number(source.rejected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </AnalyticsPanelFrame>
  )
}
