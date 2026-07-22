/**
 * Pure reducer for import_migration_commit (ADR-0117 §4).
 *
 * Consumes dry-run MigrateStudyV1Result fields only (no localStorage / fs).
 * Fail-closed: userConfirmed required; entity validation; locked-block overlap.
 * Never treats suggestedWindows as historical schedule facts.
 */

import type { PlanningTask, ScheduleBlock } from './schedule-block'
import { validateScheduleBlocks } from './schedule-block'
import type { TimerPlanV2 } from './timer-plan'
import type { TimerSessionRecord } from './timer-session-lifecycle'
import type {
  StudyPlanningEffect,
  StudyPlanningError,
  StudyPlanningPreferencesV1,
  StudyPlanningSnapshotV1
} from './study-planning-store'
import {
  normalizeStudyPlanningCategories,
  type StudyPlanningCategoryV1
} from './study-planning-categories'
import type { MigrationReportEntry, SuggestedTimeWindow } from './migrate-v1'

export type ImportMigrationCommitPayload = {
  /** Must be true — dry-run alone never commits. */
  userConfirmed: true
  tasks?: readonly PlanningTask[]
  scheduleBlocks?: readonly ScheduleBlock[]
  timerPlans?: readonly TimerPlanV2[]
  /**
   * Optional sessions from unreliable V1 active timers.
   * Any non-closed session is forced to needs_reconcile (never silent focus credit).
   */
  timerSessions?: readonly TimerSessionRecord[]
  preferences?: Partial<StudyPlanningPreferencesV1>
  /** Optional category catalog seed (dedupe keep color/id). */
  categories?: readonly StudyPlanningCategoryV1[]
  /** Report codes from dry-run (stored as rebuildable hints only). */
  migrationReport?: readonly MigrationReportEntry[]
  /** Suggested windows only — never written as ScheduleBlock history. */
  suggestedWindows?: readonly SuggestedTimeWindow[]
  source?: 'v1_local_storage' | string
}

export type ImportMigrationCommitOk = {
  ok: true
  snapshot: StudyPlanningSnapshotV1
  effects: StudyPlanningEffect[]
  summary: {
    tasksAdded: number
    tasksSkippedExisting: number
    blocksAdded: number
    blocksSkippedExisting: number
    plansAdded: number
    sessionsImported: number
    sessionsNeedsReconcile: number
  }
}

export type ImportMigrationCommitErr = {
  ok: false
  error: StudyPlanningError
}

const TASK_STATUS = new Set(['open', 'done', 'cancelled'])
const TASK_SOURCE = new Set(['migrated_v1', 'manual', 'allocator', 'quick_start'])
const BLOCK_KIND = new Set(['focus', 'short_break', 'long_break', 'wrap_up'])
const BLOCK_SOURCE = new Set(['manual', 'allocator', 'quick_start', 'migrated_v1'])
const BLOCK_STATUS = new Set(['planned', 'running', 'completed', 'skipped', 'cancelled'])
const SESSION_STATE = new Set([
  'idle',
  'running',
  'paused',
  'completed',
  'cancelled',
  'needs_reconcile'
])
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fail(code: StudyPlanningError['code'], message: string, details?: Record<string, unknown>): ImportMigrationCommitErr {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } }
}

function asTask(raw: unknown, index: number): PlanningTask | ImportMigrationCommitErr {
  if (!isObject(raw)) return fail('invalid_command', `tasks[${index}] must be object`)
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!id || !title) return fail('invalid_command', `tasks[${index}] requires id and title`)
  const status = typeof raw.status === 'string' ? raw.status : 'open'
  if (!TASK_STATUS.has(status)) return fail('invalid_command', `tasks[${index}] invalid status`)
  const source = typeof raw.source === 'string' ? raw.source : 'migrated_v1'
  if (!TASK_SOURCE.has(source)) return fail('invalid_command', `tasks[${index}] invalid source`)
  const inbox = raw.inbox === true || raw.categoryId == null || raw.categoryId === ''
  const categoryId =
    raw.categoryId == null || raw.categoryId === ''
      ? null
      : typeof raw.categoryId === 'string'
        ? raw.categoryId.trim() || null
        : null
  const revision =
    typeof raw.revision === 'number' && Number.isFinite(raw.revision) && raw.revision >= 1
      ? Math.trunc(raw.revision)
      : 1
  return {
    id,
    title,
    status: status as PlanningTask['status'],
    categoryId,
    inbox,
    estimateMinutes:
      typeof raw.estimateMinutes === 'number' || raw.estimateMinutes === null
        ? (raw.estimateMinutes as number | null)
        : null,
    remainingEstimateMinutes:
      typeof raw.remainingEstimateMinutes === 'number' || raw.remainingEstimateMinutes === null
        ? (raw.remainingEstimateMinutes as number | null)
        : null,
    splittable: raw.splittable !== false,
    revision,
    source: source as PlanningTask['source']
  }
}

function asBlock(raw: unknown, index: number): ScheduleBlock | ImportMigrationCommitErr {
  if (!isObject(raw)) return fail('invalid_command', `scheduleBlocks[${index}] must be object`)
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return fail('invalid_command', `scheduleBlocks[${index}] requires id`)
  if (typeof raw.kind !== 'string' || !BLOCK_KIND.has(raw.kind)) {
    return fail('invalid_command', `scheduleBlocks[${index}] invalid kind`)
  }
  if (typeof raw.source !== 'string' || !BLOCK_SOURCE.has(raw.source)) {
    return fail('invalid_command', `scheduleBlocks[${index}] invalid source`)
  }
  if (typeof raw.status !== 'string' || !BLOCK_STATUS.has(raw.status)) {
    return fail('invalid_command', `scheduleBlocks[${index}] invalid status`)
  }
  if (typeof raw.startAtMs !== 'number' || !Number.isFinite(raw.startAtMs)) {
    return fail('invalid_command', `scheduleBlocks[${index}] invalid startAtMs`)
  }
  if (typeof raw.endAtMs !== 'number' || !Number.isFinite(raw.endAtMs)) {
    return fail('invalid_command', `scheduleBlocks[${index}] invalid endAtMs`)
  }
  if (raw.endAtMs <= raw.startAtMs) {
    return fail('invalid_command', `scheduleBlocks[${index}] endAtMs must be after startAtMs`)
  }
  const taskId =
    raw.taskId == null || raw.taskId === ''
      ? null
      : typeof raw.taskId === 'string'
        ? raw.taskId.trim() || null
        : null
  const revision =
    typeof raw.revision === 'number' && Number.isFinite(raw.revision) && raw.revision >= 1
      ? Math.trunc(raw.revision)
      : 1
  return {
    id,
    taskId,
    kind: raw.kind as ScheduleBlock['kind'],
    startAtMs: raw.startAtMs,
    endAtMs: raw.endAtMs,
    locked: raw.locked === true,
    source: raw.source as ScheduleBlock['source'],
    status: raw.status as ScheduleBlock['status'],
    revision,
    ...(typeof raw.planId === 'string' && raw.planId.trim() ? { planId: raw.planId.trim() } : {}),
    ...(typeof raw.planRevision === 'number' && Number.isFinite(raw.planRevision)
      ? { planRevision: Math.trunc(raw.planRevision) }
      : {})
  }
}

function asPlan(raw: unknown, index: number): TimerPlanV2 | ImportMigrationCommitErr {
  if (!isObject(raw)) return fail('invalid_command', `timerPlans[${index}] must be object`)
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!id || !name) return fail('invalid_command', `timerPlans[${index}] requires id and name`)
  // Structural accept: plans already normalized by migrateStudyV1ToPlanning / save_timer_plan.
  return raw as TimerPlanV2
}

function forceNeedsReconcile(session: TimerSessionRecord, nowMs: number): TimerSessionRecord {
  // Closed / idle / already reconcile: leave alone (ADR: only unreliable *active* timers).
  if (
    session.state === 'completed' ||
    session.state === 'cancelled' ||
    session.state === 'idle' ||
    session.state === 'needs_reconcile'
  ) {
    return session
  }
  // running | paused → needs_reconcile; never silent focus credit.
  const pending =
    typeof session.pendingReconcileSeconds === 'number' && session.pendingReconcileSeconds > 0
      ? session.pendingReconcileSeconds
      : Math.max(0, Math.floor((nowMs - session.lastSampleWallMs) / 1000))
  return {
    ...session,
    state: 'needs_reconcile',
    pendingReconcileSeconds: pending > 0 ? pending : 1
  }
}

function asSession(raw: unknown, index: number, nowMs: number): TimerSessionRecord | ImportMigrationCommitErr {
  if (!isObject(raw)) return fail('invalid_command', `timerSessions[${index}] must be object`)
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return fail('invalid_command', `timerSessions[${index}] requires id`)
  if (typeof raw.state !== 'string' || !SESSION_STATE.has(raw.state)) {
    return fail('invalid_command', `timerSessions[${index}] invalid state`)
  }
  // Duck-type remaining required fields; migration path should only pass records or omit.
  const session = raw as TimerSessionRecord
  if (typeof session.startedAtMs !== 'number' || !Number.isFinite(session.startedAtMs)) {
    return fail('invalid_command', `timerSessions[${index}] invalid startedAtMs`)
  }
  if (typeof session.lastSampleWallMs !== 'number' || !Number.isFinite(session.lastSampleWallMs)) {
    return fail('invalid_command', `timerSessions[${index}] invalid lastSampleWallMs`)
  }
  return forceNeedsReconcile(session, nowMs)
}

/**
 * Apply import_migration_commit onto a cloned snapshot base (caller clones).
 * Idempotent-friendly: existing task/block/plan/session ids are skipped, not clobbered.
 */
export function applyImportMigrationCommit(input: {
  base: StudyPlanningSnapshotV1
  payload: unknown
  nowMs: number
}): ImportMigrationCommitOk | ImportMigrationCommitErr {
  const { base, nowMs } = input
  if (!isObject(input.payload)) {
    return fail('invalid_command', 'import_migration_commit payload object required')
  }
  if (input.payload.userConfirmed !== true) {
    return fail(
      'invalid_command',
      'import_migration_commit requires userConfirmed:true (dry-run alone never commits)'
    )
  }

  const rawTasks = Array.isArray(input.payload.tasks) ? input.payload.tasks : []
  const rawBlocks = Array.isArray(input.payload.scheduleBlocks) ? input.payload.scheduleBlocks : []
  const rawPlans = Array.isArray(input.payload.timerPlans) ? input.payload.timerPlans : []
  const rawSessions = Array.isArray(input.payload.timerSessions) ? input.payload.timerSessions : []

  if (rawTasks.length === 0 && rawBlocks.length === 0 && rawPlans.length === 0 && rawSessions.length === 0) {
    return fail('invalid_command', 'import_migration_commit requires at least one entity')
  }

  const tasks: PlanningTask[] = []
  for (let i = 0; i < rawTasks.length; i += 1) {
    const t = asTask(rawTasks[i], i)
    if ('error' in t) return t
    tasks.push(t as PlanningTask)
  }
  const taskIds = new Set(tasks.map((t) => t.id))
  if (taskIds.size !== tasks.length) {
    return fail('invalid_command', 'import_migration_commit tasks contain duplicate ids')
  }

  const blocks: ScheduleBlock[] = []
  for (let i = 0; i < rawBlocks.length; i += 1) {
    const b = asBlock(rawBlocks[i], i)
    if ('error' in b) return b
    blocks.push(b as ScheduleBlock)
  }
  const blockIds = new Set(blocks.map((b) => b.id))
  if (blockIds.size !== blocks.length) {
    return fail('invalid_command', 'import_migration_commit scheduleBlocks contain duplicate ids')
  }
  // Focus blocks with taskId must reference a task in import or existing base.
  const knownTaskIds = new Set([...base.tasks.map((t) => t.id), ...taskIds])
  for (const block of blocks) {
    if (block.taskId && !knownTaskIds.has(block.taskId)) {
      return fail(
        'invalid_command',
        `scheduleBlock ${block.id} references unknown taskId ${block.taskId}`
      )
    }
  }

  const plans: TimerPlanV2[] = []
  for (let i = 0; i < rawPlans.length; i += 1) {
    const p = asPlan(rawPlans[i], i)
    if ('error' in p) return p
    plans.push(p as TimerPlanV2)
  }

  const sessions: TimerSessionRecord[] = []
  for (let i = 0; i < rawSessions.length; i += 1) {
    const s = asSession(rawSessions[i], i, nowMs)
    if ('error' in s) return s
    sessions.push(s as TimerSessionRecord)
  }

  // Merge: existing ids win (dual-write / prior state not clobbered).
  const existingTaskIds = new Set(base.tasks.map((t) => t.id))
  const existingBlockIds = new Set(base.scheduleBlocks.map((b) => b.id))
  const existingPlanIds = new Set(base.timerPlans.map((p) => p.id))
  const existingSessionIds = new Set(base.timerSessions.map((s) => s.id))

  const addedTasks = tasks.filter((t) => !existingTaskIds.has(t.id))
  const skippedTasks = tasks.length - addedTasks.length
  const addedBlocks = blocks.filter((b) => !existingBlockIds.has(b.id))
  const skippedBlocks = blocks.length - addedBlocks.length
  const addedPlans = plans.filter((p) => !existingPlanIds.has(p.id))
  const addedSessions = sessions.filter((s) => !existingSessionIds.has(s.id))

  const nextTasks = [...base.tasks, ...addedTasks]
  const nextBlocks = [...base.scheduleBlocks, ...addedBlocks]
  const validation = validateScheduleBlocks(nextBlocks)
  if (!validation.ok) {
    return fail('invariant_violation', 'schedule validation failed after migration merge', {
      issues: validation.issues
    })
  }

  let nextPlans = [...base.timerPlans]
  for (const plan of addedPlans) {
    if (nextPlans.length >= 12) {
      return fail('invariant_violation', 'timer plan limit 12; refuse silent truncate on migration')
    }
    nextPlans = [plan, ...nextPlans]
  }

  const nextSessions = [...base.timerSessions, ...addedSessions]
  // Single running invariant: needs_reconcile is not "running", but re-check running.
  const running = nextSessions.filter((s) => s.state === 'running')
  if (running.length > 1) {
    return fail('invariant_violation', 'multiple running TimerSession after migration', {
      ids: running.map((s) => s.id)
    })
  }

  let preferences = { ...base.preferences }
  if (isObject(input.payload.preferences)) {
    const pref = input.payload.preferences
    if (typeof pref.emptyStartPolicy === 'string') {
      if (
        pref.emptyStartPolicy === 'ask_every_time' ||
        pref.emptyStartPolicy === 'remember_quick_start' ||
        pref.emptyStartPolicy === 'remember_unattributed'
      ) {
        preferences = { ...preferences, emptyStartPolicy: pref.emptyStartPolicy }
      }
    }
    if (typeof pref.classificationPromptOptOut === 'boolean') {
      preferences = { ...preferences, classificationPromptOptOut: pref.classificationPromptOptOut }
    }
    if (pref.defaultTimerPlanId === null || typeof pref.defaultTimerPlanId === 'string') {
      preferences = {
        ...preferences,
        defaultTimerPlanId: pref.defaultTimerPlanId as string | null
      }
    }
    if (typeof pref.simulationStartTime === 'string' && /^\d{1,2}:\d{2}$/.test(pref.simulationStartTime.trim())) {
      const m = pref.simulationStartTime.trim().match(/^(\d{1,2}):(\d{2})$/)
      if (m) {
        const h = Math.min(23, Math.max(0, Number(m[1])))
        const min = Math.min(59, Math.max(0, Number(m[2])))
        preferences = {
          ...preferences,
          simulationStartTime: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
        }
      }
    }
    if (typeof pref.simulationEndTime === 'string' && /^\d{1,2}:\d{2}$/.test(pref.simulationEndTime.trim())) {
      const m = pref.simulationEndTime.trim().match(/^(\d{1,2}):(\d{2})$/)
      if (m) {
        const h = Math.min(23, Math.max(0, Number(m[1])))
        const min = Math.min(59, Math.max(0, Number(m[2])))
        preferences = {
          ...preferences,
          simulationEndTime: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
        }
      }
    }
  }

  let categories: StudyPlanningCategoryV1[] | undefined = base.categories
  if (Array.isArray(input.payload.categories)) {
    categories = normalizeStudyPlanningCategories(input.payload.categories)
  }

  const report = Array.isArray(input.payload.migrationReport)
    ? input.payload.migrationReport
    : []
  const suggestedWindows = Array.isArray(input.payload.suggestedWindows)
    ? input.payload.suggestedWindows
    : []
  const source =
    typeof input.payload.source === 'string' && input.payload.source.trim()
      ? input.payload.source.trim()
      : 'v1_local_storage'

  const needsReconcileCount = addedSessions.filter((s) => s.state === 'needs_reconcile').length

  const effects: StudyPlanningEffect[] = [
    {
      type: 'migration_committed',
      source,
      tasksAdded: addedTasks.length,
      blocksAdded: addedBlocks.length,
      plansAdded: addedPlans.length,
      sessionsImported: addedSessions.length
    },
    ...(addedBlocks.length > 0
      ? ([{ type: 'schedule_blocks_applied', count: addedBlocks.length }] as StudyPlanningEffect[])
      : []),
    ...addedTasks.map(
      (t): StudyPlanningEffect => ({ type: 'task_created', taskId: t.id })
    ),
    ...addedSessions
      .filter((s) => s.state === 'needs_reconcile')
      .map(
        (s): StudyPlanningEffect => ({
          type: 'reconcile_required',
          sessionId: s.id,
          gapSeconds: s.pendingReconcileSeconds ?? 0
        })
      )
  ]

  const snapshot: StudyPlanningSnapshotV1 = {
    ...base,
    tasks: nextTasks,
    scheduleBlocks: nextBlocks,
    timerPlans: nextPlans,
    timerSessions: nextSessions,
    preferences,
    ...(categories ? { categories } : {}),
    localAnalyticsHints: {
      ...base.localAnalyticsHints,
      lastMigration: {
        atMs: nowMs,
        source,
        report,
        // Rebuildable suggestions only — not schedule authority.
        suggestedWindows,
        summary: {
          tasksAdded: addedTasks.length,
          tasksSkippedExisting: skippedTasks,
          blocksAdded: addedBlocks.length,
          blocksSkippedExisting: skippedBlocks,
          plansAdded: addedPlans.length,
          sessionsImported: addedSessions.length,
          sessionsNeedsReconcile: needsReconcileCount
        }
      }
    }
  }

  return {
    ok: true,
    snapshot,
    effects,
    summary: {
      tasksAdded: addedTasks.length,
      tasksSkippedExisting: skippedTasks,
      blocksAdded: addedBlocks.length,
      blocksSkippedExisting: skippedBlocks,
      plansAdded: addedPlans.length,
      sessionsImported: addedSessions.length,
      sessionsNeedsReconcile: needsReconcileCount
    }
  }
}
