/**
 * Sole-read hydrate: project workspace-canonical StudyPlanning into V1 UI cache.
 *
 * ADR-0117: snapshot.json is authority for tasks/blocks when present.
 * localStorage remains rebuildable cache / presence host; focus clock sole-reads local TimerSession (Slice D).
 *
 * Policy:
 * - missing workspace / API → keep V1 (`v1_cache`), fail-closed (no silent invent)
 * - canonical empty + V1 has tasks → keep V1, set `migrationSuggested`
 * - canonical has tasks → replace UI tasks with projected PlanningTask rows (sole-read)
 * - presence fields stay V1; focus remainingSeconds can be projected from local TimerSession
 * - canonical timerPlans (if any) replace V1 timerPlans list (simulation windows preserved by id)
 * - preferences.defaultTimerPlanId projects as sole-read default catalog selection
 * - preferences.simulationStart/EndTime project as sole-read active allocation window
 * - preferences.recurrenceRules project as sole-read durable recurrence list (STC-703 host)
 * - snapshot.categories project as sole-read category catalog (omit keeps V1 cache)
 * - canonical timerSessions project as sole-read actual-focus source (STC-304 remainder)
 */

import {
  jsWeekdayToMonFirst,
  normalizePreferencesRecurrenceRules,
  type RecurrenceRule,
  type ScheduleBlock,
  type StudyPlanningPreferencesV1,
  type StudyPlanningSnapshotV1,
  type TimerSessionRecord
} from '../../../shared/study-planning'
import type { StudySnapshot, StudyTask, StudyTaskCategory, StudyTaskCategoryId, StudyTaskSchedule } from './types'
import {
  projectPlanningTasksToStudyTasks,
  readStudyPlanningSnapshot,
  type StudyPlanningApi
} from './planning-client'
import { v2TimerPlanToV1 } from './planning-timer-plan-dual-write'
import {
  projectClassificationPromptOptOutFromPreferences,
  projectEmptyStartCategoryIdFromPreferences,
  projectEmptyStartPolicyFromPreferences
} from './planning-study-prefs-ui'
import { projectSimulationWindowFromPreferences } from './planning-simulation-window-ui'
import { projectTaskCategoriesFromSnapshot } from './planning-categories-ui'
import type { EmptyStartPolicy } from '../../../shared/study-planning'

export type HydrateStudyPlanningResult =
  | {
      kind: 'applied'
      snapshot: StudySnapshot
      revision: number
      path: string
      source: 'canonical' | 'backup'
      taskCount: number
      scheduleProjected: number
      /** How many TimerPlanV2 rows projected into V1 catalog (0 keeps host list). */
      timerPlansProjected: number
      /**
       * Sole-read preferences.defaultTimerPlanId.
       * null when unset / empty — catalog UI falls back to classic_25_5.
       */
      defaultTimerPlanId: string | null
      /** Sole-read preferences.emptyStartPolicy (STC-404). Default remember_quick_start. */
      emptyStartPolicy: EmptyStartPolicy
      /** Sole-read preferences.emptyStartCategoryId (default other). */
      emptyStartCategoryId: string
      /** Sole-read preferences.classificationPromptOptOut (STC-406/407 restore). */
      classificationPromptOptOut: boolean
      /**
       * Sole-read preferences simulation window (HH:MM).
       * null when unset/invalid — host keeps V1 cache labels.
       */
      simulationStartTime: string | null
      simulationEndTime: string | null
      /**
       * Sole-read snapshot.categories (ADR-0117).
       * null when unset/invalid — host keeps V1 localStorage categories cache.
       */
      categories: StudyTaskCategory[] | null
      /** Canonical ScheduleBlock rows for multi-block week projection (STC-307). */
      scheduleBlocks: ScheduleBlock[]
      /**
       * Canonical TimerSession rows for task-detail actual focus (STC-304 remainder).
       * Sole-read cache; not teaching authority for open/running clock (local TimerSession).
       */
      timerSessions: TimerSessionRecord[]
      /**
       * Sole-read preferences.recurrenceRules (STC-703 host wire).
       * Empty array when unset / invalid; never invents rules.
       */
      recurrenceRules: RecurrenceRule[]
    }
  | {
      kind: 'kept_v1'
      reason:
        | 'missing_workspace'
        | 'api_unavailable'
        | 'io_failed'
        | 'canonical_empty'
        | 'workspace_denied'
        | 'unknown'
      message: string
      migrationSuggested: boolean
      revision?: number
    }

export type CanonicalHydrateContext = {
  api: StudyPlanningApi | null | undefined
  workspaceRoot: string | null | undefined
  /** Local midnight used only for multi-block → V1 single-schedule pick (display). */
  nowMs?: () => number
}

/**
 * Project preferences.defaultTimerPlanId for UI sole-read.
 * Trims whitespace; empty string becomes null (unset → catalog fallback).
 */
export function projectDefaultTimerPlanIdFromPreferences(
  preferences: StudyPlanningPreferencesV1 | null | undefined
): string | null {
  if (!preferences) return null
  const raw = preferences.defaultTimerPlanId
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') return null
  const id = raw.trim()
  return id.length > 0 ? id : null
}

/**
 * Project preferences.recurrenceRules for UI sole-read (STC-703).
 * Fail-closed normalize: cap, dedupe, drop invalid; empty when unset.
 */
export function projectRecurrenceRulesFromPreferences(
  preferences: StudyPlanningPreferencesV1 | null | undefined
): RecurrenceRule[] {
  return normalizePreferencesRecurrenceRules(preferences?.recurrenceRules)
}


/**
 * Reverse a ScheduleBlock interval into V1 weekday+minutes (local wall clock).
 * Returns null when interval spans midnight or is invalid (V1 cannot represent it cleanly).
 */
export function scheduleBlockToV1Schedule(
  block: Pick<ScheduleBlock, 'startAtMs' | 'endAtMs'>
): StudyTaskSchedule | null {
  if (!Number.isFinite(block.startAtMs) || !Number.isFinite(block.endAtMs)) return null
  if (block.endAtMs <= block.startAtMs) return null
  const start = new Date(block.startAtMs)
  const end = new Date(block.endAtMs)
  if (start.getFullYear() !== end.getFullYear()
    || start.getMonth() !== end.getMonth()
    || start.getDate() !== end.getDate()) {
    return null
  }
  const startMinutes = start.getHours() * 60 + start.getMinutes()
  const endMinutes = end.getHours() * 60 + end.getMinutes()
  if (endMinutes <= startMinutes) return null
  if (startMinutes < 0 || endMinutes > 24 * 60) return null
  // Product V1 UI is Mon-first (0=Mon); Date.getDay() is Sun-first.
  const monFirst = jsWeekdayToMonFirst(start.getDay())
  if (monFirst == null) return null
  return {
    weekday: monFirst,
    startMinutes,
    endMinutes
  }
}

/**
 * Pick one focus block per task for V1's single embedded schedule field.
 * Prefers: next future block, else latest past block, else first by start.
 */
export function pickPrimaryScheduleBlockForTask(
  blocks: readonly ScheduleBlock[],
  taskId: string,
  nowMs: number
): ScheduleBlock | null {
  const focus = blocks
    .filter((b) => b.taskId === taskId && b.kind === 'focus' && b.status !== 'cancelled')
    .slice()
    .sort((a, b) => a.startAtMs - b.startAtMs)
  if (focus.length === 0) return null
  const future = focus.filter((b) => b.endAtMs > nowMs)
  if (future.length > 0) return future[0] ?? null
  return focus[focus.length - 1] ?? null
}

export type ProjectedStudyTask = StudyTask & {
  /** True when category was inbox (categoryId null in planning). */
  fromInbox?: boolean
}

/**
 * Project canonical tasks (+ optional primary block schedule) into V1 StudyTask rows.
 */
export function projectCanonicalTasksForUi(
  planning: Pick<StudyPlanningSnapshotV1, 'tasks' | 'scheduleBlocks'>,
  options?: { nowMs?: number }
): { tasks: StudyTask[]; scheduleProjected: number } {
  const nowMs = options?.nowMs ?? Date.now()
  const base = projectPlanningTasksToStudyTasks(planning.tasks)
  let scheduleProjected = 0
  const tasks: StudyTask[] = base.map((row, index) => {
    const planningTask = planning.tasks[index]
    const block = planningTask
      ? pickPrimaryScheduleBlockForTask(planning.scheduleBlocks, planningTask.id, nowMs)
      : null
    const schedule = block ? scheduleBlockToV1Schedule(block) : null
    if (schedule) scheduleProjected += 1

    const categoryId = row.categoryId as StudyTaskCategoryId | undefined
    const task: StudyTask = {
      id: row.id,
      title: row.title,
      done: row.done,
      ...(categoryId ? { categoryId } : {}),
      ...(schedule ? { schedule } : {}),
      ...(row.estimateMinutes !== undefined ? { estimateMinutes: row.estimateMinutes } : {})
    }
    return task
  })
  return { tasks, scheduleProjected }
}

/**
 * Project canonical TimerPlanV2 catalog into V1 StudyTimerPlan list (UI cache).
 * Preserves host simulation window defaults when matching id exists.
 */
export function projectCanonicalTimerPlansForUi(
  planning: Pick<StudyPlanningSnapshotV1, 'timerPlans'>,
  hostPlans: readonly import('./types').StudyTimerPlan[] = []
): import('./types').StudyTimerPlan[] {
  if (!planning.timerPlans || planning.timerPlans.length === 0) return []
  const hostById = new Map(hostPlans.map((p) => [p.id, p]))
  return planning.timerPlans.map((p) => {
    const host = hostById.get(p.id)
    return v2TimerPlanToV1(p, {
      simulationStartTime: host?.simulationStartTime,
      simulationEndTime: host?.simulationEndTime
    })
  })
}

/**
 * Merge projected canonical tasks (+ optional timerPlans) into a V1 StudySnapshot host shell.
 * Presence / room fields stay from host.
 */
export function mergeCanonicalTasksIntoStudySnapshot(
  host: StudySnapshot,
  planning: StudyPlanningSnapshotV1,
  options?: { nowMs?: number }
): { snapshot: StudySnapshot; scheduleProjected: number; timerPlansProjected: number } {
  const { tasks, scheduleProjected } = projectCanonicalTasksForUi(planning, options)
  const projectedPlans = projectCanonicalTimerPlansForUi(planning, host.timerPlans)
  const timerPlans =
    projectedPlans.length > 0 ? projectedPlans : host.timerPlans
  const sim = projectSimulationWindowFromPreferences(planning.preferences)
  return {
    snapshot: {
      ...host,
      tasks,
      timerPlans,
      ...(sim
        ? { simulationStartTime: sim.start, simulationEndTime: sim.end }
        : {})
    },
    scheduleProjected,
    timerPlansProjected: projectedPlans.length
  }
}

function tasksFingerprint(tasks: readonly StudyTask[]): string {
  return JSON.stringify(
    tasks.map((t) => ({
      id: t.id,
      title: t.title,
      done: t.done,
      categoryId: t.categoryId ?? null,
      schedule: t.schedule ?? null,
      estimateMinutes: t.estimateMinutes ?? null
    }))
  )
}

/**
 * True when two task lists match (for race-safe hydrate apply).
 */
export function studyTasksEqual(
  a: readonly StudyTask[],
  b: readonly StudyTask[]
): boolean {
  return tasksFingerprint(a) === tasksFingerprint(b)
}

/**
 * Read canonical and, when it holds tasks, replace host UI tasks (sole-read).
 * Never wipes V1 when canonical is empty (migration path still required).
 */
export async function hydrateStudyTasksFromCanonical(
  ctx: CanonicalHydrateContext,
  host: StudySnapshot,
  options?: {
    /**
     * Tasks fingerprint at request start. After the async read, apply only when
     * live host tasks still match (via getCurrentHostTasks, else frozen host).
     */
    expectedHostTasks?: readonly StudyTask[]
    /**
     * Live host tasks after the await. Required for race-safe sole-read apply
     * when the UI may mutate V1 during the IPC round-trip.
     */
    getCurrentHostTasks?: () => readonly StudyTask[]
  }
): Promise<HydrateStudyPlanningResult> {
  const root = typeof ctx.workspaceRoot === 'string' ? ctx.workspaceRoot.trim() : ''
  if (!root) {
    return {
      kind: 'kept_v1',
      reason: 'missing_workspace',
      message: 'No active workspace root; keeping V1 UI cache.',
      migrationSuggested: host.tasks.length > 0
    }
  }
  if (!ctx.api || typeof ctx.api.readStudyPlanning !== 'function') {
    return {
      kind: 'kept_v1',
      reason: 'api_unavailable',
      message: 'TeachingSystemApi.readStudyPlanning unavailable; keeping V1 UI cache.',
      migrationSuggested: host.tasks.length > 0
    }
  }

  const read = await readStudyPlanningSnapshot(ctx.api, root)
  if (!read.ok) {
    const reason =
      read.code === 'missing_workspace'
        ? 'missing_workspace'
        : read.code === 'api_unavailable'
          ? 'api_unavailable'
          : read.code === 'workspace_denied'
            ? 'workspace_denied'
            : read.code === 'io_failed'
              ? 'io_failed'
              : 'unknown'
    return {
      kind: 'kept_v1',
      reason,
      message: read.message,
      migrationSuggested: host.tasks.length > 0
    }
  }

  if (options?.expectedHostTasks) {
    const liveTasks = options.getCurrentHostTasks?.() ?? host.tasks
    if (!studyTasksEqual(liveTasks, options.expectedHostTasks)) {
      // Race: user mutated V1 while we were reading — do not stomp.
      return {
        kind: 'kept_v1',
        reason: 'unknown',
        message: 'Host tasks changed during canonical read; skipped hydrate apply.',
        migrationSuggested: false,
        revision: read.snapshot.revision
      }
    }
  }

  const planning = read.snapshot
  if (!planning.tasks || planning.tasks.length === 0) {
    return {
      kind: 'kept_v1',
      reason: 'canonical_empty',
      message: 'Canonical planning has no tasks; keeping V1 UI cache (run migration if needed).',
      migrationSuggested: host.tasks.length > 0,
      revision: planning.revision
    }
  }

  const nowMs = ctx.nowMs?.() ?? Date.now()
  const merged = mergeCanonicalTasksIntoStudySnapshot(host, planning, { nowMs })
  return {
    kind: 'applied',
    snapshot: merged.snapshot,
    revision: planning.revision,
    path: read.path,
    source: read.source === 'backup' ? 'backup' : 'canonical',
    taskCount: merged.snapshot.tasks.length,
    scheduleProjected: merged.scheduleProjected,
    timerPlansProjected: merged.timerPlansProjected,
    defaultTimerPlanId: projectDefaultTimerPlanIdFromPreferences(planning.preferences),
    emptyStartPolicy: projectEmptyStartPolicyFromPreferences(planning.preferences),
    emptyStartCategoryId: projectEmptyStartCategoryIdFromPreferences(planning.preferences),
    classificationPromptOptOut: projectClassificationPromptOptOutFromPreferences(
      planning.preferences
    ),
    simulationStartTime: projectSimulationWindowFromPreferences(planning.preferences)?.start ?? null,
    simulationEndTime: projectSimulationWindowFromPreferences(planning.preferences)?.end ?? null,
    categories: projectTaskCategoriesFromSnapshot(planning.categories),
    scheduleBlocks: planning.scheduleBlocks.slice(),
    timerSessions: Array.isArray(planning.timerSessions) ? planning.timerSessions.slice() : [],
    recurrenceRules: projectRecurrenceRulesFromPreferences(planning.preferences),
  }
}
