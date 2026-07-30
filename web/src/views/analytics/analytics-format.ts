/**
 * View-side helpers for the Web analytics dashboard.
 *
 * Pure date/format/query utilities. The adapter (`web/src/adapter/features/
 * analytics.ts`) owns the server->bundle mapping; this module only constructs
 * the `LearningAnalyticsQuery` the view sends and formats values for display.
 */

import type {
  AnalyticsDateRange,
  AnalyticsLocalDate,
  AnalyticsRangePreset,
  LearningAnalyticsQuery
} from '@shared/teaching-types/analytics'

export type { AnalyticsRangePreset }

export interface RangeOption {
  preset: AnalyticsRangePreset
  label: string
}

export const RANGE_OPTIONS: readonly RangeOption[] = [
  { preset: 'today', label: '今日' },
  { preset: 'week', label: '近 7 天' },
  { preset: 'month', label: '近 30 天' },
  { preset: 'all', label: '全部' }
]

function formatLocalDate(y: number, m: number, d: number): AnalyticsLocalDate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Current local date as `YYYY-MM-DD` (the analytics local-calendar key). */
export function todayLocalDate(): AnalyticsLocalDate {
  const d = new Date()
  return formatLocalDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function shiftLocalDate(date: AnalyticsLocalDate, deltaDays: number): AnalyticsLocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  d.setDate(d.getDate() + deltaDays)
  return formatLocalDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

/** `YYYY-MM-DD` -> `M月D日` for compact display. */
export function formatShortDate(date: AnalyticsLocalDate): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  return `${Number(match[2])}月${Number(match[3])}日`
}

/** ISO instant -> `YYYY-MM-DD HH:mm` for the "updated at" stamp. */
export function formatInstant(instant: string): string {
  const d = new Date(instant)
  if (Number.isNaN(d.getTime())) return instant
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Human focus duration: hours + minutes, or minutes/seconds for small values. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
    return '—'
  }
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours >= 1) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  if (minutes >= 1) return `${minutes} 分钟`
  return `${safe} 秒`
}

/** Percent string for a [0,1] ratio (may exceed 100%); `—` when null. */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—'
  return `${Math.round(ratio * 100)}%`
}

/** Build a contract-correct `LearningAnalyticsQuery` for a range preset.
 *
 *  Web has no personal focus facts and no teaching workspaces, so every scope
 *  is `none` (the server returns only uploaded aggregate summaries). */
export function buildAnalyticsQuery(preset: AnalyticsRangePreset): LearningAnalyticsQuery {
  const localToday = todayLocalDate()
  const from =
    preset === 'today'
      ? localToday
      : preset === 'week'
        ? shiftLocalDate(localToday, -6)
        : preset === 'month'
          ? shiftLocalDate(localToday, -29)
          : preset === 'all'
            ? shiftLocalDate(localToday, -365)
            : shiftLocalDate(localToday, -29) // custom -> 30-day default
  const range: AnalyticsDateRange = {
    from,
    to: localToday,
    preset,
    fromInclusive: true,
    toInclusive: true,
    calendar: 'local_gregorian',
    weekStartsOn: 1
  }
  return {
    range,
    scope: {
      personalFocus: { kind: 'none' },
      teaching: { kind: 'none' },
      presence: { kind: 'none' }
    },
    calendarContext: { localToday, timeZone: localTimeZone(), weekStartsOn: 1 }
  }
}
