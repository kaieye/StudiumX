import { describe, expect, it } from 'vitest'
import {
  addLocalDays,
  countInclusiveLocalDays,
  createAnalyticsDateRange,
  getLocalDayBounds,
  getLocalDateKey,
  getLocalTimezoneOffsetMinutes,
  getMondayWeekStart,
  isLocalDateInRange
} from '@renderer/views/workbench/analytics/domain/dateRange'

describe('analytics local calendar dates', () => {
  it('uses the requested local calendar rather than the UTC date', () => {
    const instant = new Date('2026-07-12T16:30:00.000Z')
    expect(getLocalDateKey(instant, 'Asia/Shanghai')).toBe('2026-07-13')
    expect(getLocalDateKey(instant, 'America/Los_Angeles')).toBe('2026-07-12')
  })

  it('uses Monday as the week start and keeps range boundaries inclusive', () => {
    expect(getMondayWeekStart('2026-07-12')).toBe('2026-07-06')
    const range = createAnalyticsDateRange('week', '2026-07-12')
    expect(range).toMatchObject({ from: '2026-07-06', to: '2026-07-12', fromInclusive: true, toInclusive: true })
    expect(isLocalDateInRange('2026-07-06', range)).toBe(true)
    expect(isLocalDateInRange('2026-07-12', range)).toBe(true)
    expect(isLocalDateInRange('2026-07-13', range)).toBe(false)
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addLocalDays('0001-01-01', 1)).toBe('0001-01-02')
    expect(countInclusiveLocalDays('0001-01-01', '0001-01-02')).toBe(2)
  })

  it('keeps Gregorian years 1 through 99 when calculating explicit-zone offsets', () => {
    const ancient = new Date(0)
    ancient.setUTCHours(0, 0, 0, 0)
    ancient.setUTCFullYear(1, 0, 1)
    expect(getLocalDateKey(ancient, 'UTC')).toBe('0001-01-01')
    expect(getLocalTimezoneOffsetMinutes(ancient, 'UTC')).toBe(0)
  })

  it('preserves 23-hour and 25-hour DST days', () => {
    const spring = getLocalDayBounds('2026-03-08', 'America/New_York')
    const autumn = getLocalDayBounds('2026-11-01', 'America/New_York')
    expect((spring.endExclusiveMs - spring.startMs) / 3_600_000).toBe(23)
    expect((autumn.endExclusiveMs - autumn.startMs) / 3_600_000).toBe(25)
  })
})
