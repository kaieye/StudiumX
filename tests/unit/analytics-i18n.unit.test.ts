import { describe, expect, it } from 'vitest'
import {
  analyticsLocaleDirection,
  bidiIsolate,
  createAnalyticsI18n,
  stripBidiControls
} from '../../src/renderer/src/views/workbench/analytics/i18n'

describe('analytics i18n and formatting seam', () => {
  it('provides distinct zh-CN and en-US dictionaries through one injected API', () => {
    const zh = createAnalyticsI18n('zh-CN')
    const en = createAnalyticsI18n('en-US')

    expect(zh.dictionaryLocale).toBe('zh-CN')
    expect(en.dictionaryLocale).toBe('en-US')
    expect(zh.labels.memory.title).toBe('记忆库存')
    expect(en.labels.memory.title).toBe('Memory inventory')
    expect(zh.labels.skills.rangeHistoryUnavailable).not.toBe(en.labels.skills.rangeHistoryUnavailable)
  })

  it('formats calendar dates, numbers, percentages, duration, and compact tokens with Intl', () => {
    const zh = createAnalyticsI18n('zh-CN', { timeZone: 'Asia/Shanghai' })
    const en = createAnalyticsI18n('en-US', { timeZone: 'America/Los_Angeles' })

    expect(en.formatters.localDate('2026-01-02')).toMatch(/2026/)
    expect(en.formatters.localDate('2026-01-02')).toMatch(/2/)
    expect(zh.formatters.number(1234567)).toMatch(/1/)
    expect(en.formatters.percent(0.4)).toMatch(/40/)
    expect(en.formatters.duration(5400)).toMatch(/1\.5/)
    expect(en.formatters.compactTokens(1_250_000)).toMatch(/1\.3M|1\.2M/)
    expect(zh.formatters.compactTokens(1_250_000)).toContain(zh.labels.common.tokenUnit)
    expect(zh.formatters.compactTokens(1_250_000)).not.toBe(en.formatters.compactTokens(1_250_000))
    expect(en.formatters.number(Number.NaN)).toBe(en.labels.common.unknown)
  })

  it('keeps RTL locale formatting and bidi isolation safe even when labels fall back to English', () => {
    const rtl = createAnalyticsI18n('ar-EG')
    const hostile = '\u202eabc\u202c مرحبا 🧠'
    const isolated = bidiIsolate(hostile)

    expect(rtl.direction).toBe('rtl')
    expect(analyticsLocaleDirection('he-IL')).toBe('rtl')
    expect(rtl.dictionaryLocale).toBe('en-US')
    expect(rtl.formatters.compactNumber(1_250_000)).not.toBe('1250000')
    expect(isolated.startsWith('\u2068')).toBe(true)
    expect(isolated.endsWith('\u2069')).toBe(true)
    expect(stripBidiControls(isolated)).toBe('abc مرحبا 🧠')
  })

  it('returns the localized unknown label for invalid dates instead of inventing a date', () => {
    const zh = createAnalyticsI18n('zh-CN')
    expect(zh.formatters.localDate('not-a-date')).toBe(zh.labels.common.unknown)
    expect(zh.formatters.instant('not-an-instant')).toBe(zh.labels.common.unknown)
  })
})
