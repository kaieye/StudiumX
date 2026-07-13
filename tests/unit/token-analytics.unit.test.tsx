import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TokenAnalytics, type TokenAnalyticsFormatters } from '@renderer/views/workbench/analytics/components/TokenAnalytics'
import type {
  AnalyticsCoverage,
  AnalyticsDateRange,
  AnalyticsSectionResult,
  LearningAnalyticsQuery,
  TokenAnalytics as TokenAnalyticsData
} from '@renderer/views/workbench/analytics/types'

const range: AnalyticsDateRange = {
  from: '2026-07-07',
  to: '2026-07-13',
  preset: 'week',
  fromInclusive: true,
  toInclusive: true,
  calendar: 'local_gregorian',
  weekStartsOn: 1
}

const query: LearningAnalyticsQuery = {
  range,
  scope: {
    personalFocus: { kind: 'personal', clientId: 'learner-1' },
    teaching: { kind: 'workspace', workspaceId: 'workspace-1', workspaceName: '离散数学' },
    presence: { kind: 'none' }
  },
  calendarContext: {
    localToday: '2026-07-13',
    timeZone: 'Asia/Shanghai',
    weekStartsOn: 1
  }
}

const coverage: AnalyticsCoverage = {
  rangeApplied: true,
  requestedRange: range,
  effectiveRange: range,
  trackingStartedOn: '2026-07-01',
  dataStartDate: '2026-07-07',
  dataEndDate: '2026-07-13',
  retention: {
    policy: 'rolling_local_days',
    days: 400,
    includesToday: true,
    cutoffDate: '2025-06-09'
  },
  complete: true,
  sources: [
    { source: 'agent_conversations', state: 'complete', scanned: 2, included: 2, missing: 0, rejected: 0 },
    { source: 'learning_work_ledger', state: 'complete', scanned: 1, included: 1, missing: 0, rejected: 0 }
  ]
}

function tokenData(overrides: Partial<TokenAnalyticsData> = {}): TokenAnalyticsData {
  return {
    totals: {
      promptTokens: 700,
      completionTokens: 300,
      totalTokens: 1000,
      providerCalls: 2,
      toolCalls: 3,
      toolErrors: 1,
      iterations: 2,
      childRuns: 0,
      durationMs: 120_000,
      budgetStops: 0
    },
    byDay: [
      { date: '2026-07-07', promptTokens: 500, completionTokens: 200, totalTokens: 700, runs: 1 },
      { date: '2026-07-13', promptTokens: 200, completionTokens: 100, totalTokens: 300, runs: 1 }
    ],
    byConversation: [
      {
        conversationKey: 'workspace-1:conversation-1',
        conversationId: 'conversation-1',
        title: '矩阵复习',
        workspaceId: 'workspace-1',
        workspaceName: '离散数学',
        source: 'conversation',
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        providerCalls: 1,
        toolCalls: 2,
        toolErrors: 0,
        messageCount: 4,
        durationMs: 60_000,
        updatedAt: '2026-07-13T09:00:00.000Z'
      },
      {
        conversationKey: 'workspace-1:conversation-2',
        conversationId: 'conversation-2',
        title: 'Ledger 对话',
        workspaceId: 'workspace-1',
        workspaceName: '离散数学',
        courseRelativePath: 'C:\\Users\\secret\\course\\conversations',
        source: 'ledger_fallback',
        totalTokens: 300,
        providerCalls: 1,
        toolCalls: 1,
        toolErrors: 1,
        messageCount: 1,
        durationMs: 60_000,
        updatedAt: '2026-07-12T09:00:00.000Z'
      }
    ],
    byWorkspace: [{ workspaceId: 'workspace-1', name: '离散数学', totalTokens: 1000, conversationCount: 2 }],
    byTool: [{ name: 'search_notes', calls: 3, errors: 1 }],
    efficiency: {
      averageTokensPerUsageFact: 500,
      averageTokensPerConversation: 500,
      averageTokensPerMessage: 200,
      averageDurationMs: 60_000,
      toolErrorRate: 1 / 3
    },
    contextGovernance: {
      compactionEvents: 1,
      replacedTokens: 150,
      hygieneSavedTokens: 80,
      childRunShare: 0
    },
    sourceCoverage: {
      conversationsScanned: 2,
      conversationsReadable: 2,
      conversationsWithUsage: 1,
      conversationsPartiallyMissingUsage: 0,
      ledgerSnapshotsScanned: 4,
      ledgerFallbackConversations: 1,
      invalidLedgerRows: 0
    },
    ...overrides
  }
}

function result(
  data: TokenAnalyticsData = tokenData(),
  state: 'available' | 'empty' | 'partial' = 'available',
  overrides: Partial<Extract<AnalyticsSectionResult<TokenAnalyticsData>, { state: 'available' | 'empty' | 'partial' }>> = {}
): AnalyticsSectionResult<TokenAnalyticsData> {
  const base = {
    state,
    data,
    temporal: { kind: 'range' as const, range },
    coverage,
    warnings: [],
    ...overrides
  }
  return state === 'empty' ? { ...base, state, reason: 'no_activity' } : base
}

const formatters: TokenAnalyticsFormatters = {
  number: (value) => `exact:${value}`,
  compactNumber: (value) => `compact:${value}`,
  localDate: (value) => `date:${value}`,
  duration: (value) => `duration:${value}`,
  percent: (value) => value === null ? 'percent:missing' : `percent:${value}`
}

function renderTokens(sectionResult: AnalyticsSectionResult<TokenAnalyticsData> = result()) {
  return render(<TokenAnalytics result={sectionResult} query={query} formatters={formatters} onRetry={vi.fn()} />)
}

function metricCard(label: string): HTMLElement {
  const labelNode = screen.getByText(label)
  const card = labelNode.closest('.token-analytics-total')
  if (!card) throw new Error(`Metric card not found: ${label}`)
  return card as HTMLElement
}

describe('TokenAnalytics', () => {
  it('distinguishes missing components from legitimate zero and never invents prompt/completion', () => {
    const totalOnly = tokenData({
      totals: {
        totalTokens: 1234567,
        providerCalls: 1,
        toolCalls: 0,
        toolErrors: 0,
        iterations: 1,
        childRuns: 0,
        durationMs: 100,
        budgetStops: 0
      },
      byDay: [{ date: '2026-07-13', totalTokens: 1234567, runs: 1 }]
    })
    const { rerender } = render(<TokenAnalytics result={result(totalOnly)} query={query} formatters={formatters} />)

    expect(within(metricCard('Total tokens')).getByText('compact:1234567')).toHaveAttribute('title', 'exact:1234567')
    expect(within(metricCard('Prompt tokens')).getByLabelText('未提供')).toHaveTextContent('—')
    expect(within(metricCard('Prompt tokens')).getByText('未提供，未推断')).toBeInTheDocument()
    expect(within(metricCard('Completion tokens')).getByLabelText('未提供')).toBeInTheDocument()

    const zeroData = tokenData({
      totals: { ...tokenData().totals, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    })
    rerender(<TokenAnalytics result={result(zeroData, 'empty')} query={query} formatters={formatters} />)
    expect(within(metricCard('Prompt tokens')).getByText('compact:0')).toHaveAttribute('title', 'exact:0')
    expect(screen.getByText('当前范围为完整空结果。')).toBeInTheDocument()
  })

  it('explains partial coverage and exposes warnings through an operable disclosure', () => {
    const partialCoverage = { ...coverage, complete: false }
    const partialData = tokenData({
      sourceCoverage: {
        ...tokenData().sourceCoverage,
        conversationsPartiallyMissingUsage: 2,
        invalidLedgerRows: 3
      }
    })
    renderTokens(result(partialData, 'partial', {
      coverage: partialCoverage,
      warnings: [{
        code: 'conversation_usage_partially_missing',
        severity: 'warning',
        message: '2 个对话缺少部分 usage。',
        source: 'agent_conversations'
      }]
    }))

    expect(screen.getByText('部分覆盖')).toBeInTheDocument()
    expect(screen.getByText(/缺失记录不是 0/)).toBeInTheDocument()
    const disclosure = screen.getByTestId('token-warnings')
    const summary = within(disclosure).getByText('查看 1 条完整性说明')
    fireEvent.click(summary)
    expect(disclosure).toHaveAttribute('open')
    expect(within(disclosure).getByText('2 个对话缺少部分 usage。')).toBeInTheDocument()
  })

  it('shows conversation turn usage as primary and ledger only as fallback without exposing paths', () => {
    renderTokens()
    const table = screen.getByRole('table', { name: '对话 Token 排名' })
    const primaryRow = within(table).getByText('矩阵复习').closest('tr')
    const fallbackRow = within(table).getByText('Ledger 对话').closest('tr')
    expect(primaryRow).not.toBeNull()
    expect(fallbackRow).not.toBeNull()
    expect(within(primaryRow as HTMLElement).getByText('turn usage')).toBeInTheDocument()
    expect(within(fallbackRow as HTMLElement).getByText('ledger 兜底')).toBeInTheDocument()
    expect(screen.getByText(/Ledger 快照不会逐行相加/)).toBeInTheDocument()
    expect(screen.queryByText(/C:\\Users\\secret/)).not.toBeInTheDocument()
    expect(screen.getByText(/不会用 conversation updatedAt/)).toBeInTheDocument()
  })

  it('supports large numbers, CJK/RTL long labels, injected formatters, and model-unavailable truthfulness', () => {
    const rtlTitle = 'مرحبا-非常非常非常长的对话名称-1234567890'
    const rtlTool = 'أداة_بحث_طويلة_جداً'
    const rtlData = tokenData({
      totals: { ...tokenData().totals, totalTokens: 987654321 },
      byConversation: [{ ...tokenData().byConversation[0], title: rtlTitle, totalTokens: 987654321 }],
      byWorkspace: [{ workspaceId: 'rtl', name: '工作区-مرحبا-名称非常非常非常长', totalTokens: 987654321, conversationCount: 1 }],
      byTool: [{ name: rtlTool, calls: 999999, errors: 2 }]
    })
    renderTokens(result(rtlData))

    expect(within(metricCard('Total tokens')).getByText('compact:987654321')).toHaveAttribute('title', 'exact:987654321')
    expect(screen.getByText(rtlTitle)).toHaveAttribute('dir', 'auto')
    expect(screen.getByText(rtlTool)).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('模型拆分').parentElement).toHaveTextContent('不可用')
  })

  it('provides an accessible SVG and a semantic table fallback with local day/week inclusive range filtering', () => {
    const rangedData = tokenData({
      byDay: [
        { date: '2026-07-06', totalTokens: 99, runs: 1 },
        { date: '2026-07-07', totalTokens: 10, runs: 1 },
        { date: '2026-07-13', totalTokens: 20, runs: 2 },
        { date: '2026-07-14', totalTokens: 88, runs: 1 }
      ]
    })
    renderTokens(result(rangedData))

    expect(screen.getByRole('img', { name: 'Token 使用趋势图' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '表格' }))
    const dayTable = screen.getByRole('table', { name: '按日 Token 使用' })
    expect(within(dayTable).getByText('date:2026-07-07')).toBeInTheDocument()
    expect(within(dayTable).getByText('date:2026-07-13')).toBeInTheDocument()
    expect(within(dayTable).queryByText('date:2026-07-06')).not.toBeInTheDocument()
    expect(within(dayTable).queryByText('date:2026-07-14')).not.toBeInTheDocument()
    expect(within(dayTable).getAllByRole('columnheader')).toHaveLength(5)

    fireEvent.click(screen.getByRole('button', { name: '周' }))
    const weekTable = screen.getByRole('table', { name: '按周 Token 使用' })
    expect(within(weekTable).getByText('date:2026-07-06 — date:2026-07-12')).toBeInTheDocument()
    expect(within(weekTable).getByText('date:2026-07-13 — date:2026-07-13')).toBeInTheDocument()
  })

  it('renders loading, unavailable, and error states with accessible status semantics and retry', () => {
    const retry = vi.fn()
    const { rerender } = render(<TokenAnalytics fallbackState="loading" />)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载 Token 分析')

    rerender(<TokenAnalytics fallbackState="unavailable" fallbackMessage="后端明确不可用" />)
    expect(screen.getByRole('status')).toHaveTextContent('后端明确不可用')

    rerender(<TokenAnalytics fallbackState="error" fallbackMessage="读取失败" onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('读取失败')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
