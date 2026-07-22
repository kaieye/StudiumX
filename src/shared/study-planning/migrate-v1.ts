/**
 * Study planning pure domain — V1 → planning-model migration adapter (STC-108).
 *
 * Dry-run only: maps loose V1 snapshot fields into PlanningTask / ScheduleBlock / TimerPlanV2.
 * Does NOT write localStorage, does NOT freeze canonical paths, does NOT run live migration.
 * Roadmap §14.4 / §7.3: single schedule → one ScheduleBlock; plans → TimerPlanV2 with report.
 */

import {
  normalizeTimerPlanV2,
  TIMER_PLAN_SEED_DEFAULTS,
  type TimerPlanV2
} from './timer-plan'
import type { PlanningTask, ScheduleBlock } from './schedule-block'

/** Minimal V1 task shape (renderer StudyTask-compatible; duck-typed). */
export type StudyTaskV1 = {
  id: string
  title: string
  done?: boolean
  categoryId?: string | null
  schedule?: {
    weekday: number
    startMinutes: number
    endMinutes: number
    colorId?: string
  }
}

/** Minimal V1 timer plan (renderer StudyTimerPlan-compatible). */
export type StudyTimerPlanV1 = {
  id: string
  name: string
  focusMinutes: number
  breakMinutes: number
  simulationStartTime?: string
  simulationEndTime?: string
  /** Optional STC-502 advanced fields when present on V1 cache. */
  longBreakMinutes?: number
  longBreakEvery?: number
  breakPolicy?: 'automatic' | 'ask' | 'reminder_only' | 'none'
}

export type StudySnapshotV1Slice = {
  tasks?: readonly StudyTaskV1[]
  timerPlans?: readonly StudyTimerPlanV1[]
  /** Snapshot-level simulation labels (not history). */
  simulationStartTime?: string
  simulationEndTime?: string
  focusMinutes?: number
  breakMinutes?: number
}

export type MigrationReportEntry = {
  code: string
  message: string
  entityId?: string
}

export type SuggestedTimeWindow = {
  /** HH:MM label only — not a historical schedule fact. */
  startLabel: string
  endLabel: string
  source: 'plan_simulation' | 'snapshot_simulation' | 'default'
  planId?: string
}

export type MigrateStudyV1Result = {
  tasks: PlanningTask[]
  scheduleBlocks: ScheduleBlock[]
  timerPlans: TimerPlanV2[]
  suggestedWindows: SuggestedTimeWindow[]
  report: MigrationReportEntry[]
  /** Always true for this pure adapter; callers must still dry-run before any write. */
  dryRun: true
}

const MINUTE_MS = 60_000

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.trunc(value)
}

/**
 * Map a V1 weekday + minute-of-day schedule onto a concrete week anchor day.
 * weekday: 0=Sunday … 6=Saturday (JS Date convention).
 * Returns null if schedule is invalid.
 */
export function v1ScheduleToIntervalMs(input: {
  weekday: number
  startMinutes: number
  endMinutes: number
  /** Epoch ms for local midnight of any day in the target week (caller supplies). */
  weekAnchorMidnightMs: number
}): { startAtMs: number; endAtMs: number } | null {
  const weekday = asInt(input.weekday)
  const startMinutes = asInt(input.startMinutes)
  const endMinutes = asInt(input.endMinutes)
  if (weekday == null || weekday < 0 || weekday > 6) return null
  if (startMinutes == null || endMinutes == null) return null
  if (startMinutes < 0 || startMinutes >= 24 * 60) return null
  if (endMinutes <= startMinutes || endMinutes > 24 * 60) return null
  if (!Number.isFinite(input.weekAnchorMidnightMs)) return null

  const anchor = new Date(input.weekAnchorMidnightMs)
  // weekAnchor is local midnight of some day in the target week (see
  // resolveLocalWeekAnchorMidnightMs / resolveDefaultWeekAnchorMidnightMs).
  // Must use local getDay() — getUTCDay() is off-by-one for UTC+ offsets
  // (e.g. Asia/Shanghai Sunday 00:00 local = Saturday UTC → drag lands next day).
  const anchorWeekday = anchor.getDay()
  const dayDelta = (weekday - anchorWeekday + 7) % 7
  // Full calendar day (not 24 minutes — prior bug used 24 * MINUTE_MS only).
  const dayStart = input.weekAnchorMidnightMs + dayDelta * 24 * 60 * MINUTE_MS
  return {
    startAtMs: dayStart + startMinutes * MINUTE_MS,
    endAtMs: dayStart + endMinutes * MINUTE_MS
  }
}

/**
 * Product V1 week-plan UI stores Mon-first weekdays: 0=Mon … 6=Sun
 * (`currentWeekdayIndex` = (getDay()+6)%7).
 * Interval math / JS Date use Sun-first: 0=Sun … 6=Sat.
 * Convert at dual-write / migrate materialization boundaries only.
 */
export function monFirstWeekdayToJs(monFirst: number): number | null {
  const w = asInt(monFirst)
  if (w == null || w < 0 || w > 6) return null
  return (w + 1) % 7
}

export function jsWeekdayToMonFirst(jsWeekday: number): number | null {
  const w = asInt(jsWeekday)
  if (w == null || w < 0 || w > 6) return null
  return (w + 6) % 7
}

/**
 * Materialize a product V1 (Mon-first) schedule onto a week anchor using JS weekday math.
 */
export function monFirstScheduleToIntervalMs(input: {
  weekday: number
  startMinutes: number
  endMinutes: number
  weekAnchorMidnightMs: number
}): { startAtMs: number; endAtMs: number } | null {
  const jsWeekday = monFirstWeekdayToJs(input.weekday)
  if (jsWeekday == null) return null
  return v1ScheduleToIntervalMs({
    weekday: jsWeekday,
    startMinutes: input.startMinutes,
    endMinutes: input.endMinutes,
    weekAnchorMidnightMs: input.weekAnchorMidnightMs
  })
}

function migrateTaskV1(raw: unknown, index: number, report: MigrationReportEntry[]): PlanningTask | null {
  if (!isObject(raw)) {
    report.push({ code: 'task_not_object', message: `tasks[${index}] is not an object` })
    return null
  }
  const id = asTrimmedString(raw.id)
  const title = asTrimmedString(raw.title)
  if (!id || !title) {
    report.push({
      code: 'task_identity_missing',
      message: `tasks[${index}] missing id/title`,
      entityId: id
    })
    return null
  }

  const done = raw.done === true
  const categoryRaw = raw.categoryId
  let categoryId: string | null = null
  let inbox = false
  if (categoryRaw == null || categoryRaw === '') {
    // V1 often omitted category; product freeze #2: inbox projection, not fake study.
    categoryId = null
    inbox = true
    report.push({
      code: 'task_inbox_projected',
      message: `Task ${id} has no categoryId; marked inbox`,
      entityId: id
    })
  } else if (typeof categoryRaw === 'string' && categoryRaw.trim()) {
    categoryId = categoryRaw.trim()
  } else {
    categoryId = null
    inbox = true
    report.push({
      code: 'task_category_invalid',
      message: `Task ${id} has invalid categoryId; marked inbox`,
      entityId: id
    })
  }

  return {
    id,
    title,
    status: done ? 'done' : 'open',
    categoryId,
    inbox,
    estimateMinutes: null,
    remainingEstimateMinutes: null,
    splittable: true,
    revision: 1,
    source: 'migrated_v1'
  }
}

function migrateScheduleFromTask(
  task: PlanningTask,
  raw: unknown,
  weekAnchorMidnightMs: number | undefined,
  report: MigrationReportEntry[]
): ScheduleBlock | null {
  if (!isObject(raw) || !isObject((raw as { schedule?: unknown }).schedule)) return null
  const schedule = (raw as { schedule: Record<string, unknown> }).schedule
  const weekday = asInt(schedule.weekday)
  const startMinutes = asInt(schedule.startMinutes)
  const endMinutes = asInt(schedule.endMinutes)
  if (weekday == null || startMinutes == null || endMinutes == null) {
    report.push({
      code: 'schedule_fields_invalid',
      message: `Task ${task.id} schedule missing weekday/start/end`,
      entityId: task.id
    })
    return null
  }
  if (weekAnchorMidnightMs == null || !Number.isFinite(weekAnchorMidnightMs)) {
    report.push({
      code: 'schedule_needs_week_anchor',
      message: `Task ${task.id} schedule not materialized (no weekAnchorMidnightMs)`,
      entityId: task.id
    })
    return null
  }
  // Product V1 schedule.weekday is Mon-first (week plan UI); convert at boundary.
  const interval = monFirstScheduleToIntervalMs({
    weekday,
    startMinutes,
    endMinutes,
    weekAnchorMidnightMs
  })
  if (!interval) {
    report.push({
      code: 'schedule_interval_invalid',
      message: `Task ${task.id} schedule interval invalid`,
      entityId: task.id
    })
    return null
  }

  return {
    id: `migrated-block-${task.id}`,
    taskId: task.id,
    kind: 'focus',
    startAtMs: interval.startAtMs,
    endAtMs: interval.endAtMs,
    locked: true,
    source: 'migrated_v1',
    status: 'planned',
    revision: 1
  }
}

function parseHmLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function migratePlanV1(raw: unknown, index: number, report: MigrationReportEntry[]): {
  plan: TimerPlanV2 | null
  window?: SuggestedTimeWindow
} {
  if (!isObject(raw)) {
    report.push({ code: 'plan_not_object', message: `timerPlans[${index}] is not an object` })
    return { plan: null }
  }
  const id = asTrimmedString(raw.id) ?? `migrated-plan-${index + 1}`
  const name = asTrimmedString(raw.name) ?? `方案 ${index + 1}`
  const focusMinutes = asInt(raw.focusMinutes) ?? TIMER_PLAN_SEED_DEFAULTS.classicFocusMinutes
  const breakMinutes = asInt(raw.breakMinutes) ?? TIMER_PLAN_SEED_DEFAULTS.classicShortBreakMinutes

  // Roadmap §14.4 / STC-502: prefer V1 advanced fields when present; else seed defaults.
  const longBreakMinutes =
    asInt(raw.longBreakMinutes) ?? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes
  const longBreakEvery =
    asInt(raw.longBreakEvery) ?? TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery
  const breakPolicyRaw =
    typeof raw.breakPolicy === 'string' ? raw.breakPolicy.trim() : ''
  const breakPolicy =
    breakPolicyRaw === 'automatic' || breakPolicyRaw === 'ask'
      ? breakPolicyRaw
      : TIMER_PLAN_SEED_DEFAULTS.pomodoroBreakPolicy
  const usedSeedLongBreak =
    asInt(raw.longBreakMinutes) === undefined || asInt(raw.longBreakEvery) === undefined

  const result = normalizeTimerPlanV2({
    id,
    name,
    kind: 'pomodoro',
    clockMode: 'countdown',
    focusMinutes,
    shortBreakMinutes: breakMinutes,
    longBreakMinutes,
    longBreakEvery,
    breakPolicy,
    windowFillPolicy: TIMER_PLAN_SEED_DEFAULTS.windowFillPolicy,
    minimumFinalFocusMinutes: TIMER_PLAN_SEED_DEFAULTS.minimumFinalFocusMinutes,
    wrapUpMinutes: TIMER_PLAN_SEED_DEFAULTS.wrapUpMinutes,
    revision: 1
  })

  if (!result.ok) {
    report.push({
      code: 'plan_migrate_failed',
      message: `timerPlans[${index}] failed normalize`,
      entityId: id
    })
    return { plan: null }
  }

  if (usedSeedLongBreak) {
    report.push({
      code: 'plan_long_break_defaulted',
      message: `Plan ${id}: V1 missing long break fields; defaulted longBreak ${TIMER_PLAN_SEED_DEFAULTS.classicLongBreakMinutes}m every ${TIMER_PLAN_SEED_DEFAULTS.classicLongBreakEvery}`,
      entityId: id
    })
  }

  const startLabel = parseHmLabel(raw.simulationStartTime)
  const endLabel = parseHmLabel(raw.simulationEndTime)
  let window: SuggestedTimeWindow | undefined
  if (startLabel && endLabel) {
    window = {
      startLabel,
      endLabel,
      source: 'plan_simulation',
      planId: id
    }
    report.push({
      code: 'simulation_as_window_suggestion',
      message: `Plan ${id} simulationStart/EndTime → suggested window only (not history)`,
      entityId: id
    })
  }

  return { plan: result.plan, window }
}

export type MigrateStudyV1Options = {
  /**
   * Local midnight epoch-ms for a day in the week used to materialize V1 weekday schedules.
   * If omitted, schedules are reported but not converted to concrete blocks.
   */
  weekAnchorMidnightMs?: number
}

/**
 * Pure dry-run migration from V1 study snapshot fields to planning-domain models.
 * Never throws on malformed entries; drops bad rows and records report codes.
 */
export function migrateStudyV1ToPlanning(
  snapshot: StudySnapshotV1Slice | unknown,
  options: MigrateStudyV1Options = {}
): MigrateStudyV1Result {
  const report: MigrationReportEntry[] = []
  const tasks: PlanningTask[] = []
  const scheduleBlocks: ScheduleBlock[] = []
  const timerPlans: TimerPlanV2[] = []
  const suggestedWindows: SuggestedTimeWindow[] = []

  if (!isObject(snapshot)) {
    report.push({ code: 'snapshot_not_object', message: 'V1 snapshot must be an object' })
    return { tasks, scheduleBlocks, timerPlans, suggestedWindows, report, dryRun: true }
  }

  const rawTasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : []
  if (!Array.isArray(snapshot.tasks)) {
    report.push({ code: 'tasks_missing', message: 'tasks array missing; treating as empty' })
  }

  for (let i = 0; i < rawTasks.length; i += 1) {
    const task = migrateTaskV1(rawTasks[i], i, report)
    if (!task) continue
    tasks.push(task)
    const block = migrateScheduleFromTask(task, rawTasks[i], options.weekAnchorMidnightMs, report)
    if (block) scheduleBlocks.push(block)
  }

  const rawPlans = Array.isArray(snapshot.timerPlans) ? snapshot.timerPlans : []
  if (!Array.isArray(snapshot.timerPlans)) {
    report.push({ code: 'timer_plans_missing', message: 'timerPlans array missing; treating as empty' })
  }

  for (let i = 0; i < rawPlans.length; i += 1) {
    const { plan, window } = migratePlanV1(rawPlans[i], i, report)
    if (plan) timerPlans.push(plan)
    if (window) suggestedWindows.push(window)
  }

  // Snapshot-level simulation labels → window suggestion only (not history).
  const snapStart = parseHmLabel(snapshot.simulationStartTime)
  const snapEnd = parseHmLabel(snapshot.simulationEndTime)
  if (snapStart && snapEnd) {
    suggestedWindows.push({
      startLabel: snapStart,
      endLabel: snapEnd,
      source: 'snapshot_simulation'
    })
    report.push({
      code: 'snapshot_simulation_as_window_suggestion',
      message: 'Snapshot simulationStart/EndTime → suggested window only (not history)'
    })
  }

  report.push({
    code: 'migration_dry_run',
    message: 'Pure adapter dry-run complete; no localStorage or canonical write performed'
  })

  return {
    tasks,
    scheduleBlocks,
    timerPlans,
    suggestedWindows,
    report,
    dryRun: true
  }
}
