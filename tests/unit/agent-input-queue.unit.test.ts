import { describe, expect, it } from 'vitest'
import {
  AgentInputQueue,
  AgentInputQueueRegistry,
  DEFAULT_AGENT_INPUT_QUEUE_HARD_CAP
} from '../../src/main/ai/agent-input-queue'

describe('AgentInputQueue', () => {
  it('enqueues follow-up and steer in FIFO order with a hard cap', () => {
    let seq = 0
    const queue = new AgentInputQueue({
      hardCap: 3,
      idFactory: () => `id-${++seq}`,
      now: () => '2026-07-21T12:00:00.000Z'
    })

    expect(queue.capacity).toBe(3)
    expect(DEFAULT_AGENT_INPUT_QUEUE_HARD_CAP).toBeGreaterThanOrEqual(1)

    const a = queue.enqueue({ text: ' first ', kind: 'follow_up' })
    const b = queue.enqueue({ text: 'steer me', kind: 'steer', expectedRevision: 2 })
    const c = queue.enqueue({ text: 'third', conversationId: 'conv-1' })
    const full = queue.enqueue({ text: 'overflow' })

    expect(a).toMatchObject({ ok: true, depth: 1 })
    expect(b).toMatchObject({ ok: true, depth: 2 })
    expect(c).toMatchObject({ ok: true, depth: 3 })
    expect(full).toEqual({ ok: false, reason: 'full', depth: 3 })
    expect(queue.isFull()).toBe(true)
    expect(queue.snapshot().map((item) => item.text)).toEqual(['first', 'steer me', 'third'])
    expect(queue.snapshot()[1]).toMatchObject({ kind: 'steer', expectedRevision: 2 })
    expect(queue.dequeue()?.id).toBe('id-1')
    expect(queue.size()).toBe(2)
  })

  it('rejects empty text and preserves race-safe size under concurrent enqueue/dequeue', () => {
    const queue = new AgentInputQueue({ hardCap: 2, idFactory: () => crypto.randomUUID() })
    expect(queue.enqueue({ text: '   ' })).toEqual({ ok: false, reason: 'empty_text', depth: 0 })

    // Simulate interleaving within a single tick: enqueue → dequeue → enqueue → full reject.
    const first = queue.enqueue({ text: 'a' })
    const second = queue.enqueue({ text: 'b' })
    expect(first.ok && second.ok).toBe(true)
    expect(queue.dequeue()?.text).toBe('a')
    const third = queue.enqueue({ text: 'c' })
    const fourth = queue.enqueue({ text: 'd' })
    expect(third).toMatchObject({ ok: true, depth: 2 })
    expect(fourth).toEqual({ ok: false, reason: 'full', depth: 2 })
    expect(queue.drain().map((item) => item.text)).toEqual(['b', 'c'])
    expect(queue.isEmpty()).toBe(true)
  })

  it('clearOnCancel drains all items, closes enqueue, and reopen restores capacity', () => {
    const queue = new AgentInputQueue({ hardCap: 4 })
    queue.enqueue({ text: 'one' })
    queue.enqueue({ text: 'two' })
    const cleared = queue.clearOnCancel('user_cancel')
    expect(cleared.map((item) => item.text)).toEqual(['one', 'two'])
    expect(queue.isClosed()).toBe(true)
    expect(queue.size()).toBe(0)
    expect(queue.enqueue({ text: 'after-cancel' })).toEqual({ ok: false, reason: 'closed', depth: 0 })
    queue.reopen()
    expect(queue.enqueue({ text: 'again' })).toMatchObject({ ok: true, depth: 1 })
  })

  it('registry clears per-key queues on cancel without leaking closed instances', () => {
    const registry = new AgentInputQueueRegistry(() => new AgentInputQueue({ hardCap: 2 }))
    const q1 = registry.getOrCreate('stream-a')
    const q2 = registry.getOrCreate('stream-b')
    q1.enqueue({ text: 'a1' })
    q2.enqueue({ text: 'b1' })
    const cleared = registry.clearOnCancel('stream-a')
    expect(cleared.map((item) => item.text)).toEqual(['a1'])
    expect(registry.get('stream-a')).toBeUndefined()
    expect(registry.get('stream-b')?.size()).toBe(1)
    const recreated = registry.getOrCreate('stream-a')
    expect(recreated.isClosed()).toBe(false)
    expect(recreated.enqueue({ text: 'fresh' })).toMatchObject({ ok: true })
  })
})
