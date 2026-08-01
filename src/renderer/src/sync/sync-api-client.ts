/**
 * Thin fetch-based sync API client for StudiumX-Server.
 *
 * User-initiated + login-gated only; no default remote telemetry.
 * Bearer auth header; on 401 the client transparently rotates the refresh
 * token and retries the request once before clearing local auth.
 * Never writes to local teaching authority — uploads/archives only.
 */

import type { StudyPlanningSnapshotV1 } from '../../../shared/study-planning/study-planning-store'
import type { SyncedAnalyticsVisualizationsV1 } from '../../../shared/teaching-types/analytics'

const DEFAULT_SYNC_API_BASE = 'https://api.studiumx.cn'

export function resolveDefaultSyncApiBase(): string {
  const raw = import.meta.env.STUDIUMX_SYNC_API_BASE
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
  return DEFAULT_SYNC_API_BASE
}

export type SyncAuthUser = {
  id?: string
  nickname?: string
  avatarUrl?: string
  [key: string]: unknown
}

export type SyncLoginResponse = {
  accessToken: string
  refreshToken: string
  user: SyncAuthUser
}

export type SyncRefreshResponse = {
  accessToken: string
  refreshToken: string
  user?: SyncAuthUser
}

export type SyncEntity = {
  collection: string
  id: string
  revision: number
  updatedAtMs: number
  actionId?: string
  payload: unknown
}

export type SyncPushStatus = 'accepted' | 'conflict' | 'skipped_duplicate'

export type SyncPushConflict = {
  serverRevision: number
  serverUpdatedAtMs: number
}

export type SyncPushResult = {
  collection: string
  id: string
  status: SyncPushStatus
  serverRevision?: number
  conflict?: SyncPushConflict
}

export type SyncPushResponse = {
  results: SyncPushResult[]
}

export type SyncPullResponse = {
  serverCursor: string | null
  entities: SyncEntity[]
}

export type SyncAckResponse = Record<string, unknown>

export type SyncStudyPlanningPutResponse = {
  status: 'accepted' | 'skipped_duplicate' | 'conflict'
  serverRevision?: number
}

export type SyncLessonListItem = { id: string; [key: string]: unknown }
export type SyncLessonContent = { id: string; content: string; contentType: string; [key: string]: unknown }
export type SyncLessonUploadBody = {
  courseId: string
  sessionId: string
  relativePath: string
  content: string
  contentType: string
  revision: number
  updatedAtMs: number
}
export type SyncConversationListItem = { id: string; [key: string]: unknown }
export type SyncConversationContent = { id: string; content: string; contentType: string; [key: string]: unknown }
export type SyncConversationUploadBody = {
  courseRelativePath?: string
  content: string
  contentType: string
  updatedAtMs: number
}

export type SyncWechatLoginUrlResponse = {
  url: string
  loginId: string
  state: string
}

export type SyncPollResponse = {
  status: 'pending' | 'completed' | 'expired'
  accessToken?: string
  refreshToken?: string
  user?: SyncAuthUser
}

export type SyncStudyRoomMember = {
  userId: string
  nickname: string | null
  avatarUrl: string | null
  petAppearance: string | null
  platform: string | null
  status: string | null
  focusSecondsToday: number
  isSelf: boolean
}

export type SyncStudyRoomMembersResponse = {
  roomId: string
  members: SyncStudyRoomMember[]
}

export type SyncStudyRoomJoinBody = {
  roomId: string
  nickname?: string
  avatarUrl?: string
  petAppearance?: string
  platform?: string
  status?: 'studying' | 'break' | 'idle'
  focusSecondsToday?: number
}

export type SyncStudyRoomHeartbeatBody = {
  roomId: string
  status?: 'studying' | 'break' | 'idle'
  focusSecondsToday?: number
}

export type SyncStudyRoomAssignAndJoinBody = Omit<SyncStudyRoomJoinBody, 'roomId'> & {
  /** Client-generated room code used only if no live room has a free seat. */
  fallbackRoomId: string
  /** Set for an explicit random room switch so the server may retain it when appropriate. */
  currentRoomId?: string
}

/** One peer in the analytics peers-today leaderboard (same-day focus record). */
export type SyncAnalyticsPeer = {
  userId: string
  focusSeconds: number
  updatedAtMs: number
}

export type SyncAnalyticsPeersResponse = {
  peers: SyncAnalyticsPeer[]
  asOf: string
}

/**
 * Consent-gated derived analytics summary (MASTER_PLAN §5.4). `payload` is
 * limited to chart-ready aggregates; it never contains raw timer/activity
 * facts or teaching evidence.
 */
export type SyncAnalyticsSummaryBody = {
  rangeKey: 'today' | 'sevenDays' | 'thirtyDays' | 'ninetyDays' | 'allTime'
  focusSeconds: number
  plannedFocusSeconds: number
  completedFocusSessions: number
  periodStartDate: string
  periodEndDate: string
  payload?: SyncedAnalyticsVisualizationsV1
}

export type SyncAnalyticsSummaryResponse = {
  stored: boolean
  summary: {
    id: string
    focusSeconds: number
    updatedAtMs: number
  }
}

export type SyncApiClientOptions = {
  baseUrl?: string
  getAccessToken?: () => string | null
  getRefreshToken?: () => string | null
  onTokenRefreshed?: (accessToken: string, refreshToken: string) => void
  onTokenExpired?: () => void
}

export type SyncApiClient = {
  loginWechat(code: string, platform: string): Promise<SyncLoginResponse>
  refresh(refreshToken: string): Promise<SyncRefreshResponse>
  logout(refreshToken: string): Promise<void>
  getMe(): Promise<SyncAuthUser>
  push(deviceId: string, entities: SyncEntity[]): Promise<SyncPushResponse>
  pull(since?: string | null, collections?: string[]): Promise<SyncPullResponse>
  ack(deviceId: string, cursor: string): Promise<SyncAckResponse>
  getStudyPlanning(): Promise<StudyPlanningSnapshotV1 | null>
  putStudyPlanning(revision: number, updatedAtMs: number, payload: unknown): Promise<SyncStudyPlanningPutResponse>
  listLessons(): Promise<SyncLessonListItem[]>
  downloadLesson(id: string): Promise<SyncLessonContent>
  uploadLesson(id: string, body: SyncLessonUploadBody): Promise<Record<string, unknown>>
  listConversations(): Promise<SyncConversationListItem[]>
  downloadConversation(id: string): Promise<SyncConversationContent>
  uploadConversation(id: string, body: SyncConversationUploadBody): Promise<Record<string, unknown>>
  getWechatLoginUrl(): Promise<SyncWechatLoginUrlResponse>
  pollLoginStatus(loginId: string): Promise<SyncPollResponse>
  studyRoomJoin(body: SyncStudyRoomJoinBody): Promise<{ joined: boolean; roomId: string }>
  studyRoomHeartbeat(body: SyncStudyRoomHeartbeatBody): Promise<{ ok: boolean }>
  studyRoomLeave(roomId: string): Promise<{ left: boolean }>
  studyRoomMembers(roomId: string): Promise<SyncStudyRoomMembersResponse>
  studyRoomAssignment(): Promise<{ roomId: string | null }>
  studyRoomAssignAndJoin(body: SyncStudyRoomAssignAndJoinBody): Promise<{ joined: boolean; roomId: string }>
  getAnalyticsPeersToday(): Promise<SyncAnalyticsPeersResponse>
  putAnalyticsSummary(body: SyncAnalyticsSummaryBody): Promise<SyncAnalyticsSummaryResponse>
}

export class SyncApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `sync api error ${status}`)
    this.name = 'SyncApiError'
    this.status = status
    this.body = body
  }
}

export class SyncUnauthorizedError extends SyncApiError {
  constructor(body: unknown) {
    super(401, body, 'sync api unauthorized')
    this.name = 'SyncUnauthorizedError'
  }
}

function asType<T>(value: unknown): T {
  return value as T
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function buildUrl(base: string, path: string, query?: Record<string, string | undefined>): string {
  const trimmedBase = base.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  let url = `${trimmedBase}${normalizedPath}`
  if (query) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, value)
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }
  return url
}

type RequestOptions = {
  body?: unknown
  auth?: boolean
  query?: Record<string, string | undefined>
  nullOnStatus?: number[]
  getAccessToken?: () => string | null
}

async function request(baseUrl: string, method: string, path: string, opts: RequestOptions): Promise<unknown> {
  const url = buildUrl(baseUrl, path, opts.query)
  const headers: Record<string, string> = {}
  let bodyText: string | undefined
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    bodyText = JSON.stringify(opts.body)
  }
  if (opts.auth) {
    const token = opts.getAccessToken?.() ?? null
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  let res: Response
  try {
    res = await fetch(url, { method, headers, body: bodyText })
  } catch (err) {
    throw new SyncApiError(0, null, err instanceof Error ? err.message : 'network error')
  }
  if (res.status === 401 && opts.auth) {
    const body = await parseBody(res)
    throw new SyncUnauthorizedError(body)
  }
  const parsed = await parseBody(res)
  if (!res.ok) {
    if (opts.nullOnStatus?.includes(res.status)) return null
    throw new SyncApiError(res.status, parsed)
  }
  return parsed
}

export function createSyncApiClient(options: SyncApiClientOptions = {}): SyncApiClient {
  const baseUrl = options.baseUrl?.trim() || resolveDefaultSyncApiBase()
  const getAccessToken = options.getAccessToken ?? (() => null)
  const getRefreshToken = options.getRefreshToken
  const onTokenRefreshed = options.onTokenRefreshed
  const onTokenExpired = options.onTokenExpired

  // Shared refresh lock – concurrent 401s share a single refresh attempt so
  // that a burst of heartbeats doesn't fire N simultaneous /auth/refresh calls.
  let refreshInFlight: Promise<{ accessToken: string; refreshToken: string } | null> | null = null

  async function tryRefresh(): Promise<{ accessToken: string; refreshToken: string } | null> {
    if (refreshInFlight) return refreshInFlight
    const refreshToken = getRefreshToken?.() ?? null
    if (!refreshToken) return null
    refreshInFlight = (async () => {
      try {
        const raw = await request(baseUrl, 'POST', '/auth/refresh', { body: { refreshToken } })
        const typed = raw as { accessToken: string; refreshToken: string }
        onTokenRefreshed?.(typed.accessToken, typed.refreshToken)
        return typed
      } catch {
        return null
      } finally {
        refreshInFlight = null
      }
    })()
    return refreshInFlight
  }

  const authed = async (
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>,
    nullOnStatus?: number[]
  ): Promise<unknown> => {
    try {
      return await request(baseUrl, method, path, { body, auth: true, query, nullOnStatus, getAccessToken })
    } catch (err) {
      if (!(err instanceof SyncUnauthorizedError)) throw err
      // 401 – try to rotate the refresh token and retry once.
      const refreshed = await tryRefresh()
      if (!refreshed) {
        onTokenExpired?.()
        throw err
      }
      try {
        return await request(baseUrl, method, path, { body, auth: true, query, nullOnStatus, getAccessToken })
      } catch (retryErr) {
        if (retryErr instanceof SyncUnauthorizedError) onTokenExpired?.()
        throw retryErr
      }
    }
  }

  const anon = (method: string, path: string, body?: unknown): Promise<unknown> =>
    request(baseUrl, method, path, { body })

  return {
    async loginWechat(code, platform) {
      return asType<SyncLoginResponse>(await anon('POST', '/auth/wechat/login', { code, platform }))
    },
    async refresh(refreshToken) {
      return asType<SyncRefreshResponse>(await anon('POST', '/auth/refresh', { refreshToken }))
    },
    async logout(refreshToken) {
      await anon('POST', '/auth/logout', { refreshToken })
    },
    async getMe() {
      return asType<SyncAuthUser>(await authed('GET', '/auth/me'))
    },
    async push(deviceId, entities) {
      return asType<SyncPushResponse>(await authed('POST', '/sync/push', { deviceId, entities }))
    },
    async pull(since, collections) {
      const query: Record<string, string | undefined> = {}
      if (since !== undefined && since !== null) query.since = since
      if (collections && collections.length > 0) query.collections = collections.join(',')
      return asType<SyncPullResponse>(await authed('GET', '/sync/pull', undefined, query))
    },
    async ack(deviceId, cursor) {
      return asType<SyncAckResponse>(await authed('POST', '/sync/ack', { deviceId, cursor }))
    },
    async getStudyPlanning() {
      return asType<StudyPlanningSnapshotV1 | null>(await authed('GET', '/study-planning', undefined, undefined, [404]))
    },
    async putStudyPlanning(revision, updatedAtMs, payload) {
      return asType<SyncStudyPlanningPutResponse>(await authed('PUT', '/study-planning', { revision, updatedAtMs, payload }))
    },
    async listLessons() {
      return asType<SyncLessonListItem[]>(await authed('GET', '/lessons'))
    },
    async downloadLesson(id) {
      return asType<SyncLessonContent>(await authed('GET', `/lessons/${encodeURIComponent(id)}/content`))
    },
    async uploadLesson(id, body) {
      return asType<Record<string, unknown>>(await authed('PUT', `/lessons/${encodeURIComponent(id)}`, body))
    },
    async listConversations() {
      return asType<SyncConversationListItem[]>(await authed('GET', '/conversations'))
    },
    async downloadConversation(id) {
      return asType<SyncConversationContent>(await authed('GET', `/conversations/${encodeURIComponent(id)}/content`))
    },
    async uploadConversation(id, body) {
      return asType<Record<string, unknown>>(await authed('PUT', `/conversations/${encodeURIComponent(id)}`, body))
    },
    async getWechatLoginUrl() {
      return asType<SyncWechatLoginUrlResponse>(await anon('GET', '/auth/wechat/login-url?client=desktop'))
    },
    async pollLoginStatus(loginId) {
      return asType<SyncPollResponse>(await anon('GET', `/auth/desktop/poll?loginId=${encodeURIComponent(loginId)}`))
    },
    async studyRoomJoin(body) {
      return asType<{ joined: boolean; roomId: string }>(await authed('POST', '/sync/study-room/join', body))
    },
    async studyRoomHeartbeat(body) {
      return asType<{ ok: boolean }>(await authed('POST', '/sync/study-room/heartbeat', body))
    },
    async studyRoomLeave(roomId) {
      return asType<{ left: boolean }>(await authed('POST', '/sync/study-room/leave', { roomId }))
    },
    async studyRoomMembers(roomId) {
      return asType<SyncStudyRoomMembersResponse>(await authed('GET', `/sync/study-room/members?roomId=${encodeURIComponent(roomId)}`))
    },
    async studyRoomAssignment() {
      return asType<{ roomId: string | null }>(await authed('GET', '/sync/study-room/assignment'))
    },
    async studyRoomAssignAndJoin(body) {
      return asType<{ joined: boolean; roomId: string }>(
        await authed('POST', '/sync/study-room/assign-and-join', body)
      )
    },
    async getAnalyticsPeersToday() {
      return asType<SyncAnalyticsPeersResponse>(await authed('GET', '/analytics/peers-today'))
    },
    async putAnalyticsSummary(body) {
      return asType<SyncAnalyticsSummaryResponse>(await authed('PUT', '/analytics/summary', body))
    }
  }
}
