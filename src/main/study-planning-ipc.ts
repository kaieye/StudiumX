/**
 * Study planning product IPC parsers + durable host registry (ADR-0117).
 * Fail-closed; workspace-root scoped sole-writer.
 */

import { resolve } from 'node:path'

import type {
  ApplyResult,
  StudyPlanningCommandEnvelope,
  StudyPlanningCommandType,
  StudyPlanningSnapshotV1
} from '../shared/study-planning'
import { DurableStudyPlanningStore } from './study-planning-durable-store'
import { requireRecord, requireString } from './teaching-ipc-commands'

const COMMAND_TYPES = new Set<StudyPlanningCommandType>([
  'create_task',
  'update_task',
  'complete_task',
  'delete_task',
  'reopen_task',
  'save_timer_plan',
  'delete_timer_plan',
  'copy_timer_plan',
  'upsert_schedule_block',
  'delete_schedule_block',
  'quick_start',
  'batch_classify_tasks',
  'start_timer_session',
  'pause_timer_session',
  'resume_timer_session',
  'finish_timer_session',
  'switch_session_task',
  'reconcile_stale_session',
  'advance_timer_session',
  'set_preferences',
  'set_categories',
  'import_migration_commit'
])

export type ReadStudyPlanningPayload = {
  workspaceRoot: string
}

export type ApplyStudyPlanningPayload = {
  workspaceRoot: string
  expectedRevision: number
  command: StudyPlanningCommandEnvelope
}

export type ReadStudyPlanningResult = {
  ok: true
  snapshot: StudyPlanningSnapshotV1
  path: string
  source: 'canonical' | 'backup' | 'empty'
} | {
  ok: false
  error: { code: string; message: string }
}

export type ApplyStudyPlanningResult = ApplyResult & {
  path?: string
}

const hosts = new Map<string, DurableStudyPlanningStore>()

export function getDurableStudyPlanningStore(workspaceRoot: string): DurableStudyPlanningStore {
  const key = resolve(workspaceRoot)
  let host = hosts.get(key)
  if (!host) {
    host = new DurableStudyPlanningStore({ workspaceRoot: key })
    hosts.set(key, host)
  }
  return host
}

/** Test-only: clear process registry. */
export function resetStudyPlanningHostRegistryForTests(): void {
  hosts.clear()
}

export function parseReadStudyPlanningPayload(raw: unknown): ReadStudyPlanningPayload {
  const record = requireRecord(raw)
  return { workspaceRoot: requireString(record.workspaceRoot, 'workspaceRoot').trim() }
}

export function parseApplyStudyPlanningPayload(raw: unknown): ApplyStudyPlanningPayload {
  const record = requireRecord(raw)
  const workspaceRoot = requireString(record.workspaceRoot, 'workspaceRoot').trim()
  const expectedRevision = record.expectedRevision
  if (typeof expectedRevision !== 'number' || !Number.isFinite(expectedRevision) || expectedRevision < 1) {
    throw new Error('expectedRevision must be a finite number >= 1')
  }
  const commandRecord = requireRecord(record.command)
  const actionId = requireString(commandRecord.actionId, 'command.actionId').trim()
  const typeRaw = requireString(commandRecord.type, 'command.type').trim()
  if (!COMMAND_TYPES.has(typeRaw as StudyPlanningCommandType)) {
    throw new Error(`Unknown study planning command type: ${typeRaw}`)
  }
  const command: StudyPlanningCommandEnvelope = {
    actionId,
    type: typeRaw as StudyPlanningCommandType,
    payload: commandRecord.payload,
    ...(typeof commandRecord.operationId === 'string' ? { operationId: commandRecord.operationId } : {}),
    ...(typeof commandRecord.clientIssuedAtMs === 'number'
      ? { clientIssuedAtMs: commandRecord.clientIssuedAtMs }
      : {})
  }
  return { workspaceRoot, expectedRevision, command }
}

export async function runReadStudyPlanningIpc(
  payload: ReadStudyPlanningPayload,
  resolveWorkspaceRoot: (raw: string) => Promise<{ ok: true; rootPath: string } | { ok: false; message: string }>
): Promise<ReadStudyPlanningResult> {
  const access = await resolveWorkspaceRoot(payload.workspaceRoot)
  if (!access.ok) {
    return { ok: false, error: { code: 'workspace_denied', message: access.message } }
  }
  try {
    const host = getDurableStudyPlanningStore(access.rootPath)
    const loaded = await host.ensureLoaded()
    return {
      ok: true,
      snapshot: loaded.snapshot,
      path: loaded.path,
      source: loaded.source
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'io_failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export async function runApplyStudyPlanningIpc(
  payload: ApplyStudyPlanningPayload,
  resolveWorkspaceRoot: (raw: string) => Promise<{ ok: true; rootPath: string } | { ok: false; message: string }>
): Promise<ApplyStudyPlanningResult> {
  const access = await resolveWorkspaceRoot(payload.workspaceRoot)
  if (!access.ok) {
    return {
      ok: false,
      revision: 0,
      error: { code: 'invalid_command', message: access.message }
    }
  }
  const host = getDurableStudyPlanningStore(access.rootPath)
  const result = await host.applyCommand(payload.command, payload.expectedRevision)
  return { ...result, path: host.getSnapshotPath() }
}
