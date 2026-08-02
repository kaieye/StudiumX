/**
 * Web adapter feature module - Learning Analytics (plan §8 Phase 4, §7.1, §9.4).
 *
 * Implements `getLearningAnalytics` and `exportLearningAnalytics` over the
 * StudiumX-Server analytics endpoint (server-contracts.md §2):
 *
 *   GET /analytics/summary?range=<key>   -> { summary: AnalyticsSummaryRow } | 404
 *
 * The server always stores headline per-range totals (focusSeconds,
 * plannedFocusSeconds, completedFocusSessions, period dates), uploaded via PUT
 * only after the user enables analytics sync. Newer desktop clients may also
 * send a strict v1, chart-ready aggregate for focus/task visualizations. The
 * payload deliberately excludes raw activity facts, task labels, teaching
 * evidence, and workspace/conversation/review/memory content; it never becomes
 * teaching authority. Legacy rows without that payload remain `partial` focus
 * summaries, while valid v1 payloads restore the supported focus/task charts.
 * All other analytics sections remain `unavailable` on Web because the server
 * does not own those source data.
 *
 * When no summary is stored (HTTP 404) the adapter returns an `empty` bundle
 * (hero.state === 'empty') so the view can render a clear empty state WITHOUT
 * auto-uploading derived summaries (plan §9.4 red line - never PUT from Web).
 *
 `exportLearningAnalytics` becomes a client-side Blob download (porting-features
 * §0 web note): it fetches the same summary, serializes to JSON/CSV, triggers a
 * browser download, and synthesizes `bytesWritten`/`fileName` (no path semantics).
 */

import type {
  AnalyticsCoverage,
  AnalyticsExportManifest,
  AnalyticsHourBuckets,
  AnalyticsInstant,
  AnalyticsLevelProgress,
  AnalyticsLocalDate,
  AnalyticsRetentionCoverage,
  AnalyticsSectionResult,
  AnalyticsTemporalBasis,
  AnalyticsUnavailableReason,
  AnalyticsWarning,
  FocusAnalytics,
  InsightsAnalytics,
  LearningAnalyticsBundle,
  LearningAnalyticsHero,
  LearningAnalyticsQuery,
  LearningAnalyticsRequest,
  MemoryAnalytics,
  PlatformAnalytics,
  PresenceSnapshotAnalytics,
  ReviewAnalytics,
  TaskAnalytics,
  TokenAnalytics,
  WorkspaceAssetsAnalytics
} from '@shared/teaching-types/analytics'
import type { TeachingSystemApi } from '@shared/teaching-types/system-api'
import { calculateStudyLevelProgress, dailyXpSummary, studyPlantStageForLevel } from '@shared/study-progression'
import { apiGet, ApiError } from '../../api/http'
import { hydratedSyncedTasks, parseSyncedAnalyticsVisualizations } from '../analytics-payload'

/** Server `AnalyticsSummaryRow` (server-contracts.md §2, `toRow`). */
interface AnalyticsSummaryRow {
  id: string
  userId: string
  rangeKey: string
  focusSeconds: number
  plannedFocusSeconds: number
  completedFocusSessions: number
  payload: unknown
  periodStartDate: AnalyticsLocalDate
  periodEndDate: AnalyticsLocalDate
  updatedAtMs: number
  createdAt: number | null
}

/** Server range keys (fixed set, ANALYTICS_RANGE_KEYS). */
type ServerRangeKey = 'today' | 'sevenDays' | 'thirtyDays' | 'ninetyDays' | 'allTime'

const EMPTY_WARNINGS: AnalyticsWarning[] = []

/** Map the client range preset to the server range key. `custom` has no server
 *  equivalent and falls back to a 30-day window. */
function serverRangeKey(preset: LearningAnalyticsQuery['range']['preset']): ServerRangeKey {
  switch (preset) {
    case 'today':
      return 'today'
    case 'week':
      return 'sevenDays'
    case 'month':
      return 'thirtyDays'
    case 'all':
      return 'allTime'
    case 'custom':
    default:
      return 'thirtyDays'
  }
}

function nowInstant(): AnalyticsInstant {
  return new Date().toISOString()
}

function asInstant(ms: number): AnalyticsInstant {
  return new Date(ms).toISOString()
}

/** Parse a `YYYY-MM-DD` local date into year/month/day parts. */
function localDateParts(date: AnalyticsLocalDate): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function formatLocalDate(y: number, m: number, d: number): AnalyticsLocalDate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Shift a `YYYY-MM-DD` local date by `deltaDays` using local-calendar arithmetic. */
function shiftLocalDate(date: AnalyticsLocalDate, deltaDays: number): AnalyticsLocalDate {
  const parts = localDateParts(date)
  if (!parts) return date
  const d = new Date(parts.y, parts.m - 1, parts.d)
  d.setDate(d.getDate() + deltaDays)
  return formatLocalDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** Human focus duration: hours + minutes, or minutes/seconds for small values. */
function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours >= 1) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  if (minutes >= 1) return `${minutes} 分钟`
  return `${safe} 秒`
}

function retentionFor(localToday: AnalyticsLocalDate): AnalyticsRetentionCoverage {
  return {
    policy: 'rolling_local_days',
    days: 400,
    includesToday: true,
    cutoffDate: shiftLocalDate(localToday, -400)
  }
}

function emptyCoverage(query: LearningAnalyticsQuery): AnalyticsCoverage {
  return {
    rangeApplied: false,
    requestedRange: query.range,
    effectiveRange: null,
    trackingStartedOn: null,
    dataStartDate: null,
    dataEndDate: null,
    retention: retentionFor(query.calendarContext.localToday),
    complete: false,
    sources: []
  }
}

function summaryCoverage(query: LearningAnalyticsQuery, row: AnalyticsSummaryRow): AnalyticsCoverage {
  return {
    rangeApplied: true,
    requestedRange: query.range,
    effectiveRange: query.range,
    trackingStartedOn: null,
    dataStartDate: row.periodStartDate,
    dataEndDate: row.periodEndDate,
    retention: retentionFor(query.calendarContext.localToday),
    complete: true,
    sources: [
      {
        source: 'study_daily_projection',
        state: 'complete',
        scanned: 1,
        included: 1,
        missing: 0,
        rejected: 0,
        earliestLocalDate: row.periodStartDate,
        latestLocalDate: row.periodEndDate
      }
    ]
  }
}

function rangeTemporal(query: LearningAnalyticsQuery): AnalyticsTemporalBasis {
  return { kind: 'range', range: query.range }
}

function asOfTemporal(asOf: AnalyticsInstant): AnalyticsTemporalBasis {
  return { kind: 'as_of', asOf, rangeInvariant: true }
}

/** Build an `unavailable` section result. The server has no source data for
 *  teaching-scope sections on Web, so they are honestly reported unavailable. */
function unavailableSection<T>(
  query: LearningAnalyticsQuery,
  reason: AnalyticsUnavailableReason,
  asOf: AnalyticsInstant
): AnalyticsSectionResult<T> {
  return {
    state: 'unavailable',
    temporal: asOfTemporal(asOf),
    coverage: emptyCoverage(query),
    warnings: EMPTY_WARNINGS,
    reason
  }
}

function levelProgress(xp: number): AnalyticsLevelProgress {
  return calculateStudyLevelProgress(xp)
}

function zeroHourBuckets(): AnalyticsHourBuckets {
  return Array.from({ length: 24 }, () => 0) as unknown as AnalyticsHourBuckets
}

function buildInsightLine(
  focus: number,
  planned: number,
  sessions: number,
  rate: number | null
): string {
  if (focus <= 0 && sessions <= 0) return '本周期暂无专注记录。'
  const parts: string[] = [`本周期专注 ${formatDuration(focus)}`]
  if (sessions > 0) parts.push(`完成 ${sessions} 次专注会话`)
  if (planned > 0 && rate !== null) parts.push(`计划完成率 ${Math.round(rate * 100)}%`)
  return `${parts.join('，')}。`
}

/** Bundle returned when no summary is stored (HTTP 404): hero is `empty`, every
 *  other section is `unavailable`. The view renders the empty state from this. */
function emptyBundle(request: LearningAnalyticsRequest, asOf: AnalyticsInstant): LearningAnalyticsBundle {
  const query = request.query
  const heroData: LearningAnalyticsHero = {
    focusSeconds: 0,
    completedFocusSessions: 0,
    currentStreakDays: 0,
    currentXp: 0,
    currentLevel: levelProgress(0),
    totalTokens: 0,
    currentTaskCompletionRate: null,
    insightLine: '暂无学习分析数据。'
  }
  return {
    contractVersion: 1,
    generatedAt: asOf,
    query,
    hero: {
      state: 'empty',
      temporal: rangeTemporal(query),
      coverage: emptyCoverage(query),
      warnings: EMPTY_WARNINGS,
      data: heroData,
      reason: 'no_activity'
    },
    focus: unavailableSection<FocusAnalytics>(query, 'unsupported', asOf),
    tasks: unavailableSection<TaskAnalytics>(query, 'unsupported', asOf),
    tokens: unavailableSection<TokenAnalytics>(query, 'unsupported', asOf),
    workspaceAssets: unavailableSection<WorkspaceAssetsAnalytics>(query, 'unsupported', asOf),
    review: unavailableSection<ReviewAnalytics>(query, 'unsupported', asOf),
    memory: unavailableSection<MemoryAnalytics>(query, 'unsupported', asOf),
    platform: unavailableSection<PlatformAnalytics>(query, 'unsupported', asOf),
    presence: unavailableSection<PresenceSnapshotAnalytics>(query, 'not_applicable', asOf),
    insights: unavailableSection<InsightsAnalytics>(query, 'unsupported', asOf)
  }
}

/** Bundle built from a stored aggregate summary row. Older desktop uploads expose
 * only focus totals; v1 consented chart payloads also restore focus and
 * aggregate task visualizations without making the server a teaching authority. */
function populatedBundle(
  request: LearningAnalyticsRequest,
  row: AnalyticsSummaryRow
): LearningAnalyticsBundle {
  const query = request.query
  const asOf = asInstant(row.updatedAtMs)
  const focusSeconds = Math.max(0, row.focusSeconds)
  const planned = Math.max(0, row.plannedFocusSeconds)
  const sessions = Math.max(0, row.completedFocusSessions)
  const visuals = parseSyncedAnalyticsVisualizations(row.payload)
  const xp = request.personalStudy?.current.xp ?? visuals?.focus.currentGrowth.xp ?? 0
  const streak = request.personalStudy?.current.streakDays ?? visuals?.focus.currentGrowth.streakDays ?? 0
  const syncedTasks = visuals?.tasks ? hydratedSyncedTasks(visuals.tasks) : null
  const completionRate = planned > 0 ? focusSeconds / planned : null
  const coverage = summaryCoverage(query, row)

  const heroData: LearningAnalyticsHero = {
    focusSeconds,
    completedFocusSessions: sessions,
    currentStreakDays: streak,
    currentXp: xp,
    currentLevel: levelProgress(xp),
    totalTokens: 0,
    currentTaskCompletionRate: syncedTasks?.current.completionRate ?? null,
    insightLine: buildInsightLine(focusSeconds, planned, sessions, completionRate)
  }

  const focusData: FocusAnalytics = {
    daily: visuals?.focus.daily ?? [],
    heatmap: visuals?.focus.heatmap ?? [],
    trend: visuals?.focus.trend ?? [],
    hourBuckets: visuals?.focus.hourBuckets ?? zeroHourBuckets(),
    activeRanges: visuals?.focus.activeRanges ?? {
      mode: 'day_of_range',
      categories: [],
      ranges: [],
      yMax: 24,
      yUnit: 'hour'
    },
    sessionStructure: visuals?.focus.sessionStructure ?? {
      focusSeconds,
      breakSeconds: 0,
      completed: sessions,
      interrupted: 0,
      canceled: 0,
      averageCompletedFocusSeconds: sessions > 0 ? focusSeconds / sessions : null,
      completionRate
    },
    currentGrowth: visuals?.focus.currentGrowth ?? {
      xp,
      level: levelProgress(xp),
      streakDays: streak,
      badges: [],
      plantStage: studyPlantStageForLevel(levelProgress(xp).level),
      dailyXp: dailyXpSummary(request.personalStudy?.current.dailyXpProgress, query.calendarContext.localToday)
    }
  }

  return {
    contractVersion: 1,
    generatedAt: asOf,
    query,
    hero: {
      state: 'available',
      temporal: {
        kind: 'mixed',
        range: query.range,
        asOf,
        rangeFields: ['focusSeconds', 'completedFocusSessions', 'totalTokens'],
        rangeInvariantFields: ['currentStreakDays', 'currentXp', 'currentLevel', 'currentTaskCompletionRate']
      },
      coverage,
      warnings: EMPTY_WARNINGS,
      data: heroData
    },
    focus: {
      state: visuals ? 'available' : 'partial',
      temporal: rangeTemporal(query),
      coverage,
      warnings: EMPTY_WARNINGS,
      data: focusData
    },
    tasks: syncedTasks
      ? {
          state: 'available',
          temporal: {
            kind: 'mixed',
            range: query.range,
            asOf,
            rangeFields: ['flow', 'plan', 'topByAttributedFocus', 'byCategoryFocus', 'topByCompletion', 'byCategoryCompletion', 'unattributedFocusSeconds'],
            rangeInvariantFields: ['current']
          },
          coverage,
          warnings: EMPTY_WARNINGS,
          data: syncedTasks
        }
      : unavailableSection<TaskAnalytics>(query, 'unsupported', asOf),
    tokens: unavailableSection<TokenAnalytics>(query, 'unsupported', asOf),
    workspaceAssets: unavailableSection<WorkspaceAssetsAnalytics>(query, 'unsupported', asOf),
    review: unavailableSection<ReviewAnalytics>(query, 'unsupported', asOf),
    memory: unavailableSection<MemoryAnalytics>(query, 'unsupported', asOf),
    platform: unavailableSection<PlatformAnalytics>(query, 'unsupported', asOf),
    presence: unavailableSection<PresenceSnapshotAnalytics>(query, 'not_applicable', asOf),
    insights: unavailableSection<InsightsAnalytics>(query, 'unsupported', asOf)
  }
}

/** Fetch the stored summary for the requested range. Returns `null` when the
 *  server has no summary (HTTP 404); rethrows all other errors (auth/network/5xx). */
async function fetchSummaryRow(query: LearningAnalyticsQuery): Promise<AnalyticsSummaryRow | null> {
  const range = serverRangeKey(query.range.preset)
  try {
    const res = await apiGet<{ summary: AnalyticsSummaryRow }>('/analytics/summary', { range })
    return res.summary
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** Trigger a browser download for `content` and return the byte count. */
function downloadBlob(fileName: string, content: string, mime: string): number {
  if (typeof document === 'undefined') return 0
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  return blob.size
}

function dateStamp(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

function summaryToCsv(row: AnalyticsSummaryRow | null): string {
  const header =
    'rangeKey,periodStart,periodEnd,focusSeconds,plannedFocusSeconds,completedFocusSessions,completionRate'
  if (!row) return header
  const rate = row.plannedFocusSeconds > 0 ? (row.focusSeconds / row.plannedFocusSeconds).toFixed(3) : ''
  const line = [
    row.rangeKey,
    row.periodStartDate,
    row.periodEndDate,
    row.focusSeconds,
    row.plannedFocusSeconds,
    row.completedFocusSessions,
    rate
  ].join(',')
  return `${header}\n${line}`
}

function summaryToJson(row: AnalyticsSummaryRow | null, query: LearningAnalyticsQuery): string {
  return JSON.stringify({ generatedAt: nowInstant(), query, summary: row }, null, 2)
}

export const feature: Partial<TeachingSystemApi> = {
  async getLearningAnalytics(request: LearningAnalyticsRequest): Promise<LearningAnalyticsBundle> {
    const row = await fetchSummaryRow(request.query)
    if (!row) return emptyBundle(request, nowInstant())
    return populatedBundle(request, row)
  },

  async exportLearningAnalytics(request) {
    const row = await fetchSummaryRow(request.query)
    const asOf = nowInstant()
    const rangeKey = serverRangeKey(request.query.range.preset)
    const ext = request.format === 'csv' ? 'csv' : 'json'
    const fileName = `studiumx-analytics-${rangeKey}-${dateStamp(new Date())}.${ext}`
    const manifest: AnalyticsExportManifest = {
      contractVersion: 1,
      generatedAt: asOf,
      format: request.format,
      detail: request.detail,
      includedSections: request.sectionIds,
      excludedSensitiveFields: [
        'conversation_content',
        'mission_content',
        'memory_content',
        'tool_arguments',
        'tool_results',
        'absolute_paths',
        'api_keys',
        'secret_endpoints'
      ]
    }
    if (typeof document === 'undefined') {
      return { canceled: true }
    }
    const content =
      request.format === 'csv' ? summaryToCsv(row) : summaryToJson(row, request.query)
    const bytesWritten = downloadBlob(
      fileName,
      content,
      request.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json'
    )
    return { canceled: false, fileName, bytesWritten, manifest }
  }
}
