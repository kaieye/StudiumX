/**
 * Bridge between the local study-planning snapshot and StudiumX-Server sync.
 *
 * Red line: this module only READS the local canonical snapshot (via the
 * existing planning-client IPC wrapper) and PUSHES it to the server. It NEVER
 * writes back to local teaching authority, never relaxes expectedRevision,
 * and never rewrites the LearningSession ledger.
 */

import type { StudyPlanningSnapshotV1 } from '../../../shared/study-planning/study-planning-store'
import { isStudyPlanningSnapshotV1, studyPlanningSnapshotRelativePath } from '../../../shared/study-planning/snapshot-wire'
import {
  readStudyPlanningSnapshot,
  type StudyPlanningApi
} from '../study-space/planning-client'
import type { SyncApiClient, SyncEntity } from './sync-api-client'

export const STUDY_PLANNING_SYNC_COLLECTION = 'study-planning'

export type PushStudyPlanningResult =
  | { ok: true; status: string; serverRevision?: number }
  | { ok: false; code: string; message: string }

export type PullStudyPlanningResult =
  | {
      ok: true
      status: 'no_server_snapshot' | 'up_to_date' | 'server_newer'
      serverSnapshot?: StudyPlanningSnapshotV1
      serverRevision?: number
    }
  | { ok: false; code: string; message: string }

export type StudyPlanningSyncBridge = {
  pushStudyPlanning(snapshot: StudyPlanningSnapshotV1): Promise<PushStudyPlanningResult>
  pullStudyPlanning(localRevision?: number): Promise<PullStudyPlanningResult>
}

export type StudyPlanningSyncBridgeDeps = {
  apiClient: SyncApiClient
  deviceId: string
}

/**
 * Build a SyncEntity from a local StudyPlanningSnapshotV1.
 * Uses the workspace-relative snapshot path as a stable entity id.
 */
export function buildStudyPlanningSyncEntity(snapshot: StudyPlanningSnapshotV1): SyncEntity {
  return {
    collection: STUDY_PLANNING_SYNC_COLLECTION,
    id: studyPlanningSnapshotRelativePath('/'),
    revision: snapshot.revision,
    updatedAtMs: snapshot.updatedAtMs,
    payload: snapshot
  }
}

/**
 * Read the local canonical study-planning snapshot via existing IPC wrapper.
 * Fail-closed: returns structured error when workspace/api unavailable —
 * never falls back to localStorage as teaching authority.
 */
export async function readLocalStudyPlanningSnapshot(
  api: StudyPlanningApi | null | undefined,
  workspaceRoot: string | null | undefined
): Promise<{ ok: true; snapshot: StudyPlanningSnapshotV1 } | { ok: false; code: string; message: string }> {
  const result = await readStudyPlanningSnapshot(api, workspaceRoot)
  if (!result.ok) return { ok: false, code: result.code, message: result.message }
  return { ok: true, snapshot: result.snapshot }
}

export function createStudyPlanningSyncBridge(deps: StudyPlanningSyncBridgeDeps): StudyPlanningSyncBridge {
  const { apiClient, deviceId } = deps

  return {
    async pushStudyPlanning(snapshot) {
      const entity = buildStudyPlanningSyncEntity(snapshot)
      try {
        const response = await apiClient.push(deviceId, [entity])
        const result =
          response.results.find((item) => item.collection === STUDY_PLANNING_SYNC_COLLECTION) ??
          response.results[0]
        if (!result) {
          return { ok: false, code: 'no_result', message: 'server returned no result for study-planning' }
        }
        if (result.status === 'conflict' || result.conflict) {
          return { ok: true, status: 'conflict', serverRevision: result.serverRevision }
        }
        return { ok: true, status: result.status || 'accepted', serverRevision: result.serverRevision }
      } catch (err) {
        return { ok: false, code: 'push_failed', message: err instanceof Error ? err.message : String(err) }
      }
    },

    async pullStudyPlanning(localRevision) {
      try {
        const response = await apiClient.pull(undefined, [STUDY_PLANNING_SYNC_COLLECTION])
        const entity = response.entities.find((item) => item.collection === STUDY_PLANNING_SYNC_COLLECTION)
        if (!entity) return { ok: true, status: 'no_server_snapshot' }
        if (!isStudyPlanningSnapshotV1(entity.payload)) {
          return { ok: false, code: 'schema_invalid', message: 'server study-planning payload failed validation' }
        }
        const serverSnapshot = entity.payload
        const serverRevision = entity.revision
        if (typeof localRevision === 'number' && serverRevision > localRevision) {
          return { ok: true, status: 'server_newer', serverSnapshot, serverRevision }
        }
        return { ok: true, status: 'up_to_date', serverSnapshot, serverRevision }
      } catch (err) {
        return { ok: false, code: 'pull_failed', message: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
