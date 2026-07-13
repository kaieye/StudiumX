import { useEffect, useMemo, useState } from 'react'
import { displayStudyRelayUrl } from './domain'
import {
  createStudyPresenceConnection,
  studyPresenceConnectionIdentity,
  type StudyPresenceConnectionState,
  type StudyPresenceEnvironment,
  type StudyPresenceSocket
} from './presence/study-presence-connection'
import type { StudyPresencePeer, StudyPresenceStatus, StudyRoomEvent, StudyRoomEventKind, StudyRoomId, StudySnapshot } from './types'

function browserStudyPresenceEnvironment(): StudyPresenceEnvironment {
  return {
    now: () => Date.now(),
    createSocket: (url, protocol) => new WebSocket(url, protocol) as unknown as StudyPresenceSocket,
    setTimeout: (handler, delayMs) => window.setTimeout(handler, delayMs),
    clearTimeout: (timer) => window.clearTimeout(timer),
    setInterval: (handler, delayMs) => window.setInterval(handler, delayMs),
    clearInterval: (timer) => window.clearInterval(timer)
  }
}

function initialConnectionState(identity: ReturnType<typeof studyPresenceConnectionIdentity>): StudyPresenceConnectionState {
  return {
    status: 'connecting',
    peers: [],
    events: [],
    relayUrl: identity.relayUrl,
    topic: identity.topic,
    lastHeartbeatAt: 0,
    lastRemoteMessageAt: 0
  }
}

export function useStudyPresence(snapshot: StudySnapshot): {
  status: StudyPresenceStatus
  peers: StudyPresencePeer[]
  events: StudyRoomEvent[]
  relay: string
  topic: string
  lastHeartbeatAt: number
  lastRemoteMessageAt: number
  sendEvent: (kind: StudyRoomEventKind, text: string, target?: { roomId?: StudyRoomId; spaceCode?: string }) => void
} {
  const environment = useMemo(browserStudyPresenceEnvironment, [])
  const identity = useMemo(
    () => studyPresenceConnectionIdentity(snapshot),
    [snapshot.presenceRelayUrl, snapshot.spaceCode]
  )
  const [state, setState] = useState<StudyPresenceConnectionState>(() => initialConnectionState(identity))
  const connection = useMemo(
    () => createStudyPresenceConnection({ snapshot, environment, onStateChange: setState }),
    [environment, identity.relayUrl, identity.topic]
  )

  // The connection reads the latest snapshot for heartbeats and events, while
  // only relay/topic identity changes replace its live-room session.
  useEffect(() => {
    connection.updateSnapshot(snapshot)
  }, [connection, snapshot])

  useEffect(() => {
    connection.start()
    return () => connection.stop()
  }, [connection])

  // Keep the established eager presence publication behavior for every
  // presence-bearing snapshot field, without coupling React to MQTT details.
  useEffect(() => {
    connection.publishPresence()
  }, [
    connection,
    snapshot.clientId,
    snapshot.focusMinutes,
    snapshot.nickname,
    snapshot.roomId,
    snapshot.seatClaimedAt,
    snapshot.seatIndex,
    snapshot.signalId,
    snapshot.spaceCode,
    snapshot.streakDays,
    snapshot.timerMode,
    snapshot.timerState,
    snapshot.todayFocusSeconds,
    snapshot.todaySessions
  ])

  return {
    status: state.status,
    peers: state.peers,
    events: state.events,
    relay: displayStudyRelayUrl(state.relayUrl),
    topic: state.topic,
    lastHeartbeatAt: state.lastHeartbeatAt,
    lastRemoteMessageAt: state.lastRemoteMessageAt,
    sendEvent: (kind, text, target) => connection.sendEvent(kind, text, target)
  }
}
