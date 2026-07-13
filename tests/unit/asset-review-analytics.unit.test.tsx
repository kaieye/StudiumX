import { describe, expect, it } from 'vitest'
import type {
  AnalyticsCoverage,
  AnalyticsDateRange,
  AnalyticsSectionResult,
  ReviewAnalytics as ReviewAnalyticsData,
  WorkspaceAssetsAnalytics as WorkspaceAssetsData
} from '@renderer/views/workbench/analytics/types'
import { AssetAnalytics } from '@renderer/views/workbench/analytics/components/AssetAnalytics'
import { ReviewAnalytics } from '@renderer/views/workbench/analytics/components/ReviewAnalytics'
import type { StudyAnalyticsPageSlots } from '@renderer/views/workbench/analytics/StudyAnalyticsPage'
import { renderUi, screen, setupUser, within } from '../helpers/render'

const slotCompatibility: StudyAnalyticsPageSlots = {
  workspace_assets: AssetAnalytics,
  review: ReviewAnalytics
}
void slotCompatibility

const weekRange: AnalyticsDateRange = {
  from: '2026-07-06',
  to: '2026-07-12',
  preset: 'week',
  fromInclusive: true,
  toInclusive: true,
  calendar: 'local_gregorian',
  weekStartsOn: 1
}

const monthRange: AnalyticsDateRange = {
  from: '2026-07-01',
  to: '2026-07-13',
  preset: 'month',
  fromInclusive: true,
  toInclusive: true,
  calendar: 'local_gregorian',
  weekStartsOn: 1
}

function coverage(range: AnalyticsDateRange, rangeApplied: boolean, complete = true): AnalyticsCoverage {
  return {
    rangeApplied,
    requestedRange: range,
    effectiveRange: rangeApplied ? range : null,
    trackingStartedOn: null,
    dataStartDate: null,
    dataEndDate: null,
    retention: { policy: 'rolling_local_days', days: 400, includesToday: true, cutoffDate: '2025-06-09' },
    complete,
    sources: [{ source: 'workspace_catalog', state: complete ? 'complete' : 'partial', scanned: 1, included: 1, missing: 0, rejected: 0 }]
  }
}

const bidiTitle = '超长课程标题📚 العربية \u202Eabc\u202C / English / 中文 — 需要安全换行'.replace('\\u202E', '\u202E').replace('\\u202C', '\u202C')

const assetData: WorkspaceAssetsData = {
  counts: {
    workspaces: 1,
    courses: 2,
    sessions: 3,
    lessons: 4,
    resources: 5,
    learningRecords: 6,
    references: 7,
    conversations: 8
  },
  courses: [
    { workspaceId: 'workspace-1', courseId: 'course-1', name: bidiTitle, sessionCount: 2, lessonCount: 3, conversationCount: 4, pinned: true, updatedAt: '2026-07-12T09:00:00.000Z' },
    { workspaceId: 'workspace-1', courseId: 'course-2', name: 'A Course', sessionCount: 1, lessonCount: 1, conversationCount: 0, pinned: false, updatedAt: '2026-07-01T09:00:00.000Z' }
  ],
  recentLessons: [
    { workspaceId: 'workspace-1', lessonId: 'lesson-1', title: 'Lesson 📘 العربية 中文', courseName: bidiTitle, createdAt: '2026-07-12T09:00:00.000Z', durationMinutes: 45 }
  ],
  missionHealth: [
    { workspaceId: 'workspace-1', hasMission: true, title: 'Mission 🎯 学习目标 العربية', excerptLength: 128, updatedAt: '2026-07-11T09:00:00.000Z' }
  ]
}

function assetResult(range: AnalyticsDateRange): AnalyticsSectionResult<WorkspaceAssetsData> {
  return {
    state: 'available',
    data: assetData,
    temporal: { kind: 'as_of', asOf: '2026-07-13T10:00:00.000Z', rangeInvariant: true },
    coverage: coverage(range, false),
    warnings: []
  }
}

function reviewResult(data: ReviewAnalyticsData, range: AnalyticsDateRange = weekRange): AnalyticsSectionResult<ReviewAnalyticsData> {
  return {
    state: 'available',
    data,
    temporal: {
      kind: 'mixed',
      range,
      asOf: '2026-07-13T10:00:00.000Z',
      rangeFields: data.range.answered === null ? [] : ['range'],
      rangeInvariantFields: ['cumulative', 'byLesson']
    },
    coverage: coverage(range, data.range.answered !== null),
    warnings: data.range.answered === null
      ? [{ code: 'review_history_missing', severity: 'warning', message: 'Timestamped review history is unavailable.', source: 'review_progress' }]
      : []
  }
}

describe('AssetAnalytics', () => {
  it('keeps current inventory invariant across selected ranges and separates unavailable range changes', () => {
    const { rerender } = renderUi(<AssetAnalytics result={assetResult(weekRange)} />)

    expect(screen.getByText('Workspace').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Learning record').nextElementSibling).toHaveTextContent('6')
    expect(screen.getByText('Reference').nextElementSibling).toHaveTextContent('7')
    expect(screen.getByText('Mission 已填写').nextElementSibling).toHaveTextContent('1 / 1')
    expect(screen.getByText(/切换日期范围不会过滤当前库存/)).toBeInTheDocument()
    expect(screen.getAllByText(bidiTitle)[0].closest('bdi')).toHaveAttribute('dir', 'auto')

    rerender(<AssetAnalytics result={assetResult(monthRange)} />)
    expect(screen.getByText('Workspace').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Learning record').nextElementSibling).toHaveTextContent('6')
    expect(screen.getByText('2026-07-01 — 2026-07-13（仅供其他历史模块使用）')).toBeInTheDocument()
  })

  it('uses accessible sortable tables and never renders Mission body content or paths', async () => {
    const user = setupUser()
    renderUi(<AssetAnalytics result={assetResult(weekRange)} />)

    const courseTable = screen.getByRole('table', { name: /当前 Course 库存/ })
    expect(courseTable).toBeInTheDocument()
    const nameSort = within(courseTable).getByRole('button', { name: /Course/ })
    expect(nameSort).toHaveClass('deep-analytics-sort-button')
    await user.click(nameSort)
    expect(nameSort.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    const missionTable = screen.getByRole('table', { name: /只显示标题、是否填写和长度/ })
    expect(within(missionTable).getByText('Mission 🎯 学习目标 العربية').closest('bdi')).toHaveAttribute('dir', 'auto')
    expect(within(missionTable).getByText('128 字符')).toBeInTheDocument()
    expect(screen.getByText(/正文、绝对路径和秘密始终排除/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('C:\\Users\\secret')
  })
})

describe('ReviewAnalytics', () => {
  const cumulativeOnly: ReviewAnalyticsData = {
    cumulative: { totalAnswered: 12, correct: 9, accuracy: 0.75, cardCount: 5 },
    range: { answered: null, correct: null, accuracy: null },
    byLesson: [
      { lessonId: 'lesson-weak', title: '薄弱 Lesson 📕 العربية 中文', answered: 4, correct: 1, accuracy: 0.25, reviewCardCount: 3 },
      { lessonId: 'lesson-strong', title: bidiTitle, answered: 8, correct: 8, accuracy: 1, reviewCardCount: 2 }
    ]
  }

  it('separates cumulative/current inventory from unavailable timestamped range accuracy with a warning', () => {
    renderUi(<ReviewAnalytics result={reviewResult(cumulativeOnly)} />)

    const currentPanel = screen.getByRole('heading', { name: '复习进度与卡片库存' }).closest('section')
    expect(within(currentPanel!).getByText('累计作答').nextElementSibling).toHaveTextContent('12')
    expect(within(currentPanel!).getByText('累计正确率').nextElementSibling).toHaveTextContent('75%')
    expect(within(currentPanel!).getByText('当前复习卡片').nextElementSibling).toHaveTextContent('5')
    expect(screen.getByText(/没有 timestamped review_answered facts/)).toBeInTheDocument()
    expect(screen.getByText(/不能显示为 0/)).toBeInTheDocument()
    expect(screen.getByText('Timestamped review history is unavailable.')).toBeInTheDocument()

    const table = screen.getByRole('table', { name: /按 Lesson 的累计进度/ })
    expect(within(table).getByText(bidiTitle).closest('bdi')).toHaveAttribute('dir', 'auto')
    expect(within(table).getByRole('button', { name: /累计正确率/ }).closest('th')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('shows confirmed range zeroes without calling them missing', () => {
    const withTimestampedZero: ReviewAnalyticsData = {
      cumulative: { totalAnswered: 0, correct: 0, accuracy: null, cardCount: 0 },
      range: { answered: 0, correct: 0, accuracy: null },
      byLesson: []
    }
    renderUi(<ReviewAnalytics result={reviewResult(withTimestampedZero)} />)

    const rangePanel = screen.getByRole('heading', { name: '区间正确率' }).closest('section')
    expect(within(rangePanel!).getByText('区间作答').nextElementSibling).toHaveTextContent('0')
    expect(within(rangePanel!).getByText('区间答对').nextElementSibling).toHaveTextContent('0')
    expect(rangePanel!.querySelector('dt:nth-of-type(1)')).not.toBeNull()
    const rangeAccuracyLabel = [...rangePanel!.querySelectorAll('dt')].find((node) => node.textContent === '区间正确率')
    expect(rangeAccuracyLabel?.nextElementSibling).toHaveTextContent('无作答')
    expect(within(rangePanel!).queryByText(/timestamped review_answered facts/)).not.toBeInTheDocument()
  })

  it('supports loading, empty data, and unavailable envelopes without fabricated accuracy', () => {
    const { rerender } = renderUi(<ReviewAnalytics loading />)
    expect(screen.getByText('正在加载累计复习进度与卡片库存。')).toBeInTheDocument()

    rerender(<ReviewAnalytics result={{
      state: 'empty',
      reason: 'no_activity',
      data: { cumulative: { totalAnswered: 0, correct: 0, accuracy: null, cardCount: 0 }, range: { answered: null, correct: null, accuracy: null }, byLesson: [] },
      temporal: { kind: 'mixed', range: weekRange, asOf: '2026-07-13T10:00:00.000Z', rangeFields: [], rangeInvariantFields: ['cumulative', 'byLesson'] },
      coverage: coverage(weekRange, false),
      warnings: [{ code: 'review_history_missing', severity: 'warning', message: 'No timestamped review facts.', source: 'review_progress' }]
    }} />)
    expect(screen.getByText('累计正确率').nextElementSibling).toHaveTextContent('无作答')
    expect(screen.queryByText('0%')).not.toBeInTheDocument()

    rerender(<ReviewAnalytics result={{
      state: 'unavailable',
      reason: 'history_not_recorded',
      temporal: { kind: 'range', range: weekRange },
      coverage: coverage(weekRange, false, false),
      warnings: [{ code: 'review_history_missing', severity: 'warning', message: 'Review history missing.', source: 'review_progress' }]
    }} />)
    expect(screen.getByText(/不能把缺失的区间正确率显示为 0/)).toBeInTheDocument()
  })
})
