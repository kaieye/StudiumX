import { describe, expect, it } from 'vitest'

import {
  mapAgentSessionPromptResultToIpc,
  noActiveAgentSessionIpcResult
} from '../../src/main/ai/agent-chat-steer-followup-ipc'
import type { AgentSessionPromptResult } from '../../src/main/ai/agent-session-facade'
import {
  parseFollowUpAgentChatPayload,
  parseSteerAgentChatPayload
} from '../../src/main/teaching-ipc-commands'

describe('parseSteerAgentChatPayload / parseFollowUpAgentChatPayload', () => {
  it('accepts exact steer payload with optional fields', () => {
    expect(
      parseSteerAgentChatPayload({
        streamId: 'stream-1',
        text: '  course-correct  ',
        conversationId: 'conv-abc',
        expectedRevision: 2
      })
    ).toEqual({
      streamId: 'stream-1',
      text: '  course-correct  ',
      conversationId: 'conv-abc',
      expectedRevision: 2
    })
  })

  it('accepts follow-up with only required fields', () => {
    expect(parseFollowUpAgentChatPayload({ streamId: 's-1', text: 'next' })).toEqual({
      streamId: 's-1',
      text: 'next'
    })
  })

  it('rejects extra keys fail-closed', () => {
    expect(() =>
      parseSteerAgentChatPayload({
        streamId: 'stream-1',
        text: 'x',
        preferredAction: 'interrupt'
      })
    ).toThrow(/only "streamId"/)
  })

  it('rejects invalid streamId and missing text', () => {
    expect(() => parseSteerAgentChatPayload({ streamId: '../bad', text: 'x' })).toThrow(/streamId/)
    expect(() => parseFollowUpAgentChatPayload({ streamId: 'stream-1' })).toThrow(/text/)
  })

  it('rejects oversized text', () => {
    expect(() =>
      parseSteerAgentChatPayload({
        streamId: 'stream-1',
        text: 'a'.repeat(32 * 1024 + 1)
      })
    ).toThrow(/at most/)
  })

  it('rejects non-canonical conversationId and negative revision', () => {
    expect(() =>
      parseSteerAgentChatPayload({
        streamId: 'stream-1',
        text: 'x',
        conversationId: 'BAD_ID'
      })
    ).toThrow(/conversationId/)
    expect(() =>
      parseFollowUpAgentChatPayload({
        streamId: 'stream-1',
        text: 'x',
        expectedRevision: -1
      })
    ).toThrow(/expectedRevision/)
  })
})

describe('mapAgentSessionPromptResultToIpc', () => {
  const snapshot = {
    busy: true,
    phase: 'provider' as const,
    queueDepth: 1,
    queueCapacity: 16,
    streamId: 'stream-1'
  }

  it('maps accepted/queued/steered ok results with snapshot', () => {
    const accepted: AgentSessionPromptResult = {
      ok: true,
      disposition: 'queued',
      reason: 'busy_queue',
      depth: 1
    }
    expect(mapAgentSessionPromptResultToIpc(accepted, snapshot)).toEqual({
      ok: true,
      disposition: 'queued',
      reason: 'busy_queue',
      depth: 1,
      snapshot
    })
  })

  it('maps rejected results including enqueueReason', () => {
    const rejected: AgentSessionPromptResult = {
      ok: false,
      disposition: 'rejected',
      reason: 'queue_full',
      depth: 16,
      enqueueReason: 'capacity'
    }
    expect(mapAgentSessionPromptResultToIpc(rejected, snapshot)).toEqual({
      ok: false,
      disposition: 'rejected',
      reason: 'queue_full',
      depth: 16,
      enqueueReason: 'capacity',
      snapshot
    })
  })

  it('returns no_active_session when façade registry miss', () => {
    expect(noActiveAgentSessionIpcResult()).toEqual({
      ok: false,
      disposition: 'no_active_session',
      reason: 'no_active_session'
    })
  })
})
