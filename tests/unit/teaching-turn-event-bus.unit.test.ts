import { describe, expect, it, vi } from 'vitest'
import { createTeachingTurnEventBus } from '../../src/main/teaching-turn-event-bus'

function publishMany(
  bus: ReturnType<typeof createTeachingTurnEventBus>,
  count: number,
  prefix = 'event'
) {
  const published = []
  for (let index = 1; index <= count; index += 1) {
    published.push(
      bus.publish({
        durability: 'ephemeral',
        occurredAt: `2026-07-18T10:00:0${Math.min(index, 9)}.000Z`,
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        eventId: `${prefix}-${index}`,
        payload: {
          type: 'turn_progress',
          stage: `stage-${index}`,
          message: 'x'.repeat(200)
        }
      })
    )
  }
  return published
}

describe('TeachingTurnEventBus', () => {
  it('assigns per-turn monotonic sequences starting at 1', () => {
    const bus = createTeachingTurnEventBus({ turnId: 'turn-1', now: () => '2026-07-18T10:00:00.000Z' })
    const first = bus.publish({
      durability: 'ephemeral',
      occurredAt: '2026-07-18T10:00:00.000Z',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      eventId: 'e1',
      payload: { type: 'turn_progress', stage: 'a' }
    })
    const second = bus.publish({
      durability: 'ephemeral',
      occurredAt: '2026-07-18T10:00:01.000Z',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      eventId: 'e2',
      payload: { type: 'turn_progress', stage: 'b' }
    })
    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(bus.currentSequence()).toBe(2)
  })

  it('supports subscribe/unsubscribe and does not deliver after unsubscribe', () => {
    const bus = createTeachingTurnEventBus({ turnId: 'turn-1' })
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(listener)
    bus.publish({
      durability: 'ephemeral',
      occurredAt: '2026-07-18T10:00:00.000Z',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      eventId: 'e1',
      payload: { type: 'turn_progress', stage: 'a' }
    })
    unsubscribe()
    bus.publish({
      durability: 'ephemeral',
      occurredAt: '2026-07-18T10:00:01.000Z',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      eventId: 'e2',
      payload: { type: 'turn_progress', stage: 'b' }
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].eventId).toBe('e1')
  })

  it('keeps sticky terminal exactly once and ignores subsequent terminals', () => {
    const bus = createTeachingTurnEventBus({ turnId: 'turn-1' })
    const first = bus.publishTerminal({
      occurredAt: '2026-07-18T10:00:00.000Z',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      eventId: 'term-1',
      outcome: 'completed'
    })
    const second = bus.publishTerminal({
      occurredAt: '2026-07-18T10:00:01.000Z',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      eventId: 'term-2',
      outcome: 'failed'
    })
    expect(first.payload).toMatchObject({ type: 'turn_terminal', outcome: 'completed' })
    expect(second.eventId).toBe('term-1')
    expect(second.payload).toMatchObject({ outcome: 'completed' })
    expect(bus.terminal()?.eventId).toBe('term-1')
    expect(bus.currentSequence()).toBe(1)
  })

  it('signals replay gaps after bounded truncation', () => {
    const bus = createTeachingTurnEventBus({
      turnId: 'turn-1',
      maxReplayBytes: 1800
    })
    publishMany(bus, 12)
    const replay = bus.replayAfter(0)
    expect(replay.droppedEvents).toBeGreaterThan(0)
    expect(replay.hasGap).toBe(true)
    expect(replay.fromSequence).toBeGreaterThan(1)
    expect(replay.events.every((event) => (event.sequence ?? 0) >= replay.fromSequence)).toBe(true)
  })

  it('replayAfter returns only events after the requested sequence and exposes nextSequence', () => {
    const bus = createTeachingTurnEventBus({ turnId: 'turn-1' })
    publishMany(bus, 3, 'keep')
    const replay = bus.replayAfter(1)
    expect(replay.requestedAfterSequence).toBe(1)
    expect(replay.events.map((event) => event.sequence)).toEqual([2, 3])
    expect(replay.nextSequence).toBe(4)
    expect(replay.hasGap).toBe(false)
  })

  it('rejects cross-turn publishes and does not claim durable authority', () => {
    const bus = createTeachingTurnEventBus({ turnId: 'turn-1' })
    expect(() =>
      bus.publish({
        durability: 'durable',
        occurredAt: '2026-07-18T10:00:00.000Z',
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        turnId: 'other-turn',
        eventId: 'e1',
        payload: { type: 'turn_progress', stage: 'a' }
      })
    ).toThrow(/cross-turn/)

    const event = bus.publish({
      durability: 'durable',
      occurredAt: '2026-07-18T10:00:00.000Z',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      eventId: 'e2',
      payload: {
        type: 'evidence_recorded',
        sessionId: 'session-1',
        evidenceEventId: 'evidence-1',
        sequence: 7,
        duplicate: false,
        kind: 'quiz_answered'
      }
    })
    // Bus sequence is stream-local; durable evidence sequence remains on payload only.
    expect(event.sequence).toBe(1)
    expect(event.payload).toMatchObject({ type: 'evidence_recorded', sequence: 7 })
  })
})
