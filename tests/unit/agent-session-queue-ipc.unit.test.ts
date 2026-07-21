import { describe, expect, it } from 'vitest'

import { runProjectAgentSessionQueueIpc } from '../../src/main/ai/agent-session-queue-ipc'
import { AgentSessionFacade } from '../../src/main/ai/agent-session-facade'
import { parseProjectAgentSessionQueuePayload } from '../../src/main/teaching-ipc-commands'

describe('parseProjectAgentSessionQueuePayload', () => {
  it('accepts streamId-only payload', () => {
    expect(parseProjectAgentSessionQueuePayload({ streamId: 'stream-1' })).toEqual({
      streamId: 'stream-1'
    })
  })

  it('accepts optional includeTextPreview and textPreviewMax', () => {
    expect(
      parseProjectAgentSessionQueuePayload({
        streamId: 's-1',
        includeTextPreview: true,
        textPreviewMax: 40
      })
    ).toEqual({
      streamId: 's-1',
      includeTextPreview: true,
      textPreviewMax: 40
    })
  })

  it('rejects unknown payload keys fail-closed', () => {
    expect(() =>
      parseProjectAgentSessionQueuePayload({
        streamId: 'stream-1',
        autoDrain: true
      })
    ).toThrow(/only "streamId"/)
  })

  it('rejects empty / whitespace streamId', () => {
    expect(() => parseProjectAgentSessionQueuePayload({ streamId: '' })).toThrow(/streamId/)
    expect(() => parseProjectAgentSessionQueuePayload({ streamId: '   ' })).toThrow(/streamId/)
    expect(() => parseProjectAgentSessionQueuePayload({})).toThrow(/requires "streamId"/)
  })

  it('rejects non-boolean includeTextPreview and non-safe-integer textPreviewMax', () => {
    expect(() =>
      parseProjectAgentSessionQueuePayload({
        streamId: 'stream-1',
        includeTextPreview: 'yes'
      })
    ).toThrow(/includeTextPreview/)
    expect(() =>
      parseProjectAgentSessionQueuePayload({
        streamId: 'stream-1',
        textPreviewMax: 1.5
      })
    ).toThrow(/textPreviewMax/)
    expect(() =>
      parseProjectAgentSessionQueuePayload({
        streamId: 'stream-1',
        textPreviewMax: -1
      })
    ).toThrow(/textPreviewMax/)
  })
})

describe('runProjectAgentSessionQueueIpc', () => {
  it('returns no_active_session when façade is missing', () => {
    expect(runProjectAgentSessionQueueIpc({ streamId: 'missing' }, null)).toEqual({
      ok: false,
      reason: 'no_active_session'
    })
    expect(runProjectAgentSessionQueueIpc({ streamId: 'missing' }, undefined)).toEqual({
      ok: false,
      reason: 'no_active_session'
    })
  })

  it('projects empty active façade queue with autoDrain false and depth 0', () => {
    const facade = new AgentSessionFacade({
      autoDrain: false,
      streamId: 'stream-empty'
    })
    const result = runProjectAgentSessionQueueIpc({ streamId: 'stream-empty' }, facade)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.projection).toMatchObject({
      streamId: 'stream-empty',
      busy: false,
      phase: 'idle',
      autoDrain: false,
      queueDepth: 0,
      closed: false
    })
    expect(result.projection.entries).toEqual([])
  })

  it('omits textPreview by default (privacy)', async () => {
    const facade = new AgentSessionFacade({
      autoDrain: false,
      streamId: 'stream-1',
      conversationId: 'conv-1'
    })
    facade.setPhase('provider')
    await facade.followUp({ text: 'secret queued body', expectedRevision: 3 })

    const result = runProjectAgentSessionQueueIpc({ streamId: 'stream-1' }, facade)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.projection.autoDrain).toBe(false)
    expect(result.projection.queueDepth).toBe(1)
    expect(result.projection.entries).toHaveLength(1)
    expect(result.projection.entries[0]).toMatchObject({
      kind: 'follow_up',
      expectedRevision: 3
    })
    expect(result.projection.entries[0]).not.toHaveProperty('textPreview')
    expect(JSON.stringify(result.projection)).not.toContain('secret')
  })

  it('includes hard-capped textPreview when includeTextPreview is true', async () => {
    const facade = new AgentSessionFacade({ autoDrain: false, streamId: 's-preview' })
    facade.setPhase('tool_batch')
    await facade.steer({ text: 'abcdefghij' })

    const result = runProjectAgentSessionQueueIpc(
      { streamId: 's-preview', includeTextPreview: true, textPreviewMax: 4 },
      facade
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.projection.autoDrain).toBe(false)
    expect(result.projection.entries[0]?.textPreview).toBe('abcd')
    // Must not mutate / drain the façade queue.
    expect(facade.snapshot().queueDepth).toBe(1)
    expect(facade.getQueue().snapshot()[0]?.text).toBe('abcdefghij')
  })

  it('does not drain, prompt, or flip autoDrain', async () => {
    const facade = new AgentSessionFacade({ autoDrain: false, streamId: 's-ro' })
    facade.setPhase('provider')
    await facade.followUp({ text: 'stay queued' })
    const before = facade.snapshot()
    const depthBefore = facade.getQueue().size()

    const result = runProjectAgentSessionQueueIpc(
      { streamId: 's-ro', includeTextPreview: true },
      facade
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.projection.autoDrain).toBe(false)
    expect(facade.snapshot()).toEqual(before)
    expect(facade.getQueue().size()).toBe(depthBefore)
  })
})
