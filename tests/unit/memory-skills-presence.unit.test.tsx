import { describe, expect, it, vi } from 'vitest'
import { renderUi, screen, within } from '../helpers/render'
import { MemoryAnalytics, type MemoryAnalyticsViewData } from '../../src/renderer/src/views/workbench/analytics/components/MemoryAnalytics'
import { SkillsAnalytics, type SkillsAnalyticsViewData } from '../../src/renderer/src/views/workbench/analytics/components/SkillsAnalytics'
import { PresenceAnalytics } from '../../src/renderer/src/views/workbench/analytics/components/PresenceAnalytics'
import { InsightsPanel } from '../../src/renderer/src/views/workbench/analytics/components/InsightsPanel'
import { createAnalyticsI18n } from '../../src/renderer/src/views/workbench/analytics/i18n'
import type {
  AnalyticsCoverage,
  AnalyticsInsight,
  AnalyticsWarning,
  PresenceSnapshotAnalytics
} from '../../src/renderer/src/views/workbench/analytics/types'

const en = createAnalyticsI18n('en-US', { timeZone: 'UTC' })
const zh = createAnalyticsI18n('zh-CN', { timeZone: 'UTC' })

function memoryData(overrides: Partial<MemoryAnalyticsViewData> = {}): MemoryAnalyticsViewData {
  return {
    activeCount: 0,
    tombstoneCount: null,
    byScope: [
      { scope: 'user', count: 0 },
      { scope: 'workspace', count: 0 },
      { scope: 'project', count: 0 }
    ],
    topTags: [{ tag: 'تعلم 🧠 中文', count: 1 }],
    confidenceBuckets: [
      { fromInclusive: 0, toInclusive: 0.25, count: 0 },
      { fromInclusive: 0.25, toInclusive: 0.5, count: 0 },
      { fromInclusive: 0.5, toInclusive: 0.75, count: 0 },
      { fromInclusive: 0.75, toInclusive: 1, count: 0 }
    ],
    recentlyUpdated: [{
      id: 'opaque-memory-id',
      scope: 'user',
      tags: ['تعلم 🧠 中文'],
      confidence: 0.75,
      updatedAt: '2026-07-13T10:00:00.000Z'
    }],
    ...overrides
  }
}

function skillsData(overrides: Partial<SkillsAnalyticsViewData> = {}): SkillsAnalyticsViewData {
  const base: SkillsAnalyticsViewData = {
    skills: { installed: 3, byCategory: [{ category: 'Research 🧪', count: 3 }], usedInRange: null },
    pet: { appearanceId: 'owl-🦉', plantStage: 'seedling' },
    model: {
      providerLabel: 'Provider العربية',
      modelLabel: 'model-long-title-中文-🧠',
      lessonRunsInRange: null,
      failedLessonRunsInRange: null
    },
    workspaceChanges: { changesInRange: null, byDay: [] },
    connectors: [{ id: 'search-موصل', configured: true, usedInRange: null }]
  }
  return { ...base, ...overrides }
}

function presenceData(overrides: Partial<PresenceSnapshotAnalytics> = {}): PresenceSnapshotAnalytics {
  return {
    capturedAt: '2026-07-13T10:00:00.000Z',
    spaceCode: '上海-ROOM-🧭',
    online: 0,
    roomCapacityPercent: null,
    peerFocusSecondsToday: 0,
    selfPercentile: null,
    eventCounts: { checkin: 0 },
    ...overrides
  }
}

function coverage(): AnalyticsCoverage {
  return {
    rangeApplied: false,
    requestedRange: {
      preset: 'week',
      from: '2026-07-13',
      to: '2026-07-13',
      fromInclusive: true,
      toInclusive: true
    },
    effectiveRange: null,
    trackingStartedOn: null,
    dataStartDate: null,
    dataEndDate: null,
    retention: {
      policy: 'rolling_local_days',
      days: 400,
      includesToday: true,
      cutoffDate: '2025-06-09'
    },
    complete: false,
    sources: [{
      source: 'memory_store',
      state: 'partial',
      scanned: 2,
      included: 1,
      missing: 1,
      rejected: 0
    }]
  }
}

describe('memory, skills, Presence, and insights analytics UI', () => {
  it('keeps a legitimate zero distinct from unknown diagnostics and never renders memory body content', () => {
    const data = {
      ...memoryData(),
      content: 'DO NOT DISPLAY THIS MEMORY BODY',
      secretEndpoint: 'https://secret.invalid'
    } as MemoryAnalyticsViewData

    renderUi(
      <MemoryAnalytics
        state="available"
        data={data}
        labels={en.labels}
        formatters={en.formatters}
      />
    )

    const activeMetric = screen.getByText(en.labels.memory.active).closest('div')
    const tombstoneMetric = screen.getByText(en.labels.memory.tombstones).closest('div')
    expect(activeMetric).toHaveTextContent('0')
    expect(tombstoneMetric).toHaveTextContent(en.labels.common.unknown)
    expect(tombstoneMetric).not.toHaveTextContent('0')
    expect(screen.queryByText('DO NOT DISPLAY THIS MEMORY BODY')).not.toBeInTheDocument()
    expect(screen.queryByText('https://secret.invalid')).not.toBeInTheDocument()
    expect(screen.getAllByText('تعلم 🧠 中文')[0].closest('bdi')).toHaveAttribute('dir', 'auto')
    expect(screen.getByRole('table', { name: en.labels.memory.recent })).toBeInTheDocument()
  })

  it('supports localized loading/error states and an accessible retry seam', async () => {
    const onRetry = vi.fn()
    const { rerender } = renderUi(
      <MemoryAnalytics state="loading" labels={zh.labels} formatters={zh.formatters} />
    )
    expect(screen.getAllByText(zh.labels.states.loading).length).toBeGreaterThan(0)

    rerender(
      <MemoryAnalytics
        state="error"
        labels={zh.labels}
        formatters={zh.formatters}
        onRetry={onRetry}
        error={{ code: 'memory_diagnostics_failed', message: zh.labels.memory.unavailable, retryable: true }}
      />
    )
    screen.getByRole('button', { name: new RegExp(zh.labels.common.retry) }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('separates range usage from current Skills configuration and never guesses missing usage', () => {
    const initial = skillsData()
    const { rerender } = renderUi(
      <SkillsAnalytics
        state="partial"
        data={initial}
        rangeLabel="This week"
        labels={en.labels}
        formatters={en.formatters}
      />
    )

    const currentSection = screen.getByRole('heading', { name: en.labels.skills.currentConfiguration }).closest('section')
    const currentText = currentSection?.textContent
    expect(currentSection).toHaveTextContent('Provider العربية')
    expect(screen.getAllByText(en.labels.skills.rangeHistoryUnavailable).length).toBeGreaterThan(0)

    rerender(
      <SkillsAnalytics
        state="available"
        data={skillsData({
          skills: { ...initial.skills, usedInRange: 0 },
          workspaceChanges: { changesInRange: 4, byDay: [{ date: '2026-07-13', count: 4 }] }
        })}
        rangeLabel="This month"
        labels={en.labels}
        formatters={en.formatters}
      />
    )

    const currentAfter = screen.getByRole('heading', { name: en.labels.skills.currentConfiguration }).closest('section')
    const rangeAfter = screen.getByRole('heading', { name: en.labels.skills.rangeUsage }).closest('section')
    expect(currentAfter?.textContent).toBe(currentText)
    expect(rangeAfter).toHaveTextContent('This month')
    expect(screen.getByText(en.labels.skills.skillsUsed).closest('div')).toHaveTextContent('0')
    expect(currentAfter?.querySelectorAll('bdi').length).toBeGreaterThan(0)
  })

  it('renders only a current Presence snapshot, preserves zero, and marks absent event fields unknown', () => {
    renderUi(
      <PresenceAnalytics
        state="empty"
        data={presenceData()}
        labels={zh.labels}
        formatters={zh.formatters}
      />
    )

    expect(screen.getByText(zh.labels.presence.snapshotOnly)).toBeInTheDocument()
    expect(screen.getByText(zh.labels.presence.noHistory)).toBeInTheDocument()
    expect(screen.getByText(zh.labels.presence.online).closest('div')).toHaveTextContent('0')
    const cheerRow = screen.getByText(zh.labels.presence.eventTypes.cheer).closest('tr')
    expect(cheerRow).toHaveTextContent(zh.labels.common.unknown)
    expect(screen.queryByText(/average|平均/i)).not.toBeInTheDocument()
    expect(screen.getByText('上海-ROOM-🧭').closest('bdi')).toHaveAttribute('dir', 'auto')
  })

  it('does not fabricate Presence history when the live source is unavailable', () => {
    renderUi(
      <PresenceAnalytics
        state="unavailable"
        unavailableReason="source_missing"
        labels={en.labels}
        formatters={en.formatters}
      />
    )

    expect(screen.getByText(en.labels.states.unavailableReasons.source_missing)).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows only verified data-backed insights with partial warnings and source coverage', () => {
    const items: AnalyticsInsight[] = [
      {
        id: 'verified-observation',
        kind: 'observation',
        text: 'Token usage is recorded for this range.',
        explanation: 'Deduplicated conversation facts support this observation.',
        evidenceSectionIds: ['tokens']
      },
      {
        id: 'unsupported-action',
        kind: 'action',
        text: 'You should change your study plan.',
        explanation: 'No structured action or verified fact supports this.',
        evidenceSectionIds: ['tokens']
      },
      {
        id: 'unavailable-evidence',
        kind: 'observation',
        text: 'Presence was historically quiet.',
        explanation: 'This would require unavailable Presence history.',
        evidenceSectionIds: ['presence']
      }
    ]
    const warnings: AnalyticsWarning[] = [{
      code: 'source_scan_incomplete',
      severity: 'warning',
      message: 'raw backend message',
      source: 'memory_store'
    }]

    renderUi(
      <InsightsPanel
        state="partial"
        data={{ items }}
        evidenceStates={{ tokens: 'available', presence: 'unavailable' }}
        coverage={coverage()}
        warnings={warnings}
        labels={en.labels}
        formatters={en.formatters}
      />
    )

    expect(screen.getByText('Token usage is recorded for this range.')).toBeInTheDocument()
    expect(screen.queryByText('You should change your study plan.')).not.toBeInTheDocument()
    expect(screen.queryByText('Presence was historically quiet.')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(en.labels.states.partialDetail)
    expect(screen.getByText(en.labels.warningCodes.source_scan_incomplete)).toBeInTheDocument()
    const coverageTable = screen.getByRole('table', { name: en.labels.insights.sourceCoverageCaption })
    expect(within(coverageTable).getByText('memory_store').closest('bdi')).toHaveAttribute('dir', 'auto')
    expect(within(coverageTable).getByText(en.labels.states.partial)).toBeInTheDocument()
    expect(screen.getByText(en.labels.common.incomplete)).toBeInTheDocument()
  })
})
