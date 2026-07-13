import type { AnalyticsDirection, AnalyticsIntlFormatters } from './types'

export type AnalyticsFormatterOptions = {
  timeZone?: string
  tokenUnit: string
  unknownLabel: string
}

const RTL_LANGUAGES = new Set(['ar', 'dv', 'fa', 'he', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi'])

function safeLocale(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? 'en-US'
  } catch {
    return 'en-US'
  }
}

export function analyticsLocaleDirection(locale: string): AnalyticsDirection {
  const canonical = safeLocale(locale)
  const language = canonical.split('-')[0]?.toLowerCase() ?? 'en'
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'
}

function localDateToUtcNoon(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null
  return date
}

export function createAnalyticsFormatters(
  locale: string,
  options: AnalyticsFormatterOptions
): AnalyticsIntlFormatters {
  const resolvedLocale = safeLocale(locale)
  const number = new Intl.NumberFormat(resolvedLocale, { maximumFractionDigits: 0 })
  const compact = new Intl.NumberFormat(resolvedLocale, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1
  })
  const percent = new Intl.NumberFormat(resolvedLocale, {
    style: 'percent',
    maximumFractionDigits: 0
  })
  const localDate = new Intl.DateTimeFormat(resolvedLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  })
  const instant = new Intl.DateTimeFormat(resolvedLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.timeZone ? { timeZone: options.timeZone } : {})
  })
  const list = new Intl.ListFormat(resolvedLocale, { style: 'short', type: 'conjunction' })
  const hours = new Intl.NumberFormat(resolvedLocale, {
    style: 'unit',
    unit: 'hour',
    unitDisplay: 'short',
    maximumFractionDigits: 1
  })
  const minutes = new Intl.NumberFormat(resolvedLocale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
    maximumFractionDigits: 0
  })
  const seconds = new Intl.NumberFormat(resolvedLocale, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
    maximumFractionDigits: 0
  })

  return {
    locale: resolvedLocale,
    direction: analyticsLocaleDirection(resolvedLocale),
    number: (value) => Number.isFinite(value) ? number.format(value) : options.unknownLabel,
    compactNumber: (value) => Number.isFinite(value) ? compact.format(value) : options.unknownLabel,
    compactTokens: (value) => Number.isFinite(value) ? `${compact.format(value)} ${options.tokenUnit}` : options.unknownLabel,
    percent: (ratio) => Number.isFinite(ratio) ? percent.format(ratio) : options.unknownLabel,
    duration: (totalSeconds) => {
      if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return options.unknownLabel
      const safeSeconds = totalSeconds
      if (safeSeconds >= 3600) return hours.format(safeSeconds / 3600)
      if (safeSeconds >= 60) return minutes.format(Math.round(safeSeconds / 60))
      return seconds.format(Math.round(safeSeconds))
    },
    localDate: (value) => {
      const date = localDateToUtcNoon(value)
      return date ? localDate.format(date) : options.unknownLabel
    },
    instant: (value) => {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? options.unknownLabel : instant.format(date)
    },
    list: (values) => list.format(values)
  }
}
