import type { AnalyticsDateRange, AnalyticsLocalDate } from './types'

export type AnalyticsLocale = 'zh-CN' | 'en-US'

export function resolveAnalyticsLocale(language: string | undefined): AnalyticsLocale {
  return language?.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
}

function dateFromLocalKey(value: AnalyticsLocalDate): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Locale-aware, allocation-light formatters for the analytics dashboard. Every
 * helper degrades to a stable placeholder when the input is null/invalid so a
 * partial section never renders `NaN`.
 */
export function createAnalyticsFormatters(locale: AnalyticsLocale) {
  const integerFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const compactFormat = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const percentFormat = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  const shortDateFormat = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' })
  const longDateFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  // Heatmap month axis always uses English abbreviations (Jan, Feb, …).
  const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short' })
  const instantFormat = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  const dash = '—'

  return {
    locale,

    integer(value: number | null | undefined): string {
      if (value === null || value === undefined || !Number.isFinite(value)) return dash
      return integerFormat.format(value)
    },

    compact(value: number | null | undefined): string {
      if (value === null || value === undefined || !Number.isFinite(value)) return dash
      return compactFormat.format(value)
    },

    percent(value: number | null | undefined): string {
      if (value === null || value === undefined || !Number.isFinite(value)) return dash
      return percentFormat.format(value)
    },

    /** Human focus duration: hours when >= 1h, otherwise minutes. */
    duration(totalSeconds: number | null | undefined): string {
      if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return dash
      const safe = Math.max(0, totalSeconds)
      const hours = safe / 3600
      if (hours >= 1) {
        const value = new Intl.NumberFormat(locale, { maximumFractionDigits: hours >= 10 ? 0 : 1 }).format(hours)
        return locale === 'zh-CN' ? `${value} 小时` : `${value} h`
      }
      const minutes = Math.floor(safe / 60)
      return locale === 'zh-CN' ? `${minutes} 分钟` : `${minutes} min`
    },

    shortDate(value: AnalyticsLocalDate): string {
      const date = dateFromLocalKey(value)
      return date ? shortDateFormat.format(date) : value
    },

    longDate(value: AnalyticsLocalDate): string {
      const date = dateFromLocalKey(value)
      return date ? longDateFormat.format(date) : value
    },

    month(value: AnalyticsLocalDate): string {
      const date = dateFromLocalKey(value)
      if (!date) return value
      // Bare English abbreviation (Jan, Feb, …) with only the first letter capital.
      const raw = monthFormat.format(date).replace(/\./g, '').trim()
      if (!raw) return value
      return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
    },

    instant(value: string): string {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? dash : instantFormat.format(date)
    },

    hour(hour: number): string {
      const normalized = ((hour % 24) + 24) % 24
      return `${String(normalized).padStart(2, '0')}:00`
    },

    /** Compact hour tick for the active-range X axis (avoids "00:00" clipping). */
    axisHour(hour: number): string {
      const normalized = ((hour % 24) + 24) % 24
      return String(normalized)
    },

    /**
     * Compact date tick for multi-day active-range X axis.
     * Always month/day without year so labels fit half-width cards.
     */
    axisDate(value: AnalyticsLocalDate): string {
      const date = dateFromLocalKey(value)
      if (!date) return value
      const month = date.getMonth() + 1
      const day = date.getDate()
      return `${month}/${day}`
    },

    /** Minute mark on a 0–60 axis (today active-range view). Bare number, no unit word. */
    minuteMark(minute: number): string {
      if (!Number.isFinite(minute)) return dash
      const safe = Math.max(0, Math.min(60, minute))
      return integerFormat.format(Math.round(safe))
    },

    /** Hour-of-day mark on a 0–24 axis (week active-range view). Bare number, no unit word. */
    hourMark(hour: number): string {
      if (!Number.isFinite(hour)) return dash
      const safe = Math.max(0, Math.min(24, hour))
      return integerFormat.format(Math.round(safe))
    },

    range(range: AnalyticsDateRange): string {
      const from = this.longDate(range.from)
      const to = this.longDate(range.to)
      return range.from === range.to ? from : `${from} — ${to}`
    }
  }
}

export type AnalyticsFormatters = ReturnType<typeof createAnalyticsFormatters>
