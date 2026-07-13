import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultStudySnapshot, STUDY_PRESENCE_PEER_TTL_MS } from '@renderer/study-space/constants'
import { studyRelayCandidates } from '@renderer/study-space/domain'
import {
  createStudyPresenceConnection,
  type StudyPresenceConnectionState,
  type StudyPresenceEnvironment,
  type StudyPresenceSocket
} from '@renderer/study-space/presence/study-presence-connection'
import { mqttParsePublish, mqttPublishPacket } from '@renderer/study-space/presence/mqtt-wire'
import type { StudySnapshot } from '@renderer/study-space/types'

class FakeSocket implements StudyPresenceSocket {
  readyState = 0
  binaryType: BinaryType = 'blob'
  readonly sent: ArrayBuffer[] = []
  private readonly listeners = new Map<string, Array<(event?: { data: unknown }) => void>>()

  send(data: ArrayBuffer): void {
    this.sent.push(data)
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.emit('close')
  }

  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: ((event?: { data: unknown }) => void)): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  receive(data: ArrayBuffer): void {
    this.emit('message', { data })
  }

  fail(): void {
    this.emit('error')
  }

  private emit(type: string, event?: { data: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function toArrayBuffer(packet: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(packet.byteLength)
  copy.set(packet)
  return copy.buffer
}

function relayPublish(topic: string, payload: unknown): ArrayBuffer {
  return toArrayBuffer(mqttPublishPacket(topic, JSON.stringify(payload)))
}

function snapshot(overrides: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    ...defaultStudySnapshot,
    clientId: 'studiumx-self',
    nickname: 'Self',
    spaceCode: 'TEAM-7',
    presenceRelayUrl: 'wss://relay.example/mqtt',
    seatClaimedAt: 1_000,
    ...overrides
  }
}

function createHarness(initialSnapshot = snapshot()): {
  connection: ReturnType<typeof createStudyPresenceConnection>
  sockets: FakeSocket[]
  states: StudyPresenceConnectionState[]
} {
  const sockets: FakeSocket[] = []
  const states: StudyPresenceConnectionState[] = []
  const environment: StudyPresenceEnvironment = {
    now: () => Date.now(),
    createSocket: vi.fn(() => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    }),
    setTimeout: (handler, delayMs) => window.setTimeout(handler, delayMs),
    clearTimeout: (timer) => window.clearTimeout(timer),
    setInterval: (handler, delayMs) => window.setInterval(handler, delayMs),
    clearInterval: (timer) => window.clearInterval(timer)
  }
  const connection = createStudyPresenceConnection({
    snapshot: initialSnapshot,
    environment,
    onStateChange: (state) => states.push(state)
  })
  return { connection, sockets, states }
}

function subscribe(harness: ReturnType<typeof createHarness>): FakeSocket {
  harness.connection.start()
  const socket = harness.sockets[0]
  socket.open()
  socket.receive(new Uint8Array([0x20, 0x02, 0x00, 0x00]).buffer)
  socket.receive(new Uint8Array([0x90, 0x03, 0x00, 0x01, 0x00]).buffer)
  return socket
}

afterEach(() => {
  vi.useRealTimers()
})

describe('StudyPresenceConnection lifecycle', () => {
  it('keeps relay candidate order and reconnect delays, then cancels all timers on stop', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'))
    const initial = snapshot()
    const harness = createHarness(initial)
    const expectedCandidates = studyRelayCandidates(initial.presenceRelayUrl)

    harness.connection.start()
    expect(harness.sockets.map((socket) => socket.binaryType)).toEqual(['arraybuffer'])
    expect(vi.mocked(harness.sockets).length).toBe(1)
    expect(harness.states.at(-1)?.relayUrl).toBe(expectedCandidates[0])

    harness.sockets[0].close()
    expect(harness.states.at(-1)?.status).toBe('connecting')
    vi.advanceTimersByTime(699)
    expect(harness.sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(harness.sockets).toHaveLength(2)
    expect(harness.states.at(-1)?.relayUrl).toBe(expectedCandidates[1])

    harness.sockets[1].close()
    vi.advanceTimersByTime(700)
    expect(harness.sockets).toHaveLength(3)
    expect(harness.states.at(-1)?.relayUrl).toBe(expectedCandidates[2])

    harness.sockets[2].close()
    vi.advanceTimersByTime(5_000)
    expect(harness.sockets).toHaveLength(4)
    expect(harness.states.at(-1)?.relayUrl).toBe(expectedCandidates[0])

    const socket = harness.sockets[3]
    harness.connection.stop()
    expect(socket.readyState).toBe(3)
    vi.advanceTimersByTime(30_000)
    expect(harness.sockets).toHaveLength(4)
  })

  it('validates hostile public payloads, preserves receive ordering, deduplicates, expires items, and follows room updates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'))
    const harness = createHarness()
    const socket = subscribe(harness)
    const topic = harness.connection.getState().topic

    socket.receive(relayPublish(topic, { type: 'study-presence', clientId: `studiumx-${'x'.repeat(200)}` }))
    socket.receive(relayPublish(topic, {
      type: 'study-presence', clientId: 'studiumx-first', roomId: 'silent', spaceCode: 'TEAM-7', nickname: 'First',
      updatedAt: Date.now(), status: 'running'
    }))
    socket.receive(relayPublish(topic, {
      type: 'study-presence', clientId: 'studiumx-second', roomId: 'deep', spaceCode: 'TEAM-7', nickname: 'Second',
      updatedAt: Date.now() + 1, status: 'paused'
    }))
    socket.receive(relayPublish(topic, {
      type: 'study-presence', clientId: 'studiumx-first', roomId: 'exam', spaceCode: 'TEAM-7', nickname: 'Stale',
      updatedAt: Date.now() - 1, status: 'idle'
    }))

    expect(harness.connection.getState().peers.map((peer) => [peer.clientId, peer.nickname])).toEqual([
      ['studiumx-second', 'Second'],
      ['studiumx-first', 'First']
    ])

    socket.receive(relayPublish(topic, {
      type: 'study-event', id: 'event-one', clientId: 'studiumx-first', roomId: 'silent', spaceCode: 'TEAM-7',
      nickname: 'First', kind: 'cheer', text: 'You can do this', createdAt: Date.now()
    }))
    socket.receive(relayPublish(topic, {
      type: 'study-event', id: 'event-two', clientId: 'studiumx-second', roomId: 'deep', spaceCode: 'TEAM-7',
      nickname: 'Second', kind: 'task_done', text: 'Done', createdAt: Date.now()
    }))
    socket.receive(relayPublish(topic, {
      type: 'study-event', id: 'event-one', clientId: 'studiumx-first', roomId: 'silent', spaceCode: 'TEAM-7',
      nickname: 'First', kind: 'cheer', text: 'Newest copy', createdAt: Date.now()
    }))
    socket.receive(relayPublish(topic, JSON.stringify({ type: 'study-event', text: 'x'.repeat(16 * 1024) })))

    expect(harness.connection.getState().events.map((event) => [event.id, event.text])).toEqual([
      ['event-one', 'Newest copy'],
      ['event-two', 'Done']
    ])

    harness.connection.updateSnapshot(snapshot({ roomId: 'deep' }))
    harness.connection.publishPresence()
    const sentPresence = mqttParsePublish(socket.sent.at(-1) as ArrayBuffer)
    expect(sentPresence?.topic).toBe(topic)
    expect(JSON.parse(sentPresence?.message ?? '{}')).toMatchObject({ roomId: 'deep' })

    socket.receive(relayPublish(topic, {
      type: 'study-presence', clientId: 'studiumx-expired', roomId: 'silent', spaceCode: 'TEAM-7',
      nickname: 'Expired', updatedAt: Date.now() - STUDY_PRESENCE_PEER_TTL_MS - 1
    }))
    socket.receive(relayPublish(topic, {
      type: 'study-event', id: 'old-event', clientId: 'studiumx-expired', roomId: 'silent', spaceCode: 'TEAM-7',
      nickname: 'Expired', kind: 'checkin', text: 'Old', createdAt: Date.now() - 2 * 60 * 60 * 1000 - 1
    }))
    vi.advanceTimersByTime(5_000)

    expect(harness.connection.getState().peers.some((peer) => peer.clientId === 'studiumx-expired')).toBe(false)
    expect(harness.connection.getState().events.some((event) => event.id === 'old-event')).toBe(false)
  })

  it('publishes MQTT keepalive and presence only while the subscribed connection is live', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'))
    const harness = createHarness()
    const socket = subscribe(harness)
    const sentBeforeHeartbeat = socket.sent.length

    vi.advanceTimersByTime(10_000)
    expect(socket.sent.slice(sentBeforeHeartbeat).map((packet) => Array.from(new Uint8Array(packet)).slice(0, 2))).toEqual([
      [0xc0, 0x00],
      [0x30, expect.any(Number)]
    ])

    harness.connection.stop()
    const sentAfterStop = socket.sent.length
    vi.advanceTimersByTime(20_000)
    expect(socket.sent).toHaveLength(sentAfterStop)
  })
})


