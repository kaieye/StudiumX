/**
 * ScheduleBlock adapter for week-plan cutover (STC-307).
 *
 * Pure helpers: resolve which block a V1 week-drag updates, project multi-block
 * rows for week UI, and build upsert payloads without cloning Task.
 *
 * V1 StudyTask.schedule remains a rebuildable primary-block cache (not authority).
 * Canonical ScheduleBlock rows are 1:N per task.
 *
 * STC-704: week chips project via splitIntervalAtLocalMidnights (overnight → multi chips).
 */

import type { ScheduleBlock, TimeZoneId } from '../../../shared/study-planning'
import { monFirstScheduleToIntervalMs } from '../../../shared/study-planning'
import {
  pickPrimaryScheduleBlockForTask,
  scheduleBlockToV1Schedule
} from './planning-hydrate'
import {
  formatWeekChipZoneTooltip,
  projectWeekZoneChips,
  weekZoneChipToV1Schedule
} from './planning-week-zone-projection'
import type { StudyTask, StudyTaskCategoryId, StudyTaskSchedule } from './types'

/** Stable dual-write id used when a task has no canonical focus blocks yet. */
export function defaultV1ScheduleBlockId(taskId: string): string {
  return `block:${taskId}:v1`
}

/**
 * Active (non-cancelled) focus blocks for a task, sorted by start.
 */
export function listActiveFocusBlocksForTask(
  blocks: readonly ScheduleBlock[],
  taskId: string
): ScheduleBlock[] {
  return blocks
    .filter((b) => b.taskId === taskId && b.kind === 'focus' && b.status !== 'cancelled')
    .slice()
    .sort((a, b) => a.startAtMs - b.startAtMs || a.endAtMs - b.endAtMs || a.id.localeCompare(b.id))
}

/**
 * Resolve which ScheduleBlock id a V1 schedule upsert / week-drag should write.
 *
 * Priority:
 * 1. explicit preferredBlockId
 * 2. primary focus block for the task (same pick as hydrate reverse)
 * 3. legacy dual-write id if present (any status except cancelled preference via primary)
 * 4. default `block:${taskId}:v1` for first create
 *
 * Does **not** invent a second block while one already exists for the task.
 */
export function resolveFocusBlockIdForScheduleUpsert(
  blocks: readonly ScheduleBlock[],
  taskId: string,
  nowMs: number,
  preferredBlockId?: string | null
): string {
  const preferred = typeof preferredBlockId === 'string' ? preferredBlockId.trim() : ''
  if (preferred) return preferred

  const primary = pickPrimaryScheduleBlockForTask(blocks, taskId, nowMs)
  if (primary) return primary.id

  const legacyId = defaultV1ScheduleBlockId(taskId)
  const legacy = blocks.find((b) => b.id === legacyId && b.taskId === taskId)
  if (legacy) return legacy.id

  // Any remaining focus block (e.g. cancelled-only primary empty path)
  const anyFocus = listActiveFocusBlocksForTask(blocks, taskId)
  if (anyFocus[0]) return anyFocus[0].id

  return legacyId
}

/**
 * One week-grid chip projected from a real ScheduleBlock (not a Task clone).
 * V1 cache can still collapse to primary; this list is multi-block ready.
 * Overnight blocks may produce multiple entries sharing the same blockId (STC-704).
 */
export type WeekScheduleEntry = {
  blockId: string
  taskId: string
  title: string
  done: boolean
  categoryId?: StudyTaskCategoryId
  schedule: StudyTaskSchedule
  /** True when this block is the hydrate primary for V1.schedule. */
  isPrimary: boolean
  locked: boolean
  source: ScheduleBlock['source']
  status: ScheduleBlock['status']
  /** Local date key of this chip slice (STC-704). */
  dateKey?: string
  /** Slice index when parent crossed midnight (0-based). */
  sliceIndex?: number
  /** Total slices for parent block. */
  sliceCount?: number
  /** Optional zone mismatch tooltip (labels only; no rewrite). */
  zoneTooltip?: string
  /** Projection zone used for wall minutes. */
  timeZone?: string
}

export type WeekScheduleTaskInput = {
  id: string
  title: string
  done: boolean
  categoryId?: StudyTaskCategoryId | null
}

function resolveHostTimeZone(explicit?: string | null): TimeZoneId {
  const raw = typeof explicit === 'string' ? explicit.trim() : ''
  if (raw) return raw
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Project all projectable focus ScheduleBlocks into week entries.
 * Overnight / cross-midnight blocks split into multi chips via pure STC-704 helpers
 * (no longer dropped by scheduleBlockToV1Schedule null-on-overnight).
 */
export function projectWeekScheduleEntries(input: {
  tasks: readonly WeekScheduleTaskInput[]
  scheduleBlocks: readonly ScheduleBlock[]
  nowMs?: number
  /** Host IANA zone; default = Intl resolved. */
  hostTimeZone?: string | null
}): WeekScheduleEntry[] {
  const nowMs = input.nowMs ?? Date.now()
  const hostTimeZone = resolveHostTimeZone(input.hostTimeZone)
  const taskById = new Map(input.tasks.map((t) => [t.id, t]))
  const entries: WeekScheduleEntry[] = []

  // Group by task for primary pick
  const taskIds = new Set<string>()
  for (const b of input.scheduleBlocks) {
    if (b.taskId) taskIds.add(b.taskId)
  }
  for (const t of input.tasks) taskIds.add(t.id)

  for (const taskId of taskIds) {
    const task = taskById.get(taskId)
    if (!task) continue
    const focus = listActiveFocusBlocksForTask(input.scheduleBlocks, taskId)
    if (focus.length === 0) continue
    const primary = pickPrimaryScheduleBlockForTask(input.scheduleBlocks, taskId, nowMs)
    const primaryId = primary?.id ?? null

    const projected = projectWeekZoneChips({
      blocks: focus,
      hostTimeZone,
      focusOnly: true
    })

    if (projected.ok && projected.chips.length > 0) {
      const categoryId =
        typeof task.categoryId === 'string' && task.categoryId.trim()
          ? (task.categoryId as StudyTaskCategoryId)
          : undefined
      for (const chip of projected.chips) {
        if (chip.taskId !== taskId) continue
        const schedule = weekZoneChipToV1Schedule(chip)
        const tooltip = formatWeekChipZoneTooltip(chip)
        entries.push({
          blockId: chip.blockId,
          taskId,
          title: task.title,
          done: task.done,
          ...(categoryId ? { categoryId } : {}),
          schedule,
          isPrimary: chip.blockId === primaryId && chip.sliceIndex === 0,
          locked: focus.find((b) => b.id === chip.blockId)?.locked ?? false,
          source: focus.find((b) => b.id === chip.blockId)?.source ?? 'manual',
          status: focus.find((b) => b.id === chip.blockId)?.status ?? 'planned',
          dateKey: chip.dateKey,
          sliceIndex: chip.sliceIndex,
          sliceCount: chip.sliceCount,
          ...(tooltip ? { zoneTooltip: tooltip } : {}),
          timeZone: chip.timeZone
        })
      }
      continue
    }

    // Fallback: same-day reverse only (legacy path if pure split fails).
    for (const block of focus) {
      const schedule = scheduleBlockToV1Schedule(block)
      if (!schedule) continue
      const categoryId =
        typeof task.categoryId === 'string' && task.categoryId.trim()
          ? (task.categoryId as StudyTaskCategoryId)
          : undefined
      entries.push({
        blockId: block.id,
        taskId,
        title: task.title,
        done: task.done,
        ...(categoryId ? { categoryId } : {}),
        schedule,
        isPrimary: block.id === primaryId,
        locked: block.locked,
        source: block.source,
        status: block.status,
        ...(block.timeZone ? { timeZone: block.timeZone } : {})
      })
    }
  }

  return entries.sort(
    (a, b) =>
      a.schedule.weekday - b.schedule.weekday ||
      a.schedule.startMinutes - b.schedule.startMinutes ||
      a.blockId.localeCompare(b.blockId) ||
      (a.sliceIndex ?? 0) - (b.sliceIndex ?? 0)
  )
}

/**
 * Pure builder for a focus ScheduleBlock upsert from product Mon-first V1 schedule.
 * Preserves identity / locked / source / plan from an existing block when present.
 * Stamps host zone on new/updated blocks (STC-704 optional wire; epoch remains authority).
 */
export function buildFocusScheduleBlockFromV1(input: {
  taskId: string
  schedule: StudyTaskSchedule
  weekAnchorMidnightMs: number
  blockId: string
  existing?: ScheduleBlock | null
  /** Host IANA zone stamped when creating/updating; omit to keep existing or leave unset. */
  hostTimeZone?: string | null
}): { ok: true; block: ScheduleBlock } | { ok: false; reason: 'invalid_schedule' } {
  const interval = monFirstScheduleToIntervalMs({
    weekday: input.schedule.weekday,
    startMinutes: input.schedule.startMinutes,
    endMinutes: input.schedule.endMinutes,
    weekAnchorMidnightMs: input.weekAnchorMidnightMs
  })
  if (!interval) return { ok: false, reason: 'invalid_schedule' }

  const existing = input.existing
  const status =
    existing && existing.status !== 'cancelled' && existing.status !== 'skipped'
      ? existing.status
      : 'planned'

  const hostRaw = typeof input.hostTimeZone === 'string' ? input.hostTimeZone.trim() : ''
  const hostZone = hostRaw || resolveHostTimeZone(null)
  const existingZone =
    typeof existing?.timeZone === 'string' && existing.timeZone.trim()
      ? existing.timeZone.trim()
      : undefined
  // Prefer existing zone (preserve intent); stamp host on create or when existing had none.
  const timeZone = existingZone ?? hostZone

  const block: ScheduleBlock = {
    id: input.blockId,
    taskId: input.taskId,
    kind: existing?.kind === 'focus' || !existing ? 'focus' : existing.kind,
    startAtMs: interval.startAtMs,
    endAtMs: interval.endAtMs,
    locked: existing?.locked ?? false,
    source: existing?.source ?? 'manual',
    status,
    revision: (existing?.revision ?? 0) + 1,
    ...(existing?.planId ? { planId: existing.planId } : {}),
    ...(existing?.planRevision !== undefined ? { planRevision: existing.planRevision } : {}),
    ...(timeZone ? { timeZone } : {})
  }
  // Week-drag always moves a focus task block — force focus kind for task-owned upsert.
  block.kind = 'focus'
  block.taskId = input.taskId

  return { ok: true, block }
}

/**
 * Map V1 StudyTask list + optional canonical blocks into week entries.
 * When canonical blocks exist for a task, they win; otherwise fall back to V1.schedule
 * materialised as a single default dual-write block (rebuildable cache).
 */
export function projectWeekScheduleEntriesFromHost(input: {
  tasks: readonly StudyTask[]
  scheduleBlocks?: readonly ScheduleBlock[] | null
  weekAnchorMidnightMs: number
  nowMs?: number
  hostTimeZone?: string | null
}): WeekScheduleEntry[] {
  const nowMs = input.nowMs ?? Date.now()
  const hostTimeZone = resolveHostTimeZone(input.hostTimeZone)
  const canonical = input.scheduleBlocks ?? []
  if (canonical.length > 0) {
    const fromCanonical = projectWeekScheduleEntries({
      tasks: input.tasks,
      scheduleBlocks: canonical,
      nowMs,
      hostTimeZone
    })
    // Tasks with V1.schedule but no canonical focus blocks still need a chip.
    const covered = new Set(fromCanonical.map((e) => e.taskId))
    const extras: WeekScheduleEntry[] = []
    for (const task of input.tasks) {
      if (covered.has(task.id) || !task.schedule) continue
      const built = buildFocusScheduleBlockFromV1({
        taskId: task.id,
        schedule: task.schedule,
        weekAnchorMidnightMs: input.weekAnchorMidnightMs,
        blockId: defaultV1ScheduleBlockId(task.id),
        existing: null,
        hostTimeZone
      })
      if (!built.ok) continue
      extras.push({
        blockId: built.block.id,
        taskId: task.id,
        title: task.title,
        done: task.done,
        ...(task.categoryId ? { categoryId: task.categoryId } : {}),
        schedule: task.schedule,
        isPrimary: true,
        locked: false,
        source: 'manual',
        status: 'planned',
        ...(built.block.timeZone ? { timeZone: built.block.timeZone } : {})
      })
    }
    return [...fromCanonical, ...extras].sort(
      (a, b) =>
        a.schedule.weekday - b.schedule.weekday ||
        a.schedule.startMinutes - b.schedule.startMinutes ||
        a.blockId.localeCompare(b.blockId) ||
        (a.sliceIndex ?? 0) - (b.sliceIndex ?? 0)
    )
  }

  // No canonical blocks: project V1 schedules only (pre-migration / no workspace).
  const entries: WeekScheduleEntry[] = []
  for (const task of input.tasks) {
    if (!task.schedule) continue
    entries.push({
      blockId: defaultV1ScheduleBlockId(task.id),
      taskId: task.id,
      title: task.title,
      done: task.done,
      ...(task.categoryId ? { categoryId: task.categoryId } : {}),
      schedule: task.schedule,
      isPrimary: true,
      locked: false,
      source: 'manual',
      status: 'planned'
    })
  }
  return entries.sort(
    (a, b) =>
      a.schedule.weekday - b.schedule.weekday ||
      a.schedule.startMinutes - b.schedule.startMinutes ||
      a.blockId.localeCompare(b.blockId)
  )
}
