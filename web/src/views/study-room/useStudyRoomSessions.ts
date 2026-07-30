/**
 * Study room state hook: owns the local focus-session log, the best-effort
 * sync queue, and the read-only leaderboard data assembly.
 *
 * Design (plan §6.3 / §10 / §390):
 *  - Timing is 100% client-side; completed focus segments are appended to a
 *    localStorage log (today's focus is always available, offline-friendly).
 *  - Each completed segment is also enqueued for a best-effort push to
 *    POST /sync/push (collection `timer-sessions`) via the adapter. Failed /
 *    offline pushes stay queued and are retried on `online` / manual refresh
 *    ("本地计时正常运行，联网后批量 push").
 *  - Leaderboard self focus = server `GET /analytics/summary?range=today`
 *    when available, else the local log. Peer ranking has no server endpoint
 *    yet (plan §10 待定) -> explicit empty state.
 *
 * All server access goes through `window.teachingSystem` (the adapter seam);
 * this module never imports `../api/http` directly.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LeaderboardData,
  StudyRoomSession,
  SyncPushResult,
  WebStudyRoomApi
} from './types'

/** localStorage keys (NOT auth tokens). */
const SESSION_LOG_KEY = 'studiumx.webStudyRoom.sessions'
const SYNC_QUEUE_KEY = 'studiumx.webStudyRoom.syncQueue'

/** Keep the local log bounded: last 7 days, at most 500 rows. */
const LOG_MAX_ROWS = 500
const LOG_RETAIN_MS = 7 * 24 * 60 * 60 * 1000
/** Minimum focus seconds worth queueing for sync (avoid noise). */
const SYNC_MIN_FOCUS_SECONDS = 60

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline'

export interface UseStudyRoomSessions {
  /** Today's locally-recorded focus sessions (most recent first). */
  sessions: StudyRoomSession[]
  todayFocusSeconds: number
  todaySessionCount: number
  leaderboard: LeaderboardData | null
  leaderboardLoading: boolean
  leaderboardError: string | null
  refreshLeaderboard: () => void
  /** Record a completed focus segment (log + enqueue + best-effort push). */
  addSession: (session: StudyRoomSession) => void
  syncStatus: SyncStatus
  pendingCount: number
  /** Manually drain the sync queue. */
  pushNow: () => void
}

/** Stable adapter handle (set once at startup; never changes). */
function getStudyRoomApi(): WebStudyRoomApi {
  return window.teachingSystem as unknown as WebStudyRoomApi
}

function isToday(ms: number): boolean {
  const d = new Date(ms)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function readJson<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function loadSessionLog(): StudyRoomSession[] {
  const cutoff = Date.now() - LOG_RETAIN_MS
  return readJson<StudyRoomSession>(SESSION_LOG_KEY)
    .filter((s) => typeof s?.id === 'string' && s.endedAtMs >= cutoff)
    .slice(-LOG_MAX_ROWS)
}

function loadQueue(): StudyRoomSession[] {
  return readJson<StudyRoomSession>(SYNC_QUEUE_KEY).filter(
    (s) => typeof s?.id === 'string'
  )
}

function summarizeToday(sessions: StudyRoomSession[]): {
  focusSeconds: number
  count: number
} {
  let focusSeconds = 0
  let count = 0
  for (const s of sessions) {
    if (s.phase === 'focus' && isToday(s.endedAtMs)) {
      focusSeconds += Math.max(0, Math.floor(s.focusSeconds))
      count += 1
    }
  }
  return { focusSeconds, count }
}

function buildLeaderboard(
  localToday: { focusSeconds: number; count: number },
  server: { focusSeconds: number; count: number } | null
): LeaderboardData {
  if (server) {
    return {
      entries: [
        {
          rank: 1,
          nickname: '我',
          focusSeconds: server.focusSeconds,
          isSelf: true
        }
      ],
      selfFocusSeconds: server.focusSeconds,
      selfSessionsToday: server.count,
      source: 'server',
      peersUnavailable: true,
      note: '今日专注时长来自服务端聚合（含其他设备）。同伴排行需服务端新增排行榜端点后上线。'
    }
  }
  if (localToday.focusSeconds > 0) {
    return {
      entries: [
        {
          rank: 1,
          nickname: '我',
          focusSeconds: localToday.focusSeconds,
          isSelf: true
        }
      ],
      selfFocusSeconds: localToday.focusSeconds,
      selfSessionsToday: localToday.count,
      source: 'local',
      peersUnavailable: true,
      note: '今日专注时长为本机本地记录（未联网同步）。同伴排行需服务端新增排行榜端点后上线。'
    }
  }
  return {
    entries: [],
    selfFocusSeconds: 0,
    selfSessionsToday: 0,
    source: 'empty',
    peersUnavailable: true,
    note: '暂无今日专注记录。完成一个专注段后这里会显示你的时长。同伴排行需服务端新增排行榜端点后上线。'
  }
}

export function useStudyRoomSessions(): UseStudyRoomSessions {
  const apiRef = useRef<WebStudyRoomApi>(getStudyRoomApi())

  const [sessions, setSessions] = useState<StudyRoomSession[]>(() => loadSessionLog())
  const [queue, setQueue] = useState<StudyRoomSession[]>(() => loadQueue())
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null)
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)

  // Refs mirroring queue/sessions so async callbacks read fresh values without
  // re-creating the callbacks (keeps `addSession`/`pushNow` identity stable).
  const queueRef = useRef<StudyRoomSession[]>(queue)
  queueRef.current = queue
  const sessionsRef = useRef<StudyRoomSession[]>(sessions)
  sessionsRef.current = sessions

  const todaySummary = summarizeToday(sessions)
  const todayFocusSeconds = todaySummary.focusSeconds
  const todaySessionCount = todaySummary.count

  // Serialize drains so concurrent triggers (addSession + mount + online) never
  // race on queueRef: each drain reads the freshest queue after the previous
  // one finishes. The server actionId idempotency (server-contracts §7) makes
  // any residual duplicate push harmless.
  const drainSeqRef = useRef<Promise<void> | null>(null)

  /** Drain the sync queue: push all pending sessions, drop accepted/dup ones. */
  const drainQueue = useCallback((): Promise<void> => {
    const run = async (): Promise<void> => {
      const pending = queueRef.current
      if (pending.length === 0) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setSyncStatus('offline')
        return
      }
      setSyncStatus('syncing')
      try {
        const result: SyncPushResult = await apiRef.current.pushStudyRoomSessions(pending)
        // accepted = stored; skipped_duplicate = already stored (idempotent
        // retry). Both mean the server has the session -> drop it from the
        // queue. conflict / missing result -> keep for retry.
        const acknowledged = new Set<string>()
        for (const r of result.results ?? []) {
          if (r.status === 'accepted' || r.status === 'skipped_duplicate') {
            acknowledged.add(r.id)
          }
        }
        const nextQueue = pending.filter((s) => !acknowledged.has(s.id))
        queueRef.current = nextQueue
        setQueue(nextQueue)
        writeJson(SYNC_QUEUE_KEY, nextQueue)
        setSyncStatus(nextQueue.length > 0 ? 'error' : 'idle')
      } catch {
        // Network / auth / server error: keep the queue, retry later.
        setSyncStatus(
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? 'offline'
            : 'error'
        )
      }
    }
    const next = (drainSeqRef.current ?? Promise.resolve()).then(run, run)
    drainSeqRef.current = next
    return next
  }, [])

  /** (Re)fetch the server today-summary and reassemble the leaderboard. */
  const refreshLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true)
    setLeaderboardError(null)
    try {
      const serverSummary = await apiRef.current.fetchTodayFocusSummary()
      const server = serverSummary
        ? { focusSeconds: serverSummary.focusSeconds, count: serverSummary.completedFocusSessions }
        : null
      setLeaderboard(buildLeaderboard(summarizeToday(sessionsRef.current), server))
    } catch (err) {
      setLeaderboardError((err as Error)?.message ?? '加载排行榜失败')
      setLeaderboard(buildLeaderboard(summarizeToday(sessionsRef.current), null))
    } finally {
      setLeaderboardLoading(false)
    }
  }, [])

  const addSession = useCallback(
    (session: StudyRoomSession) => {
      // 1. Append to the local log (bounded).
      const nextSessions = [...sessionsRef.current, session].slice(-LOG_MAX_ROWS)
      // Update the ref synchronously so an immediate drain/refresh below (which
      // runs before the scheduled re-render) sees the fresh log.
      sessionsRef.current = nextSessions
      setSessions(nextSessions)
      writeJson(SESSION_LOG_KEY, nextSessions)

      // 2. Enqueue for sync (focus segments only; skip sub-minute noise).
      if (session.phase === 'focus' && session.focusSeconds >= SYNC_MIN_FOCUS_SECONDS) {
        const nextQueue = [...queueRef.current, session]
        // Update the ref synchronously so the immediate drainQueue() below
        // (which reads queueRef.current before re-render) includes this session.
        queueRef.current = nextQueue
        setQueue(nextQueue)
        writeJson(SYNC_QUEUE_KEY, nextQueue)
        // 3. Best-effort immediate push (non-blocking; failures stay queued).
        void drainQueue()
      }

      // 4. Refresh the leaderboard from the local log immediately.
      setLeaderboard(buildLeaderboard(summarizeToday(nextSessions), null))
    },
    [drainQueue]
  )

  const pushNow = useCallback(() => {
    void drainQueue()
  }, [drainQueue])

  // On mount: drain any offline-queued sessions + fetch the leaderboard.
  useEffect(() => {
    void drainQueue()
    void refreshLeaderboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Retry queued pushes when connectivity returns.
  useEffect(() => {
    const onOnline = () => void drainQueue()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [drainQueue])

  return {
    sessions,
    todayFocusSeconds,
    todaySessionCount,
    leaderboard,
    leaderboardLoading,
    leaderboardError,
    refreshLeaderboard: () => void refreshLeaderboard(),
    addSession,
    syncStatus,
    pendingCount: queue.length,
    pushNow
  }
}
