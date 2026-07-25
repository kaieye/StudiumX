import { describe, expect, it } from 'vitest'
import { createDemoLearningAnalyticsBundle } from '@renderer/views/workbench/analytics/demoLearningAnalyticsBundle'
import {
  assertAnalyticsBundle,
  buildAnalyticsDateRange,
  buildLearningAnalyticsQuery
} from '@renderer/views/workbench/analytics/useStudyAnalytics'

describe('demoLearningAnalyticsBundle', () => {
  it('returns a contract-valid dense multi-day bundle', () => {
    const localToday = '2026-07-25'
    const query = buildLearningAnalyticsQuery({
      range: buildAnalyticsDateRange('week', localToday),
      localToday,
      timeZone: 'Asia/Shanghai',
      personalClientId: 'demo-client',
      teaching: { kind: 'all_workspaces', workspaceIds: ['ws-algo', 'ws-eng'] },
      presenceSpaceCode: 'demo-space'
    })

    const bundle = createDemoLearningAnalyticsBundle(query)
    expect(() => assertAnalyticsBundle(bundle)).not.toThrow()

    expect(bundle.contractVersion).toBe(1)
    expect(bundle.hero.state).toBe('available')
    expect(bundle.focus.state).toBe('available')
    expect(bundle.tokens.state).toBe('available')
    expect(bundle.tasks.state).toBe('available')
    expect(bundle.review.state).toBe('available')

    if (bundle.focus.state !== 'available') throw new Error('focus unavailable')
    expect(bundle.focus.data.heatmap.length).toBe(180)
    expect(bundle.focus.data.trend.length).toBeGreaterThan(0)
    expect(bundle.focus.data.hourBuckets).toHaveLength(24)
    expect(bundle.focus.data.hourBuckets.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0)
    expect(bundle.focus.data.activeRanges.mode).toBe('day_of_range')
    expect(bundle.focus.data.activeRanges.yMax).toBe(24)
    expect(bundle.focus.data.activeRanges.ranges.length).toBeGreaterThan(0)
    // week preset is the last 7 local days ending today (no future empty columns).
    expect(bundle.focus.data.activeRanges.categories).toEqual([
      '2026-07-19',
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
      '2026-07-25'
    ])
    expect(query.range.to).toBe('2026-07-25')

    if (bundle.tokens.state !== 'available') throw new Error('tokens unavailable')
    expect(bundle.tokens.data.byDay.length).toBeGreaterThan(0)
    expect(bundle.tokens.data.byWorkspace.length).toBeGreaterThan(0)
    expect(bundle.tokens.data.byTool.length).toBeGreaterThan(0)
    expect(bundle.tokens.data.totals.totalTokens).toBeGreaterThan(0)

    if (bundle.tasks.state !== 'available') throw new Error('tasks unavailable')
    expect(bundle.tasks.data.flow.byDay.length).toBeGreaterThan(0)
    expect(bundle.tasks.data.topByAttributedFocus.length).toBeGreaterThan(0)

    if (bundle.review.state !== 'available') throw new Error('review unavailable')
    expect(bundle.review.data.byLesson.length).toBeGreaterThan(0)

    // Deterministic for the same query.
    const again = createDemoLearningAnalyticsBundle(query)
    expect(again).toEqual(bundle)
  })

  it('fills longer ranges when the preset expands', () => {
    const localToday = '2026-07-25'
    const query = buildLearningAnalyticsQuery({
      range: buildAnalyticsDateRange('all', localToday),
      localToday,
      timeZone: 'Asia/Shanghai',
      personalClientId: 'demo-client',
      teaching: { kind: 'none' }
    })
    const bundle = createDemoLearningAnalyticsBundle(query)
    assertAnalyticsBundle(bundle)
    if (bundle.focus.state !== 'available') throw new Error('focus unavailable')
    expect(bundle.focus.data.trend.length).toBeGreaterThan(80)
  })
})