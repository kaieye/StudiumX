/**
 * StudyPlanningStore pure/in-memory sole-writer skeleton (ADR-0011).
 *
 * No filesystem yet — durable publish is a later adapter. Commands, revision CAS,
 * and actionId exact-retry are enforced here so Phase 2+ can unit-test before IPC.
 */

import type { PlanningTask, ScheduleBlock } from './schedule-block'
import {
  resolveScheduleBlockTimeZoneOnWrite,
  validateScheduleBlocks
} from './schedule-block'
import type { RecurrenceRule } from './recurrence'
import { validateRecurrenceRule } from './recurrence'
import type { TimerPlanV2 } from './timer-plan'
import { normalizeTimerPlanV2 } from './timer-plan'
import type { TimerSessionRecord } from './timer-session-lifecycle'
import {
  advanceTimerSession,
  assertSingleRunningTimerSession,
  finishTimerSession,
  pauseTimerSession,
  reconcileTimerSession,
  resumeTimerSession,
  startTimerSession,
  switchTimerSessionTask,
  type ReconcileDecision
} from './timer-session-lifecycle'
import { createClassicPomodoroPlan } from './timer-plan'
import {
  copyTimerPlanAsCustom,
  isBuiltinTimerPlanId,
  removeTimerPlanFromCatalog
} from './timer-plan-catalog'
import { batchClassifyTasks } from './empty-start-and-classification'
import {
  applyCompleteTaskFutureBlocks,
  applyDeleteTaskFutureBlocks,
  applyReopenTask,
  type FutureBlocksDecision
} from './task-timeline-projection'
import { applyImportMigrationCommit } from './import-migration-commit'
import { normalizeFutureBlocksDecision } from './future-blocks-decision-sheet'
import {
  normalizeStudyPlanningCategories,
  type StudyPlanningCategoryV1
} from './study-planning-categories'

export const STUDY_PLANNING_SCHEMA = 'studiumx.study-planning' as const
export const STUDY_PLANNING_SCHEMA_VERSION = 1 as const

export type StudyPlanningPreferencesV1 = {
  emptyStartPolicy?: 'ask_every_time' | 'remember_quick_start' | 'remember_unattributed'
  /**
   * Empty-start / quick_start task category id (builtin or custom-*).
   * Default product path: 'other'. Optional wire ok without schemaVersion bump.
   */
  emptyStartCategoryId?: string | null
  classificationPromptOptOut?: boolean
  defaultTimerPlanId?: string | null
  /**
   * Active simulation window labels (HH:MM), rebuildable UI preference (not AllocationProposal product).
   * Not schedule history — same semantics as V1 snapshot simulationStart/EndTime.
   */
  simulationStartTime?: string
  simulationEndTime?: string
  /**
   * Optional sole-authority demote marker (ms since epoch).
   * When set, renderer stops treating V1 localStorage as task authority under workspace.
   * Not a teaching field; optional wire ok (ADR-0011 optional preferences fields).
   */
  v1LocalAuthorityDemotedAtMs?: number
  /**
   * Optional durable recurrence rule list (STC-703).
   * Cap + fail-closed normalize on set_preferences; default empty when unset.
   * Optional wire ok without schemaVersion bump (ADR-0011).
   */
  recurrenceRules?: RecurrenceRule[]
}

export type StudyPlanningSnapshotV1 = {
  schema: typeof STUDY_PLANNING_SCHEMA
  schemaVersion: typeof STUDY_PLANNING_SCHEMA_VERSION
  revision: number
  updatedAtMs: number
  tasks: PlanningTask[]
  scheduleBlocks: ScheduleBlock[]
  timerPlans: TimerPlanV2[]
  timerSessions: TimerSessionRecord[]
  preferences: StudyPlanningPreferencesV1
  /**
   * Optional task category catalog (ADR-0011).
   * When present, sole-read authority for UI categories; omit keeps V1 localStorage cache.
   */
  categories?: StudyPlanningCategoryV1[]
  localAnalyticsHints: Record<string, unknown>
}

export type StudyPlanningCommandType =
  | 'create_task'
  | 'update_task'
  | 'complete_task'
  | 'delete_task'
  | 'reopen_task'
  | 'save_timer_plan'
  | 'delete_timer_plan'
  | 'copy_timer_plan'
  | 'upsert_schedule_block'
  | 'delete_schedule_block'
  | 'quick_start'
  | 'batch_classify_tasks'
  | 'start_timer_session'
  | 'pause_timer_session'
  | 'resume_timer_session'
  | 'finish_timer_session'
  | 'switch_session_task'
  | 'reconcile_stale_session'
  | 'advance_timer_session'
  | 'set_preferences'
  | 'set_categories'
  | 'import_migration_commit'

export type StudyPlanningCommandEnvelope = {
  actionId: string
  operationId?: string
  type: StudyPlanningCommandType
  payload: unknown
  clientIssuedAtMs?: number
}

export type StudyPlanningError = {
  code:
    | 'revision_conflict'
    | 'duplicate_action'
    | 'invalid_command'
    | 'invariant_violation'
    | 'not_found'
    | 'migration_required'
    | 'io_failed'
    | 'command_failed'
  message: string
  details?: Record<string, unknown>
}

export type StudyPlanningEffect =
  | { type: 'timer_session_started'; sessionId: string }
  | { type: 'timer_session_updated'; sessionId: string }
  | { type: 'timer_session_closed'; sessionId: string }
  | { type: 'reconcile_required'; sessionId: string; gapSeconds: number }
  | { type: 'task_created'; taskId: string }
  | { type: 'task_updated'; taskId: string }
  | { type: 'task_deleted'; taskId: string }
  | { type: 'classification_prompt_suggested'; taskId: string }
  | { type: 'future_blocks_need_decision'; taskId: string; blockIds: string[] }
  | { type: 'schedule_blocks_applied'; count: number }
  | { type: 'schedule_block_deleted'; blockId: string; taskId: string | null }
  | { type: 'quick_start_partial_failure'; stage: string; message: string }
  | {
      type: 'migration_committed'
      source: string
      tasksAdded: number
      blocksAdded: number
      plansAdded: number
      sessionsImported: number
    }

export type ApplyResult =
  | {
      ok: true
      revision: number
      snapshot: StudyPlanningSnapshotV1
      effects: StudyPlanningEffect[]
      /** True when exact actionId retry returned prior success without re-applying. */
      replayed?: boolean
    }
  | {
      ok: false
      error: StudyPlanningError
      revision: number
    }

function emptySnapshot(nowMs: number): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision: 1,
    updatedAtMs: nowMs,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [createClassicPomodoroPlan()],
    timerSessions: [],
    preferences: {
      emptyStartPolicy: 'remember_quick_start',
      emptyStartCategoryId: 'other',
      classificationPromptOptOut: false,
      defaultTimerPlanId: 'classic_25_5'
    },
    localAnalyticsHints: {}
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * HH:MM pad for preferences simulation window.
 * Returns null when format invalid or hour/minute out of range (no silent clamp).
 */
function normalizeHmLabel(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Local analytics: plan vs actual focus minutes for a task (STC-208 pure projection). */
export function projectTaskPlanVsActual(input: {
  taskId: string
  scheduleBlocks: readonly ScheduleBlock[]
  timerSessions: readonly TimerSessionRecord[]
}): {
  plannedFocusSeconds: number
  actualFocusSeconds: number
  breakSeconds: number
  unattributedFocusSeconds: number
} {
  let plannedFocusSeconds = 0
  for (const block of input.scheduleBlocks) {
    if (block.taskId !== input.taskId || block.kind !== 'focus') continue
    plannedFocusSeconds += Math.max(0, Math.floor((block.endAtMs - block.startAtMs) / 1000))
  }
  let actualFocusSeconds = 0
  let breakSeconds = 0
  let unattributedFocusSeconds = 0
  for (const session of input.timerSessions) {
    if (session.phase === 'focus') {
      if (session.taskId === input.taskId) actualFocusSeconds += session.accumulatedFocusSeconds
      else if (session.taskId == null) unattributedFocusSeconds += session.accumulatedFocusSeconds
    } else if (session.phase === 'short_break' || session.phase === 'long_break') {
      breakSeconds += session.accumulatedActiveSeconds
    }
  }
  return { plannedFocusSeconds, actualFocusSeconds, breakSeconds, unattributedFocusSeconds }
}

/** Max durable recurrence rules kept in preferences (STC-703). */
export const STUDY_PLANNING_RECURRENCE_RULES_CAP = 32

const RECURRENCE_KIND_SET = new Set(['focus', 'short_break', 'long_break', 'wrap_up'] as const)

/**
 * Normalize optional preferences.recurrenceRules: cap, dedupe by id, drop invalid.
 * Fail-closed items are skipped; never invents Task ids.
 * When input is undefined/null/non-array → empty array.
 */
export function normalizePreferencesRecurrenceRules(input: unknown): RecurrenceRule[] {
  if (!Array.isArray(input)) return []
  const out: RecurrenceRule[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (out.length >= STUDY_PLANNING_RECURRENCE_RULES_CAP) break
    const rule = coerceRecurrenceRule(raw)
    if (!rule) continue
    if (seen.has(rule.id)) continue
    const validation = validateRecurrenceRule(rule)
    if (!validation.ok) continue
    seen.add(rule.id)
    out.push(rule)
  }
  return out
}


function coerceRecurrenceRule(raw: unknown): RecurrenceRule | null {
  if (!isObject(raw)) return null
  const id = asString(raw.id)
  if (!id) return null
  const kind = asString(raw.kind)
  if (!kind || !(RECURRENCE_KIND_SET as Set<string>).has(kind)) return null
  const frequency = asString(raw.frequency)
  if (frequency !== 'daily' && frequency !== 'weekly') return null
  const dtStartMs =
    typeof raw.dtStartMs === 'number' && Number.isFinite(raw.dtStartMs)
      ? Math.trunc(raw.dtStartMs)
      : null
  const startMinutes =
    typeof raw.startMinutes === 'number' && Number.isFinite(raw.startMinutes)
      ? Math.trunc(raw.startMinutes)
      : null
  const endMinutes =
    typeof raw.endMinutes === 'number' && Number.isFinite(raw.endMinutes)
      ? Math.trunc(raw.endMinutes)
      : null
  if (dtStartMs == null || startMinutes == null || endMinutes == null) return null

  let taskId: string | null = null
  if (raw.taskId === null) {
    taskId = null
  } else if (typeof raw.taskId === 'string') {
    const t = raw.taskId.trim()
    taskId = t || null
  } else if (raw.taskId !== undefined) {
    return null
  }

  const rule: RecurrenceRule = {
    id,
    taskId,
    kind: kind as RecurrenceRule['kind'],
    frequency,
    dtStartMs,
    startMinutes,
    endMinutes
  }

  if (Array.isArray(raw.byWeekday)) {
    const dayOut: number[] = []
    for (const d of raw.byWeekday) {
      if (typeof d !== 'number' || !Number.isFinite(d)) continue
      const w = Math.trunc(d)
      if (w < 0 || w > 6) continue
      if (!dayOut.includes(w)) dayOut.push(w)
    }
    if (dayOut.length > 0) {
      rule.byWeekday = dayOut as RecurrenceRule['byWeekday']
    }
  }

  if (raw.untilMs === null) {
    rule.untilMs = null
  } else if (typeof raw.untilMs === 'number' && Number.isFinite(raw.untilMs)) {
    rule.untilMs = Math.trunc(raw.untilMs)
  }

  if (raw.count === null) {
    rule.count = null
  } else if (typeof raw.count === 'number' && Number.isFinite(raw.count)) {
    rule.count = Math.trunc(raw.count)
  }

  if (typeof raw.locked === 'boolean') rule.locked = raw.locked
  if (typeof raw.expandAsLocked === 'boolean') rule.expandAsLocked = raw.expandAsLocked
  if (typeof raw.planId === 'string' && raw.planId.trim()) rule.planId = raw.planId.trim()
  if (typeof raw.planRevision === 'number' && Number.isFinite(raw.planRevision)) {
    rule.planRevision = Math.trunc(raw.planRevision)
  }

  return rule
}

export type StudyPlanningStoreOptions = {
  nowMs?: () => number
  initial?: StudyPlanningSnapshotV1
}

/**
 * In-memory sole-writer. Swap transport later; keep command semantics identical.
 */
export class StudyPlanningStore {
  private snapshot: StudyPlanningSnapshotV1
  private readonly nowMs: () => number
  /** actionId → last successful ApplyResult (exact retry). */
  private readonly actionLog = new Map<string, Extract<ApplyResult, { ok: true }>>()

  constructor(options: StudyPlanningStoreOptions = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now())
    this.snapshot = options.initial ? structuredClone(options.initial) : emptySnapshot(this.nowMs())
  }

  readSnapshot(): StudyPlanningSnapshotV1 {
    return structuredClone(this.snapshot)
  }

  /** Exact-retry lookup without applying (durable hosts). */
  peekActionResult(actionId: string): Extract<ApplyResult, { ok: true }> | null {
    const prior = this.actionLog.get(actionId)
    return prior ? structuredClone(prior) : null
  }

  /**
   * Replace in-memory snapshot after durable publish succeeded.
   * Does not clear action log (caller should setActionResult after).
   */
  replaceSnapshot(snapshot: StudyPlanningSnapshotV1): void {
    this.snapshot = structuredClone(snapshot)
  }

  rememberActionResult(actionId: string, result: Extract<ApplyResult, { ok: true }>): void {
    this.actionLog.set(actionId, structuredClone(result))
  }

  applyCommand(command: StudyPlanningCommandEnvelope, expectedRevision: number): ApplyResult {
    if (!command?.actionId?.trim()) {
      return {
        ok: false,
        revision: this.snapshot.revision,
        error: { code: 'invalid_command', message: 'actionId is required' }
      }
    }
    const prior = this.actionLog.get(command.actionId)
    if (prior) {
      return { ...structuredClone(prior), replayed: true }
    }

    if (expectedRevision !== this.snapshot.revision) {
      return {
        ok: false,
        revision: this.snapshot.revision,
        error: {
          code: 'revision_conflict',
          message: `expected ${expectedRevision}, actual ${this.snapshot.revision}`
        }
      }
    }

    const applied = this.dispatch(command)
    if (!applied.ok) return applied

    this.snapshot = applied.snapshot
    this.actionLog.set(command.actionId, applied)
    return applied
  }

  private dispatch(command: StudyPlanningCommandEnvelope): ApplyResult {
    const now = this.nowMs()
    const effects: StudyPlanningEffect[] = []
    let next = structuredClone(this.snapshot)

    try {
      switch (command.type) {
        case 'create_task': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'create_task payload object required')
          const id = asString(p.id)
          const title = asString(p.title)
          if (!id || !title) throw fail('invalid_command', 'create_task requires id and title')
          if (next.tasks.some((t) => t.id === id)) throw fail('invariant_violation', `task ${id} exists`)
          const inbox = p.inbox === true || p.categoryId == null || p.categoryId === ''
          const task: PlanningTask = {
            id,
            title,
            status: 'open',
            categoryId: inbox ? null : asString(p.categoryId) ?? null,
            inbox,
            estimateMinutes: null,
            remainingEstimateMinutes: null,
            splittable: p.splittable !== false,
            revision: 1,
            source: asString(p.source) === 'quick_start' ? 'quick_start' : 'manual'
          }
          next.tasks = [...next.tasks, task]
          effects.push({ type: 'task_created', taskId: id })
          break
        }
        case 'update_task': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'update_task payload required')
          const id = asString(p.id)
          if (!id) throw fail('invalid_command', 'update_task requires id')
          const idx = next.tasks.findIndex((t) => t.id === id)
          if (idx < 0) throw fail('not_found', `task ${id}`)
          const cur = next.tasks[idx]
          const title = asString(p.title) ?? cur.title
          let categoryId = cur.categoryId
          let inbox = cur.inbox
          if ('categoryId' in p) {
            if (p.categoryId == null || p.categoryId === '') {
              categoryId = null
              inbox = true
            } else {
              categoryId = asString(p.categoryId) ?? null
              inbox = false
            }
          }
          next.tasks = next.tasks.map((t, i) =>
            i === idx
              ? {
                  ...t,
                  title,
                  categoryId,
                  inbox,
                  revision: t.revision + 1,
                  ...(typeof p.estimateMinutes === 'number' || p.estimateMinutes === null
                    ? { estimateMinutes: p.estimateMinutes as number | null }
                    : {})
                }
              : t
          )
          effects.push({ type: 'task_updated', taskId: id })
          break
        }
        case 'complete_task': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'complete_task payload required')
          const id = asString(p.id)
          if (!id) throw fail('invalid_command', 'complete_task requires id')
          const idx = next.tasks.findIndex((t) => t.id === id)
          if (idx < 0) throw fail('not_found', `task ${id}`)
          const task = next.tasks[idx]
          const decisionRaw = asString(p.futureBlocksDecision)
          const decision = normalizeFutureBlocksDecision(decisionRaw) as FutureBlocksDecision | null
          const handled = applyCompleteTaskFutureBlocks({
            task,
            scheduleBlocks: next.scheduleBlocks,
            nowMs: now,
            ...(decision ? { decision } : {}),
            reassignTaskId: p.reassignTaskId === null ? null : asString(p.reassignTaskId) ?? null
          })
          if (handled.requiresDecision) {
            // Still mark done, but force UI decision for future blocks (freeze #7).
            next.tasks = next.tasks.map((t, i) => (i === idx ? handled.task : t))
            effects.push({
              type: 'future_blocks_need_decision',
              taskId: id,
              blockIds: handled.futureBlockIds
            })
          } else {
            next.tasks = next.tasks.map((t, i) => (i === idx ? handled.task : t))
            next.scheduleBlocks = handled.scheduleBlocks
          }
          if (handled.task.inbox && !next.preferences.classificationPromptOptOut) {
            effects.push({ type: 'classification_prompt_suggested', taskId: id })
          }
          effects.push({ type: 'task_updated', taskId: id })
          break
        }
        case 'delete_task': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'delete_task payload required')
          const id = asString(p.id)
          if (!id) throw fail('invalid_command', 'delete_task requires id')
          const idx = next.tasks.findIndex((t) => t.id === id)
          if (idx < 0) throw fail('not_found', `task ${id}`)
          const task = next.tasks[idx]
          // Already cancelled: allow second call only to apply future-blocks decision (idempotent task).
          const decisionRaw = asString(p.futureBlocksDecision)
          const decision = normalizeFutureBlocksDecision(decisionRaw) as FutureBlocksDecision | null
          const handled = applyDeleteTaskFutureBlocks({
            task,
            scheduleBlocks: next.scheduleBlocks,
            nowMs: now,
            ...(decision ? { decision } : {}),
            reassignTaskId: p.reassignTaskId === null ? null : asString(p.reassignTaskId) ?? null
          })
          next.tasks = next.tasks.map((t, i) => (i === idx ? handled.task : t))
          next.scheduleBlocks = handled.scheduleBlocks
          effects.push({ type: 'task_deleted', taskId: id })
          if (handled.requiresDecision) {
            effects.push({
              type: 'future_blocks_need_decision',
              taskId: id,
              blockIds: handled.futureBlockIds
            })
          }
          break
        }
        case 'reopen_task': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'reopen_task payload required')
          const id = asString(p.id)
          if (!id) throw fail('invalid_command', 'reopen_task requires id')
          const idx = next.tasks.findIndex((t) => t.id === id)
          if (idx < 0) throw fail('not_found', `task ${id}`)
          const task = next.tasks[idx]
          const handled = applyReopenTask({ task })
          if (handled.changed) {
            next.tasks = next.tasks.map((t, i) => (i === idx ? handled.task : t))
          }
          effects.push({ type: 'task_updated', taskId: id })
          break
        }
        case 'save_timer_plan': {
          const p = command.payload
          if (!isObject(p) || !isObject(p.plan)) throw fail('invalid_command', 'save_timer_plan.plan required')
          const rawPlan = p.plan as TimerPlanV2
          if (!rawPlan.id?.trim()) throw fail('invalid_command', 'plan.id required')
          // System seed ids may be upserted (user overrides); delete remains blocked.
          // STC-702: fail-closed normalize (custom_rhythm sequence + primary fields).
          const normalized = normalizeTimerPlanV2(rawPlan)
          if (!normalized.ok) {
            throw fail(
              'invalid_command',
              `save_timer_plan.plan invalid: ${normalized.issues.map((i) => i.message).join('; ')}`,
              { issues: normalized.issues }
            )
          }
          const plan = normalized.plan
          const others = next.timerPlans.filter((x) => x.id !== plan.id)
          if (others.length + 1 > 12) {
            throw fail('invariant_violation', 'timer plan limit 12; refuse silent truncate')
          }
          // Preserve catalog order on update; only prepend was reordering custom rows in UI.
          const existingIndex = next.timerPlans.findIndex((x) => x.id === plan.id)
          if (existingIndex >= 0) {
            next.timerPlans = next.timerPlans.map((x) => (x.id === plan.id ? plan : x))
          } else {
            next.timerPlans = [...others, plan]
          }
          break
        }
        case 'copy_timer_plan': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'copy_timer_plan payload required')
          const sourceId = asString(p.sourceId)
          const newId = asString(p.newId)
          if (!sourceId || !newId) throw fail('invalid_command', 'sourceId and newId required')
          const source =
            next.timerPlans.find((x) => x.id === sourceId) ??
            (isBuiltinTimerPlanId(sourceId)
              ? createClassicPomodoroPlan(
                  sourceId === 'classic_25_5'
                    ? {}
                    : sourceId === 'deep_50_10'
                      ? {
                          id: 'deep_50_10',
                          name: '深度专注',
                          focusMinutes: 50,
                          shortBreakMinutes: 10
                        }
                      : {
                          id: 'continuous_countup',
                          name: '连续专注',
                          kind: 'continuous',
                          clockMode: 'countup',
                          breakPolicy: 'reminder_only'
                        }
                )
              : undefined)
          // Prefer catalog builtins via copyTimerPlanAsCustom from listed plans or seed
          const fromList = next.timerPlans.find((x) => x.id === sourceId)
          const sourcePlan = fromList ?? source
          if (!sourcePlan) throw fail('not_found', `plan ${sourceId}`)
          if (next.timerPlans.length >= 12) {
            throw fail('invariant_violation', 'timer plan limit 12; refuse silent truncate')
          }
          const copied = copyTimerPlanAsCustom({
            source: sourcePlan,
            newId,
            newName: asString(p.newName)
          })
          if (!copied.ok) throw fail('command_failed', copied.message)
          next.timerPlans = [copied.plan, ...next.timerPlans]
          break
        }
        case 'delete_timer_plan': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'delete_timer_plan payload required')
          const planId = asString(p.planId)
          if (!planId) throw fail('invalid_command', 'planId required')
          const removed = removeTimerPlanFromCatalog({
            plans: next.timerPlans,
            planId,
            defaultTimerPlanId: next.preferences.defaultTimerPlanId
          })
          if (!removed.ok) {
            throw fail(
              removed.code === 'not_found' ? 'not_found' : 'invariant_violation',
              removed.message
            )
          }
          next.timerPlans = removed.plans
          if (removed.defaultTimerPlanId !== undefined) {
            next.preferences = {
              ...next.preferences,
              defaultTimerPlanId: removed.defaultTimerPlanId
            }
          }
          break
        }
        case 'batch_classify_tasks': {
          const p = command.payload
          if (!isObject(p) || !Array.isArray(p.taskIds)) {
            throw fail('invalid_command', 'batch_classify_tasks.taskIds required')
          }
          const categoryId = asString(p.categoryId)
          if (!categoryId) throw fail('invalid_command', 'categoryId required')
          const patches = batchClassifyTasks({
            tasks: next.tasks,
            taskIds: p.taskIds.filter((x): x is string => typeof x === 'string'),
            categoryId
          })
          const patchMap = new Map(patches.map((x) => [x.id, x]))
          next.tasks = next.tasks.map((t) => {
            const patch = patchMap.get(t.id)
            if (!patch) return t
            return {
              ...t,
              categoryId: patch.categoryId,
              inbox: false,
              revision: t.revision + 1
            }
          })
          for (const patch of patches) {
            effects.push({ type: 'task_updated', taskId: patch.id })
          }
          break
        }
        case 'upsert_schedule_block': {
          const p = command.payload
          if (!isObject(p) || !isObject(p.block)) throw fail('invalid_command', 'upsert_schedule_block.block required')
          const block = p.block as ScheduleBlock
          if (!block.id?.trim()) throw fail('invalid_command', 'block.id required')
          const existingBlock = next.scheduleBlocks.find((b) => b.id === block.id)
          // STC-704: never overwrite existing timeZone (no silent rezone). Stamp host only when
          // existing had none and payload/host provides a valid zone.
          // confirmOverwriteTimeZone=true is user-confirmed rezone write policy only (travel product UI removed).
          const hostStamp = asString(p.hostTimeZone) ?? asString(p.timeZone)
          const confirmOverwrite =
            p.confirmOverwriteTimeZone === true || p.confirmOverwriteTimeZone === 'true'
          const resolvedZone = resolveScheduleBlockTimeZoneOnWrite({
            existingTimeZone: existingBlock?.timeZone,
            incomingTimeZone: block.timeZone,
            hostTimeZone: hostStamp,
            confirmOverwriteTimeZone: confirmOverwrite
          })
          const finalBlock: ScheduleBlock = resolvedZone
            ? { ...block, timeZone: resolvedZone }
            : (() => {
                const { timeZone: _omit, ...rest } = block
                return rest as ScheduleBlock
              })()
          const without = next.scheduleBlocks.filter((b) => b.id !== finalBlock.id)
          const merged = [...without, finalBlock]
          const validation = validateScheduleBlocks(merged)
          if (!validation.ok) {
            throw fail('invariant_violation', 'schedule validation failed', {
              issues: validation.issues
            })
          }
          next.scheduleBlocks = merged
          effects.push({ type: 'schedule_blocks_applied', count: 1 })
          break
        }
        case 'delete_schedule_block': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'delete_schedule_block payload required')
          const blockId = asString(p.blockId)
          if (!blockId) throw fail('invalid_command', 'delete_schedule_block.blockId required')
          const existing = next.scheduleBlocks.find((b) => b.id === blockId)
          if (!existing) throw fail('not_found', `schedule block ${blockId}`)
          if (existing.locked) {
            throw fail('invariant_violation', `schedule block ${blockId} is locked`)
          }
          next.scheduleBlocks = next.scheduleBlocks.filter((b) => b.id !== blockId)
          effects.push({
            type: 'schedule_block_deleted',
            blockId,
            taskId: existing.taskId
          })
          break
        }
        case 'quick_start': {
          // Coordinated create task + optional block + start session; partial failure is explicit.
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'quick_start payload required')
          const taskId = asString(p.taskId)
          const title = asString(p.title) ?? '临时专注'
          const sessionId = asString(p.sessionId)
          const planId = asString(p.planId) ?? next.preferences.defaultTimerPlanId ?? 'classic_25_5'
          if (!taskId || !sessionId) {
            throw fail('invalid_command', 'quick_start requires taskId and sessionId')
          }
          if (next.tasks.some((t) => t.id === taskId)) {
            throw fail('invariant_violation', `task ${taskId} exists`)
          }
          const runningCheck = assertSingleRunningTimerSession(next.timerSessions)
          if (!runningCheck.ok) {
            throw fail('invariant_violation', 'already have running TimerSession', {
              ids: runningCheck.ids
            })
          }
          const plan = next.timerPlans.find((x) => x.id === planId)
          if (!plan) {
            effects.push({
              type: 'quick_start_partial_failure',
              stage: 'plan',
              message: `timer plan ${planId} missing`
            })
            throw fail('not_found', `timer plan ${planId}`)
          }
          next.tasks = [
            ...next.tasks,
            {
              id: taskId,
              title,
              status: 'open',
              categoryId: 'other',
              inbox: false,
              estimateMinutes: null,
              remainingEstimateMinutes: null,
              splittable: true,
              revision: 1,
              source: 'quick_start'
            }
          ]
          effects.push({ type: 'task_created', taskId })
          if (isObject(p.block)) {
            const block = {
              ...(p.block as ScheduleBlock),
              taskId,
              source: 'quick_start' as const
            }
            const merged = [...next.scheduleBlocks, block]
            const validation = validateScheduleBlocks(merged)
            if (!validation.ok) {
              effects.push({
                type: 'quick_start_partial_failure',
                stage: 'schedule_block',
                message: 'block validation failed; task created, session not started'
              })
              // Keep task; do not start session (explicit partial failure).
              break
            }
            next.scheduleBlocks = merged
          }
          const started = startTimerSession({
            id: sessionId,
            nowMs: now,
            plan,
            taskId,
            attributionReason: 'quick_start',
            startActionId: command.actionId
          })
          if (!started.session) {
            effects.push({
              type: 'quick_start_partial_failure',
              stage: 'timer_session',
              message: started.error?.message ?? 'start failed; task may exist'
            })
            throw fail('command_failed', started.error?.message ?? 'quick_start session failed')
          }
          next.timerSessions = [...next.timerSessions, started.session]
          effects.push({ type: 'timer_session_started', sessionId })
          break
        }
        case 'start_timer_session': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'start_timer_session payload required')
          const id = asString(p.id)
          const planId = asString(p.planId) ?? next.preferences.defaultTimerPlanId ?? 'classic_25_5'
          if (!id) throw fail('invalid_command', 'session id required')
          const runningCheck = assertSingleRunningTimerSession(next.timerSessions)
          if (!runningCheck.ok) {
            throw fail('invariant_violation', 'already have running TimerSession', {
              ids: runningCheck.ids
            })
          }
          const plan = next.timerPlans.find((x) => x.id === planId)
          if (!plan) throw fail('not_found', `timer plan ${planId}`)
          const phaseRaw = asString(p.phase)
          const phase =
            phaseRaw === 'focus' ||
            phaseRaw === 'short_break' ||
            phaseRaw === 'long_break' ||
            phaseRaw === 'wrap_up'
              ? phaseRaw
              : undefined
          const started = startTimerSession({
            id,
            nowMs: now,
            plan,
            ...(phase ? { phase } : {}),
            taskId: p.taskId === undefined ? null : (asString(p.taskId) ?? null),
            scheduleBlockId: asString(p.scheduleBlockId) ?? null,
            attributionReason:
              p.taskId == null || p.taskId === ''
                ? 'unattributed'
                : ((asString(p.attributionReason) as 'explicit') ?? 'explicit'),
            startActionId: command.actionId,
            ...(typeof p.targetSeconds === 'number' || p.targetSeconds === null
              ? { targetSeconds: p.targetSeconds as number | null }
              : {})
          })
          if (!started.session) throw fail('command_failed', started.error?.message ?? 'start failed')
          next.timerSessions = [...next.timerSessions, started.session]
          effects.push({ type: 'timer_session_started', sessionId: id })
          break
        }
        case 'pause_timer_session':
        case 'resume_timer_session':
        case 'finish_timer_session':
        case 'advance_timer_session':
        case 'reconcile_stale_session':
        case 'switch_session_task': {
          this.applySessionCommand(command, next, effects, now)
          break
        }
        case 'set_preferences': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'set_preferences payload required')
          next.preferences = {
            ...next.preferences,
            ...(asString(p.emptyStartPolicy)
              ? {
                  emptyStartPolicy: asString(p.emptyStartPolicy) as StudyPlanningPreferencesV1['emptyStartPolicy']
                }
              : {}),
            ...(p.emptyStartCategoryId === null
              ? { emptyStartCategoryId: null as string | null }
              : asString(p.emptyStartCategoryId)
                ? { emptyStartCategoryId: asString(p.emptyStartCategoryId) }
                : {}),
            ...(typeof p.classificationPromptOptOut === 'boolean'
              ? { classificationPromptOptOut: p.classificationPromptOptOut }
              : {}),
            ...(p.defaultTimerPlanId === null || typeof p.defaultTimerPlanId === 'string'
              ? { defaultTimerPlanId: p.defaultTimerPlanId as string | null }
              : {}),
            // Active simulation window (HH:MM labels only — not schedule history).
            ...(() => {
              if (typeof p.simulationStartTime !== 'string') return {}
              const start = normalizeHmLabel(p.simulationStartTime)
              return start ? { simulationStartTime: start } : {}
            })(),
            ...(() => {
              if (typeof p.simulationEndTime !== 'string') return {}
              const end = normalizeHmLabel(p.simulationEndTime)
              return end ? { simulationEndTime: end } : {}
            })(),
            // Optional demote marker — number > 0 only; never invent erase of V1 from store.
            ...(typeof p.v1LocalAuthorityDemotedAtMs === 'number' &&
            Number.isFinite(p.v1LocalAuthorityDemotedAtMs) &&
            p.v1LocalAuthorityDemotedAtMs > 0
              ? { v1LocalAuthorityDemotedAtMs: Math.floor(p.v1LocalAuthorityDemotedAtMs) }
              : {}),
            // Optional durable recurrence rules (STC-703). Full replace when provided.
            // Fail-closed: non-array → invalid_command; invalid items dropped via normalize.
            ...(() => {
              if (!('recurrenceRules' in p)) return {}
              if (p.recurrenceRules == null) {
                return { recurrenceRules: [] as RecurrenceRule[] }
              }
              if (!Array.isArray(p.recurrenceRules)) {
                throw fail(
                  'invalid_command',
                  'set_preferences.recurrenceRules must be an array when provided'
                )
              }
              return {
                recurrenceRules: normalizePreferencesRecurrenceRules(p.recurrenceRules)
              }
            })(),
          }
          break
        }
        case 'set_categories': {
          const p = command.payload
          if (!isObject(p)) throw fail('invalid_command', 'set_categories payload required')
          if (!Array.isArray(p.categories)) {
            throw fail('invalid_command', 'set_categories requires categories array')
          }
          // Full replace with normalize (builtins always present; custom deduped/capped).
          next.categories = normalizeStudyPlanningCategories(p.categories)
          break
        }
        case 'import_migration_commit': {
          const migrated = applyImportMigrationCommit({
            base: next,
            payload: command.payload,
            nowMs: now
          })
          if (!migrated.ok) throw migrated.error
          next = migrated.snapshot
          effects.push(...migrated.effects)
          break
        }
        default:
          throw fail('invalid_command', `unknown type ${String((command as { type: string }).type)}`)
      }
    } catch (err) {
      const error = err as StudyPlanningError
      if (error && typeof error === 'object' && 'code' in error) {
        return { ok: false, revision: this.snapshot.revision, error }
      }
      return {
        ok: false,
        revision: this.snapshot.revision,
        error: { code: 'command_failed', message: err instanceof Error ? err.message : String(err) }
      }
    }

    next = {
      ...next,
      revision: next.revision + 1,
      updatedAtMs: now
    }

    // Re-check single running after mutations
    const running = assertSingleRunningTimerSession(next.timerSessions)
    if (!running.ok) {
      return {
        ok: false,
        revision: this.snapshot.revision,
        error: {
          code: 'invariant_violation',
          message: 'multiple running TimerSession',
          details: { ids: running.ids }
        }
      }
    }

    return {
      ok: true,
      revision: next.revision,
      snapshot: next,
      effects
    }
  }

  private applySessionCommand(
    command: StudyPlanningCommandEnvelope,
    next: StudyPlanningSnapshotV1,
    effects: StudyPlanningEffect[],
    now: number
  ): void {
    const p = command.payload
    if (!isObject(p)) throw fail('invalid_command', `${command.type} payload required`)
    const sessionId = asString(p.sessionId)
    if (!sessionId) throw fail('invalid_command', 'sessionId required')
    const idx = next.timerSessions.findIndex((s) => s.id === sessionId)
    if (idx < 0) throw fail('not_found', `TimerSession ${sessionId}`)
    const current = next.timerSessions[idx]

    if (command.type === 'pause_timer_session') {
      const r = pauseTimerSession(current, now)
      if (r.error) throw fail('command_failed', r.error.message)
      next.timerSessions = replaceSession(next.timerSessions, r.session!)
      effects.push({ type: 'timer_session_updated', sessionId })
      return
    }
    if (command.type === 'resume_timer_session') {
      const r = resumeTimerSession(current, now)
      if (r.error) throw fail('command_failed', r.error.message)
      next.timerSessions = replaceSession(next.timerSessions, r.session!)
      effects.push({ type: 'timer_session_updated', sessionId })
      return
    }
    if (command.type === 'finish_timer_session') {
      const reason = p.reason === 'cancelled' ? 'cancelled' : 'manual'
      const r = finishTimerSession(current, now, reason)
      next.timerSessions = replaceSession(next.timerSessions, r.session!)
      effects.push({ type: 'timer_session_closed', sessionId })
      return
    }
    if (command.type === 'advance_timer_session') {
      const r = advanceTimerSession(current, typeof p.nowMs === 'number' ? p.nowMs : now)
      next.timerSessions = replaceSession(next.timerSessions, r.session!)
      for (const ev of r.events) {
        if (ev.type === 'needs_reconcile') {
          effects.push({
            type: 'reconcile_required',
            sessionId,
            gapSeconds: ev.gapSeconds
          })
        }
      }
      effects.push({ type: 'timer_session_updated', sessionId })
      return
    }
    if (command.type === 'reconcile_stale_session') {
      const decision = asString(p.decision) as ReconcileDecision | undefined
      if (!decision || !['confirm_all', 'truncate_to_target', 'discard_gap'].includes(decision)) {
        throw fail('invalid_command', 'decision must be confirm_all|truncate_to_target|discard_gap')
      }
      const r = reconcileTimerSession(current, decision, now)
      if (r.error) throw fail('command_failed', r.error.message)
      next.timerSessions = replaceSession(next.timerSessions, r.session!)
      effects.push({ type: 'timer_session_updated', sessionId })
      return
    }
    if (command.type === 'switch_session_task') {
      const newSessionId = asString(p.newSessionId)
      if (!newSessionId) throw fail('invalid_command', 'newSessionId required')
      const newTaskId = p.newTaskId === null || p.newTaskId === undefined ? null : asString(p.newTaskId) ?? null
      const r = switchTimerSessionTask({
        session: current,
        nowMs: now,
        newSessionId,
        newTaskId,
        startActionId: command.actionId
      })
      if (r.error) throw fail('command_failed', r.error.message)
      let sessions = next.timerSessions
      if (r.closedSession) sessions = replaceSession(sessions, r.closedSession)
      if (r.session) sessions = [...sessions.filter((s) => s.id !== r.session!.id), r.session]
      next.timerSessions = sessions
      effects.push({ type: 'timer_session_closed', sessionId })
      effects.push({ type: 'timer_session_started', sessionId: newSessionId })
    }
  }
}

function replaceSession(
  sessions: TimerSessionRecord[],
  session: TimerSessionRecord
): TimerSessionRecord[] {
  return sessions.map((s) => (s.id === session.id ? session : s))
}

function fail(
  code: StudyPlanningError['code'],
  message: string,
  details?: Record<string, unknown>
): StudyPlanningError {
  return details ? { code, message, details } : { code, message }
}


