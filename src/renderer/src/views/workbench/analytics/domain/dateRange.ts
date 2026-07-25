import type {
  AnalyticsDateRange,
  AnalyticsLocalDate,
  AnalyticsRangePreset
} from '../../../../../../shared/teaching-types/analytics'

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const formatterCache = new Map<string, Intl.DateTimeFormat>()

export type LocalCalendarParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn-hc-h23', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })
  formatterCache.set(timeZone, formatter)
  return formatter
}

function utcDateFromParts(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date
}

export function getLocalCalendarParts(input: Date | number, timeZone?: string): LocalCalendarParts {
  const date = input instanceof Date ? input : new Date(input)
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid instant')
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds()
    }
  }
  const parts = formatterFor(timeZone).formatToParts(input)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value
    if (value === undefined) throw new RangeError(`Unable to resolve ${type} in ${timeZone}`)
    return Number(value)
  }
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second')
  }
}

function parseLocalDate(date: AnalyticsLocalDate): { year: number; month: number; day: number } {
  const match = LOCAL_DATE_PATTERN.exec(date)
  if (!match) throw new RangeError(`Invalid local date: ${date}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const normalized = utcDateFromParts(year, month, day)
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid local date: ${date}`)
  }
  return { year, month, day }
}

function formatDateParts(year: number, month: number, day: number): AnalyticsLocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Gregorian local date for an instant. Omitting timeZone uses the device calendar directly. */
export function getLocalDateKey(input: Date | number = new Date(), timeZone?: string): AnalyticsLocalDate {
  const date = input instanceof Date ? input : new Date(input)
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid instant')
  if (timeZone) {
    const parts = getLocalCalendarParts(date, timeZone)
    return formatDateParts(parts.year, parts.month, parts.day)
  }
  return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function getLocalTimezoneOffsetMinutes(input: Date | number, timeZone?: string): number {
  const date = input instanceof Date ? input : new Date(input)
  if (!timeZone) return date.getTimezoneOffset()
  const parts = getLocalCalendarParts(date, timeZone)
  const representedAsUtc = utcDateFromParts(parts.year, parts.month, parts.day)
  representedAsUtc.setUTCHours(parts.hour, parts.minute, parts.second, 0)
  return Math.round((date.getTime() - representedAsUtc.getTime()) / 60_000)
}

export function addLocalDays(date: AnalyticsLocalDate, amount: number): AnalyticsLocalDate {
  const { year, month, day } = parseLocalDate(date)
  const value = utcDateFromParts(year, month, day + Math.trunc(amount))
  return formatDateParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
}

export function compareLocalDates(left: AnalyticsLocalDate, right: AnalyticsLocalDate): number {
  parseLocalDate(left)
  parseLocalDate(right)
  return left < right ? -1 : left > right ? 1 : 0
}

export function getMondayWeekStart(date: AnalyticsLocalDate): AnalyticsLocalDate {
  const { year, month, day } = parseLocalDate(date)
  const sundayBased = utcDateFromParts(year, month, day).getUTCDay()
  const mondayBased = (sundayBased + 6) % 7
  return addLocalDays(date, -mondayBased)
}

export function countInclusiveLocalDays(from: AnalyticsLocalDate, to: AnalyticsLocalDate): number {
  const fromParts = parseLocalDate(from)
  const toParts = parseLocalDate(to)
  const fromMs = utcDateFromParts(fromParts.year, fromParts.month, fromParts.day).getTime()
  const toMs = utcDateFromParts(toParts.year, toParts.month, toParts.day).getTime()
  if (toMs < fromMs) throw new RangeError('Inclusive local date range requires from <= to')
  return Math.floor((toMs - fromMs) / 86_400_000) + 1
}

export function createAnalyticsDateRange(
  preset: AnalyticsRangePreset,
  localToday: AnalyticsLocalDate,
  custom?: { from: AnalyticsLocalDate; to: AnalyticsLocalDate }
): AnalyticsDateRange {
  parseLocalDate(localToday)
  let from: AnalyticsLocalDate
  let to = localToday
  switch (preset) {
    case 'today':
      from = localToday
      break
    case 'week':
      // Last 7 inclusive local days ending today (today-6 … today).
      from = addLocalDays(localToday, -6)
      break
    case 'month':
      // Last 30 inclusive local days ending today (today-29 … today).
      from = addLocalDays(localToday, -29)
      break
    case 'all':
      from = '0001-01-01'
      break
    case 'custom':
      if (!custom) throw new RangeError('Custom range requires from and to')
      parseLocalDate(custom.from)
      parseLocalDate(custom.to)
      from = custom.from
      to = custom.to
      if (compareLocalDates(from, to) > 0 || compareLocalDates(to, localToday) > 0) {
        throw new RangeError('Custom range must satisfy from <= to <= localToday')
      }
      break
  }
  return {
    from,
    to,
    preset,
    fromInclusive: true,
    toInclusive: true,
    calendar: 'local_gregorian',
    weekStartsOn: 1
  }
}

export function isLocalDateInRange(date: AnalyticsLocalDate, range: AnalyticsDateRange): boolean {
  return compareLocalDates(date, range.from) >= 0 && compareLocalDates(date, range.to) <= 0
}

function localMidnightInstant(date: AnalyticsLocalDate, timeZone: string): number {
  const { year, month, day } = parseLocalDate(date)
  const desiredWallMs = utcDateFromParts(year, month, day).getTime()
  let instant = desiredWallMs
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const offsetMinutes = getLocalTimezoneOffsetMinutes(instant, timeZone)
    const candidate = desiredWallMs + offsetMinutes * 60_000
    if (candidate === instant) break
    instant = candidate
  }
  return instant
}

/** Absolute bounds for a local date; duration can be 23, 24, or 25 hours across DST. */
export function getLocalDayBounds(date: AnalyticsLocalDate, timeZone: string): {
  startMs: number
  endExclusiveMs: number
} {
  return {
    startMs: localMidnightInstant(date, timeZone),
    endExclusiveMs: localMidnightInstant(addLocalDays(date, 1), timeZone)
  }
}

export function resolvedLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
