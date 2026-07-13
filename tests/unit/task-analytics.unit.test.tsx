import { describe, expect, it } from 'vitest'
import type {
  AnalyticsCoverage,
  AnalyticsDateRange,
  AnalyticsSectionResult,
  TaskAnalytics as TaskAnalyticsData
} from '@renderer/views/workbench/analytics/types'
import { TaskAnalytics } from '@renderer/views/workbench/analytics/components/TaskAnalytics'
import type { StudyAnalyticsPageSlots } from '@renderer/views/workbench/analytics/StudyAnalyticsPage'
import { renderUi, screen, setupUser, within } from '../helpers/render'

const slotCompatibility: StudyAnalyticsPageSlots = { tasks: TaskAnalytics }
void slotCompatibility

const range: AnalyticsDateRange = {
  from: '2026-07-01',
  to: '2026-07-07',
  preset: 'week',
  fromInclusive: true,
  toInclusive: true,
  calendar: 'local_gregorian',
  weekStartsOn: 1
}

function coverage(complete = true): AnalyticsCoverage {
  return {
    rangeApplied: true,
    requestedRange: range,
    effectiveRange: range,
    trackingStartedOn: '2026-06-01',
    dataStartDate: '2026-07-01',
    dataEndDate: '2026-07-07',
    retention: { policy: 'rolling_local_days', days: 400, includesToday: true, cutoffDate: '2025-06-09' },
    complete,
    sources: [
      { source: 'task_activity_facts', state: complete ? 'complete' : 'partial', scanned: 9, included: 9, missing: 0, rejected: 0 },
      { source: 'study_fact_store', state: complete ? 'complete' : 'partial', scanned: 4, included: 4, missing: 0, rejected: 0 }
    ]
  }
}

const longTitle = '超长任务标题📚学习计划 / العربية \u202Eabc\u202C / English — 用于验证换行与双向文本安全'.replace('\\u202E', '\u202E').replace('\\u202C', '\u202C')

function data(overrides: Partial<TaskAnalyticsData> = {}): TaskAnalyticsData {
  return {
    current: {
      asOf: '2026-07-13T10:00:00.000Z',
      total: 4,
      open: 2,
      completed: 2,
      overdue: 1,
      completionRate: 0.5
    },
    flow: {
      created: 2,
      completed: 3,
      reopened: 1,
      deleted: 0,
      byDay: []
    },
    plan: {
      plannedSeconds: 3600,
      scheduledOccurrences: 2,
      attributedFocusSeconds: 5400,
      executionRate: 1.5
    },
    topByAttributedFocus: [
      { taskId: 'task-explicit-1', title: longTitle, focusSeconds: 4200, completedInRange: true, currentlyDone: true },
      { taskId: 'task-explicit-2', title: '第二个任务', focusSeconds: 1200, completedInRange: false, currentlyDone: false }
    ],
    unattributedFocusSeconds: 1800,
    ...overrides
  }
}

function availableResult(value = data()): AnalyticsSectionResult<TaskAnalyticsData> {
  return {
    state: 'available',
    data: value,
    temporal: {
      kind: 'mixed',
      range,
      asOf: '2026-07-13T10:00:00.000Z',
      rangeFields: ['flow', 'plan', 'topByAttributedFocus', 'unattributedFocusSeconds'],
      rangeInvariantFields: ['current']
    },
    coverage: coverage(),
    warnings: []
  }
}

describe('TaskAnalytics', () => {
  it('shows only explicit taskId attribution, preserves unattributed focus, and does not clamp execution above 100%', () => {
    renderUi(<TaskAnalytics result={availableResult()} />)

    expect(screen.getAllByText('150%').length).toBeGreaterThan(0)
    expect(screen.getByText('执行率超过 100% 是有效结果，不会被截断。')).toBeInTheDocument()
    expect(screen.queryByText('30 分钟（覆盖不完整）')).not.toBeInTheDocument()
    expect(screen.getByText('30 分钟')).toBeInTheDocument()
    expect(screen.getByText(/不按标题相似度或“第一个未完成任务”猜测/)).toBeInTheDocument()

    const table = screen.getByRole('table', { name: /按显式 taskId 聚合/ })
    const row = within(table).getByRole('row', { name: new RegExp('task-explicit-1') })
    expect(within(row).getByText(longTitle).closest('bdi')).toHaveAttribute('dir', 'auto')
    expect(within(row).getByText('task-explicit-1').closest('bdi')).toHaveAttribute('dir', 'auto')
    expect(within(row).getByText('显式 taskId')).toBeInTheDocument()
    expect(screen.getByText('不可用（区间起点库存未包含在聚合 DTO）')).toBeInTheDocument()
  })

  it('offers native table/expand semantics and keyboard-sized sortable controls', async () => {
    const user = setupUser()
    renderUi(<TaskAnalytics result={availableResult()} />)

    const disclosure = screen.getByText('展开任务耗时与显式归因表').closest('summary')
    expect(disclosure).toBeInTheDocument()
    expect(disclosure?.parentElement).toHaveAttribute('open')

    const durationSort = screen.getByRole('button', { name: /专注耗时/ })
    expect(durationSort).toHaveClass('deep-analytics-sort-button')
    expect(durationSort.closest('th')).toHaveAttribute('aria-sort', 'descending')
    await user.click(durationSort)
    expect(durationSort.closest('th')).toHaveAttribute('aria-sort', 'ascending')

    const rows = screen.getByRole('table', { name: /按显式 taskId 聚合/ }).querySelectorAll('tbody tr')
    expect(rows[0]).toHaveAttribute('data-task-id', 'task-explicit-2')
  })

  it('distinguishes missing task/schedule history from a confirmed zero', () => {
    const partial: AnalyticsSectionResult<TaskAnalyticsData> = {
      state: 'partial',
      data: data({
        current: { asOf: '2026-07-13T10:00:00.000Z', total: 0, open: 0, completed: 0, overdue: 0, completionRate: null },
        flow: { created: 0, completed: 0, reopened: 0, deleted: 0, byDay: [] },
        plan: { plannedSeconds: 0, scheduledOccurrences: 0, attributedFocusSeconds: 0, executionRate: null },
        topByAttributedFocus: [],
        unattributedFocusSeconds: 0
      }),
      temporal: { kind: 'mixed', range, asOf: '2026-07-13T10:00:00.000Z', rangeFields: [], rangeInvariantFields: ['current'] },
      coverage: coverage(false),
      warnings: [
        { code: 'task_history_missing', severity: 'warning', message: 'Task history was not recorded.', source: 'task_activity_facts' },
        { code: 'schedule_history_missing', severity: 'warning', message: 'Schedule history was not recorded.', source: 'task_activity_facts' }
      ]
    }

    const { rerender } = renderUi(<TaskAnalytics result={partial} />)
    const planPanel = screen.getByRole('heading', { name: '计划与实际' }).closest('section')
    expect(within(planPanel!).getByText(/计划时长和执行率不能显示为 0/)).toBeInTheDocument()
    expect(within(planPanel!).queryByText('0 秒')).not.toBeInTheDocument()
    expect(screen.getByText('不可用（没有当前任务）')).toBeInTheDocument()

    rerender(<TaskAnalytics result={availableResult(data({
      current: { asOf: '2026-07-13T10:00:00.000Z', total: 0, open: 0, completed: 0, overdue: 0, completionRate: null },
      flow: { created: 0, completed: 0, reopened: 0, deleted: 0, byDay: [] },
      plan: { plannedSeconds: 0, scheduledOccurrences: 0, attributedFocusSeconds: 0, executionRate: null },
      topByAttributedFocus: [],
      unattributedFocusSeconds: 0
    }))} />)
    const confirmedPlan = screen.getByRole('heading', { name: '计划与实际' }).closest('section')
    expect(within(confirmedPlan!).getAllByText('0 秒').length).toBeGreaterThan(0)
  })

  it('renders loading, unavailable, and error without fabricating task zeroes', () => {
    const { rerender } = renderUi(<TaskAnalytics loading />)
    expect(screen.getByText('正在加载任务生命周期与显式归因数据。')).toBeInTheDocument()

    rerender(<TaskAnalytics result={{
      state: 'unavailable',
      reason: 'history_not_recorded',
      temporal: { kind: 'mixed', range, asOf: '2026-07-13T10:00:00.000Z', rangeFields: [], rangeInvariantFields: ['current'] },
      coverage: coverage(false),
      warnings: [{ code: 'task_history_missing', severity: 'warning', message: 'History unavailable.', source: 'task_activity_facts' }]
    }} />)
    expect(screen.getByText(/当前库存不能倒推出区间历史/)).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()

    rerender(<TaskAnalytics result={{
      state: 'error',
      error: { code: 'task_failed', message: '任务聚合失败，但未暴露路径。', retryable: true },
      temporal: { kind: 'range', range },
      coverage: coverage(false),
      warnings: []
    }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('任务聚合失败，但未暴露路径。')
  })
})
