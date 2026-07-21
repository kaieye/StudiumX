/**
 * Sole-read hydrate: project workspace-canonical StudyPlanning into V1 UI cache.
 *
 * ADR-0117: snapshot.json is authority for tasks/blocks when present.
 * localStorage remains rebuildable cache / presence+timer host until Slice D.
 *
 * Policy:
 * - missing workspace / API → keep V1 (`v1_cache`), fail-closed (no silent invent)
 * - canonical empty + V1 has tasks → keep V1, set `migrationSuggested`
 * - canonical has tasks → replace UI tasks with projected PlanningTask rows (sole-read)
 * - timer/presence fields always stay from V1 host until timer durable cutover
 */

import {
  jsWeekdayToMonFirst,
  type ScheduleBlock,
  type StudyPlanningSnapshotV1
} from '../../../shared/study-planning'
import type { StudySnapshot, StudyTask, StudyTaskCategoryId, StudyTaskSchedule } from './types'
import {
  projectPlanningTasksToStudyTasks,
  readStudyPlanningSnapshot,
  type StudyPlanningApi
} from './planning-client'

export type HydrateStudyPlanningResult =
  | {
      kind: 'applied'
      snapshot: StudySnapshot
      revision: number
      path: string
      source: 'canonical' | 'backup'
      taskCount: number
      scheduleProjected: number
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
      ...(schedule ? { schedule } : {})
    }
    return task
  })
  return { tasks, scheduleProjected }
}

/**
 * Merge projected canonical tasks into a V1 StudySnapshot host shell.
 * Timer / presence / room fields stay from host (not yet sole-read).
 */
export function mergeCanonicalTasksIntoStudySnapshot(
  host: StudySnapshot,
  planning: StudyPlanningSnapshotV1,
  options?: { nowMs?: number }
): { snapshot: StudySnapshot; scheduleProjected: number } {
  const { tasks, scheduleProjected } = projectCanonicalTasksForUi(planning, options)
  return {
    snapshot: {
      ...host,
      tasks
    },
    scheduleProjected
  }
}

function tasksFingerprint(tasks: readonly StudyTask[]): string {
  return JSON.stringify(
    tasks.map((t) => ({
      id: t.id,
      title: t.title,
      done: t.done,
      categoryId: t.categoryId ?? null,
      schedule: t.schedule ?? null
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
    scheduleProjected: merged.scheduleProjected
  }
}
