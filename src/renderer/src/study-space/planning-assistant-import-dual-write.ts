/**
 * Pure helpers for assistant-todo → planning dual-write (sole-authority demotion).
 *
 * AssistantTodoCapture historically wrote only V1 localStorage and dispatched
 * STUDY_TASKS_CHANGED_EVENT. When canonical already has tasks, hydrate sole-read
 * replaces the UI list — so assistant-only V1 creates were teaching-truth leaks.
 *
 * This module:
 * - diffs previous vs next V1 task lists to find **added** open tasks
 * - dual-writes each added id via dualWriteCreateTask (shared id)
 * - does **not** invent deletes / reopens; fail-closed on missing workspace
 *
 * No I/O beyond dualWriteCreateTask; no auto-erase of localStorage.
 */

import {
  dualWriteCreateTask,
  type CanonicalPlanningContext,
  type DualWriteResult
} from './planning-dual-write'
import type { StudyTask } from './types'

export type AssistantImportAddedTask = {
  id: string
  title: string
  categoryId: string | null
}

export type DualWriteAssistantImportTasksResult = {
  /** Tasks newly present in `next` that were absent from `previous` (by id). */
  added: AssistantImportAddedTask[]
  /** One dual-write outcome per added task (same order as `added`). */
  writes: DualWriteResult[]
  /** True when every write is canonical_ok or the batch was empty. */
  allOk: boolean
  /** True when at least one write is canonical_failed. */
  anyFailed: boolean
  /** True when at least one write is canonical_skipped (no workspace/API). */
  anySkipped: boolean
}

/**
 * Pure: tasks in `next` whose id is not in `previous`.
 * Only open tasks (done=false) are dual-write candidates — complete path is separate.
 */
export function collectAssistantImportAddedTasks(
  previous: readonly StudyTask[],
  next: readonly StudyTask[]
): AssistantImportAddedTask[] {
  const prevIds = new Set(
    previous
      .map((t) => (typeof t.id === 'string' ? t.id.trim() : ''))
      .filter((id) => id.length > 0)
  )
  const added: AssistantImportAddedTask[] = []
  const seen = new Set<string>()
  for (const task of next) {
    const id = typeof task.id === 'string' ? task.id.trim() : ''
    if (!id || prevIds.has(id) || seen.has(id)) continue
    if (task.done === true) continue
    seen.add(id)
    const title =
      typeof task.title === 'string' ? task.title.trim().slice(0, 80) : ''
    if (!title) continue
    const categoryId =
      typeof task.categoryId === 'string' && task.categoryId.trim().length > 0
        ? task.categoryId.trim()
        : null
    added.push({ id, title, categoryId })
  }
  return added
}

/**
 * Dual-write newly imported V1 tasks into workspace canonical (create_task, shared id).
 * Sequential to keep CAS revision chain simple under concurrent host mutations.
 * Empty added → no IPC; missing workspace → skipped per dualWriteCreateTask.
 */
export async function dualWriteAssistantImportTasks(
  ctx: CanonicalPlanningContext,
  previous: readonly StudyTask[],
  next: readonly StudyTask[]
): Promise<DualWriteAssistantImportTasksResult> {
  const added = collectAssistantImportAddedTasks(previous, next)
  if (added.length === 0) {
    return {
      added: [],
      writes: [],
      allOk: true,
      anyFailed: false,
      anySkipped: false
    }
  }

  const writes: DualWriteResult[] = []
  for (const task of added) {
    const write = await dualWriteCreateTask(ctx, {
      id: task.id,
      title: task.title,
      categoryId: task.categoryId,
      // Assistant invents manual study tasks; store source is manual | quick_start only.
      source: 'manual'
    })
    writes.push(write)
  }

  const anyFailed = writes.some((w) => w.kind === 'canonical_failed')
  const anySkipped = writes.some((w) => w.kind === 'canonical_skipped')
  const allOk = writes.every((w) => w.kind === 'canonical_ok')
  return { added, writes, allOk, anyFailed, anySkipped }
}
