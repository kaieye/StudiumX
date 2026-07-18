import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { StudyAnalyticsPage } from '@renderer/views/workbench/analytics/StudyAnalyticsPage'
import type {
  AnalyticsCoverage,
  AnalyticsSectionResult,
  LearningAnalyticsBundle,
  LearningAnalyticsHero,
  LearningAnalyticsQuery,
  TokenAnalytics
} from '@renderer/views/workbench/analytics/types'
import {
  AnalyticsApiUnavailableError,
  type LearningAnalyticsClient
} from '@renderer/views/workbench/analytics/useStudyAnalytics'
import { renderUi, screen, setupUser, waitFor } from '../helpers/render'

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

function tokenResult(
  query: LearningAnalyticsQuery
): Extract<AnalyticsSectionResult<TokenAnalytics>, { state: 'available' }> {
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

function emptyTokenResult(
  query: LearningAnalyticsQuery
): Extract<AnalyticsSectionResult<TokenAnalytics>, { state: 'empty' }> {
  return {
    ...tokenResult(query),
    state: 'empty',
    reason: 'no_activity'
  }
}

function heroResult(query: LearningAnalyticsQuery): AnalyticsSectionResult<LearningAnalyticsHero> {
  return {
    state: 'available',
    temporal: { kind: 'range', range: query.range },
    coverage: coverage(query),
    warnings: [],
    data: {
      focusSeconds: 7_200,
      completedFocusSessions: 4,
      currentStreakDays: 3,
      currentXp: 480,
      currentLevel: { level: 5, xpAtLevelStart: 480, xpAtNextLevel: 120, currentXp: 480, progress: 0 },
      totalTokens: 1_250,
      currentTaskCompletionRate: 0.5,
      insightLine: 'steady focus'
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
    hero: heroResult(query),
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

function analyticsThemeVariable(css: string, selector: string, variable: string): string {
  const selectorIndex = css.indexOf(selector)
  if (selectorIndex < 0) throw new Error(`Missing selector: ${selector}`)
  const blockStart = css.indexOf('{', selectorIndex)
  const blockEnd = css.indexOf('}', blockStart)
  const block = css.slice(blockStart, blockEnd)
  const match = new RegExp(`--${variable}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)
  if (!match?.[1]) throw new Error(`Missing variable --${variable} in ${selector}`)
  return match[1]
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex.match(/[0-9a-f]{2}/gi)?.map((value) => Number.parseInt(value, 16))
    if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`)
    const [red, green, blue] = channels.map((value) => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

describe('StudyAnalyticsPage', () => {
  it('renders a multi-section dashboard from the analytics bundle', async () => {
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

    // Hero section renders its stat cards from the bundle.
    expect(await screen.findByRole('heading', { name: '概览' })).toBeInTheDocument()
    expect(screen.getByText('专注时长')).toBeInTheDocument()

    // Token section only keeps total, today, and the usage trend.
    const tokenHeading = screen.getByRole('heading', { name: 'Token 消耗' })
    expect(tokenHeading).toBeInTheDocument()
    const tokenSection = tokenHeading.closest('section')
    expect(tokenSection).not.toBeNull()
    expect(tokenSection?.querySelectorAll('.analytics-stat')).toHaveLength(2)
    expect(tokenSection?.querySelectorAll('.analytics-subcard')).toHaveLength(1)
    expect(screen.getByText('1,250')).toBeInTheDocument()
    expect(screen.getByText('今日 Token 量')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Token 使用趋势' })).toBeInTheDocument()
    expect(screen.queryByText('模型调用')).not.toBeInTheDocument()
    expect(screen.queryByText('工具调用')).not.toBeInTheDocument()
    expect(screen.queryByText('Token 效率')).not.toBeInTheDocument()

    // The requested cards and standalone summary copy are removed.
    expect(screen.queryByText('汇总你的专注时段、任务节奏、模型消耗与知识沉淀。')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '记忆分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '平台分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '洞察' })).not.toBeInTheDocument()
    expect(document.querySelector('.token-consumption-card')).toBeNull()
    expect(document.querySelectorAll('.analytics-section-card')).toHaveLength(5)

    // Range presets are exposed and default to "this week".
    expect(screen.getByRole('button', { name: '本周' })).toHaveAttribute('aria-pressed', 'true')

    await setupUser().click(screen.getByRole('button', { name: '返回自习室' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(client.getLearningAnalytics).toHaveBeenCalled()
  })

  it('switches the analytics range when a preset is selected', async () => {
    const user = setupUser()
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async (query) => bundle(query))
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={vi.fn()}
        client={client}
        identity={{ personalClientId: 'test-client' }}
      />
    )

    await screen.findByRole('heading', { name: '概览' })
    await user.click(screen.getByRole('button', { name: '近 90 天' }))
    expect(screen.getByRole('button', { name: '近 90 天' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders a successful empty section as recorded zero activity, not a missing API', async () => {
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async (query) => ({
        ...bundle(query),
        tokens: emptyTokenResult(query)
      }))
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={vi.fn()}
        client={client}
        identity={{ personalClientId: 'test-client' }}
      />
    )

    const tokenSection = screen.getByRole('heading', { name: 'Token 消耗' }).closest('section')
    await waitFor(() => expect(tokenSection).toHaveAttribute('data-section-state', 'empty'))
    expect(tokenSection).toHaveTextContent('当前范围内暂无学习记录。')
    expect(tokenSection).not.toHaveTextContent('未提供学习分析 API')
    expect(document.body).not.toHaveTextContent('尚未接入')
  })

  it('renders a missing API as a non-retryable unavailable state', async () => {
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async () => {
        throw new AnalyticsApiUnavailableError()
      })
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={vi.fn()}
        client={client}
        identity={{ personalClientId: 'test-client' }}
      />
    )

    await waitFor(() => {
      expect(document.querySelectorAll('[data-section-state="api-unavailable"]')).toHaveLength(5)
    })
    expect(screen.getAllByText('当前应用未提供学习分析 API。请更新应用或联系管理员。')).toHaveLength(5)
    expect(screen.queryAllByRole('button', { name: '重试' })).toHaveLength(0)
  })

  it('renders an API invocation failure as a retryable request error', async () => {
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async () => {
        throw new Error('socket exploded')
      })
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={vi.fn()}
        client={client}
        identity={{ personalClientId: 'test-client' }}
      />
    )

    await waitFor(() => {
      expect(document.querySelectorAll('[data-section-state="request-error"]')).toHaveLength(5)
    })
    expect(document.querySelectorAll('.analytics-section-message[role="alert"]')).toHaveLength(5)
    expect(screen.getAllByText('分析服务暂时无法响应。请稍后重试。')).toHaveLength(5)
    expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(5)
    expect(document.body).not.toHaveTextContent('socket exploded')
  })

  it('defines WCAG-safe text, focus, and control colors for light and dark themes', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/views/workbench/analytics/analytics-page.css'),
      'utf8'
    )
    const themes = [
      { selector: '.study-analytics-page {', background: '#fbfbfb' },
      { selector: ":root[data-resolved-theme='dark'] .study-analytics-page {", background: '#18181b' }
    ] as const

    for (const theme of themes) {
      expect(contrastRatio(analyticsThemeVariable(css, theme.selector, 'analytics-text-muted'), theme.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(analyticsThemeVariable(css, theme.selector, 'analytics-text-soft'), theme.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(analyticsThemeVariable(css, theme.selector, 'analytics-focus-ring'), theme.background)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(analyticsThemeVariable(css, theme.selector, 'analytics-control-border'), theme.background)).toBeGreaterThanOrEqual(3)
    }

    expect(css).not.toMatch(/color:\s*var\(--text-(?:muted|soft)\)/)
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
