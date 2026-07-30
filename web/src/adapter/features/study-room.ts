/**
 * Web study-room adapter feature (plan §8 Phase 5 / §6.3 / §10).
 *
 * Implements the web-supported server seams the study room needs:
 *  - `pushStudyRoomSessions` -> POST /sync/push (collection `timer-sessions`,
 *    server-contracts §7). Best-effort: throws on error so the view's local
 *    queue can retry (plan §390).
 *  - `fetchTodayFocusSummary` -> GET /analytics/summary?range=today
 *    (server-contracts §2). Null on 404/offline so the leaderboard degrades
 *    to the local log.
 *
 * These are NOT `TeachingSystemApi` methods (sync is a web/device concern).
 * The export is typed `Partial<TeachingSystemApi> & WebStudyRoomApi`; the
 * composer merges every key over the throwing base, so the view reaches them
 * through `window.teachingSystem` (cast to `WebStudyRoomApi`). No
 * teaching-engine method is implemented here (red lines, plan §9).
 */

import type { TeachingSystemApi } from '@shared/teaching-types/system-api'
import { ApiError, apiGet, apiPost } from '../../api/http'
import type {
  StudyRoomSession,
  SyncEntity,
  SyncPushResult,
  TodayFocusSummary,
  WebStudyRoomApi
} from '../../views/study-room/types'

/** localStorage key for the stable web sync device id (NOT an auth token). */
const WEB_DEVICE_ID_KEY = 'studiumx.webDeviceId'

/** Server collection name for timer session archives (server-contracts §7). */
const TIMER_SESSIONS_COLLECTION = 'timer-sessions'

/** Minimal projection of the server `AnalyticsSummaryRow` (server-contracts §2). */
interface AnalyticsSummaryRowResponse {
  focusSeconds: number
  completedFocusSessions: number
  periodStartDate: string
  periodEndDate: string
  updatedAtMs: number
}

/**
 * Stable per-browser device id used as the (fallback) `deviceId` in
 * /sync/push bodies. The server prefers the access-token's `deviceId`
 * (server-contracts §7), so this only matters for the required non-empty
 * body field. It is NOT an auth token and never leaves the sync request body.
 */
function getWebDeviceId(): string {
  try {
    let id = localStorage.getItem(WEB_DEVICE_ID_KEY)
    if (!id) {
      id = generateId()
      localStorage.setItem(WEB_DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    // localStorage unavailable (private mode / sandbox) - use an ephemeral id.
    return 'web'
  }
}

/** RFC4122 v4 id with a fallback for non-secure contexts. */
function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Map a recorded focus session to a sync entity (server-contracts §7). */
function toSyncEntity(session: StudyRoomSession): SyncEntity {
  return {
    collection: TIMER_SESSIONS_COLLECTION,
    id: session.id,
    // revision drives last-write-wins per id; endedAtMs is monotonic per
    // session and re-pushes of the same id carry the same value (idempotent).
    revision: session.endedAtMs,
    updatedAtMs: session.endedAtMs,
    // actionId = session id => a retry of the same push is deduped
    // (status "skipped_duplicate") rather than double-counted.
    actionId: session.id,
    payload: session
  }
}

export const feature: Partial<TeachingSystemApi> & WebStudyRoomApi = {
  async pushStudyRoomSessions(sessions: StudyRoomSession[]): Promise<SyncPushResult> {
    if (sessions.length === 0) {
      return { results: [] }
    }
    const entities = sessions.map(toSyncEntity)
    // Throws ApiError/AuthError on failure; the caller keeps the queue.
    return apiPost<SyncPushResult>('/sync/push', {
      deviceId: getWebDeviceId(),
      entities
    })
  },

  async fetchTodayFocusSummary(): Promise<TodayFocusSummary | null> {
    try {
      const data = await apiGet<{ summary: AnalyticsSummaryRowResponse }>(
        '/analytics/summary',
        { range: 'today' }
      )
      const s = data?.summary
      if (!s) return null
      return {
        focusSeconds: s.focusSeconds,
        completedFocusSessions: s.completedFocusSessions,
        periodStartDate: s.periodStartDate,
        periodEndDate: s.periodEndDate,
        updatedAtMs: s.updatedAtMs
      }
    } catch (err) {
      // 404 (no summary stored) is the common case (analytics upload is gated
      // OFF by default, server-contracts §2). Any other failure (network,
      // expired session) is also non-fatal for a read-only leaderboard.
      if (err instanceof ApiError) return null
      // Re-throw unexpected (non-ApiError) errors so they surface.
      throw err
    }
  }
}
