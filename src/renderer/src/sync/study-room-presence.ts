/**
 * Server-backed study-room presence for the desktop.
 *
 * Replaces the local-only leaderboard with a synced view: the desktop joins a
 * room, heartbeats its same-day focus total + status, and polls the member
 * list so the WorkbenchLeaderboard shows every device currently in the room.
 *
 * Presence is opt-in: the hook is a no-op until a room id + access token are
 * available. All traffic is gated behind the existing sync-store auth.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createSyncApiClient, type SyncStudyRoomMember } from './sync-api-client'
import { getSyncAccessToken, useSyncState } from './sync-store'

export type StudyRoomPresenceState = {
  members: SyncStudyRoomMember[]
  loading: boolean
  error: string | null
  refresh: () => void
}

const HEARTBEAT_INTERVAL_MS = 30 * 1000
const POLL_INTERVAL_MS = 15 * 1000

export interface UseStudyRoomPresenceOptions {
  roomId: string | null
  nickname?: string | null
  avatarUrl?: string | null
  platform?: string
  /** Same-day focus seconds to advertise to the room. */
  focusSecondsToday?: number
  status?: 'studying' | 'break' | 'idle'
  /** When false, the hook stays inert (no joins/traffic). */
  active?: boolean
}

/**
 * Join `roomId`, heartbeat focus/status, and poll the member list.
 *
 * Returns the synced member list for the leaderboard. Joins on mount/room
 * change, leaves on unmount/room change.
 */
export function useStudyRoomPresence(
  options: UseStudyRoomPresenceOptions,
): StudyRoomPresenceState {
  const { roomId, nickname, avatarUrl, platform, focusSecondsToday, status, active } = options
  const syncState = useSyncState()
  const [members, setMembers] = useState<SyncStudyRoomMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const joinedRef = useRef<string | null>(null)
  const focusRef = useRef(focusSecondsToday)
  focusRef.current = focusSecondsToday
  const statusRef = useRef(status)
  statusRef.current = status

  const client = createSyncApiClient({
    baseUrl: syncState.baseUrl,
    getAccessToken: getSyncAccessToken,
  })

  const refresh = useCallback(async () => {
    if (!roomId || !getSyncAccessToken()) return
    try {
      const res = await client.studyRoomMembers(roomId)
      setMembers(res.members)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [roomId, syncState.baseUrl])

  // Join + leave lifecycle.
  useEffect(() => {
    if (!active || !roomId || !getSyncAccessToken() || !syncState.accessToken) {
      return
    }
    const room = roomId
    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        await client.studyRoomJoin({
          roomId: room,
          nickname: nickname ?? undefined,
          avatarUrl: avatarUrl ?? undefined,
          platform: platform ?? 'desktop',
          status: status ?? 'studying',
          focusSecondsToday: focusSecondsToday ?? 0,
        })
        if (cancelled) return
        joinedRef.current = room
        await refresh()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (joinedRef.current === room) {
        joinedRef.current = null
        void client.studyRoomLeave(room).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, roomId, syncState.accessToken, syncState.baseUrl, nickname, avatarUrl, platform])

  // Heartbeat + poll loop.
  useEffect(() => {
    if (!active || !roomId || !joinedRef.current) return
    const hb = () => {
      void client
        .studyRoomHeartbeat({
          roomId,
          status: statusRef.current,
          focusSecondsToday: focusRef.current,
        })
        .catch(() => {})
    }
    const poll = () => {
      void refresh().catch(() => {})
    }
    const hbTimer = setInterval(hb, HEARTBEAT_INTERVAL_MS)
    const pollTimer = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      clearInterval(hbTimer)
      clearInterval(pollTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, roomId, syncState.accessToken, syncState.baseUrl])

  return { members, loading, error, refresh }
}
