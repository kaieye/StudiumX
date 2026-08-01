import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthError } from '../../api/http'
import type { WebStudyRoomApi, WebStudyRoomMember } from './types'

const ROOM_ID_KEY = 'studiumx.webStudyRoom.roomId'
const MEMBER_REFRESH_MS = 15_000
const HEARTBEAT_MS = 30_000

export interface UseStudyRoomPresenceOptions {
  focusSecondsToday?: number
  status?: 'studying' | 'break' | 'idle'
  active?: boolean
}

export interface UseStudyRoomPresence {
  roomId: string | null
  members: WebStudyRoomMember[]
  loading: boolean
  error: string | null
  refresh: () => void
}

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  try {
    const values = new Uint32Array(5)
    crypto.getRandomValues(values)
    for (const value of values) result += alphabet[value % alphabet.length]
    return result
  } catch {
    for (let i = 0; i < 5; i += 1) {
      result += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    return result
  }
}

function readRoomId(): string | null {
  try {
    return localStorage.getItem(ROOM_ID_KEY)
  } catch {
    return null
  }
}

function writeRoomId(roomId: string | null): void {
  try {
    if (roomId) localStorage.setItem(ROOM_ID_KEY, roomId)
    else localStorage.removeItem(ROOM_ID_KEY)
  } catch {
    // Ignore private-mode storage failures.
  }
}

function getApi(): WebStudyRoomApi {
  return window.teachingSystem as unknown as WebStudyRoomApi
}

export function useStudyRoomPresence({
  focusSecondsToday = 0,
  status = 'studying',
  active = true
}: UseStudyRoomPresenceOptions = {}): UseStudyRoomPresence {
  const apiRef = useRef<WebStudyRoomApi>(getApi())
  const focusRef = useRef(focusSecondsToday)
  const statusRef = useRef(status)
  focusRef.current = Math.max(0, Math.floor(focusSecondsToday))
  statusRef.current = status

  const [roomId, setRoomId] = useState<string | null>(() => readRoomId())
  const [members, setMembers] = useState<WebStudyRoomMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const roomRef = useRef(roomId)
  roomRef.current = roomId
  const mountedRef = useRef(true)

  const handleAuthError = useCallback((err: unknown) => {
    if (!(err instanceof AuthError)) return false
    roomRef.current = null
    setRoomId(null)
    setMembers([])
    writeRoomId(null)
    setError('登录已失效，请重新登录')
    return true
  }, [])

  const refresh = useCallback(async () => {
    const currentRoom = roomRef.current
    if (!active || !currentRoom) return
    setLoading(true)
    try {
      const result = await apiRef.current.fetchStudyRoomMembers(currentRoom)
      if (!mountedRef.current || roomRef.current !== currentRoom) return
      setMembers(result.members ?? [])
      setError(null)
    } catch (err) {
      if (!handleAuthError(err) && mountedRef.current) {
        setError((err as Error)?.message ?? '自习室同步失败')
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [active, handleAuthError])

  useEffect(() => {
    mountedRef.current = true
    if (!active) return () => { mountedRef.current = false }

    let cancelled = false
    const setup = async () => {
      setLoading(true)
      try {
        const assigned = await apiRef.current.assignAndJoinStudyRoom({
          fallbackRoomId: readRoomId() ?? generateRoomCode(),
          status: statusRef.current,
          focusSecondsToday: focusRef.current,
          platform: 'web'
        })
        if (cancelled || !mountedRef.current) {
          void apiRef.current.leaveStudyRoom(assigned.roomId).catch(() => undefined)
          return
        }
        roomRef.current = assigned.roomId
        setRoomId(assigned.roomId)
        writeRoomId(assigned.roomId)
        setError(null)
        const result = await apiRef.current.fetchStudyRoomMembers(assigned.roomId)
        if (cancelled || !mountedRef.current) return
        setMembers(result.members ?? [])
      } catch (err) {
        if (!handleAuthError(err) && mountedRef.current) {
          setError((err as Error)?.message ?? '无法加入自习室')
        }
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    }
    void setup()

    const refreshTimer = window.setInterval(() => void refresh(), MEMBER_REFRESH_MS)
    const heartbeatTimer = window.setInterval(() => {
      const currentRoom = roomRef.current
      if (!currentRoom) return
      void apiRef.current.heartbeatStudyRoom({
        roomId: currentRoom,
        status: statusRef.current,
        focusSecondsToday: focusRef.current
      }).catch((err) => {
        if (!handleAuthError(err) && mountedRef.current) {
          setError((err as Error)?.message ?? '自习室心跳失败')
        }
      })
    }, HEARTBEAT_MS)

    return () => {
      cancelled = true
      mountedRef.current = false
      window.clearInterval(refreshTimer)
      window.clearInterval(heartbeatTimer)
      const currentRoom = roomRef.current
      if (currentRoom) {
        void apiRef.current.leaveStudyRoom(currentRoom).catch(() => undefined)
      }
    }
  }, [active, handleAuthError, refresh])

  return { roomId, members, loading, error, refresh: () => void refresh() }
}
