import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { StudyAnalyticsPage } from '@renderer/views/workbench/analytics/StudyAnalyticsPage'
import { getAnalyticsCopy } from '@renderer/views/workbench/analytics/analyticsCopy'
import {
  shouldShowSectionRetry,
  type AnalyticsFallbackState
} from '@renderer/views/workbench/analytics/components/AnalyticsSection'
import type {
  AnalyticsCoverage,
  AnalyticsSectionResult,
  FocusAnalytics,
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
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0))
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
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
      byDayByModel: [
        { date: query.range.to, model: 'demo-model-pro', totalTokens: 180, runs: 1 },
        { date: query.range.to, model: 'demo-model-fast', totalTokens: 70, runs: 1 },
        { date: addDays(query.range.to, -3), model: 'demo-model-pro', totalTokens: 700, runs: 1 },
        { date: addDays(query.range.to, -3), model: 'demo-model-fast', totalTokens: 300, runs: 1 }
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

function emptyFocusResult(
  query: LearningAnalyticsQuery
): Extract<AnalyticsSectionResult<FocusAnalytics>, { state: 'empty' }> {
  const localToday = query.calendarContext.localToday
  const heatmapFrom = addDays(localToday, -179)
  const singleDay = query.range.from === query.range.to
  return {
    state: 'empty',
    reason: 'no_activity',
    temporal: { kind: 'range', range: query.range },
    coverage: coverage(query),
    warnings: [],
    data: {
      daily: [],
      heatmap: Array.from({ length: 180 }, (_, index) => {
        const date = addDays(heatmapFrom, index)
        return {
          date,
          focusSeconds: 0,
          completedFocusSessions: 0,
          tasksCompleted: 0,
          isCovered: false
        }
      }),
      trend: [],
      hourBuckets: Array.from({ length: 24 }, () => 0) as FocusAnalytics['hourBuckets'],
      activeRanges: singleDay
        ? {
            mode: 'hour_of_day',
            categories: Array.from({ length: 24 }, (_, hour) => String(hour)),
            ranges: [],
            yMax: 60,
            yUnit: 'minute'
          }
        : {
            mode: 'day_of_range',
            categories: [query.range.from, query.range.to],
            ranges: [],
            yMax: 24,
            yUnit: 'hour'
          },
      sessionStructure: {
        focusSeconds: 0,
        breakSeconds: 0,
        completed: 0,
        interrupted: 0,
        canceled: 0,
        averageCompletedFocusSeconds: null,
        completionRate: null
      },
      currentGrowth: {
        xp: 0,
        level: { level: 1, xpAtLevelStart: 0, xpAtNextLevel: 120, currentXp: 0, progress: 0 },
        streakDays: 0,
        badges: [],
        plantStage: '种子'
      }
    }
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

function sectionBase(query: LearningAnalyticsQuery) {
  return {
    temporal: { kind: 'range' as const, range: query.range },
    coverage: coverage(query),
    warnings: [] as const
  }
}

function bundle(query: LearningAnalyticsQuery): LearningAnalyticsBundle {
  const unavailable = {
    ...sectionBase(query),
    state: 'unavailable' as const,
    reason: 'not_applicable' as const
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
  }
}

function designTokenHex(css: string, selector: string, variable: string): string {
  const selectorIndex = css.indexOf(selector)
  if (selectorIndex < 0) throw new Error(`Missing selector: ${selector}`)
  const blockStart = css.indexOf('{', selectorIndex)
  const blockEnd = css.indexOf('}', blockStart)
  const block = css.slice(blockStart, blockEnd)
  const hex = new RegExp(`--${variable}:\\s*(#[0-9a-f]{3,8})`, 'i').exec(block)
  if (hex?.[1]) {
    const value = hex[1]
    if (value.length === 4) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase()
    }
    return value.toLowerCase()
  }
  throw new Error(`Missing hex token --${variable} in ${selector}`)
}

function analyticsThemeVariable(css: string, selector: string, variable: string): string {
  const selectorIndex = css.indexOf(selector)
  if (selectorIndex < 0) throw new Error(`Missing selector: ${selector}`)
  const blockStart = css.indexOf('{', selectorIndex)
  const blockEnd = css.indexOf('}', blockStart)
  const block = css.slice(blockStart, blockEnd)
  const hex = new RegExp(`--${variable}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)
  if (hex?.[1]) return hex[1].toLowerCase()
  const rgb = new RegExp(`--${variable}:\\s*rgb\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)`, 'i').exec(block)
  if (rgb) {
    const channels = rgb.slice(1, 4).map((value) => Number(value).toString(16).padStart(2, '0'))
    return `#${channels.join('')}`
  }
  throw new Error(`Missing solid color --${variable} in ${selector}`)
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const normalized = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex
    const channels = normalized.match(/[0-9a-f]{2}/gi)?.map((value) => Number.parseInt(value, 16))
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

describe('section retry semantics', () => {
  const base = {
    temporal: { kind: 'range' as const, range: {
      preset: 'week' as const,
      from: '2026-07-13',
      to: '2026-07-13',
      fromInclusive: true,
      toInclusive: true,
      calendar: 'local_gregorian' as const,
      weekStartsOn: 1 as const
    } },
    coverage: {
      rangeApplied: true,
      requestedRange: {
        preset: 'week' as const,
        from: '2026-07-13',
        to: '2026-07-13',
        fromInclusive: true,
        toInclusive: true,
        calendar: 'local_gregorian' as const,
        weekStartsOn: 1 as const
      },
      effectiveRange: {
        preset: 'week' as const,
        from: '2026-07-13',
        to: '2026-07-13',
        fromInclusive: true,
        toInclusive: true,
        calendar: 'local_gregorian' as const,
        weekStartsOn: 1 as const
      },
      trackingStartedOn: '2026-07-13',
      dataStartDate: '2026-07-13',
      dataEndDate: '2026-07-13',
      retention: { policy: 'rolling_local_days' as const, days: 400, includesToday: true, cutoffDate: '2026-07-13' },
      complete: true,
      sources: []
    },
    warnings: []
  }

  it('uses typed error.retryable and keeps section unavailable distinct from API unavailable', () => {
    expect(shouldShowSectionRetry({
      ...base,
      state: 'error',
      error: { code: 'x', message: 'failed', retryable: true }
    }, 'loading')).toBe(true)
    expect(shouldShowSectionRetry({
      ...base,
      state: 'error',
      error: { code: 'x', message: 'failed', retryable: false }
    }, 'loading')).toBe(false)

    // Shared contract has reason only (no retryable) on section unavailable — keep Retry.
    expect(shouldShowSectionRetry({
      ...base,
      state: 'unavailable',
      reason: 'not_configured'
    }, 'loading')).toBe(true)

    // Page-level API unavailability must not be confused with section-level unavailable.
    expect(shouldShowSectionRetry(null, 'api-unavailable')).toBe(false)
    expect(shouldShowSectionRetry(null, 'request-error')).toBe(true)
    expect(shouldShowSectionRetry(null, 'loading' as AnalyticsFallbackState)).toBe(false)
  })
})

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

    // Token section: totals + model-stacked trend + workspace ranking (no efficiency card).
    const tokenHeading = screen.getByRole('heading', { name: 'Token 消耗' })
    expect(tokenHeading).toBeInTheDocument()
    const tokenSection = tokenHeading.closest('section')
    expect(tokenSection).not.toBeNull()
    expect(tokenSection?.querySelectorAll('.analytics-stat').length).toBeGreaterThanOrEqual(2)
    expect(tokenSection?.querySelectorAll('.analytics-subcard').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('1,250')).toBeInTheDocument()
    expect(screen.getByText('今日 Token 量')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Token 使用趋势' })).toBeInTheDocument()
    expect(screen.queryByText('模型调用')).not.toBeInTheDocument()
    expect(screen.queryByText('工具调用')).not.toBeInTheDocument()
    expect(screen.queryByText('工具调用排行')).not.toBeInTheDocument()
    expect(screen.queryByText('效率')).not.toBeInTheDocument()

    // The requested cards and standalone summary copy are removed.
    expect(screen.queryByText('汇总你的专注时段、任务节奏、模型消耗与知识沉淀。')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '记忆分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '平台分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '洞察' })).not.toBeInTheDocument()
    expect(document.querySelector('.token-consumption-card')).toBeNull()
    expect(document.querySelectorAll('.analytics-section-card')).toHaveLength(6)

    // Range presets are exposed and default to the last 7 days.
    expect(screen.getByRole('button', { name: '7天' })).toHaveAttribute('aria-pressed', 'true')

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
    await user.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true')
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

  it('keeps focus heatmap and active-range cards mounted for empty focus data', async () => {
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async (query) => ({
        ...bundle(query),
        focus: emptyFocusResult(query)
      }))
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={vi.fn()}
        client={client}
        identity={{ personalClientId: 'test-client' }}
      />
    )

    const focusSection = (await screen.findByRole('heading', { name: '专注分析' })).closest('section')
    await waitFor(() => expect(focusSection).toHaveAttribute('data-section-state', 'empty'))
    expect(focusSection).toHaveTextContent('专注日历热力图')
    expect(focusSection).toHaveTextContent('一天中的专注分布')
    // Blank skeleton still mounts the chart shells instead of only the empty message.
    expect(focusSection?.querySelector('.calendar-heatmap')).not.toBeNull()
    expect(focusSection?.querySelector('.active-range')).not.toBeNull()
    expect(focusSection?.querySelector('.analytics-focus__share')).not.toBeNull()
    expect(focusSection?.querySelector('.analytics-focus__hours')).not.toBeNull()
  })

  it('renders the focus percentile hub with tick-gauge when presence selfPercentile is available', async () => {
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async (query) => {
        const emptyFocus = emptyFocusResult(query)
        return {
          ...bundle(query),
          focus: {
            ...emptyFocus,
            state: 'available' as const
          },
          presence: {
            ...sectionBase(query),
            state: 'available' as const,
            data: {
              capturedAt: '2026-07-13T12:00:00.000Z',
              spaceCode: 'demo-space',
              online: 12,
              roomCapacityPercent: 0.5,
              peerFocusSecondsToday: 30_000,
              selfPercentile: 0.73,
              eventCounts: {}
            }
          }
        }
      })
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={vi.fn()}
        client={client}
        identity={{ personalClientId: 'test-client', presenceSpaceCode: 'demo-space' }}
      />
    )

    const focusSection = (await screen.findByRole('heading', { name: '专注分析' })).closest('section')
    await waitFor(() => expect(focusSection?.querySelector('.analytics-focus__percentile')).not.toBeNull())
    expect(focusSection?.querySelector('.tick-gauge')).not.toBeNull()
    expect(focusSection).toHaveTextContent('专注超越')
    expect(focusSection).toHaveTextContent('73%')
  })

  it('renders section-level unavailable with reason copy and retry, never as API unavailable', async () => {
    const copy = getAnalyticsCopy('zh')
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async (query) => ({
        ...bundle(query),
        focus: {
          ...sectionBase(query),
          state: 'unavailable',
          reason: 'not_configured'
        }
      }))
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={vi.fn()}
        client={client}
        identity={{ personalClientId: 'test-client' }}
      />
    )

    const focusSection = (await screen.findByRole('heading', { name: '专注分析' })).closest('section')
    expect(focusSection).toHaveAttribute('data-section-state', 'unavailable')
    expect(focusSection).toHaveTextContent(copy.states.unavailableReasons.not_configured)
    expect(focusSection).not.toHaveTextContent(copy.page.apiUnavailableDetail)
    expect(focusSection?.querySelector('button')).toHaveTextContent(copy.section.retry)
    expect(document.querySelectorAll('[data-section-state="api-unavailable"]')).toHaveLength(0)
  })

  it('honors section error.retryable when deciding whether Retry is shown', async () => {
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async (query) => ({
        ...bundle(query),
        tokens: {
          ...sectionBase(query),
          state: 'error',
          error: { code: 'tokens_failed', message: 'raw boom path C:\\\\secret', retryable: false }
        },
        tasks: {
          ...sectionBase(query),
          state: 'error',
          error: { code: 'tasks_failed', message: 'raw boom path C:\\\\secret', retryable: true }
        }
      }))
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={vi.fn()}
        client={client}
        identity={{ personalClientId: 'test-client' }}
      />
    )

    const tokens = (await screen.findByRole('heading', { name: 'Token 消耗' })).closest('section')
    const tasks = screen.getByRole('heading', { name: '任务分析' }).closest('section')
    expect(tokens).toHaveAttribute('data-section-state', 'error')
    expect(tasks).toHaveAttribute('data-section-state', 'error')
    expect(tokens?.querySelectorAll('button')).toHaveLength(0)
    expect(tasks?.querySelector('button')).toHaveTextContent('重试')
    // Section error UI must use sanitized copy, never the raw error message.
    expect(document.body).not.toHaveTextContent('raw boom path')
    expect(document.body).not.toHaveTextContent('C:\\secret')
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
      expect(document.querySelectorAll('[data-section-state="api-unavailable"]')).toHaveLength(6)
    })
    expect(screen.getAllByText('当前应用未提供学习分析 API。请更新应用或联系管理员。')).toHaveLength(6)
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
      expect(document.querySelectorAll('[data-section-state="request-error"]')).toHaveLength(6)
    })
    expect(document.querySelectorAll('.analytics-section-message[role="alert"]')).toHaveLength(6)
    expect(screen.getAllByText('分析服务暂时无法响应。请稍后重试。')).toHaveLength(6)
    expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(6)
    expect(document.body).not.toHaveTextContent('socket exploded')
  })

  it('renders a partial ready bundle as a page-level request failure instead of null sections', async () => {
    const secret = 'PARTIAL_BUNDLE_SECRET_SHOULD_NOT_RENDER'
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: vi.fn(async (query) => ({
        contractVersion: 1,
        generatedAt: '2026-07-13T12:00:00.000Z',
        query,
        hero: heroResult(query),
        secret
      }) as unknown as LearningAnalyticsBundle)
    }

    renderUi(
      <StudyAnalyticsPage
        onBack={vi.fn()}
        client={client}
        identity={{ personalClientId: 'test-client' }}
      />
    )

    await waitFor(() => {
      expect(document.querySelectorAll('[data-section-state="request-error"]')).toHaveLength(6)
    })
    expect(screen.getAllByText('分析服务暂时无法响应。请稍后重试。')).toHaveLength(6)
    expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(6)
    expect(document.body).not.toHaveTextContent(secret)
    expect(document.querySelectorAll('[data-section-state="api-unavailable"]')).toHaveLength(0)
  })

  it('defines WCAG-safe text, focus, and control colors against real page/surface and card tokens', () => {
    const tokensCss = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/styles/tokens.css'),
      'utf8'
    )
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/views/workbench/analytics/analytics-page.css'),
      'utf8'
    )

    // Bind to the actual design-system surface tokens rather than approximate page paints.
    const lightSurface = designTokenHex(tokensCss, ':root {', 'surface-solid')
    const darkSurface = designTokenHex(tokensCss, ':root[data-resolved-theme="dark"] {', 'surface-solid')
    expect(lightSurface).toBe('#ffffff')
    expect(darkSurface).toBe('#18181b')

    // Page shell uses var(--surface-solid); light analytics card is an explicit solid paint.
    const lightCard = analyticsThemeVariable(css, '.study-analytics-page {', 'analytics-card')
    expect(lightCard).toBe('#fbfbfb')

    const themes = [
      {
        name: 'light-page-surface',
        selector: '.study-analytics-page {',
        backgrounds: [lightSurface]
      },
      {
        name: 'light-card',
        selector: '.study-analytics-page {',
        backgrounds: [lightCard]
      },
      {
        name: 'dark-page-surface',
        selector: ":root[data-resolved-theme='dark'] .study-analytics-page {",
        backgrounds: [darkSurface]
      }
    ] as const

    for (const theme of themes) {
      for (const background of theme.backgrounds) {
        expect(
          contrastRatio(analyticsThemeVariable(css, theme.selector, 'analytics-text-muted'), background)
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(analyticsThemeVariable(css, theme.selector, 'analytics-text-soft'), background)
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(analyticsThemeVariable(css, theme.selector, 'analytics-focus-ring'), background)
        ).toBeGreaterThanOrEqual(3)
        expect(
          contrastRatio(analyticsThemeVariable(css, theme.selector, 'analytics-control-border'), background)
        ).toBeGreaterThanOrEqual(3)
      }
    }

    expect(css).not.toMatch(/color:\s*var\(--text-(?:muted|soft)\)/)
  })

  it('places a sample toggle left of refresh and fills charts with demo data', async () => {
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

    const demoButton = screen.getByRole('button', { name: '示例' })
    const refreshButton = screen.getByRole('button', { name: '刷新' })
    expect(demoButton.compareDocumentPosition(refreshButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(demoButton)

    expect(screen.getByRole('button', { name: '退出示例' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('正在展示示例数据（多日伪造学习记录）')).toBeInTheDocument()
    expect(refreshButton).toBeDisabled()

    // Demo mode densifies sections that were unavailable from the real client fixture.
    const focusSection = screen.getByRole('heading', { name: '专注分析' }).closest('section')
    expect(focusSection).toHaveAttribute('data-section-state', 'available')
    expect(screen.getByRole('img', { name: '专注日历热力图' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '一天中的专注分布' })).toBeInTheDocument()

    // Real API traffic pauses while demo mode is active.
    const callsBefore = (client.getLearningAnalytics as ReturnType<typeof vi.fn>).mock.calls.length
    await user.click(screen.getByRole('button', { name: '全部' }))
    expect((client.getLearningAnalytics as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)

    await user.click(screen.getByRole('button', { name: '退出示例' }))
    expect(screen.getByRole('button', { name: '示例' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('retains the clipped page shell and container-query safeguards', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/views/workbench/analytics/analytics-page.css'),
      'utf8'
    )
    const entryCss = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/views/workbench/workbench-analytics-entry.css'),
      'utf8'
    )
    expect(css).toContain('.office-workbench-page.workbench-analytics-route')
    expect(css).toMatch(/\.workbench-analytics-route\s*\{[^}]*overflow:\s*hidden/s)
    expect(css).toMatch(/\.workbench-analytics-route\s*\{[^}]*height:\s*100%/s)
    expect(css).toMatch(/\.study-analytics-page\s*\{[^}]*flex:\s*1 1 auto/s)
    expect(css).toMatch(/\.study-analytics-scroll\s*\{[^}]*overflow-x:\s*clip[^}]*overflow-y:\s*auto/s)
    expect(css).toContain('container-type: inline-size')
    expect(css).toContain('@container study-analytics (max-width: 980px)')
    expect(css).toContain('@container study-analytics (max-width: 820px)')
    expect(css).toContain('minmax(0, 1fr)')
    expect(css).toContain('.analytics-focus:not(:has(.analytics-focus__plan))')
    expect(css).toContain('--heatmap-cell: 11px')
    expect(css).toMatch(/\.analytics-focus__plan\s*\{[^}]*grid-row:\s*1 \/ 3/s)
    expect(css).toContain('.analytics-focus__plan-header')
    expect(css).toContain('.analytics-focus__plan-legend')
    expect(css).toContain('.dumbbell-chart--stacked')
    expect(css).toMatch(/\.analytics-focus\s*\{[^}]*align-items:\s*stretch/s)
    expect(css).toContain('--analytics-focus-hub')
    expect(css).toContain('--analytics-focus-side')
    expect(css).toContain('.analytics-focus__share')
    expect(css).toContain('.analytics-focus__share-header')
    expect(css).toContain('.analytics-focus__share-footer')
    expect(css).toMatch(/\.analytics-focus:has\(\.analytics-focus__percentile\)\s*\{[^}]*grid-template-areas:/s)
    expect(css).toMatch(/\.analytics-focus:has\(\.analytics-focus__percentile\)\s*\{[^}]*justify-content:\s*center/s)
    expect(css).toMatch(/grid-template-areas:[^;]*"heat heat plan"[^;]*"share hub plan"[^;]*"share hours hours"/s)
    expect(css).toMatch(/\.analytics-focus:has\(\.analytics-focus__percentile\) \.analytics-focus__share\s*\{[^}]*grid-area:\s*share/s)
    expect(css).toMatch(/\.analytics-focus:has\(\.analytics-focus__percentile\) \.analytics-focus__hours\s*\{[^}]*grid-area:\s*hours/s)
    expect(css).toMatch(/\.analytics-focus__share\s*\{[^}]*min-height:/s)
    expect(css).toContain('.analytics-focus__percentile')
    expect(css).toContain('.tick-gauge')
    expect(css).toMatch(/\.analytics-focus__percentile\s*\{[^}]*grid-area:\s*hub/s)
    expect(css).toMatch(/\.calendar-heatmap__grid\s*\{[^}]*grid-auto-columns:\s*var\(--heatmap-cell\)/s)
    expect(css).toMatch(/\.calendar-heatmap__cell\s*\{[^}]*width:\s*var\(--heatmap-cell\)/s)
    expect(css).not.toContain('content-visibility: auto')
    expect(entryCss).toMatch(/\.workbench-analytics-route\s*\{[^}]*overflow:\s*hidden/s)
    expect(entryCss).toMatch(/\.workbench-analytics-route\s*\{[^}]*height:\s*100%/s)
  })
})


