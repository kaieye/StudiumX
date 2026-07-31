import {
  STUDY_DAY_MS,
  STUDY_PRESENCE_CLIENT_PREFIX,
  STUDY_PRESENCE_CONNECT_TIMEOUT_MS,
  STUDY_PRESENCE_HEARTBEAT_MS,
  STUDY_PRESENCE_PEER_TTL_MS
} from '../constants'
import {
  clampNumber,
  defaultStudyNickname,
  isGeneratedStudyNickname,
  normalizeStudyRelayUrl,
  normalizeStudyRoomId,
  normalizeStudySeatClaimedAt,
  normalizeStudySeatIndex,
  normalizeStudySignalId,
  normalizeStudySpaceCode,
  studyPresenceTopic,
  studyRelayCandidates
} from '../domain'
import type {
  StudyPresencePeer,
  StudyPresenceStatus,
  StudyRoomEvent,
  StudyRoomEventKind,
  StudyRoomId,
  StudySnapshot,
  StudyTimerState
} from '../types'
import {
  mqttConnectPacket,
  mqttPacketType,
  mqttParsePublish,
  mqttPingRequestPacket,
  mqttPublishPacket,
  mqttSubscribePacket
} from './mqtt-wire'

const EVENT_TTL_MS = 2 * 60 * 60 * 1000
const PRUNE_INTERVAL_MS = 5_000
const MAX_PUBLIC_RELAY_MESSAGE_BYTES = 16 * 1024
const MAX_PUBLIC_CLIENT_ID_LENGTH = 128
const MAX_PUBLIC_ITEMS = 80

export type StudyPresenceSocket = {
  readyState: number
  binaryType: BinaryType
  send(data: ArrayBuffer): void
  close(): void
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

export type StudyPresenceEnvironment = {
  now: () => number
  createSocket: (url: string, protocol: string) => StudyPresenceSocket
  setTimeout: (handler: () => void, delayMs: number) => number
  clearTimeout: (timer: number) => void
  setInterval: (handler: () => void, delayMs: number) => number
  clearInterval: (timer: number) => void
}

export type StudyPresenceConnectionState = {
  status: StudyPresenceStatus
  peers: StudyPresencePeer[]
  events: StudyRoomEvent[]
  relayUrl: string
  topic: string
  lastHeartbeatAt: number
  lastRemoteMessageAt: number
}

export type StudyPresenceConnectionIdentity = {
  relayUrl: string
  topic: string
}

export type StudyPresenceConnectionOptions = {
  snapshot: StudySnapshot
  environment: StudyPresenceEnvironment
  onStateChange: (state: StudyPresenceConnectionState) => void
}

/** The normalized values whose change requires a fresh public-relay session. */
export function studyPresenceConnectionIdentity(snapshot: Pick<StudySnapshot, 'presenceRelayUrl' | 'spaceCode'>): StudyPresenceConnectionIdentity {
  const relayUrl = normalizeStudyRelayUrl(snapshot.presenceRelayUrl)
  return { relayUrl, topic: studyPresenceTopic(snapshot.spaceCode) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPublicClientId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_PUBLIC_CLIENT_ID_LENGTH
    && value.startsWith(STUDY_PRESENCE_CLIENT_PREFIX)
}

function publicNickname(value: unknown, clientId: string): string {
  const nickname = typeof value === 'string' ? value.trim().slice(0, 18) : ''
  return nickname && !isGeneratedStudyNickname(nickname)
    ? nickname
    : defaultStudyNickname(clientId)
}

function normalizePresencePeer(input: unknown, nowMs: number): StudyPresencePeer | null {
  if (!isRecord(input) || input.type !== 'study-presence' || !isPublicClientId(input.clientId)) return null

  const roomId = normalizeStudyRoomId(input.roomId)
  const status: StudyTimerState = input.status === 'running' || input.status === 'paused' ? input.status : 'idle'
  const updatedAt = clampNumber(input.updatedAt, 0, nowMs + 60_000, nowMs)

  return {
    clientId: input.clientId,
    roomId,
    spaceCode: normalizeStudySpaceCode(input.spaceCode),
    nickname: publicNickname(input.nickname, input.clientId),
    signalId: normalizeStudySignalId(input.signalId),
    seatIndex: normalizeStudySeatIndex(input.seatIndex, roomId, input.clientId),
    seatClaimedAt: normalizeStudySeatClaimedAt(input.seatClaimedAt, updatedAt),
    status,
    timerMode: input.timerMode === 'break' ? 'break' : 'focus',
    focusMinutes: clampNumber(input.focusMinutes, 5, 120, 25),
    todayFocusSeconds: clampNumber(input.todayFocusSeconds, 0, 24 * 60 * 60, 0),
    todaySessions: clampNumber(input.todaySessions, 0, 99, 0),
    streakDays: clampNumber(input.streakDays, 0, 10_000, 0),
    updatedAt
  }
}

function normalizeStudyRoomEvent(input: unknown, nowMs: number): StudyRoomEvent | null {
  if (!isRecord(input) || input.type !== 'study-event' || !isPublicClientId(input.clientId)) return null

  const kind = input.kind === 'checkin' || input.kind === 'focus_start' || input.kind === 'task_done' || input.kind === 'cheer'
    ? input.kind
    : null
  if (!kind) return null

  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 90) : ''
  if (!text) return null

  const id = typeof input.id === 'string' && input.id
    ? input.id.slice(0, 80)
    : `${input.clientId}-${input.createdAt ?? nowMs}`

  return {
    id,
    clientId: input.clientId,
    spaceCode: normalizeStudySpaceCode(input.spaceCode),
    roomId: normalizeStudyRoomId(input.roomId),
    nickname: publicNickname(input.nickname, input.clientId),
    kind,
    text,
    createdAt: clampNumber(input.createdAt, nowMs - STUDY_DAY_MS, nowMs + 60_000, nowMs)
  }
}

export class StudyPresenceConnection {
  private readonly environment: StudyPresenceEnvironment
  private readonly onStateChange: (state: StudyPresenceConnectionState) => void
  private readonly relayCandidates: string[]
  private snapshot: StudySnapshot
  private state: StudyPresenceConnectionState
  private socket: StudyPresenceSocket | null = null
  private subscribed = false
  private started = false
  private reconnectTimer: number | undefined
  private heartbeatTimer: number | undefined
  private pruneTimer: number | undefined
  private connectTimeout: number | undefined
  private packetId = 1

  constructor(options: StudyPresenceConnectionOptions) {
    this.snapshot = options.snapshot
    this.environment = options.environment
    this.onStateChange = options.onStateChange
    const identity = studyPresenceConnectionIdentity(options.snapshot)
    this.relayCandidates = studyRelayCandidates(identity.relayUrl)
    this.state = {
      status: 'connecting',
      peers: [],
      events: [],
      relayUrl: identity.relayUrl,
      topic: identity.topic,
      lastHeartbeatAt: 0,
      lastRemoteMessageAt: 0
    }
  }

  getState(): StudyPresenceConnectionState {
    return this.state
  }

  updateSnapshot(snapshot: StudySnapshot): void {
    this.snapshot = snapshot
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.connect()
    this.heartbeatTimer = this.environment.setInterval(() => {
      const socket = this.socket
      if (socket?.readyState === 1) this.sendPacket(socket, mqttPingRequestPacket())
      this.publishPresence()
    }, STUDY_PRESENCE_HEARTBEAT_MS)
    this.pruneExpiredItems()
    this.pruneTimer = this.environment.setInterval(() => this.pruneExpiredItems(), PRUNE_INTERVAL_MS)
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.subscribed = false
    this.clearReconnectTimer()
    this.clearConnectTimeout()
    if (this.heartbeatTimer !== undefined) this.environment.clearInterval(this.heartbeatTimer)
    if (this.pruneTimer !== undefined) this.environment.clearInterval(this.pruneTimer)
    this.heartbeatTimer = undefined
    this.pruneTimer = undefined

    const socket = this.socket
    this.socket = null
    socket?.close()
  }

  publishPresence(): void {
    const socket = this.socket
    if (!socket || socket.readyState !== 1 || !this.subscribed) return

    const current = this.snapshot
    const nowMs = this.environment.now()
    this.sendPacket(socket, mqttPublishPacket(this.state.topic, JSON.stringify({
      type: 'study-presence',
      clientId: current.clientId,
      spaceCode: current.spaceCode,
      roomId: current.roomId,
      nickname: current.nickname,
      signalId: current.signalId,
      seatIndex: normalizeStudySeatIndex(current.seatIndex, current.roomId, current.clientId),
      seatClaimedAt: current.seatClaimedAt,
      status: current.timerState,
      timerMode: current.timerMode,
      focusMinutes: current.focusMinutes,
      todayFocusSeconds: current.todayFocusSeconds,
      todaySessions: current.todaySessions,
      streakDays: current.streakDays,
      updatedAt: nowMs
    })))
    this.setState({ lastHeartbeatAt: nowMs })
  }

  sendEvent(kind: StudyRoomEventKind, text: string, target: { roomId?: StudyRoomId; spaceCode?: string } = {}): void {
    const current = this.snapshot
    const nowMs = this.environment.now()
    const event: StudyRoomEvent = {
      id: `${current.clientId}-${nowMs}-${kind}`,
      clientId: current.clientId,
      spaceCode: target.spaceCode ? normalizeStudySpaceCode(target.spaceCode) : current.spaceCode,
      roomId: target.roomId ?? current.roomId,
      nickname: current.nickname,
      kind,
      text: text.trim().slice(0, 90),
      createdAt: nowMs
    }
    if (!event.text) return

    this.setState({
      events: [event, ...this.state.events.filter((item) => item.id !== event.id)].slice(0, MAX_PUBLIC_ITEMS)
    })

    const socket = this.socket
    if (socket?.readyState === 1 && this.subscribed) {
      this.sendPacket(socket, mqttPublishPacket(this.state.topic, JSON.stringify({ type: 'study-event', ...event })))
    }
  }

  private connect(candidateIndex = 0): void {
    if (!this.started) return
    const candidateRelayUrl = this.relayCandidates[candidateIndex] ?? this.relayCandidates[0] ?? this.state.relayUrl
    this.subscribed = false
    this.clearConnectTimeout()
    this.setState({ status: 'connecting', relayUrl: candidateRelayUrl })

    let socket: StudyPresenceSocket
    try {
      socket = this.environment.createSocket(candidateRelayUrl, 'mqtt')
      socket.binaryType = 'arraybuffer'
    } catch {
      this.scheduleReconnect(candidateIndex)
      return
    }

    this.socket = socket
    this.connectTimeout = this.environment.setTimeout(() => {
      if (this.socket === socket && socket.readyState === 0) socket.close()
    }, STUDY_PRESENCE_CONNECT_TIMEOUT_MS)

    socket.addEventListener('open', () => {
      if (!this.isCurrentSocket(socket)) return
      this.clearConnectTimeout()
      this.sendPacket(socket, mqttConnectPacket(this.snapshot.clientId))
    })

    socket.addEventListener('message', (event) => {
      if (!this.isCurrentSocket(socket) || !(event.data instanceof ArrayBuffer)) return
      this.handleMessage(socket, event.data)
    })

    socket.addEventListener('close', () => {
      if (!this.isCurrentSocket(socket)) return
      this.clearConnectTimeout()
      this.socket = null
      this.subscribed = false
      this.setState({ status: 'offline' })
      if (this.started) this.scheduleReconnect(candidateIndex)
    })

    socket.addEventListener('error', () => {
      if (!this.isCurrentSocket(socket)) return
      this.setState({ status: 'offline' })
      socket.close()
    })
  }

  private handleMessage(socket: StudyPresenceSocket, data: ArrayBuffer): void {
    const packetType = mqttPacketType(data)
    if (packetType === 2) {
      this.sendPacket(socket, mqttSubscribePacket(this.state.topic, this.packetId++))
      this.setState({ status: 'online' })
      return
    }
    if (packetType === 9) {
      this.subscribed = true
      this.publishPresence()
      return
    }

    const publish = mqttParsePublish(data, MAX_PUBLIC_RELAY_MESSAGE_BYTES)
    if (!publish || publish.topic !== this.state.topic) return

    try {
      const payload: unknown = JSON.parse(publish.message)
      const nowMs = this.environment.now()
      const peer = normalizePresencePeer(payload, nowMs)
      if (peer) {
        if (peer.clientId === this.snapshot.clientId) return
        const existing = this.state.peers.find((item) => item.clientId === peer.clientId)
        if (existing && peer.updatedAt < existing.updatedAt) return
        this.setState({
          peers: [peer, ...this.state.peers.filter((item) => item.clientId !== peer.clientId)].slice(0, MAX_PUBLIC_ITEMS),
          lastRemoteMessageAt: nowMs
        })
        return
      }

      const event = normalizeStudyRoomEvent(payload, nowMs)
      if (!event || event.clientId === this.snapshot.clientId) return
      this.setState({
        events: [event, ...this.state.events.filter((item) => item.id !== event.id)].slice(0, MAX_PUBLIC_ITEMS),
        lastRemoteMessageAt: nowMs
      })
    } catch {
      // A public relay is untrusted. Malformed JSON is intentionally ignored.
    }
  }

  private pruneExpiredItems(): void {
    const nowMs = this.environment.now()
    const peers = this.state.peers.filter((peer) => nowMs - peer.updatedAt <= STUDY_PRESENCE_PEER_TTL_MS)
    const events = this.state.events.filter((event) => nowMs - event.createdAt <= EVENT_TTL_MS)
    if (peers.length !== this.state.peers.length || events.length !== this.state.events.length) {
      this.setState({ peers, events })
    }
  }

  private scheduleReconnect(candidateIndex: number): void {
    if (!this.started || this.reconnectTimer !== undefined) return
    const nextIndex = candidateIndex + 1
    const hasNextRelay = nextIndex < this.relayCandidates.length
    if (hasNextRelay) this.setState({ status: 'connecting' })
    this.reconnectTimer = this.environment.setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect(hasNextRelay ? nextIndex : 0)
    }, hasNextRelay ? 700 : 5_000)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) this.environment.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout !== undefined) this.environment.clearTimeout(this.connectTimeout)
    this.connectTimeout = undefined
  }

  private isCurrentSocket(socket: StudyPresenceSocket): boolean {
    return this.started && this.socket === socket
  }

  private sendPacket(socket: StudyPresenceSocket, packet: Uint8Array): void {
    const body = new ArrayBuffer(packet.byteLength)
    new Uint8Array(body).set(packet)
    socket.send(body)
  }

  private setState(next: Partial<StudyPresenceConnectionState>): void {
    this.state = { ...this.state, ...next }
    this.onStateChange(this.state)
  }
}

export function createStudyPresenceConnection(options: StudyPresenceConnectionOptions): StudyPresenceConnection {
  return new StudyPresenceConnection(options)
}

