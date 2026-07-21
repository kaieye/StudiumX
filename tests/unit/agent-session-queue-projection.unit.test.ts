import { describe, expect, it } from 'vitest'
import {
  AgentInputQueue,
  type AgentQueuedInput
} from '../../src/main/ai/agent-input-queue'
import { AgentSessionFacade } from '../../src/main/ai/agent-session-facade'
import {
  DEFAULT_QUEUE_TEXT_PREVIEW_MAX,
  projectAgentSessionQueue,
  truncateQueueTextPreview,
  type AgentSessionQueueProjectionSource
} from '../../src/main/ai/agent-session-queue-projection'

function source(partial: Partial<AgentSessionQueueProjectionSource> = {}): AgentSessionQueueProjectionSource {
  return {
    busy: false,
    phase: 'idle',
    queueDepth: 0,
    queueCapacity: 16,
    ...partial
  }
}

function entry(partial: Partial<AgentQueuedInput> & Pick<AgentQueuedInput, 'id' | 'text'>): AgentQueuedInput {
  return {
    kind: 'follow_up',
    enqueuedAt: '2026-07-21T12:00:00.000Z',
    ...partial
  }
}

describe('projectAgentSessionQueue', () => {
  it('maps idle empty queue with autoDrain default false and no text fields', () => {
    const projection = projectAgentSessionQueue(source(), [])
    expect(projection).toEqual({
      busy: false,
      phase: 'idle',
      autoDrain: false,
      queueDepth: 0,
      queueCapacity: 16,
      entries: []
    })
    expect(projection).not.toHaveProperty('streamId')
    expect(projection).not.toHaveProperty('conversationId')
    expect(projection).not.toHaveProperty('closed')
  })

  it('projects identity, depth, phase, and entry metadata without free text by default', () => {
    const entries: AgentQueuedInput[] = [
      entry({
        id: 'q-1',
        kind: 'follow_up',
        text: 'secret follow-up body',
        conversationId: 'conv-1',
        expectedRevision: 4
      }),
      entry({
        id: 'q-2',
        kind: 'steer',
        text: 'secret steer body',
        enqueuedAt: '2026-07-21T12:01:00.000Z'
      })
    ]
    const projection = projectAgentSessionQueue(
      source({
        busy: true,
        phase: 'provider',
        queueDepth: 2,
        queueCapacity: 8,
        streamId: 'stream-1',
        conversationId: 'conv-1'
      }),
      entries,
      { autoDrain: false, closed: false }
    )

    expect(projection.streamId).toBe('stream-1')
    expect(projection.conversationId).toBe('conv-1')
    expect(projection.busy).toBe(true)
    expect(projection.phase).toBe('provider')
    expect(projection.autoDrain).toBe(false)
    expect(projection.queueDepth).toBe(2)
    expect(projection.queueCapacity).toBe(8)
    expect(projection.closed).toBe(false)
    expect(projection.entries).toHaveLength(2)
    expect(projection.entries[0]).toEqual({
      id: 'q-1',
      kind: 'follow_up',
      enqueuedAt: '2026-07-21T12:00:00.000Z',
      conversationId: 'conv-1',
      expectedRevision: 4
    })
    expect(projection.entries[1]).toEqual({
      id: 'q-2',
      kind: 'steer',
      enqueuedAt: '2026-07-21T12:01:00.000Z'
    })
    // Privacy: full free-text never present by default.
    expect(JSON.stringify(projection)).not.toContain('secret')
    expect(projection.entries[0]).not.toHaveProperty('text')
    expect(projection.entries[0]).not.toHaveProperty('textPreview')
  })

  it('reports autoDrain true only when options explicitly pass true', () => {
    expect(projectAgentSessionQueue(source(), [], { autoDrain: true }).autoDrain).toBe(true)
    expect(projectAgentSessionQueue(source(), [], { autoDrain: false }).autoDrain).toBe(false)
    expect(projectAgentSessionQueue(source(), []).autoDrain).toBe(false)
  })

  it('optionally includes hard-capped textPreview without mutating source entries', () => {
    const long = 'x'.repeat(DEFAULT_QUEUE_TEXT_PREVIEW_MAX + 50)
    const original: AgentQueuedInput = entry({
      id: 'q-long',
      kind: 'steer',
      text: long,
      expectedRevision: 1
    })
    const frozenText = original.text
    const projection = projectAgentSessionQueue(source({ queueDepth: 1 }), [original], {
      includeTextPreview: true
    })
    expect(projection.entries[0]?.textPreview).toBe(long.slice(0, DEFAULT_QUEUE_TEXT_PREVIEW_MAX))
    expect(projection.entries[0]?.textPreview?.length).toBe(DEFAULT_QUEUE_TEXT_PREVIEW_MAX)
    expect(original.text).toBe(frozenText)
    // Full text key must not appear.
    expect(projection.entries[0]).not.toHaveProperty('text')
  })

  it('respects custom textPreviewMax when includeTextPreview is true', () => {
    const projection = projectAgentSessionQueue(
      source({ queueDepth: 1 }),
      [entry({ id: 'q-1', text: 'abcdefghij' })],
      { includeTextPreview: true, textPreviewMax: 4 }
    )
    expect(projection.entries[0]?.textPreview).toBe('abcd')
  })

  it('does not mutate the queueEntries array (pure)', () => {
    const queue = new AgentInputQueue({
      hardCap: 4,
      idFactory: () => 'fixed-id',
      now: () => '2026-07-21T00:00:00.000Z'
    })
    queue.enqueue({ text: 'one', kind: 'follow_up' })
    const snap = queue.snapshot()
    const before = JSON.stringify(snap)
    projectAgentSessionQueue(
      source({ queueDepth: queue.size(), queueCapacity: queue.capacity }),
      snap,
      { includeTextPreview: true, textPreviewMax: 2 }
    )
    expect(JSON.stringify(queue.snapshot())).toBe(before)
    expect(queue.size()).toBe(1)
    expect(queue.snapshot()[0]?.text).toBe('one')
  })

  it('maps only follow_up | steer kinds and preserves FIFO order', () => {
    const entries = [
      entry({ id: 'a', kind: 'follow_up', text: 'a' }),
      entry({ id: 'b', kind: 'steer', text: 'b' }),
      entry({ id: 'c', kind: 'follow_up', text: 'c' })
    ]
    const projection = projectAgentSessionQueue(source({ queueDepth: 3 }), entries)
    expect(projection.entries.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(projection.entries.map((e) => e.kind)).toEqual(['follow_up', 'steer', 'follow_up'])
  })
})

describe('truncateQueueTextPreview', () => {
  it('returns short text unchanged and caps long text', () => {
    expect(truncateQueueTextPreview('hi', 10)).toBe('hi')
    expect(truncateQueueTextPreview('abcdefghij', 4)).toBe('abcd')
    expect(truncateQueueTextPreview('x'.repeat(300)).length).toBe(DEFAULT_QUEUE_TEXT_PREVIEW_MAX)
  })
})

describe('AgentSessionFacade.projectQueue', () => {
  it('mirrors actual autoDrain=false and omits text by default', async () => {
    const facade = new AgentSessionFacade({
      autoDrain: false,
      streamId: 's-1',
      conversationId: 'c-1'
    })
    facade.setPhase('provider')
    await facade.followUp({ text: 'queued body', expectedRevision: 2 })
    expect(facade.snapshot().queueDepth).toBe(1)

    const projection = facade.projectQueue()
    expect(projection).toMatchObject({
      streamId: 's-1',
      conversationId: 'c-1',
      busy: true,
      phase: 'provider',
      autoDrain: false,
      queueDepth: 1,
      closed: false
    })
    expect(projection.entries).toHaveLength(1)
    expect(projection.entries[0]).toMatchObject({
      kind: 'follow_up',
      expectedRevision: 2
    })
    expect(JSON.stringify(projection)).not.toContain('queued body')
    expect(projection.entries[0]).not.toHaveProperty('textPreview')
  })

  it('does not flip façade autoDrain when projecting', async () => {
    const facade = new AgentSessionFacade({ autoDrain: false })
    facade.setPhase('tool_batch')
    await facade.steer({ text: 'nudge' })
    const before = facade.snapshot()
    const withPreview = facade.projectQueue({ includeTextPreview: true, textPreviewMax: 10 })
    expect(withPreview.autoDrain).toBe(false)
    expect(withPreview.entries[0]?.textPreview).toBe('nudge')
    expect(facade.snapshot()).toEqual(before)
    expect(facade.getQueue().snapshot()[0]?.text).toBe('nudge')
  })
})
