/**
 * STC-703 pure presenters for recurrence series edit UI.
 *
 * Calendar-ish date-grouped preview rows + series sheet copy.
 * Never writes store, never clones Task, never auto-expands.
 */
import type { ExpandRecurrenceResult, RecurrenceRule, ScheduleBlock } from '../../../shared/study-planning'
import {
  defaultWeekExpandWindow,
  formatMinutesLabel,
  localMinutesFromEpoch,
  localMonFirstWeekdayFromEpoch,
  previewRecurrenceExpand,
  type RecurrenceExpandPreviewModel,
  type RecurrenceExpandWindow,
  type RecurrenceRuleFormDraft
} from './planning-recurrence-expand'

const DAY_MS = 24 * 60 * 60_000

const MON_FIRST_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
const MONTH_DAY_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric'
})

export type RecurrenceSeriesWindowPreset = 'week' | 'two_weeks' | 'four_weeks'

export type RecurrenceSeriesPreviewRow = {
  key: string
  blockId: string
  startAtMs: number
  endAtMs: number
  dateLabel: string
  weekdayLabel: string
  timeLabel: string
  status: 'new'
  badgeLabel: string
}

export type RecurrenceSeriesPreviewDayGroup = {
  key: string
  dayStartMs: number
  dateLabel: string
  weekdayLabel: string
  rows: RecurrenceSeriesPreviewRow[]
}

export type RecurrenceSeriesPreviewModel = {
  preview: RecurrenceExpandPreviewModel
  groups: RecurrenceSeriesPreviewDayGroup[]
  rows: RecurrenceSeriesPreviewRow[]
  canConfirm: boolean
  summaryLine: string
  warnings: string[]
  lockedOverlapCount: number
  skippedExistingCount: number
  copy: {
    title: string
    description: string
    confirmLabel: string
    cancelLabel: string
    emptyLabel: string
    warningsTitle: string
    lockedNote: string
    noCloneNote: string
  }
}

export type RecurrenceSeriesEditSheetCopy = {
  title: string
  description: string
  saveLabel: string
  savedLabel: string
  savingLabel: string
  previewLabel: string
  confirmExpandLabel: string
  deleteRuleLabel: string
  deleteConfirmTitle: string
  deleteConfirmBody: string
  deleteConfirmYes: string
  deleteConfirmNo: string
  closeLabel: string
  windowLabel: string
  windowWeek: string
  windowTwoWeeks: string
  windowFourWeeks: string
  untilLabel: string
  countLabel: string
  untilNone: string
  countNone: string
  noRuleHint: string
  hasRuleHint: string
}

/**
 * Materialization window from week anchor + preset length.
 * [anchor, anchor + n*7d). Does not auto-expand.
 */
export function expandWindowForPreset(
  weekAnchorMidnightMs: number,
  preset: RecurrenceSeriesWindowPreset = 'week'
): RecurrenceExpandWindow {
  const weeks = preset === 'four_weeks' ? 4 : preset === 'two_weeks' ? 2 : 1
  if (weeks === 1) return defaultWeekExpandWindow(weekAnchorMidnightMs)
  return {
    windowStartMs: weekAnchorMidnightMs,
    windowEndMs: weekAnchorMidnightMs + weeks * 7 * DAY_MS
  }
}

/**
 * Local midnight for a wall-clock epoch (preview grouping only).
 */
export function localDayStartMs(epochMs: number): number {
  const d = new Date(epochMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function formatLocalDateLabel(epochMs: number): string {
  return MONTH_DAY_FMT.format(new Date(epochMs))
}

export function formatLocalWeekdayLabel(epochMs: number): string {
  const mon = localMonFirstWeekdayFromEpoch(epochMs)
  return MON_FIRST_LABELS[mon] ?? '日'
}

export function formatLocalTimeRangeLabel(startAtMs: number, endAtMs: number): string {
  return `${formatMinutesLabel(localMinutesFromEpoch(startAtMs))}–${formatMinutesLabel(localMinutesFromEpoch(endAtMs))}`
}

/**
 * Date-grouped calendar-ish list from expand applyBlocks.
 * Pure; locked skips stay in preview.warnings only (not rows).
 */
export function groupRecurrencePreviewBlocks(
  blocks: readonly ScheduleBlock[]
): RecurrenceSeriesPreviewDayGroup[] {
  const byDay = new Map<number, RecurrenceSeriesPreviewRow[]>()
  for (const block of blocks) {
    if (!Number.isFinite(block.startAtMs) || !Number.isFinite(block.endAtMs)) continue
    const dayStart = localDayStartMs(block.startAtMs)
    const row: RecurrenceSeriesPreviewRow = {
      key: block.id,
      blockId: block.id,
      startAtMs: block.startAtMs,
      endAtMs: block.endAtMs,
      dateLabel: formatLocalDateLabel(block.startAtMs),
      weekdayLabel: formatLocalWeekdayLabel(block.startAtMs),
      timeLabel: formatLocalTimeRangeLabel(block.startAtMs, block.endAtMs),
      status: 'new',
      badgeLabel: '新增'
    }
    const list = byDay.get(dayStart)
    if (list) list.push(row)
    else byDay.set(dayStart, [row])
  }

  const groups: RecurrenceSeriesPreviewDayGroup[] = []
  const dayStarts = [...byDay.keys()].sort((a, b) => a - b)
  for (const dayStart of dayStarts) {
    const rows = (byDay.get(dayStart) ?? []).slice().sort((a, b) => a.startAtMs - b.startAtMs)
    groups.push({
      key: `day:${dayStart}`,
      dayStartMs: dayStart,
      dateLabel: formatLocalDateLabel(dayStart),
      weekdayLabel: formatLocalWeekdayLabel(dayStart),
      rows
    })
  }
  return groups
}

/**
 * Full series preview model: dry-run expand + date groups + copy.
 * Never writes; never invents Task.
 */
export function buildRecurrenceSeriesPreviewModel(input: {
  draft: RecurrenceRuleFormDraft
  existingBlocks?: readonly ScheduleBlock[] | null
  window: RecurrenceExpandWindow
}): RecurrenceSeriesPreviewModel {
  const preview = previewRecurrenceExpand({
    draft: input.draft,
    existingBlocks: input.existingBlocks ?? [],
    window: input.window
  })
  const groups = groupRecurrencePreviewBlocks(preview.applyBlocks)
  const rows = groups.flatMap((g) => g.rows)
  const lockedOverlapCount = preview.result.skippedLockedOverlap
  const skippedExistingCount = preview.result.skippedExisting
  const n = preview.applyBlocks.length
  return {
    preview,
    groups,
    rows,
    canConfirm: preview.canConfirm,
    summaryLine: preview.summaryLine,
    warnings: preview.warnings,
    lockedOverlapCount,
    skippedExistingCount,
    copy: {
      title: '系列展开预览',
      description:
        '确认后仅写入时间块，不会复制任务。已存在槽位与锁定冲突自动跳过，不会移动锁定块。',
      confirmLabel: n > 0 ? `确认展开 ${n} 条` : '确认展开',
      cancelLabel: '关闭预览',
      emptyLabel: '本窗口没有可展开的时间块',
      warningsTitle: '提示',
      lockedNote:
        lockedOverlapCount > 0
          ? `锁定冲突已跳过 ${lockedOverlapCount} 处（锁定块不会被覆盖或移动）`
          : '锁定块不会被覆盖',
      noCloneNote: '不会静默克隆任务实体'
    }
  }
}

/**
 * Presenter for locked-overlap fail-closed messaging (product signal).
 */
export function formatLockedOverlapSummary(result: ExpandRecurrenceResult): string | null {
  if (result.skippedLockedOverlap <= 0) return null
  return `锁定冲突跳过 ${result.skippedLockedOverlap} 处（不移动锁定块）`
}

/**
 * Series sheet chrome copy (zh).
 */
export function buildRecurrenceSeriesEditSheetCopy(input: {
  taskTitle?: string | null
  hasRule: boolean
}): RecurrenceSeriesEditSheetCopy {
  const titleBit = (input.taskTitle ?? '').trim()
  return {
    title: titleBit ? `重复系列 · ${titleBit}` : '重复系列',
    description: input.hasRule
      ? '编辑规则、预览窗口内实例，再显式保存或展开。删除规则不会清除历史计时会话。'
      : '为此任务创建重复规则。保存规则与展开时间块分开操作；默认不会自动展开。',
    saveLabel: '保存规则',
    savedLabel: '已保存',
    savingLabel: '保存中…',
    previewLabel: '预览展开',
    confirmExpandLabel: '确认展开',
    deleteRuleLabel: '删除规则',
    deleteConfirmTitle: '删除重复规则？',
    deleteConfirmBody: '仅移除规则偏好；已写入的时间块与历史计时会话不会被删除。',
    deleteConfirmYes: '确认删除',
    deleteConfirmNo: '取消',
    closeLabel: '关闭',
    windowLabel: '预览窗口',
    windowWeek: '本周',
    windowTwoWeeks: '两周',
    windowFourWeeks: '四周',
    untilLabel: '截止日（可选）',
    countLabel: '次数上限（可选）',
    untilNone: '无截止',
    countNone: '不限次数',
    noRuleHint: '尚未保存规则',
    hasRuleHint: '已绑定规则'
  }
}

/**
 * Parse optional positive count from form text. Empty → null; invalid → null.
 */
export function parseOptionalPositiveCount(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.trunc(n)
}

/**
 * Parse optional until date input (YYYY-MM-DD local midnight). Empty → null.
 */
export function parseOptionalUntilDateInput(
  raw: string | null | undefined,
  dtStartMs: number
): number | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return null
  const y = Number.parseInt(match[1]!, 10)
  const m = Number.parseInt(match[2]!, 10)
  const d = Number.parseInt(match[3]!, 10)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const until = new Date(y, m - 1, d).getTime()
  if (!Number.isFinite(until) || until <= dtStartMs) return null
  return until
}

/**
 * Format untilMs as YYYY-MM-DD for date input (local).
 */
export function formatUntilDateInputValue(untilMs: number | null | undefined): string {
  if (untilMs == null || !Number.isFinite(untilMs)) return ''
  const d = new Date(untilMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Draft list after explicit delete (prefs dual-write surface). Pure.
 */
export function nextRulesAfterDelete(
  rules: readonly RecurrenceRule[] | null | undefined,
  ruleId: string
): RecurrenceRule[] {
  const id = ruleId.trim()
  if (!id) return rules ? [...rules] : []
  return (rules ?? []).filter((r) => r.id !== id)
}

export type { RecurrenceExpandPreviewModel, RecurrenceExpandWindow, RecurrenceRuleFormDraft }
