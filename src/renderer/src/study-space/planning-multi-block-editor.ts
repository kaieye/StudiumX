/**
 * Pure multi-block task editor model (STC-307 remainder).
 *
 * Lists focus ScheduleBlocks for one task for task-detail UI without cloning Task.
 * No I/O. V1 schedule remains rebuildable primary cache only.
 */
import type { ScheduleBlock } from '../../../shared/study-planning'
import {
  listActiveFocusBlocksForTask,
  type WeekScheduleEntry
} from './planning-schedule-block-adapter'
import { pickPrimaryScheduleBlockForTask, scheduleBlockToV1Schedule } from './planning-hydrate'
import type { StudyTaskSchedule } from './types'

export type TaskBlockEditorRow = {
  blockId: string
  schedule: StudyTaskSchedule
  isPrimary: boolean
  locked: boolean
  status: ScheduleBlock['status']
  source: ScheduleBlock['source']
  /** Wall-clock label for list: "周一 09:00-10:00" style parts left to UI. */
  weekday: number
  startMinutes: number
  endMinutes: number
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

export function formatBlockWeekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? `日${weekday}`
}

export function formatMinutesLabel(minutes: number): string {
  if (minutes >= 24 * 60) return '24:00'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function formatBlockTimeRange(row: Pick<TaskBlockEditorRow, 'weekday' | 'startMinutes' | 'endMinutes'>): string {
  return `${formatBlockWeekdayLabel(row.weekday)} ${formatMinutesLabel(row.startMinutes)}-${formatMinutesLabel(row.endMinutes)}`
}

/**
 * Project active focus blocks for one task into editor rows (projectable to V1 only).
 */
export function listTaskBlockEditorRows(input: {
  taskId: string
  scheduleBlocks: readonly ScheduleBlock[]
  nowMs?: number
}): TaskBlockEditorRow[] {
  const nowMs = input.nowMs ?? Date.now()
  const focus = listActiveFocusBlocksForTask(input.scheduleBlocks, input.taskId)
  const primary = pickPrimaryScheduleBlockForTask(input.scheduleBlocks, input.taskId, nowMs)
  const primaryId = primary?.id ?? null
  const rows: TaskBlockEditorRow[] = []
  for (const block of focus) {
    const schedule = scheduleBlockToV1Schedule(block)
    if (!schedule) continue
    rows.push({
      blockId: block.id,
      schedule,
      isPrimary: block.id === primaryId,
      locked: block.locked,
      status: block.status,
      source: block.source,
      weekday: schedule.weekday,
      startMinutes: schedule.startMinutes,
      endMinutes: schedule.endMinutes
    })
  }
  return rows
}

/**
 * Default schedule for "add another block": same day as primary (or Mon 09-10),
 * shifted +60m when possible without overflowing the day.
 */
export function suggestNextFocusBlockSchedule(
  existing: readonly TaskBlockEditorRow[],
  fallback: StudyTaskSchedule = { weekday: 0, startMinutes: 9 * 60, endMinutes: 10 * 60 }
): StudyTaskSchedule {
  if (existing.length === 0) return { ...fallback }
  const last = existing[existing.length - 1]!
  const duration = Math.max(15, last.endMinutes - last.startMinutes)
  const start = last.endMinutes
  if (start + duration <= 24 * 60) {
    return {
      weekday: last.weekday,
      startMinutes: start,
      endMinutes: start + duration
    }
  }
  // Next weekday if room runs out
  const nextDay = (last.weekday + 1) % 7
  return {
    weekday: nextDay,
    startMinutes: fallback.startMinutes,
    endMinutes: fallback.startMinutes + duration
  }
}

/**
 * Map week chip entry → editor row identity (for opening editor on a specific block).
 */
export function weekEntryToEditorHint(entry: WeekScheduleEntry): {
  taskId: string
  blockId: string
  schedule: StudyTaskSchedule
} {
  return {
    taskId: entry.taskId,
    blockId: entry.blockId,
    schedule: entry.schedule
  }
}
