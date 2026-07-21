/**
 * StudyPlanningStore pure/in-memory sole-writer skeleton (ADR-0117).
 *
 * No filesystem yet — durable publish is a later adapter. Commands, revision CAS,
 * and actionId exact-retry are enforced here so Phase 2+ can unit-test before IPC.
 */

import type { PlanningTask, ScheduleBlock } from './schedule-block'
import { proposalBlocksToScheduleBlocks, validateScheduleBlocks } from './schedule-block'
import type { TimerPlanV2 } from './timer-plan'
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
  type FutureBlocksDecision
} from './task-timeline-projection'
import { applyImportMigrationCommit } from './import-migration-commit'
import { normalizeFutureBlocksDecision } from './future-blocks-decision-sheet'

export const STUDY_PLANNING_SCHEMA = 'studiumx.study-planning' as const
export const STUDY_PLANNING_SCHEMA_VERSION = 1 as const

export type StudyPlanningPreferencesV1 = {
  emptyStartPolicy?: 'ask_every_time' | 'remember_quick_start' | 'remember_unattributed'
  classificationPromptOptOut?: boolean
  defaultTimerPlanId?: string | null
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
  /** Rebuildable local hints only — never remote telemetry. */
  localAnalyticsHints: Record<string, unknown>
}

export type StudyPlanningCommandType =
  | 'create_task'
  | 'update_task'
  | 'complete_task'
  | 'save_timer_plan'
  | 'delete_timer_plan'
  | 'copy_timer_plan'
  | 'apply_allocation_proposal'
  | 'upsert_schedule_block'
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
  | { type: 'classification_prompt_suggested'; taskId: string }
  | { type: 'future_blocks_need_decision'; taskId: string; blockIds: string[] }
  | { type: 'schedule_blocks_applied'; count: number }
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
      emptyStartPolicy: 'ask_every_time',
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
        case 'save_timer_plan': {
          const p = command.payload
          if (!isObject(p) || !isObject(p.plan)) throw fail('invalid_command', 'save_timer_plan.plan required')
          const plan = p.plan as TimerPlanV2
          if (!plan.id?.trim()) throw fail('invalid_command', 'plan.id required')
          if (isBuiltinTimerPlanId(plan.id) && !next.timerPlans.some((x) => x.id === plan.id)) {
            // Allow saving a user override only if already in list; else force copy path
          }
          const others = next.timerPlans.filter((x) => x.id !== plan.id)
          if (others.length + 1 > 12) {
            throw fail('invariant_violation', 'timer plan limit 12; refuse silent truncate')
          }
          next.timerPlans = [plan, ...others]
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
                          name: '深度 50/10',
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
        case 'apply_allocation_proposal': {
          const p = command.payload
          if (!isObject(p) || !Array.isArray(p.blocks)) {
            throw fail('invalid_command', 'apply_allocation_proposal.blocks required')
          }
          const drafts = proposalBlocksToScheduleBlocks({
            blocks: p.blocks as Parameters<typeof proposalBlocksToScheduleBlocks>[0]['blocks'],
            planId: asString(p.planId),
            planRevision: typeof p.planRevision === 'number' ? p.planRevision : undefined,
            idPrefix: asString(p.idPrefix) ?? 'alloc'
          })
          // Never move locked existing blocks: drop proposal pieces that overlap locked.
          const locked = next.scheduleBlocks.filter((b) => b.locked)
          const safe: ScheduleBlock[] = []
          for (const draft of drafts) {
            const hitsLocked = locked.some(
              (l) => draft.startAtMs < l.endAtMs && l.startAtMs < draft.endAtMs
            )
            if (hitsLocked) continue
            safe.push(draft)
          }
          const merged = [...next.scheduleBlocks, ...safe]
          const validation = validateScheduleBlocks(merged)
          if (!validation.ok) {
            throw fail('invariant_violation', 'schedule validation failed', {
              issues: validation.issues
            })
          }
          next.scheduleBlocks = merged
          effects.push({ type: 'schedule_blocks_applied', count: safe.length })
          break
        }
        case 'upsert_schedule_block': {
          const p = command.payload
          if (!isObject(p) || !isObject(p.block)) throw fail('invalid_command', 'upsert_schedule_block.block required')
          const block = p.block as ScheduleBlock
          if (!block.id?.trim()) throw fail('invalid_command', 'block.id required')
          const without = next.scheduleBlocks.filter((b) => b.id !== block.id)
          const merged = [...without, block]
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
              categoryId: null,
              inbox: true,
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
          const started = startTimerSession({
            id,
            nowMs: now,
            plan,
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
            ...(typeof p.classificationPromptOptOut === 'boolean'
              ? { classificationPromptOptOut: p.classificationPromptOptOut }
              : {}),
            ...(p.defaultTimerPlanId === null || typeof p.defaultTimerPlanId === 'string'
              ? { defaultTimerPlanId: p.defaultTimerPlanId as string | null }
              : {})
          }
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
