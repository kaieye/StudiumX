import { describe, expect, it } from 'vitest'
import {
  AGENT_CONVERSATION_TURN_LANE_QUEUE_HARD_CAP,
  AgentConversationTurnLane,
  normalizeConversationLaneKey,
  type ConversationLaneKey,
  type SubmitConversationTurnIntent
} from '../../src/main/ai/agent-conversation-turn-lane'

const canonical = (conversationId = 'conversation-1', scope: 'workspace' | 'temporary' = 'workspace'): ConversationLaneKey => ({
  kind: 'canonical',
  workspaceId: ' workspace-a ',
  scope,
  conversationId
})

const pending = (pendingConversationId = 'pending-1'): ConversationLaneKey => ({
  kind: 'pending',
  workspaceId: ' workspace-a ',
  scope: 'workspace',
  pendingConversationId
})

function intent(
  clientRequestId: string,
  text: string,
  target: ConversationLaneKey = canonical(),
  overrides: Partial<SubmitConversationTurnIntent> = {}
): SubmitConversationTurnIntent {
  return {
    target,
    clientRequestId,
    text,
    mode: target.scope === 'workspace' ? 'teaching' : 'temporary',
    delivery: 'follow_up',
    ...overrides
  }
}

function started(result: ReturnType<AgentConversationTurnLane['submit']>) {
  expect(result.code).toBe('started')
  return result as Extract<typeof result, { code: 'started' }>
}

function lane(): AgentConversationTurnLane {
  let turn = 0
  let stream = 0
  return new AgentConversationTurnLane({
    activeTurnIdFactory: () => `turn-${++turn}`,
    streamIdFactory: () => `stream-${++stream}`
  })
}

describe('AgentConversationTurnLane (ADR-0170)', () => {
  it('normalizes discriminated canonical/pending identities and keeps workspace, scope, and identity independent', () => {
    expect(normalizeConversationLaneKey(canonical())).toEqual({
      kind: 'canonical', workspaceId: 'workspace-a', scope: 'workspace', conversationId: 'conversation-1'
    })
    expect(normalizeConversationLaneKey(pending())).toEqual({
      kind: 'pending', workspaceId: 'workspace-a', scope: 'workspace', pendingConversationId: 'pending-1'
    })
    expect(normalizeConversationLaneKey({ ...canonical(), pendingConversationId: 'wrong' })).toBeNull()
    expect(normalizeConversationLaneKey({ ...pending(), conversationId: 'wrong' })).toBeNull()

    const subject = lane()
    expect(subject.submit(intent('workspace', 'one', canonical())).code).toBe('started')
    expect(subject.submit(intent('temporary', 'two', canonical('conversation-1', 'temporary'))).code).toBe('started')
    expect(subject.submit(intent('other-conversation', 'three', canonical('conversation-2'))).code).toBe('started')
    expect(subject.submit(intent('pending', 'four', pending())).code).toBe('started')
  })

  it('starts an idle follow-up with host-minted exact active and stream identities', () => {
    const subject = lane()
    expect(subject.submit(intent('request-1', 'first'))).toEqual({
      code: 'started', activeTurnId: 'turn-1', streamId: 'stream-1', conversationId: 'conversation-1'
    })
  })

  it('queues active follow-ups FIFO and promotes the next entry after release', () => {
    const subject = lane()
    const first = started(subject.submit(intent('request-1', 'first')))
    expect(subject.submit(intent('request-2', 'second'))).toEqual({
      code: 'queued', queuePosition: 1, activeTurnId: first.activeTurnId
    })
    expect(subject.submit(intent('request-3', 'third'))).toEqual({
      code: 'queued', queuePosition: 2, activeTurnId: first.activeTurnId
    })

    const released = subject.complete({ target: canonical(), activeTurnId: first.activeTurnId, streamId: first.streamId })
    expect(released).toMatchObject({
      code: 'released',
      next: {
        activeTurnId: 'turn-2', streamId: 'stream-2',
        intent: { clientRequestId: 'request-2', text: 'second' }
      }
    })
    const next = (released as Extract<typeof released, { code: 'released' }>).next!
    expect(subject.complete({ target: canonical(), activeTurnId: next.activeTurnId, streamId: next.streamId }))
      .toMatchObject({ code: 'released', next: { intent: { clientRequestId: 'request-3', text: 'third' } } })
  })

  it('enforces the 32 queued follow-up hard cap without silently dropping an entry', () => {
    const subject = lane()
    started(subject.submit(intent('initial', 'initial')))
    expect(AGENT_CONVERSATION_TURN_LANE_QUEUE_HARD_CAP).toBe(32)
    for (let index = 0; index < 32; index += 1) {
      expect(subject.submit(intent(`queued-${index}`, `queued ${index}`))).toMatchObject({
        code: 'queued', queuePosition: index + 1
      })
    }
    expect(subject.submit(intent('overflow', 'not accepted'))).toEqual({ code: 'rejected', reason: 'queue_full' })
    expect(subject.snapshot().lanes[0]).toMatchObject({ queueDepth: 32, queueCapacity: 32 })
  })

  it('steers only the exact active identity and never queues an invalid steer', () => {
    const subject = lane()
    const first = started(subject.submit(intent('request-1', 'first')))

    expect(subject.submit(intent('steer-ok', 'adjust', canonical(), {
      delivery: 'steer', expectedActiveTurnId: first.activeTurnId
    }))).toEqual({ code: 'steered', activeTurnId: first.activeTurnId, streamId: first.streamId })

    expect(subject.submit(intent('steer-old', 'wrong turn', canonical(), {
      delivery: 'steer', expectedActiveTurnId: 'turn-old'
    }))).toEqual({ code: 'refresh_required', reason: 'active_turn_mismatch' })
    expect(subject.submit(intent('steer-idle', 'wrong lane', canonical('conversation-2'), {
      delivery: 'steer', expectedActiveTurnId: first.activeTurnId
    }))).toEqual({ code: 'refresh_required', reason: 'active_turn_mismatch' })
    expect(subject.snapshot().lanes.find((entry) => entry.key.kind === 'canonical' && entry.key.conversationId === 'conversation-1'))
      .toMatchObject({ queueDepth: 0 })
  })

  it('cancels only an exact active identity, clears its queue, and remembers cancel receipts', () => {
    const subject = lane()
    const first = started(subject.submit(intent('request-1', 'first')))
    subject.submit(intent('request-2', 'second'))
    subject.submit(intent('request-3', 'third'))

    expect(subject.cancel({ target: canonical(), clientRequestId: 'cancel-old', expectedActiveTurnId: 'turn-old' }))
      .toEqual({ code: 'refresh_required', reason: 'active_turn_mismatch' })
    expect(subject.cancel({ target: canonical(), clientRequestId: 'cancel-1', expectedActiveTurnId: first.activeTurnId }))
      .toEqual({ code: 'cancelled', cancelledActiveTurnId: first.activeTurnId, clearedQueuedCount: 2 })
    expect(subject.cancel({ target: canonical(), clientRequestId: 'cancel-1', expectedActiveTurnId: first.activeTurnId }))
      .toEqual({ code: 'duplicate', originalCode: 'cancelled' })
    expect(subject.snapshot().lanes[0]).toMatchObject({ phase: 'canceling', queueDepth: 0 })
  })

  it('releases the lane after failure and accepts subsequent work', () => {
    const subject = lane()
    const first = started(subject.submit(intent('request-1', 'first')))
    subject.submit(intent('request-2', 'next'))
    const released = subject.fail({ target: canonical(), activeTurnId: first.activeTurnId, streamId: first.streamId })
    expect(released).toMatchObject({ code: 'released', next: { intent: { clientRequestId: 'request-2' } } })
    const next = (released as Extract<typeof released, { code: 'released' }>).next!
    expect(subject.fail({ target: canonical(), activeTurnId: next.activeTurnId, streamId: next.streamId })).toEqual({ code: 'released' })
    expect(subject.submit(intent('request-3', 'after failure')).code).toBe('started')
  })

  it('rekeys a pending lane atomically, preserves FIFO, and rejects old pending submissions', () => {
    const subject = lane()
    const pendingTarget = pending()
    const canonicalTarget = canonical('conversation-promoted')
    const first = started(subject.submit(intent('request-1', 'first', pendingTarget)))
    subject.submit(intent('request-2', 'second', pendingTarget))
    subject.submit(intent('request-3', 'third', pendingTarget))

    expect(subject.promotePending({ pendingTarget, canonicalTarget })).toEqual({
      code: 'rekeyed', target: { kind: 'canonical', workspaceId: 'workspace-a', scope: 'workspace', conversationId: 'conversation-promoted' }
    })
    expect(subject.submit(intent('old-pending', 'must refresh', pendingTarget)))
      .toEqual({ code: 'refresh_required', reason: 'pending_promoted' })
    expect(subject.submit(intent('old-pending', 'must refresh', pendingTarget)))
      .toEqual({ code: 'duplicate', originalCode: 'refresh_required' })

    const released = subject.complete({ target: canonicalTarget, activeTurnId: first.activeTurnId, streamId: first.streamId })
    expect(released).toMatchObject({
      code: 'released',
      next: {
        target: { kind: 'canonical', conversationId: 'conversation-promoted' },
        intent: { clientRequestId: 'request-2', target: { kind: 'canonical', conversationId: 'conversation-promoted' } }
      }
    })
    const next = (released as Extract<typeof released, { code: 'released' }>).next!
    expect(subject.complete({ target: canonicalTarget, activeTurnId: next.activeTurnId, streamId: next.streamId }))
      .toMatchObject({ code: 'released', next: { intent: { clientRequestId: 'request-3' } } })
  })

  it('returns stable submit receipts without repeating starts, queues, steers, refreshes, or rejections', () => {
    const subject = lane()
    const first = started(subject.submit(intent('started', 'first')))
    expect(subject.submit(intent('started', 'changed'))).toEqual({ code: 'duplicate', originalCode: 'started' })
    subject.submit(intent('queued', 'second'))
    expect(subject.submit(intent('queued', 'changed'))).toEqual({ code: 'duplicate', originalCode: 'queued' })
    expect(subject.submit(intent('steered', 'steer', canonical(), { delivery: 'steer', expectedActiveTurnId: first.activeTurnId })))
      .toMatchObject({ code: 'steered' })
    expect(subject.submit(intent('steered', 'changed', canonical(), { delivery: 'steer', expectedActiveTurnId: first.activeTurnId })))
      .toEqual({ code: 'duplicate', originalCode: 'steered' })
    expect(subject.submit(intent('refresh', 'bad steer', canonical(), { delivery: 'steer', expectedActiveTurnId: 'old' })))
      .toEqual({ code: 'refresh_required', reason: 'active_turn_mismatch' })
    expect(subject.submit(intent('refresh', 'changed', canonical(), { delivery: 'steer', expectedActiveTurnId: 'old' })))
      .toEqual({ code: 'duplicate', originalCode: 'refresh_required' })

    const full = lane()
    started(full.submit(intent('first', 'first')))
    for (let index = 0; index < 32; index += 1) full.submit(intent(`full-${index}`, 'queued'))
    expect(full.submit(intent('rejected', 'overflow'))).toEqual({ code: 'rejected', reason: 'queue_full' })
    expect(full.submit(intent('rejected', 'changed'))).toEqual({ code: 'duplicate', originalCode: 'rejected' })
  })

  it('keeps snapshots free of text and receipts', () => {
    const subject = lane()
    started(subject.submit(intent('secret-request', 'secret user body', canonical(), { skillIds: ['secret-skill'] })))
    subject.submit(intent('another-request', 'another secret body'))
    const snapshot = subject.snapshot()
    const encoded = JSON.stringify(snapshot)
    expect(encoded).not.toContain('secret user body')
    expect(encoded).not.toContain('another secret body')
    expect(encoded).not.toContain('secret-request')
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.lanes)).toBe(true)
    expect(Object.isFrozen(snapshot.lanes[0]!)).toBe(true)
  })
})
