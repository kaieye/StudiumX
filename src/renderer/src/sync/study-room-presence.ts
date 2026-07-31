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
import type { PetAppearanceId } from '../../../shared/teaching-types'
import { createSyncApiClient, type SyncStudyRoomMember } from './sync-api-client'
import { clearSyncAuth, getSyncAccessToken, getSyncState, setSyncAuth, useSyncState } from './sync-store'

export type StudyRoomPresenceState = {
  members: SyncStudyRoomMember[]
  loading: boolean
  error: string | null
  refresh: () => void
  /**
   * Join a room found by an explicit room-code search. The server rejects
   * empty/non-existent rooms, so callers must wait for this result before
   * changing their local room code.
   */
  joinExistingRoom: (roomId: string) => Promise<boolean>
  /**
   * Atomically select and enter a room on the server. Returns null when sync
   * is unavailable or the request fails, allowing the local-only room flow.
   */
  assignAndJoinRoom: (input: {
    fallbackRoomId: string
    currentRoomId?: string
  }) => Promise<string | null>
}

const HEARTBEAT_INTERVAL_MS = 30 * 1000
const POLL_INTERVAL_MS = 15 * 1000

export interface UseStudyRoomPresenceOptions {
  roomId: string | null
  nickname?: string | null
  avatarUrl?: string | null
  petAppearance?: PetAppearanceId
  platform?: string
  /** Same-day focus seconds to advertise to the room. */
  focusSecondsToday?: number
  status?: 'studying' | 'break' | 'idle'
  /** When false, the hook stays inert (no joins/traffic). */
  active?: boolean
  /** Applies the server's first-entry room assignment to the local snapshot. */
  onAssignedRoom?: (roomId: string) => void
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
  const {
    roomId,
    nickname,
    avatarUrl,
    petAppearance,
    platform,
    focusSecondsToday,
    status,
    active,
    onAssignedRoom
  } = options
  const syncState = useSyncState()
  const [members, setMembers] = useState<SyncStudyRoomMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const joinedRef = useRef<string | null>(null)
  const focusRef = useRef(focusSecondsToday)
  focusRef.current = focusSecondsToday
  const statusRef = useRef(status)
  statusRef.current = status
  const onAssignedRoomRef = useRef(onAssignedRoom)
  onAssignedRoomRef.current = onAssignedRoom
  const assignmentPresenceRef = useRef({
    nickname,
    avatarUrl,
    petAppearance,
    platform,
    status,
    focusSecondsToday,
  })
  assignmentPresenceRef.current = {
    nickname,
    avatarUrl,
    petAppearance,
    platform,
    status,
    focusSecondsToday,
  }
  const assignmentAttemptedRef = useRef(false)
  const assignmentUserIdRef = useRef<string | undefined>(undefined)

  // A fresh authenticated user entering the workbench gets one assignment
  // attempt. Subsequent explicit room switches stay under the user's control.
  useEffect(() => {
    const userId = syncState.user?.id
    if (assignmentUserIdRef.current === userId) return
    assignmentUserIdRef.current = userId
    assignmentAttemptedRef.current = false
  }, [syncState.user?.id])

  const client = createSyncApiClient({
    baseUrl: syncState.baseUrl,
    getAccessToken: getSyncAccessToken,
    getRefreshToken: () => getSyncState().refreshToken,
    onTokenRefreshed: (accessToken, refreshToken) =>
      setSyncAuth({ accessToken, refreshToken, user: getSyncState().user }),
    onTokenExpired: clearSyncAuth
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

  const assignAndJoinRoom = useCallback(async (
    input: { fallbackRoomId: string; currentRoomId?: string }
  ): Promise<string | null> => {
    if (!active || !getSyncAccessToken() || !syncState.accessToken) return null
    try {
      const presence = assignmentPresenceRef.current
      const assignment = await client.studyRoomAssignAndJoin({
        ...input,
        nickname: presence.nickname ?? undefined,
        avatarUrl: presence.avatarUrl ?? undefined,
        petAppearance: presence.petAppearance,
        platform: presence.platform ?? 'desktop',
        status: presence.status ?? 'studying',
        focusSecondsToday: presence.focusSecondsToday ?? 0,
      })
      setError(null)
      return assignment.roomId
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [active, syncState.accessToken, syncState.baseUrl])

  const joinExistingRoom = useCallback(async (roomIdInput: string): Promise<boolean> => {
    const roomId = roomIdInput.trim().toUpperCase()
    if (!roomId || !active || !getSyncAccessToken() || !syncState.accessToken) return false
    try {
      const presence = assignmentPresenceRef.current
      await client.studyRoomJoin({
        roomId,
        nickname: presence.nickname ?? undefined,
        avatarUrl: presence.avatarUrl ?? undefined,
        petAppearance: presence.petAppearance,
        platform: presence.platform ?? 'desktop',
        status: presence.status ?? 'studying',
        focusSecondsToday: presence.focusSecondsToday ?? 0,
      })
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [active, syncState.accessToken, syncState.baseUrl])

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
        if (!assignmentAttemptedRef.current && onAssignedRoomRef.current) {
          assignmentAttemptedRef.current = true
          const assignedRoomId = await assignAndJoinRoom({ fallbackRoomId: room })
          if (cancelled) return
          if (assignedRoomId) {
            if (assignedRoomId !== room) {
              onAssignedRoomRef.current(assignedRoomId)
              return
            }
            joinedRef.current = room
            await refresh()
            return
          }
        }

        await client.studyRoomJoin({
          roomId: room,
          nickname: nickname ?? undefined,
          avatarUrl: avatarUrl ?? undefined,
          petAppearance,
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
  }, [
    active,
    roomId,
    syncState.accessToken,
    syncState.baseUrl,
    nickname,
    avatarUrl,
    petAppearance,
    platform,
    assignAndJoinRoom,
    refresh,
  ])

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

  return { members, loading, error, refresh, joinExistingRoom, assignAndJoinRoom }
}
