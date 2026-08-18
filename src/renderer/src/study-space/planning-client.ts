/**
 * Thin renderer client for StudyPlanning canonical IPC (ADR-0011).
 *
 * Product path: workspace file via main DurableStudyPlanningStore.
 * Fail-closed when TeachingSystemApi or workspaceRoot is unavailable —
 * never silently treat localStorage as teaching authority.
 */

import type {
  ApplyResult,
  StudyPlanningCommandEnvelope,
  StudyPlanningCommandType,
  StudyPlanningSnapshotV1
} from '../../../shared/study-planning'
import type { TeachingSystemApi } from '../../../shared/teaching-types'

export type StudyPlanningApi = Pick<TeachingSystemApi, 'readStudyPlanning' | 'applyStudyPlanning'>

export type PlanningClientReadOk = {
  ok: true
  snapshot: StudyPlanningSnapshotV1
  path: string
  source: 'canonical' | 'backup' | 'empty'
}

export type PlanningClientReadErr = {
  ok: false
  code: 'missing_workspace' | 'api_unavailable' | 'workspace_denied' | 'io_failed' | 'unknown'
  message: string
}

export type PlanningClientReadResult = PlanningClientReadOk | PlanningClientReadErr

export type PlanningClientApplyOk = Extract<ApplyResult, { ok: true }> & { path?: string }

export type PlanningClientApplyErr = {
  ok: false
  revision: number
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
  path?: string
}

export type PlanningClientApplyResult = PlanningClientApplyOk | PlanningClientApplyErr

function resolveApi(
  api: StudyPlanningApi | null | undefined
): StudyPlanningApi | null {
  if (!api) return null
  if (typeof api.readStudyPlanning !== 'function' || typeof api.applyStudyPlanning !== 'function') {
    return null
  }
  return api
}

function normalizeWorkspaceRoot(workspaceRoot: string | null | undefined): string | null {
  if (typeof workspaceRoot !== 'string') return null
  const trimmed = workspaceRoot.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Read StudyPlanningSnapshotV1 for a registered workspace.
 * Fail-closed: missing root or API returns structured error (no localStorage fallback).
 */
export async function readStudyPlanningSnapshot(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined
): Promise<PlanningClientReadResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  if (!root) {
    return {
      ok: false,
      code: 'missing_workspace',
      message: 'No active workspace root; cannot read study planning canonical store.'
    }
  }
  const resolved = resolveApi(api)
  if (!resolved) {
    return {
      ok: false,
      code: 'api_unavailable',
      message: 'TeachingSystemApi.readStudyPlanning is unavailable.'
    }
  }
  try {
    const result = await resolved.readStudyPlanning({ workspaceRoot: root })
    if (!result.ok) {
      const code = result.error.code === 'workspace_denied' ? 'workspace_denied' : 'io_failed'
      return { ok: false, code, message: result.error.message }
    }
    return {
      ok: true,
      snapshot: result.snapshot,
      path: result.path,
      source: result.source
    }
  } catch (error) {
    return {
      ok: false,
      code: 'unknown',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Apply one StudyPlanning command with expectedRevision CAS.
 * Caller must supply a unique actionId for idempotent retries.
 */
export async function applyStudyPlanningCommand(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined,
  expectedRevision: number,
  command: StudyPlanningCommandEnvelope
): Promise<PlanningClientApplyResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  if (!root) {
    return {
      ok: false,
      revision: 0,
      error: {
        code: 'missing_workspace',
        message: 'No active workspace root; cannot write study planning canonical store.'
      }
    }
  }
  const resolved = resolveApi(api)
  if (!resolved) {
    return {
      ok: false,
      revision: 0,
      error: {
        code: 'api_unavailable',
        message: 'TeachingSystemApi.applyStudyPlanning is unavailable.'
      }
    }
  }
  if (!Number.isFinite(expectedRevision) || expectedRevision < 1) {
    return {
      ok: false,
      revision: 0,
      error: {
        code: 'invalid_command',
        message: 'expectedRevision must be a finite number >= 1'
      }
    }
  }
  try {
    const result = await resolved.applyStudyPlanning({
      workspaceRoot: root,
      expectedRevision,
      command
    })
    return result as PlanningClientApplyResult
  } catch (error) {
    return {
      ok: false,
      revision: 0,
      error: {
        code: 'unknown',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export type CreatePlanningTaskInput = {
  id: string
  title: string
  /** When omitted or empty, task is inbox (freeze #2). */
  categoryId?: string | null
  source?: 'manual' | 'quick_start'
  estimateMinutes?: number | null
  splittable?: boolean
}

/**
 * Build a create_task envelope. Id is caller-owned so renderer dual-write can share it.
 */
export function buildCreateTaskCommand(
  input: CreatePlanningTaskInput,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  const payload: Record<string, unknown> = {
    id: input.id,
    title: input.title
  }
  if (input.categoryId !== undefined) {
    payload.categoryId = input.categoryId
    if (input.categoryId == null || input.categoryId === '') {
      payload.inbox = true
    }
  }
  if (input.source) payload.source = input.source
  if (input.estimateMinutes !== undefined) payload.estimateMinutes = input.estimateMinutes
  if (input.splittable !== undefined) payload.splittable = input.splittable

  return {
    actionId,
    type: 'create_task' as StudyPlanningCommandType,
    payload,
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export type CompletePlanningTaskInput = {
  id: string
  futureBlocksDecision?: 'cancel' | 'keep_review' | 'reassign'
  reassignTaskId?: string | null
}

export function buildCompleteTaskCommand(
  input: CompletePlanningTaskInput,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  const payload: Record<string, unknown> = { id: input.id }
  if (input.futureBlocksDecision) payload.futureBlocksDecision = input.futureBlocksDecision
  if (input.reassignTaskId !== undefined) payload.reassignTaskId = input.reassignTaskId
  return {
    actionId,
    type: 'complete_task' as StudyPlanningCommandType,
    payload,
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export type UpdatePlanningTaskInput = {
  id: string
  title?: string
  /** null or '' → inbox */
  categoryId?: string | null
  estimateMinutes?: number | null
}

/**
 * Build update_task envelope (title / category / estimate only — not schedule).
 */
export function buildUpdateTaskCommand(
  input: UpdatePlanningTaskInput,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  const payload: Record<string, unknown> = { id: input.id }
  if (input.title !== undefined) payload.title = input.title
  if (input.categoryId !== undefined) {
    payload.categoryId = input.categoryId
    if (input.categoryId == null || input.categoryId === '') {
      payload.inbox = true
    }
  }
  if (input.estimateMinutes !== undefined) payload.estimateMinutes = input.estimateMinutes
  return {
    actionId,
    type: 'update_task' as StudyPlanningCommandType,
    payload,
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}


export type DeletePlanningTaskInput = {
  id: string
  futureBlocksDecision?: 'cancel' | 'keep_review' | 'reassign'
  reassignTaskId?: string | null
}

/**
 * Build delete_task envelope (soft-cancel). Optional future-block decision (§7.3).
 */
export function buildDeleteTaskCommand(
  input: DeletePlanningTaskInput,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  const payload: Record<string, unknown> = { id: input.id }
  if (input.futureBlocksDecision) payload.futureBlocksDecision = input.futureBlocksDecision
  if (input.reassignTaskId !== undefined) payload.reassignTaskId = input.reassignTaskId
  return {
    actionId,
    type: 'delete_task' as StudyPlanningCommandType,
    payload,
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

export type ReopenPlanningTaskInput = {
  id: string
}

/**
 * Build reopen_task envelope (done|cancelled → open).
 */
export function buildReopenTaskCommand(
  input: ReopenPlanningTaskInput,
  actionId: string,
  clientIssuedAtMs?: number
): StudyPlanningCommandEnvelope {
  return {
    actionId,
    type: 'reopen_task' as StudyPlanningCommandType,
    payload: { id: input.id },
    ...(clientIssuedAtMs !== undefined ? { clientIssuedAtMs } : {})
  }
}

async function resolveExpectedRevision(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined,
  expectedRevision: number | undefined
): Promise<{ ok: true; revision: number } | PlanningClientApplyErr> {
  if (expectedRevision !== undefined) {
    return { ok: true, revision: expectedRevision }
  }
  const read = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!read.ok) {
    return {
      ok: false,
      revision: 0,
      error: { code: read.code, message: read.message }
    }
  }
  return { ok: true, revision: read.snapshot.revision }
}

/**
 * Create task on canonical store. On revision_conflict, re-read and retry once with a new actionId.
 * Does not fall back to localStorage.
 */
export async function createPlanningTask(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined,
  input: CreatePlanningTaskInput,
  options?: {
    expectedRevision?: number
    actionId?: string
    nowMs?: () => number
  }
): Promise<PlanningClientApplyResult> {
  const nowMs = options?.nowMs ?? (() => Date.now())
  const makeActionId = (suffix: string): string =>
    options?.actionId && suffix === '0'
      ? options.actionId
      : `create_task:${input.id}:${nowMs()}:${suffix}`

  const resolvedRevision = await resolveExpectedRevision(api, workspaceRoot, options?.expectedRevision)
  if (!resolvedRevision.ok) return resolvedRevision

  const first = await applyStudyPlanningCommand(
    api,
    workspaceRoot,
    resolvedRevision.revision,
    buildCreateTaskCommand(input, makeActionId('0'), nowMs())
  )
  if (first.ok) return first
  if (first.error.code !== 'revision_conflict') return first

  const refreshed = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!refreshed.ok) {
    return {
      ok: false,
      revision: first.revision,
      error: { code: refreshed.code, message: refreshed.message }
    }
  }
  return applyStudyPlanningCommand(
    api,
    workspaceRoot,
    refreshed.snapshot.revision,
    buildCreateTaskCommand(input, makeActionId('retry'), nowMs())
  )
}

/**
 * Complete task on canonical store (status → done). Optional future-block decision.
 */
export async function completePlanningTask(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined,
  input: CompletePlanningTaskInput,
  options?: {
    expectedRevision?: number
    actionId?: string
    nowMs?: () => number
  }
): Promise<PlanningClientApplyResult> {
  const nowMs = options?.nowMs ?? (() => Date.now())
  const makeActionId = (suffix: string): string =>
    options?.actionId && suffix === '0'
      ? options.actionId
      : `complete_task:${input.id}:${nowMs()}:${suffix}`

  const resolvedRevision = await resolveExpectedRevision(api, workspaceRoot, options?.expectedRevision)
  if (!resolvedRevision.ok) return resolvedRevision

  const first = await applyStudyPlanningCommand(
    api,
    workspaceRoot,
    resolvedRevision.revision,
    buildCompleteTaskCommand(input, makeActionId('0'), nowMs())
  )
  if (first.ok) return first
  if (first.error.code !== 'revision_conflict') return first

  const refreshed = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!refreshed.ok) {
    return {
      ok: false,
      revision: first.revision,
      error: { code: refreshed.code, message: refreshed.message }
    }
  }
  return applyStudyPlanningCommand(
    api,
    workspaceRoot,
    refreshed.snapshot.revision,
    buildCompleteTaskCommand(input, makeActionId('retry'), nowMs())
  )
}

/**
 * Update task fields on canonical store (title/category/estimate).
 * On revision_conflict, re-read and retry once with a new actionId.
 */

/**
 * Soft-delete task on canonical store (status → cancelled). Optional future-block decision.
 */
export async function deletePlanningTask(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined,
  input: DeletePlanningTaskInput,
  options?: {
    expectedRevision?: number
    actionId?: string
    nowMs?: () => number
  }
): Promise<PlanningClientApplyResult> {
  const nowMs = options?.nowMs ?? (() => Date.now())
  const makeActionId = (suffix: string): string =>
    options?.actionId && suffix === '0'
      ? options.actionId
      : `delete_task:${input.id}:${nowMs()}:${suffix}`

  const resolvedRevision = await resolveExpectedRevision(api, workspaceRoot, options?.expectedRevision)
  if (!resolvedRevision.ok) return resolvedRevision

  const first = await applyStudyPlanningCommand(
    api,
    workspaceRoot,
    resolvedRevision.revision,
    buildDeleteTaskCommand(input, makeActionId('0'), nowMs())
  )
  if (first.ok) return first
  if (first.error.code !== 'revision_conflict') return first

  const refreshed = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!refreshed.ok) {
    return {
      ok: false,
      revision: first.revision,
      error: { code: refreshed.code, message: refreshed.message }
    }
  }
  return applyStudyPlanningCommand(
    api,
    workspaceRoot,
    refreshed.snapshot.revision,
    buildDeleteTaskCommand(input, makeActionId('retry'), nowMs())
  )
}

/**
 * Reopen task on canonical store (done|cancelled → open).
 * On revision_conflict, re-read and retry once with a new actionId.
 */
export async function reopenPlanningTask(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined,
  input: ReopenPlanningTaskInput,
  options?: {
    expectedRevision?: number
    actionId?: string
    nowMs?: () => number
  }
): Promise<PlanningClientApplyResult> {
  const nowMs = options?.nowMs ?? (() => Date.now())
  const makeActionId = (suffix: string): string =>
    options?.actionId && suffix === '0'
      ? options.actionId
      : `reopen_task:${input.id}:${nowMs()}:${suffix}`

  const resolvedRevision = await resolveExpectedRevision(api, workspaceRoot, options?.expectedRevision)
  if (!resolvedRevision.ok) return resolvedRevision

  const first = await applyStudyPlanningCommand(
    api,
    workspaceRoot,
    resolvedRevision.revision,
    buildReopenTaskCommand(input, makeActionId('0'), nowMs())
  )
  if (first.ok) return first
  if (first.error.code !== 'revision_conflict') return first

  const refreshed = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!refreshed.ok) {
    return {
      ok: false,
      revision: first.revision,
      error: { code: refreshed.code, message: refreshed.message }
    }
  }
  return applyStudyPlanningCommand(
    api,
    workspaceRoot,
    refreshed.snapshot.revision,
    buildReopenTaskCommand(input, makeActionId('retry'), nowMs())
  )
}

export async function updatePlanningTask(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined,
  input: UpdatePlanningTaskInput,
  options?: {
    expectedRevision?: number
    actionId?: string
    nowMs?: () => number
  }
): Promise<PlanningClientApplyResult> {
  const nowMs = options?.nowMs ?? (() => Date.now())
  const makeActionId = (suffix: string): string =>
    options?.actionId && suffix === '0'
      ? options.actionId
      : `update_task:${input.id}:${nowMs()}:${suffix}`

  const resolvedRevision = await resolveExpectedRevision(api, workspaceRoot, options?.expectedRevision)
  if (!resolvedRevision.ok) return resolvedRevision

  const first = await applyStudyPlanningCommand(
    api,
    workspaceRoot,
    resolvedRevision.revision,
    buildUpdateTaskCommand(input, makeActionId('0'), nowMs())
  )
  if (first.ok) return first
  if (first.error.code !== 'revision_conflict') return first

  const refreshed = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!refreshed.ok) {
    return {
      ok: false,
      revision: first.revision,
      error: { code: refreshed.code, message: refreshed.message }
    }
  }
  return applyStudyPlanningCommand(
    api,
    workspaceRoot,
    refreshed.snapshot.revision,
    buildUpdateTaskCommand(input, makeActionId('retry'), nowMs())
  )
}

/**
 * Map PlanningTask rows to V1 StudyTask shape for dual-write UI projection.
 * Schedule blocks are not projected here (V1 embeds one schedule per task).
 */
export function projectPlanningTasksToStudyTasks(
  tasks: readonly {
    id: string
    title: string
    status: string
    categoryId: string | null
    estimateMinutes?: number | null
  }[]
): {
  id: string
  title: string
  done: boolean
  categoryId?: string
  estimateMinutes?: number | null
}[] {
  // Cancelled tasks are soft-deleted from UI lists (keep canonical history for TimerSession refs).
  return tasks
    .filter((task) => task.status !== 'cancelled')
    .map((task) => ({
      id: task.id,
      title: task.title,
      done: task.status === 'done',
      ...(task.categoryId ? { categoryId: task.categoryId } : {}),
      ...(task.estimateMinutes !== undefined ? { estimateMinutes: task.estimateMinutes } : {})
    }))
}
