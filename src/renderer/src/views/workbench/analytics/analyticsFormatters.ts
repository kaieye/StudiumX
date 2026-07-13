import type { AnalyticsDateRange, AnalyticsLocalDate } from './types'
import { analyticsCopy, rangePresetLabel } from './analyticsCopy'

export type AnalyticsFormatterLocale = 'zh-CN' | 'en-US'

const DEFAULT_LOCALE: AnalyticsFormatterLocale = 'zh-CN'

function dateFromLocalKey(value: AnalyticsLocalDate): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatLocalDate(
  value: AnalyticsLocalDate,
  locale: AnalyticsFormatterLocale = DEFAULT_LOCALE
): string {
  const date = dateFromLocalKey(value)
  if (!date) return value
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

export const analyticsFormatters = {
  localDate: formatLocalDate,

  range(range: AnalyticsDateRange, locale: AnalyticsFormatterLocale = DEFAULT_LOCALE): string {
    const from = formatLocalDate(range.from, locale)
    const to = formatLocalDate(range.to, locale)
    const dates = range.from === range.to ? from : `${from} — ${to}`
    return `${rangePresetLabel(range.preset)} · ${dates}`
  },

  instant(value: string, locale: AnalyticsFormatterLocale = DEFAULT_LOCALE): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return analyticsCopy.page.notGenerated
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  },

  duration(totalSeconds: number, locale: AnalyticsFormatterLocale = DEFAULT_LOCALE): string {
    const safeSeconds = Math.max(0, totalSeconds)
    const hours = safeSeconds / 3600
    if (hours >= 1) {
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: hours >= 10 ? 0 : 1 }).format(hours)} ${analyticsCopy.metrics.hours}`
    }
    const minutes = Math.floor(safeSeconds / 60)
    return locale === 'zh-CN' ? `${minutes} 分钟` : `${minutes} min`
  },

  compactNumber(value: number, locale: AnalyticsFormatterLocale = DEFAULT_LOCALE): string {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  },

  integer(value: number, locale: AnalyticsFormatterLocale = DEFAULT_LOCALE): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
  },

  percent(value: number | null, locale: AnalyticsFormatterLocale = DEFAULT_LOCALE): string {
    if (value === null) return analyticsCopy.metrics.noTasks
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  }
}
