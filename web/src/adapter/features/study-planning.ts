/**
 * Web adapter for Study planning (plan §8 Phase 5 / §7.1).
 *
 * Implements `readStudyPlanning` + `applyStudyPlanning` against the
 * StudiumX-Server `/study-planning` endpoint (server-contracts.md §3).
 *
 * Authority remap (porting-features.md §0/§3, difficulty HARD): the desktop
 * host is a file-backed sole-writer that reduces a `StudyPlanningCommandEnvelope`
 * against the canonical `snapshot.json` with `expectedRevision` CAS + exact-
 * `actionId` retry. The StudiumX-Server endpoint is a *dumb whole-snapshot CAS
 * store* (`PUT { revision, updatedAtMs, payload }`; writes only when incoming
 * `revision` is strictly greater than the stored one). There is no command
 * processing on the server.
 *
 * To preserve the desktop contract verbatim, this adapter runs the **pure shared
 * `StudyPlanningStore` reducer client-side**: it reads the current server
 * snapshot, reduces the command (revision bump + `effects` + validation), then
 * CAS-PUTs the resulting whole snapshot. `workspaceRoot` has no filesystem
 * meaning on web (the server keys on the authenticated user), so it is accepted
 * but ignored for transport; `path` is returned as `''` (porting note §0).
 *
 * Red lines honoured: no model keys / agent loop / workspace file writes; this
 * is a read + CAS-write of a server-owned planning document only. Tokens are
 * never touched directly - all HTTP goes through `../../api/http`.
 */

import type { TeachingSystemApi } from '@shared/teaching-types/system-api'
import { apiGet, apiPut, ApiError } from '../../api/http'
import {
  StudyPlanningStore,
  type ApplyResult,
  type StudyPlanningError,
  type StudyPlanningSnapshotV1
} from '@shared/study-planning'

/**
 * GET /study-planning -> the snapshot is returned directly (NOT wrapped).
 * 404 NOT_FOUND means no snapshot row exists for this account yet.
 *
 * Mirrors the desktop `source` semantics: a present document is `canonical`;
 * a missing one is `empty` (the host returns an empty snapshot with
 * `source: 'empty'` when no canonical file exists).
 */
async function readServerSnapshot(): Promise<
  | { found: true; snapshot: StudyPlanningSnapshotV1 }
  | { found: false; snapshot: StudyPlanningSnapshotV1 }
  | { error: StudyPlanningError }
> {
  try {
    const snapshot = await apiGet<StudyPlanningSnapshotV1>('/study-planning')
    return { found: true, snapshot }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // No server snapshot yet -> synthesize the canonical empty snapshot
      // (same seed the desktop host uses; revision 1, default timer plan).
      return { found: false, snapshot: new StudyPlanningStore().readSnapshot() }
    }
    const message = err instanceof Error ? err.message : 'readStudyPlanning failed'
    return { error: { code: 'io_failed', message } }
  }
}

export const feature: Partial<TeachingSystemApi> = {
  async readStudyPlanning(payload) {
    void payload.workspaceRoot // server keys on the authenticated user; ignored for transport
    const result = await readServerSnapshot()
    if ('error' in result) {
      return { ok: false, error: result.error }
    }
    return {
      ok: true,
      snapshot: result.snapshot,
      path: '',
      source: result.found ? 'canonical' : 'empty'
    }
  },

  async applyStudyPlanning(payload) {
    const { expectedRevision, command } = payload

    // 1. Read the current server snapshot (or empty seed) to reduce against.
    const current = await readServerSnapshot()
    if ('error' in current) {
      return { ok: false, error: current.error, revision: expectedRevision, path: '' }
    }

    // 2. Reduce the command locally via the pure shared sole-writer reducer.
    //    This enforces expectedRevision CAS, validation, revision bump and
    //    produces the exact `effects` the desktop contract returns.
    const store = new StudyPlanningStore({ initial: current.snapshot })
    const reduced: ApplyResult = store.applyCommand(command, expectedRevision)
    if (!reduced.ok) {
      return { ...reduced, path: '' }
    }

    // 3. CAS-PUT the whole resulting snapshot. The server writes only when the
    //    incoming `revision` is strictly greater than the stored one (or no
    //    snapshot exists). `revision` here is expectedRevision + 1.
    try {
      await apiPut<{ status: string }>('/study-planning', {
        revision: reduced.revision,
        updatedAtMs: reduced.snapshot.updatedAtMs,
        payload: reduced.snapshot
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Concurrent write between our GET and PUT: the server kept its copy.
        // Surface as a revision_conflict so the view re-fetches + notifies.
        const body = err.body as { serverRevision?: unknown } | undefined
        const serverRevision =
          typeof body?.serverRevision === 'number' ? body.serverRevision : current.snapshot.revision
        return {
          ok: false,
          revision: serverRevision,
          error: {
            code: 'revision_conflict',
            message: '学习计划已被另一端更新，请刷新后重试。',
            details: { serverRevision }
          },
          path: ''
        }
      }
      const message = err instanceof Error ? err.message : 'applyStudyPlanning write failed'
      return { ok: false, error: { code: 'io_failed', message }, revision: expectedRevision, path: '' }
    }

    // 4. Accepted. `replayed` is left unset on web: the server PUT has no
    //    `actionId` field, so cross-reload exact-retry dedup is not possible
    //    (acceptable simplification; the reducer's in-instance dedup still runs).
    return { ...reduced, path: '' }
  }
}
