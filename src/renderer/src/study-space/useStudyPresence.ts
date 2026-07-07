import { useEffect, useMemo, useRef, useState } from 'react'
import {
  STUDY_DAY_MS,
  STUDY_PRESENCE_CONNECT_TIMEOUT_MS,
  STUDY_PRESENCE_HEARTBEAT_MS,
  STUDY_PRESENCE_PEER_TTL_MS,
  STUDY_PRESENCE_CLIENT_PREFIX
} from './constants'
import {
  clampNumber,
  defaultStudyNickname,
  displayStudyRelayUrl,
  normalizeStudyRelayUrl,
  normalizeStudyRoomId,
  normalizeStudySeatIndex,
  normalizeStudySignalId,
  normalizeStudySpaceCode,
  studyPresenceTopic,
  studyRelayCandidates
} from './domain'
import type { StudyPresencePeer, StudyPresenceStatus, StudyRoomEvent, StudyRoomEventKind, StudyRoomId, StudySnapshot, StudyTimerState } from './types'

function mqttEncodeString(value: string): number[] {
  const encoded = new TextEncoder().encode(value)
  return [encoded.length >> 8, encoded.length & 0xff, ...encoded]
}

function mqttEncodeRemainingLength(length: number): number[] {
  const bytes: number[] = []
  let value = length
  do {
    let byte = value % 128
    value = Math.floor(value / 128)
    if (value > 0) byte |= 128
    bytes.push(byte)
  } while (value > 0)
  return bytes
}

function mqttPacket(type: number, variableHeader: number[] = [], payload: number[] = []): Uint8Array {
  const body = [...variableHeader, ...payload]
  return new Uint8Array([type, ...mqttEncodeRemainingLength(body.length), ...body])
}

function mqttConnectPacket(clientId: string): Uint8Array {
  return mqttPacket(
    0x10,
    [...mqttEncodeString('MQTT'), 0x04, 0x02, 0x00, 0x2d],
    mqttEncodeString(clientId.slice(0, 48))
  )
}

function mqttSubscribePacket(topic: string, packetId: number): Uint8Array {
  return mqttPacket(
    0x82,
    [packetId >> 8, packetId & 0xff],
    [...mqttEncodeString(topic), 0x00]
  )
}

function mqttPublishPacket(topic: string, message: string): Uint8Array {
  return mqttPacket(0x30, mqttEncodeString(topic), Array.from(new TextEncoder().encode(message)))
}

function mqttSend(socket: WebSocket, packet: Uint8Array): void {
  const body = new ArrayBuffer(packet.byteLength)
  new Uint8Array(body).set(packet)
  socket.send(body)
}

function mqttReadRemainingLength(bytes: Uint8Array, offset: number): { value: number; nextOffset: number } | null {
  let multiplier = 1
  let value = 0
  let cursor = offset
  while (cursor < bytes.length) {
    const byte = bytes[cursor]
    value += (byte & 127) * multiplier
    cursor += 1
    if ((byte & 128) === 0) return { value, nextOffset: cursor }
    multiplier *= 128
    if (multiplier > 128 * 128 * 128) return null
  }
  return null
}

function mqttReadString(bytes: Uint8Array, offset: number): { value: string; nextOffset: number } | null {
  if (offset + 2 > bytes.length) return null
  const length = (bytes[offset] << 8) + bytes[offset + 1]
  const start = offset + 2
  const end = start + length
  if (end > bytes.length) return null
  return { value: new TextDecoder().decode(bytes.slice(start, end)), nextOffset: end }
}

function mqttParsePublish(data: ArrayBuffer): { topic: string; message: string } | null {
  const bytes = new Uint8Array(data)
  if ((bytes[0] >> 4) !== 3) return null
  const remaining = mqttReadRemainingLength(bytes, 1)
  if (!remaining) return null
  const packetEnd = remaining.nextOffset + remaining.value
  if (packetEnd > bytes.length) return null
  const topic = mqttReadString(bytes, remaining.nextOffset)
  if (!topic) return null
  return {
    topic: topic.value,
    message: new TextDecoder().decode(bytes.slice(topic.nextOffset, packetEnd))
  }
}

function normalizePresencePeer(input: unknown): StudyPresencePeer | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<StudyPresencePeer> & { type?: string }
  if (raw.type !== 'study-presence') return null
  if (typeof raw.clientId !== 'string' || !raw.clientId.startsWith(STUDY_PRESENCE_CLIENT_PREFIX)) return null
  const roomId = normalizeStudyRoomId(raw.roomId)
  const spaceCode = normalizeStudySpaceCode(raw.spaceCode)
  const nickname = typeof raw.nickname === 'string' && raw.nickname.trim()
    ? raw.nickname.trim().slice(0, 18)
    : defaultStudyNickname(raw.clientId)
  const status: StudyTimerState = raw.status === 'running' || raw.status === 'paused' ? raw.status : 'idle'
  return {
    clientId: raw.clientId,
    roomId,
    spaceCode,
    nickname,
    signalId: normalizeStudySignalId(raw.signalId),
    seatIndex: normalizeStudySeatIndex(raw.seatIndex, roomId, raw.clientId),
    status,
    timerMode: raw.timerMode === 'break' ? 'break' : 'focus',
    focusMinutes: clampNumber(raw.focusMinutes, 5, 120, 25),
    todayFocusSeconds: clampNumber(raw.todayFocusSeconds, 0, 24 * 60 * 60, 0),
    todaySessions: clampNumber(raw.todaySessions, 0, 99, 0),
    streakDays: clampNumber(raw.streakDays, 0, 10_000, 0),
    updatedAt: clampNumber(raw.updatedAt, 0, Date.now() + 60_000, Date.now())
  }
}

function normalizeStudyRoomEvent(input: unknown): StudyRoomEvent | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<StudyRoomEvent> & { type?: string }
  if (raw.type !== 'study-event') return null
  if (typeof raw.clientId !== 'string' || !raw.clientId.startsWith(STUDY_PRESENCE_CLIENT_PREFIX)) return null
  const kind = raw.kind === 'checkin' || raw.kind === 'focus_start' || raw.kind === 'task_done' || raw.kind === 'cheer'
    ? raw.kind
    : null
  if (!kind) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : `${raw.clientId}-${raw.createdAt ?? Date.now()}`
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 90) : ''
  if (!text) return null
  return {
    id,
    clientId: raw.clientId,
    spaceCode: normalizeStudySpaceCode(raw.spaceCode),
    roomId: normalizeStudyRoomId(raw.roomId),
    nickname: typeof raw.nickname === 'string' && raw.nickname.trim()
      ? raw.nickname.trim().slice(0, 18)
      : defaultStudyNickname(raw.clientId),
    kind,
    text,
    createdAt: clampNumber(raw.createdAt, Date.now() - STUDY_DAY_MS, Date.now() + 60_000, Date.now())
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
  const [status, setStatus] = useState<StudyPresenceStatus>('connecting')
  const [peers, setPeers] = useState<StudyPresencePeer[]>([])
  const [events, setEvents] = useState<StudyRoomEvent[]>([])
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState(0)
  const [lastRemoteMessageAt, setLastRemoteMessageAt] = useState(0)
  const [relayUrl, setRelayUrl] = useState(() => normalizeStudyRelayUrl(snapshot.presenceRelayUrl))
  const snapshotRef = useRef(snapshot)
  const socketRef = useRef<WebSocket | null>(null)
  const subscribedRef = useRef(false)
  const activeTopic = studyPresenceTopic(snapshot.spaceCode)
  const activeRelayUrl = normalizeStudyRelayUrl(snapshot.presenceRelayUrl)
  const relayCandidates = useMemo(() => studyRelayCandidates(activeRelayUrl), [activeRelayUrl])

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    let closed = false
    let reconnectTimer: number | undefined
    let heartbeatTimer: number | undefined
    let pruneTimer: number | undefined
    let connectTimeout: number | undefined
    let packetId = 1

    const clearConnectTimeout = (): void => {
      if (connectTimeout) {
        window.clearTimeout(connectTimeout)
        connectTimeout = undefined
      }
    }

    const publishPresence = (): void => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN || !subscribedRef.current) return
      const current = snapshotRef.current
      const message = JSON.stringify({
        type: 'study-presence',
        clientId: current.clientId,
        spaceCode: current.spaceCode,
        roomId: current.roomId,
        nickname: current.nickname,
        signalId: current.signalId,
        seatIndex: normalizeStudySeatIndex(current.seatIndex, current.roomId, current.clientId),
        status: current.timerState,
        timerMode: current.timerMode,
        focusMinutes: current.focusMinutes,
        todayFocusSeconds: current.todayFocusSeconds,
        todaySessions: current.todaySessions,
        streakDays: current.streakDays,
        updatedAt: Date.now()
      })
      mqttSend(socket, mqttPublishPacket(activeTopic, message))
      setLastHeartbeatAt(Date.now())
    }

    const prunePeers = (): void => {
      const nowMs = Date.now()
      setPeers((current) => current.filter((peer) => nowMs - peer.updatedAt <= STUDY_PRESENCE_PEER_TTL_MS))
      setEvents((current) => current.filter((event) => nowMs - event.createdAt <= 2 * 60 * 60 * 1000))
    }

    const connect = (candidateIndex = 0): void => {
      const candidateRelayUrl = relayCandidates[candidateIndex] ?? relayCandidates[0] ?? activeRelayUrl
      setStatus('connecting')
      setRelayUrl(candidateRelayUrl)
      subscribedRef.current = false
      clearConnectTimeout()
      const socket = new WebSocket(candidateRelayUrl, 'mqtt')
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket
      connectTimeout = window.setTimeout(() => {
        if (socket.readyState === WebSocket.CONNECTING) socket.close()
      }, STUDY_PRESENCE_CONNECT_TIMEOUT_MS)

      socket.addEventListener('open', () => {
        clearConnectTimeout()
        mqttSend(socket, mqttConnectPacket(snapshotRef.current.clientId))
      })

      socket.addEventListener('message', (event) => {
        if (!(event.data instanceof ArrayBuffer)) return
        const bytes = new Uint8Array(event.data)
        const packetType = bytes[0] >> 4
        if (packetType === 2) {
          mqttSend(socket, mqttSubscribePacket(activeTopic, packetId++))
          setStatus('online')
          return
        }
        if (packetType === 9) {
          subscribedRef.current = true
          publishPresence()
          return
        }
        const publish = mqttParsePublish(event.data)
        if (!publish || publish.topic !== activeTopic) return
        try {
          const peer = normalizePresencePeer(JSON.parse(publish.message))
          if (peer) {
            if (peer.clientId === snapshotRef.current.clientId) return
            setLastRemoteMessageAt(Date.now())
            setPeers((current) => [peer, ...current.filter((item) => item.clientId !== peer.clientId)].slice(0, 80))
            return
          }
          const event = normalizeStudyRoomEvent(JSON.parse(publish.message))
          if (!event || event.clientId === snapshotRef.current.clientId) return
          setLastRemoteMessageAt(Date.now())
          setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 80))
        } catch {
          // Ignore malformed public relay payloads.
        }
      })

      socket.addEventListener('close', () => {
        clearConnectTimeout()
        if (socketRef.current === socket) socketRef.current = null
        subscribedRef.current = false
        setStatus('offline')
        if (!closed) {
          const nextIndex = candidateIndex + 1
          const hasNextRelay = nextIndex < relayCandidates.length
          if (hasNextRelay) setStatus('connecting')
          reconnectTimer = window.setTimeout(() => connect(hasNextRelay ? nextIndex : 0), hasNextRelay ? 700 : 5000)
        }
      })

      socket.addEventListener('error', () => {
        setStatus('offline')
        socket.close()
      })
    }

    connect()
    setPeers([])
    setEvents([])
    setLastHeartbeatAt(0)
    setLastRemoteMessageAt(0)
    heartbeatTimer = window.setInterval(() => {
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) mqttSend(socket, new Uint8Array([0xc0, 0x00]))
      publishPresence()
    }, STUDY_PRESENCE_HEARTBEAT_MS)
    pruneTimer = window.setInterval(prunePeers, 5000)

    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (heartbeatTimer) window.clearInterval(heartbeatTimer)
      if (pruneTimer) window.clearInterval(pruneTimer)
      clearConnectTimeout()
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [activeRelayUrl, activeTopic, relayCandidates])

  useEffect(() => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN && subscribedRef.current) {
      mqttSend(socket, mqttPublishPacket(activeTopic, JSON.stringify({
        type: 'study-presence',
        clientId: snapshot.clientId,
        spaceCode: snapshot.spaceCode,
        roomId: snapshot.roomId,
        nickname: snapshot.nickname,
        signalId: snapshot.signalId,
        seatIndex: normalizeStudySeatIndex(snapshot.seatIndex, snapshot.roomId, snapshot.clientId),
        status: snapshot.timerState,
        timerMode: snapshot.timerMode,
        focusMinutes: snapshot.focusMinutes,
        todayFocusSeconds: snapshot.todayFocusSeconds,
        todaySessions: snapshot.todaySessions,
        streakDays: snapshot.streakDays,
        updatedAt: Date.now()
      })))
      setLastHeartbeatAt(Date.now())
    }
  }, [
    activeTopic,
    snapshot.clientId,
    snapshot.focusMinutes,
    snapshot.nickname,
    snapshot.roomId,
    snapshot.seatIndex,
    snapshot.signalId,
    snapshot.spaceCode,
    snapshot.streakDays,
    snapshot.timerMode,
    snapshot.timerState,
    snapshot.todayFocusSeconds,
    snapshot.todaySessions
  ])

  const sendEvent = (kind: StudyRoomEventKind, text: string, target: { roomId?: StudyRoomId; spaceCode?: string } = {}): void => {
    const current = snapshotRef.current
    const roomId = target.roomId ?? current.roomId
    const spaceCode = target.spaceCode ? normalizeStudySpaceCode(target.spaceCode) : current.spaceCode
    const event: StudyRoomEvent = {
      id: `${current.clientId}-${Date.now()}-${kind}`,
      clientId: current.clientId,
      spaceCode,
      roomId,
      nickname: current.nickname,
      kind,
      text: text.trim().slice(0, 90),
      createdAt: Date.now()
    }
    if (!event.text) return
    setEvents((items) => [event, ...items.filter((item) => item.id !== event.id)].slice(0, 80))
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN && subscribedRef.current) {
      mqttSend(socket, mqttPublishPacket(activeTopic, JSON.stringify({ type: 'study-event', ...event })))
    }
  }

  return { status, peers, events, relay: displayStudyRelayUrl(relayUrl), topic: activeTopic, lastHeartbeatAt, lastRemoteMessageAt, sendEvent }
}
