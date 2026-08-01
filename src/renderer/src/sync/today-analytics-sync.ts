/**
 * Same-day analytics sync (MASTER_PLAN §5.4 "学习分析同步").
 *
 * Once authenticated, the desktop uploads its derived `today` summary
 * (focusSeconds / sessions / planned 0 — task-plan history is not
 * reconstructable) immediately, then every hour while the app remains online.
 * It also polls the peers-today leaderboard on that cadence. Server-side
 * upload failures are retried on the next hourly tick.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { todayKey } from '../study-space/domain'
import {
  createSyncApiClient,
  SyncApiError,
  type SyncAnalyticsPeer,
  type SyncAnalyticsSummaryBody,
  type SyncApiClient,
  type SyncApiClientOptions
} from './sync-api-client'
import {
  clearSyncAuth,
  getSyncAccessToken,
  getSyncState,
  setSyncAuth,
  useSyncState
} from './sync-store'

const SYNC_INTERVAL_MS = 60 * 60 * 1000

/**
 * Derived `today` summary payload. `plannedFocusSeconds` stays 0 — the
 * desktop's personal-study analytics cannot reconstruct task-plan history.
 */
export function buildTodayAnalyticsSummary(input: {
  focusSecondsToday: number
  todaySessions: number
  localToday: string
}): SyncAnalyticsSummaryBody {
  return {
    rangeKey: 'today',
    focusSeconds: Math.max(0, Math.floor(input.focusSecondsToday)),
    plannedFocusSeconds: 0,
    completedFocusSessions: Math.max(0, Math.floor(input.todaySessions)),
    periodStartDate: input.localToday,
    periodEndDate: input.localToday
  }
}

/* Module-level upload-blocked flag, shared with the settings UI. */

let uploadBlocked = false
const uploadBlockedListeners = new Set<() => void>()

export function setAnalyticsUploadBlocked(value: boolean): void {
  if (uploadBlocked === value) return
  uploadBlocked = value
  uploadBlockedListeners.forEach((listener) => listener())
}

export function getAnalyticsUploadBlocked(): boolean {
  return uploadBlocked
}

/** True while the server rejects uploads (e.g. ANALYTICS_SYNC_DEFAULT_OFF). */
export function useAnalyticsUploadBlocked(): boolean {
  return useSyncExternalStore(
    (listener) => {
      uploadBlockedListeners.add(listener)
      return () => uploadBlockedListeners.delete(listener)
    },
    getAnalyticsUploadBlocked,
    getAnalyticsUploadBlocked
  )
}

/**
 * Upload the today summary and poll the peers-today pool while the user is
 * signed in. It is inert when offline (`peers: []`).
 */
export function useTodayAnalyticsSync(
  options: { focusSecondsToday: number; todaySessions: number },
  createClient: (clientOptions: SyncApiClientOptions) => SyncApiClient = createSyncApiClient
): { peers: SyncAnalyticsPeer[] } {
  const syncState = useSyncState()
  const enabled = Boolean(syncState.accessToken)

  // Live counters tick every second while the timer runs — keep them in refs
  // so the interval callbacks always read the latest value without
  // re-registering the loops.
  const focusRef = useRef(options.focusSecondsToday)
  focusRef.current = options.focusSecondsToday
  const sessionsRef = useRef(options.todaySessions)
  sessionsRef.current = options.todaySessions

  const [peers, setPeers] = useState<SyncAnalyticsPeer[]>([])

  useEffect(() => {
    if (!enabled) {
      setPeers([])
      return
    }
    const client = createClient({
      baseUrl: syncState.baseUrl,
      getAccessToken: getSyncAccessToken,
      getRefreshToken: () => getSyncState().refreshToken,
      onTokenRefreshed: (accessToken, refreshToken) =>
        setSyncAuth({ accessToken, refreshToken, user: getSyncState().user }),
      onTokenExpired: clearSyncAuth
    })
    // This loop is intentionally kept alive across individual failed uploads:
    // an online user gets another attempt at the next hourly sync.
    const upload = async () => {
      if (!enabled) return
      const focusSecondsToday = focusRef.current
      const todaySessions = sessionsRef.current
      // A zero-day would create a row the peers pool filters out anyway.
      if (focusSecondsToday <= 0 && todaySessions <= 0) return
      // Compute today inside the tick so midnight rollover follows the
      // snapshot's own today-counter reset.
      const localToday = todayKey(new Date())
      try {
        await client.putAnalyticsSummary(
          buildTodayAnalyticsSummary({ focusSecondsToday, todaySessions, localToday })
        )
        setAnalyticsUploadBlocked(false)
      } catch (err) {
        if (err instanceof SyncApiError && err.status === 403) {
          setAnalyticsUploadBlocked(true)
        }
      }
    }

    const poll = async () => {
      try {
        const response = await client.getAnalyticsPeersToday()
        setPeers(Array.isArray(response.peers) ? response.peers : [])
      } catch {
        // Transient failure keeps the last-known pool.
      }
    }

    const sync = () => {
      void upload()
      void poll()
    }
    sync()
    const syncTimer = setInterval(sync, SYNC_INTERVAL_MS)
    return () => {
      clearInterval(syncTimer)
      setAnalyticsUploadBlocked(false)
    }
  }, [createClient, enabled, syncState.accessToken, syncState.baseUrl])

  return { peers }
}
