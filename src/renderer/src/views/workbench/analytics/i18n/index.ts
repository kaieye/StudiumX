import { createAnalyticsFormatters, analyticsLocaleDirection } from './formatters'
import { enUSAnalyticsLabels } from './locales/en-US'
import { zhCNAnalyticsLabels } from './locales/zh-CN'
import type {
  AnalyticsI18n,
  AnalyticsLabels,
  SupportedAnalyticsLocale
} from './types'

export * from './bidi'
export * from './formatters'
export type * from './types'

export const analyticsDictionaries = {
  'zh-CN': zhCNAnalyticsLabels,
  'en-US': enUSAnalyticsLabels
} satisfies Record<SupportedAnalyticsLocale, AnalyticsLabels>

export function resolveAnalyticsDictionaryLocale(locale: string): SupportedAnalyticsLocale {
  const normalized = locale.toLowerCase()
  if (normalized.startsWith('zh')) return 'zh-CN'
  return 'en-US'
}

export function getAnalyticsLabels(locale: string): AnalyticsLabels {
  return analyticsDictionaries[resolveAnalyticsDictionaryLocale(locale)]
}

export type CreateAnalyticsI18nOptions = {
  timeZone?: string
}

export function createAnalyticsI18n(
  locale = 'zh-CN',
  options: CreateAnalyticsI18nOptions = {}
): AnalyticsI18n {
  const dictionaryLocale = resolveAnalyticsDictionaryLocale(locale)
  const labels = analyticsDictionaries[dictionaryLocale]
  const direction = analyticsLocaleDirection(locale)
  const formatters = createAnalyticsFormatters(locale, {
    timeZone: options.timeZone,
    tokenUnit: labels.common.tokenUnit,
    unknownLabel: labels.common.unknown
  })
  return { locale: formatters.locale, dictionaryLocale, direction, labels, formatters }
}
