import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { StudyAnalyticsPage } from '@renderer/views/workbench/analytics/StudyAnalyticsPage'
import type {
  AnalyticsCoverage,
  AnalyticsSectionResult,
  LearningAnalyticsBundle,
  LearningAnalyticsQuery,
  TokenAnalytics
} from '@renderer/views/workbench/analytics/types'
import type { LearningAnalyticsClient } from '@renderer/views/workbench/analytics/useStudyAnalytics'
import { renderUi, screen, setupUser } from '../helpers/render'

function coverage(query: LearningAnalyticsQuery): AnalyticsCoverage {
  return {
    rangeApplied: true,
    requestedRange: query.range,
    effectiveRange: query.range,
    trackingStartedOn: query.range.from,
    dataStartDate: query.range.from,
    dataEndDate: query.range.to,
    retention: { policy: 'rolling_local_days', days: 400, includesToday: true, cutoffDate: query.range.from },
    complete: true,
    sources: []
  }
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function tokenResult(query: LearningAnalyticsQuery): AnalyticsSectionResult<TokenAnalytics> {
  return {
    state: 'available',
    temporal: { kind: 'range', range: query.range },
    coverage: coverage(query),
    warnings: [],
    data: {
      totals: {
        promptTokens: 1_000,
        completionTokens: 250,
        totalTokens: 1_250,
        providerCalls: 2,
        toolCalls: 1,
        toolErrors: 0,
        iterations: 2,
        childRuns: 0,
        durationMs: 12_000,
        budgetStops: 0
      },
      byDay: [
        { date: query.range.to, promptTokens: 200, completionTokens: 50, totalTokens: 250, runs: 1 },
        { date: addDays(query.range.to, -3), promptTokens: 800, completionTokens: 200, totalTokens: 1_000, runs: 1 }
      ],
      byConversation: [],
      byWorkspace: [],
      byTool: [],
      efficiency: {
        averageTokensPerUsageFact: 625,
        averageTokensPerConversation: null,
        averageTokensPerMessage: null,
        averageDurationMs: 6_000,
        toolErrorRate: 0
      },
      contextGovernance: {
        compactionEvents: 0,
        replacedTokens: 0,
        hygieneSavedTokens: 0,
        childRunShare: 0
      },
      sourceCoverage: {
        conversationsScanned: 1,
        conversationsReadable: 1,
        conversationsWithUsage: 1,
        conversationsPartiallyMissingUsage: 0,
        ledgerSnapshotsScanned: 0,
        ledgerFallbackConversations: 0,
        invalidLedgerRows: 0
      }
    }
  }
}

function bundle(query: LearningAnalyticsQuery): LearningAnalyticsBundle {
  const unavailable = {
    state: 'unavailable',
    temporal: { kind: 'range', range: query.range },
    coverage: coverage(query),
    warnings: [],
    reason: 'not_applicable'
  }
  return {
    contractVersion: 1,
    generatedAt: '2026-07-13T12:00:00.000Z',
    query,
    hero: unavailable,
    focus: unavailable,
    tasks: unavailable,
    tokens: tokenResult(query),
    workspaceAssets: unavailable,
    review: unavailable,
    memory: unavailable,
    platform: unavailable,
    presence: unavailable,
    insights: unavailable
  } as LearningAnalyticsBundle
}

describe('StudyAnalyticsPage', () => {
  it('calculates and displays token consumption from the analytics client', async () => {
    const user = setupUser()
    const onBack = vi.fn()
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async (query) => bundle(query))
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={onBack}
        client={client}
        identity={{ personalClientId: 'test-client' }}
      />
    )

    expect(screen.getByRole('heading', { name: '学习分析' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Token 消耗量' })).toBeInTheDocument()
    expect(screen.getByText('总 Token 量')).toBeInTheDocument()
    expect(screen.getByText('今日 Token 量')).toBeInTheDocument()
    expect(screen.getByText('1,250')).toBeInTheDocument()
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(document.querySelectorAll('.token-consumption-card')).toHaveLength(1)
    const compactContent = document.querySelector('.token-consumption-card__content')
    expect(compactContent?.children[0]).toHaveClass('token-consumption-card__metrics')
    expect(compactContent?.children[1]).toHaveClass('token-consumption-card__chart-panel')
    expect(document.querySelectorAll('.token-consumption-card__metric-row')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '近 7 天' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: 'Token 使用趋势，近 7 天' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '近 30 天' }))
    expect(screen.getByRole('button', { name: '近 30 天' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: 'Token 使用趋势，近 30 天' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回自习室' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(client.getLearningAnalytics).toHaveBeenCalled()
  })

  it('retains the clipped page shell and container-query safeguards', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/views/workbench/analytics/analytics-page.css'),
      'utf8'
    )
    expect(css).toContain('.office-workbench-page.workbench-analytics-route')
    expect(css).toMatch(/\.workbench-analytics-route\s*\{[^}]*overflow:\s*hidden/s)
    expect(css).toMatch(/\.study-analytics-scroll\s*\{[^}]*overflow-x:\s*clip[^}]*overflow-y:\s*auto/s)
    expect(css).toContain('container-type: inline-size')
    expect(css).toContain('@container study-analytics (max-width: 820px)')
    expect(css).toContain('minmax(0, 1fr)')
  })
})
