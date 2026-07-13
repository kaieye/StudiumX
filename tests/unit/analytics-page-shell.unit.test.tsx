import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  AnalyticsCoverage,
  AnalyticsDateRange,
  AnalyticsSectionResult,
  LearningAnalyticsBundle,
  LearningAnalyticsHero,
  LearningAnalyticsQuery
} from '@shared/teaching-types/analytics'
import { renderUi, screen, setupUser, waitFor, within } from '../helpers/render'
import { StudyAnalyticsPage } from '@renderer/views/workbench/analytics/StudyAnalyticsPage'
import {
  AnalyticsApiUnavailableError,
  type LearningAnalyticsClient
} from '@renderer/views/workbench/analytics/useStudyAnalytics'

function coverage(range: AnalyticsDateRange, complete = true): AnalyticsCoverage {
  return {
    rangeApplied: true,
    requestedRange: range,
    effectiveRange: range,
    trackingStartedOn: range.from,
    dataStartDate: range.from,
    dataEndDate: range.to,
    retention: {
      policy: 'rolling_local_days',
      days: 400,
      includesToday: true,
      cutoffDate: range.from
    },
    complete,
    sources: []
  }
}

function sectionResult<T>(
  range: AnalyticsDateRange,
  state: 'available' | 'empty' | 'partial' | 'unavailable' | 'error',
  data?: T
): AnalyticsSectionResult<T> {
  const base = {
    temporal: { kind: 'range' as const, range },
    coverage: coverage(range, state === 'available' || state === 'empty'),
    warnings: state === 'partial'
      ? [{ code: 'source_scan_incomplete' as const, severity: 'warning' as const, message: '部分来源尚未扫描完成。' }]
      : []
  }
  if (state === 'available') return { ...base, state, data: data as T }
  if (state === 'empty') return { ...base, state, data: data as T, reason: 'no_activity' }
  if (state === 'partial') return { ...base, state, data: data as T }
  if (state === 'unavailable') return { ...base, state, reason: 'history_not_recorded' }
  return {
    ...base,
    state,
    error: { code: 'fixture_error', message: '区块读取失败。', retryable: true }
  }
}

function heroData(): LearningAnalyticsHero {
  return {
    focusSeconds: 7_200,
    completedFocusSessions: 4,
    currentStreakDays: 5,
    currentXp: 260,
    currentLevel: {
      level: 3,
      xpAtLevelStart: 240,
      xpAtNextLevel: 360,
      currentXp: 260,
      progress: 1 / 6
    },
    totalTokens: 12_400,
    currentTaskCompletionRate: 0.5,
    insightLine: '保持当前节奏。'
  }
}

function bundleFor(query: LearningAnalyticsQuery): LearningAnalyticsBundle {
  const range = query.range
  return {
    contractVersion: 1,
    generatedAt: '2026-07-13T10:00:00.000Z',
    query,
    hero: sectionResult(range, 'available', heroData()),
    focus: sectionResult(range, 'partial', {} as LearningAnalyticsBundle['focus'] extends AnalyticsSectionResult<infer T> ? T : never),
    tasks: sectionResult(range, 'error'),
    tokens: sectionResult(range, 'empty', {} as LearningAnalyticsBundle['tokens'] extends AnalyticsSectionResult<infer T> ? T : never),
    workspaceAssets: sectionResult(range, 'unavailable'),
    review: sectionResult(range, 'unavailable'),
    memory: sectionResult(range, 'unavailable'),
    platform: sectionResult(range, 'unavailable'),
    presence: sectionResult(range, 'unavailable'),
    insights: sectionResult(range, 'unavailable')
  }
}

const identity = { personalClientId: 'client-test', presenceSpaceCode: 'SPACE-TEST' }

describe('StudyAnalyticsPage shell', () => {
  it('renders all five section states without converting missing data to zero', async () => {
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: async (query) => bundleFor(query)
    }
    renderUi(<StudyAnalyticsPage onBack={vi.fn()} client={client} identity={identity} />)

    await waitFor(() => expect(document.querySelector('#analytics-hero')).toHaveAttribute('data-section-state', 'available'))
    expect(document.querySelector('#analytics-focus')).toHaveAttribute('data-section-state', 'partial')
    expect(document.querySelector('#analytics-tokens')).toHaveAttribute('data-section-state', 'empty')
    expect(document.querySelector('#analytics-insights')).toHaveAttribute('data-section-state', 'unavailable')
    expect(document.querySelector('#analytics-tasks')).toHaveAttribute('data-section-state', 'error')

    expect(screen.getByLabelText(/专注时长：2 小时/)).toBeInTheDocument()
    expect(within(document.querySelector('#analytics-insights') as HTMLElement).getByText(/历史数据尚未记录/)).toBeInTheDocument()
    expect(screen.queryByText('0 Token')).not.toBeInTheDocument()
  })

  it('keeps the deep inventory collapsed by default and supports keyboard focus restoration', async () => {
    const user = setupUser()
    const onBack = vi.fn()
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: async (query) => bundleFor(query)
    }
    renderUi(<StudyAnalyticsPage onBack={onBack} client={client} identity={identity} />)
    await screen.findByText('学习分析')

    const deepDisclosure = screen.getByText('展开深度盘点').closest('details')
    expect(deepDisclosure).not.toHaveAttribute('open')

    const customButton = screen.getByRole('button', { name: '自定义' })
    await user.click(customButton)
    const fromInput = screen.getByLabelText('开始日期')
    expect(fromInput).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(customButton).toHaveFocus()

    const backButton = screen.getByRole('button', { name: '返回自习室' })
    await user.click(backButton)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('prevents applying a future custom date and exposes the inclusive max boundary', async () => {
    const user = setupUser()
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: async (query) => bundleFor(query)
    }
    renderUi(<StudyAnalyticsPage onBack={vi.fn()} client={client} identity={identity} />)

    await user.click(screen.getByRole('button', { name: '自定义' }))
    const fromInput = screen.getByLabelText('开始日期')
    const toInput = screen.getByLabelText('结束日期')
    expect(fromInput).toHaveAttribute('max')
    expect(toInput).toHaveAttribute('max', fromInput.getAttribute('max'))

    const max = toInput.getAttribute('max') as string
    const future = new Date(`${max}T12:00:00`)
    future.setDate(future.getDate() + 1)
    const futureKey = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`
    fireEvent.change(fromInput, { target: { value: max } })
    fireEvent.change(toInput, { target: { value: futureKey } })
    await user.click(screen.getByRole('button', { name: '应用范围' }))

    expect(screen.getByText('日期范围不能包含未来日期。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '自定义' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows an explicit unavailable state when WP-3 has not exposed an API', async () => {
    const client: LearningAnalyticsClient = {
      getLearningAnalytics: async () => {
        throw new AnalyticsApiUnavailableError()
      }
    }
    renderUi(<StudyAnalyticsPage onBack={vi.fn()} client={client} identity={identity} />)

    expect((await screen.findAllByText('分析服务尚未接入')).length).toBeGreaterThan(0)
    expect(document.querySelector('#analytics-hero')).toHaveAttribute('data-section-state', 'unavailable')
    expect(screen.queryByText(/模拟数据/)).toBeInTheDocument()
  })

  it('declares a single clipped page shell and container-query responsive safeguards', () => {
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
