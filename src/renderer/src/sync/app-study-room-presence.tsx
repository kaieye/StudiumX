import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAppStore } from '../app-shell/appStore'
import {
  persistStudySnapshot,
  readStudySnapshot,
  syncStudyLocation
} from '../study-space/domain'
import { setStudySpaceCode } from '../study-space/session/transitions'
import type { StudySnapshot } from '../study-space/types'
import { useStudyRoomPresence, type StudyRoomPresenceState } from './study-room-presence'
import { useSyncState } from './sync-store'

const STUDY_SNAPSHOT_REFRESH_MS = 10_000

type AppStudyRoomPresenceValue = StudyRoomPresenceState & {
  /**
   * Mirrors the live workbench session into the app-wide presence owner, so
   * heartbeats keep the timer status and focus total current after navigation.
   */
  updateSessionSnapshot: (snapshot: StudySnapshot) => void
  /**
   * Makes an explicitly selected room the durable app-wide room immediately.
   * This prevents a room switch from reverting when the user leaves the
   * workbench after the server has accepted the move.
   */
  adoptRoom: (roomId: string) => void
}

const AppStudyRoomPresenceContext = createContext<AppStudyRoomPresenceValue | null>(null)

function deriveServerPresenceStatus(snapshot: StudySnapshot): 'studying' | 'break' | 'idle' {
  if (snapshot.timerState === 'running' && snapshot.timerMode === 'focus') return 'studying'
  if (snapshot.timerMode === 'break' && snapshot.timerState !== 'idle') return 'break'
  return 'idle'
}

/**
 * Keeps an authenticated user in the study-room roster for the whole app
 * session, rather than only while the workbench route is mounted.
 *
 * The provider owns the one server-presence lifecycle for desktop and Web.
 * `OfficeWorkbench` consumes it for roster rendering and room switching.
 */
export function AppStudyRoomPresenceProvider({ children }: { children: ReactNode }) {
  const syncState = useSyncState()
  const petAppearance = useAppStore((state) => state.settings.pet.appearance)
  const [snapshot, setSnapshot] = useState<StudySnapshot>(() => readStudySnapshot())

  const updateSessionSnapshot = useCallback((nextSnapshot: StudySnapshot): void => {
    setSnapshot((currentSnapshot) => currentSnapshot === nextSnapshot ? currentSnapshot : nextSnapshot)
  }, [])

  const adoptRoom = useCallback((roomId: string): void => {
    setSnapshot((currentSnapshot) => {
      const nextSnapshot = setStudySpaceCode(currentSnapshot, roomId)
      persistStudySnapshot(nextSnapshot)
      syncStudyLocation(nextSnapshot.spaceCode, nextSnapshot.roomId)
      return nextSnapshot
    })
  }, [])

  // Session changes made while the workbench is not mounted are durable in
  // localStorage. Refreshing here also lets a second renderer/tab converge on
  // the same app-wide room without requiring a visit to the workbench.
  useEffect(() => {
    const refreshSnapshot = (): void => updateSessionSnapshot(readStudySnapshot())
    const timer = window.setInterval(refreshSnapshot, STUDY_SNAPSHOT_REFRESH_MS)
    const onStorage = (event: StorageEvent): void => {
      if (event.storageArea === window.localStorage) refreshSnapshot()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('storage', onStorage)
    }
  }, [updateSessionSnapshot])

  const presence = useStudyRoomPresence({
    roomId: snapshot.spaceCode,
    nickname: syncState.user?.nickname ?? snapshot.nickname,
    avatarUrl: syncState.user?.avatarUrl,
    petAppearance,
    focusSecondsToday: snapshot.todayFocusSeconds,
    status: deriveServerPresenceStatus(snapshot),
    active: Boolean(syncState.accessToken),
    onAssignedRoom: adoptRoom
  })

  const value = useMemo<AppStudyRoomPresenceValue>(
    () => ({ ...presence, updateSessionSnapshot, adoptRoom }),
    [adoptRoom, presence, updateSessionSnapshot]
  )

  return (
    <AppStudyRoomPresenceContext.Provider value={value}>
      {children}
    </AppStudyRoomPresenceContext.Provider>
  )
}

export function useAppStudyRoomPresence(): AppStudyRoomPresenceValue {
  const value = useContext(AppStudyRoomPresenceContext)
  if (!value) {
    throw new Error('useAppStudyRoomPresence must be used within AppStudyRoomPresenceProvider')
  }
  return value
}
