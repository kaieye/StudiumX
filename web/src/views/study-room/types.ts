/**
 * Study room (focus timer + leaderboard) - web-specific shared types.
 *
 * The web study room is NOT the desktop planning engine (plan §9 red lines).
 * It runs a client-side pomodoro timer and pushes completed focus segments to
 * StudiumX-Server via the sync API (POST /sync/push, collection
 * `timer-sessions`; server-contracts §7). Leaderboard peer ranking has no
 * server endpoint yet (plan §10 待定), so the leaderboard shows the current
 * user's own focus (local log, enriched best-effort from
 * GET /analytics/summary?range=today) plus an explicit empty state for peers.
 *
 * NOTE on `WebStudyRoomApi`: sync + analytics-summary reads are NOT part of
 * `TeachingSystemApi` (sync is a web/device concern; plan §6.3/§10). The
 * study-room feature adapter therefore exports
 * `Partial<TeachingSystemApi> & WebStudyRoomApi`; the composer
 * (`adapter/web-teaching-system.ts`) merges EVERY key of every feature module
 * (not only `TeachingSystemApi` keys) over the throwing base, so these methods
 * become reachable through `window.teachingSystem`. The view reaches them via
 * `window.teachingSystem as unknown as WebStudyRoomApi`.
 */

/** Timer phase recorded for a segment. Web uses focus + a single break kind. */
export type StudyRoomPhase = 'focus' | 'short_break' | 'long_break'

/** Outcome of a focus segment. */
export type StudyRoomSessionState = 'completed' | 'cancelled'

/**
 * A focus segment recorded locally in the browser. This is a web-specific
 * SUBSET of the desktop `TimerSessionRecord`
 * (`src/shared/study-planning/timer-session-lifecycle.ts`): it carries the
 * fields needed for focus-time accounting + sync archival, without the
 * planning CAS / actionId-retry / reconcile machinery (which belongs to the
 * study-planning feature, plan §8 Phase 5). Only `focus` segments are pushed;
 * breaks are a local UX phase.
 */
export interface StudyRoomSession {
  id: string
  phase: StudyRoomPhase
  state: StudyRoomSessionState
  /** Planned target seconds for the segment. */
  targetSeconds: number
  /** Actual focus seconds accumulated (always 0 for break phases). */
  focusSeconds: number
  startedAtMs: number
  endedAtMs: number
  /** Human label of the timer plan used, e.g. "番茄 25/5". */
  planLabel: string
  /** Always 'web' - distinguishes web-client sessions in the sync archive. */
  source: 'web'
}

/** Today's focus summary sourced from GET /analytics/summary?range=today. */
export interface TodayFocusSummary {
  focusSeconds: number
  completedFocusSessions: number
  periodStartDate: string
  periodEndDate: string
  updatedAtMs: number
}

/** A single leaderboard row (self or peer). */
export interface LeaderboardEntry {
  rank: number
  nickname: string
  focusSeconds: number
  isSelf: boolean
}

/** Leaderboard data assembled by the view hook for presentation. */
export interface LeaderboardData {
  entries: LeaderboardEntry[]
  selfFocusSeconds: number
  selfSessionsToday: number
  /** Where the self focus number came from. */
  source: 'local' | 'server' | 'empty'
  /** True when peer ranking is unavailable (no server endpoint yet, plan §10). */
  peersUnavailable: boolean
  /** Human note explaining the current data source / limitation. */
  note: string
}

/** Sync entity pushed to POST /sync/push (server-contracts §7 SyncEntitySchema). */
export interface SyncEntity {
  collection: string
  id: string
  revision: number
  updatedAtMs: number
  actionId?: string
  payload: unknown
}

/** Per-entity result in a POST /sync/push response (server-contracts §7). */
export interface SyncPushEntityResult {
  collection: string
  id: string
  status: 'accepted' | 'conflict' | 'skipped_duplicate'
  serverRevision?: number
  conflict?: { serverRevision: number; serverUpdatedAtMs: number }
}

/** Response body of POST /sync/push. */
export interface SyncPushResult {
  results: SyncPushEntityResult[]
}

/**
 * Web study-room adapter surface, exposed on `window.teachingSystem` via the
 * feature-composer merge. These methods are NOT part of `TeachingSystemApi`.
 */
export interface WebStudyRoomApi {
  /**
   * Best-effort push of completed focus sessions to POST /sync/push
   * (collection `timer-sessions`). Throws on network/auth/server error so the
   * caller can keep the sessions in a local retry queue (plan §390:
   * "本地计时正常运行，联网后批量 push").
   */
  pushStudyRoomSessions(sessions: StudyRoomSession[]): Promise<SyncPushResult>
  /**
   * Fetch the current user's today focus summary from
   * GET /analytics/summary?range=today. Returns null when no summary is
   * stored (404) or the request fails (offline/expired) - the leaderboard
   * then degrades to the local session log.
   */
  fetchTodayFocusSummary(): Promise<TodayFocusSummary | null>
}
