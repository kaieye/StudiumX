/**
 * Pure task-detail stats model (STC-304).
 *
 * Shows estimate, planned focus, actual focus, and future/history/current blocks.
 * No I/O. Does not invent estimate from plan minutes (freeze #8).
 */
import type { ScheduleBlock, TimerSessionRecord } from '../../../shared/study-planning'
import {
  formatBlockTimeRange,
  listTaskBlockEditorRows,
  type TaskBlockEditorRow
} from './planning-multi-block-editor'
import { scheduleBlockToV1Schedule } from './planning-hydrate'

export type TaskDetailBlockBucket = 'current' | 'future' | 'history'

export type TaskDetailBlockRow = {
  blockId: string
  bucket: TaskDetailBlockBucket
  kind: ScheduleBlock['kind']
  status: ScheduleBlock['status']
  locked: boolean
  startAtMs: number
  endAtMs: number
  durationMinutes: number
  /** Mon-first V1 range label when projectable; else wall-clock fallback. */
  label: string
  isPrimary: boolean
}

export type TaskDetailStatsModel = {
  taskId: string
  estimateMinutes: number | null
  /** Display minutes (floor); null estimate → null. */
  remainingEstimateMinutes: number | null
  plannedFocusMinutes: number
  actualFocusMinutes: number
  futureBlocks: TaskDetailBlockRow[]
  historyBlocks: TaskDetailBlockRow[]
  currentBlocks: TaskDetailBlockRow[]
  /** total focus blocks counted (excludes cancelled) */
  focusBlockCount: number
  copy: {
    estimateLabel: string
    estimateEmpty: string
    plannedLabel: string
    actualLabel: string
    futureHeading: string
    historyHeading: string
    currentHeading: string
    emptyBlocks: string
  }
}

export type BuildTaskDetailStatsInput = {
  taskId: string
  scheduleBlocks: readonly ScheduleBlock[]
  /** Completed / historical TimerSession rows (optional; missing → actual 0). */
  timerSessions?: readonly TimerSessionRecord[] | null
  /**
   * Explicit estimate from PlanningTask / host cache.
   * null / undefined = unset (freeze #8 — never invent from plan).
   */
  estimateMinutes?: number | null
  remainingEstimateMinutes?: number | null
  nowMs?: number
}

function nonNegativeInt(n: unknown): number | null {
  if (n === null || n === undefined) return null
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.max(0, Math.floor(n))
}

function focusSeconds(block: ScheduleBlock): number {
  if (block.kind !== 'focus') return 0
  if (block.status === 'cancelled') return 0
  return Math.max(0, Math.floor((block.endAtMs - block.startAtMs) / 1000))
}

function actualFocusSecondsForTask(
  taskId: string,
  sessions: readonly TimerSessionRecord[]
): number {
  let sum = 0
  for (const s of sessions) {
    if (s.taskId === taskId && s.phase === 'focus') {
      sum += Math.max(0, Math.floor(s.accumulatedFocusSeconds || 0))
    }
  }
  return sum
}

function wallClockLabel(startAtMs: number, endAtMs: number): string {
  const s = new Date(startAtMs)
  const e = new Date(endAtMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${s.getMonth() + 1}/${s.getDate()}`
  return `${day} ${pad(s.getHours())}:${pad(s.getMinutes())}-${pad(e.getHours())}:${pad(e.getMinutes())}`
}

function bucketForBlock(
  block: ScheduleBlock,
  nowMs: number
): TaskDetailBlockBucket {
  if (block.startAtMs <= nowMs && nowMs < block.endAtMs) return 'current'
  if (block.endAtMs > nowMs) return 'future'
  return 'history'
}

function toDetailRow(
  block: ScheduleBlock,
  primaryId: string | null,
  nowMs: number
): TaskDetailBlockRow {
  const schedule = scheduleBlockToV1Schedule(block)
  const editorLike: Pick<TaskBlockEditorRow, 'weekday' | 'startMinutes' | 'endMinutes'> | null =
    schedule
      ? {
          weekday: schedule.weekday,
          startMinutes: schedule.startMinutes,
          endMinutes: schedule.endMinutes
        }
      : null
  const label = editorLike
    ? formatBlockTimeRange(editorLike)
    : wallClockLabel(block.startAtMs, block.endAtMs)
  return {
    blockId: block.id,
    bucket: bucketForBlock(block, nowMs),
    kind: block.kind,
    status: block.status,
    locked: block.locked,
    startAtMs: block.startAtMs,
    endAtMs: block.endAtMs,
    durationMinutes: Math.max(1, Math.round(focusSeconds(block) / 60) || Math.round((block.endAtMs - block.startAtMs) / 60_000)),
    label,
    isPrimary: primaryId != null && block.id === primaryId
  }
}

/**
 * Build task-detail stats for editor / detail panel.
 * Includes cancelled=false blocks only for counts; cancelled still listed under history for review.
 */
export function buildTaskDetailStatsModel(
  input: BuildTaskDetailStatsInput
): TaskDetailStatsModel {
  const nowMs = input.nowMs ?? Date.now()
  const sessions = input.timerSessions ?? []
  const estimateMinutes = nonNegativeInt(input.estimateMinutes)
  const remainingEstimateMinutes =
    input.remainingEstimateMinutes === undefined
      ? estimateMinutes
      : nonNegativeInt(input.remainingEstimateMinutes)

  const taskBlocks = input.scheduleBlocks
    .filter((b) => b.taskId === input.taskId)
    .slice()
    .sort((a, b) => a.startAtMs - b.startAtMs)

  const editorRows = listTaskBlockEditorRows({
    taskId: input.taskId,
    scheduleBlocks: input.scheduleBlocks,
    nowMs
  })
  const primaryId = editorRows.find((r) => r.isPrimary)?.blockId ?? null

  const plannedFocusSeconds = taskBlocks.reduce((acc, b) => acc + focusSeconds(b), 0)
  const actualFocusSeconds = actualFocusSecondsForTask(input.taskId, sessions)

  const futureBlocks: TaskDetailBlockRow[] = []
  const historyBlocks: TaskDetailBlockRow[] = []
  const currentBlocks: TaskDetailBlockRow[] = []

  for (const block of taskBlocks) {
    if (block.status === 'cancelled') {
      // Keep cancelled only in history for freeze #7 review.
      const row = toDetailRow(block, primaryId, nowMs)
      historyBlocks.push({ ...row, bucket: 'history' })
      continue
    }
    const row = toDetailRow(block, primaryId, nowMs)
    if (row.bucket === 'current') currentBlocks.push(row)
    else if (row.bucket === 'future') futureBlocks.push(row)
    else historyBlocks.push(row)
  }

  const focusBlockCount = taskBlocks.filter(
    (b) => b.kind === 'focus' && b.status !== 'cancelled'
  ).length

  return {
    taskId: input.taskId,
    estimateMinutes,
    remainingEstimateMinutes,
    plannedFocusMinutes: Math.round(plannedFocusSeconds / 60),
    actualFocusMinutes: Math.round(actualFocusSeconds / 60),
    futureBlocks,
    historyBlocks,
    currentBlocks,
    focusBlockCount,
    copy: {
      estimateLabel: '估时',
      estimateEmpty: '未设置',
      plannedLabel: '计划专注',
      actualLabel: '实际专注',
      futureHeading: '未来时间块',
      historyHeading: '历史时间块',
      currentHeading: '进行中',
      emptyBlocks: '暂无时间块'
    }
  }
}

/**
 * Normalize estimate minutes from editor input (empty → null; clamp 0..24h).
 * Never invents a default from focus plan.
 */
export function normalizeEstimateMinutesInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return null
    const n = Number(t)
    if (!Number.isFinite(n)) return null
    return Math.max(0, Math.min(24 * 60, Math.floor(n)))
  }
  if (!Number.isFinite(raw)) return null
  return Math.max(0, Math.min(24 * 60, Math.floor(raw)))
}

/**
 * Format minutes for compact detail chips (e.g. 90 → "1h30m", 45 → "45m").
 */
export function formatDetailMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—'
  const m = Math.max(0, Math.floor(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h${rem}m`
}
