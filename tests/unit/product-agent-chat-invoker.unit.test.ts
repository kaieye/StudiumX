import { describe, expect, it } from 'vitest'
import {
  mapAgentChatStreamResultToRunResult,
  mapProductAgentChatInvokerPayload
} from '../../src/main/ai/product-agent-chat-invoker'
import type { AgentChatStreamPayload } from '../../src/shared/teaching-types'

const basePayload = (): AgentChatStreamPayload => ({
  streamId: 'stream-orig',
  conversationId: 'conv-orig',
  workspaceId: 'ws-1',
  expectedBranchRevision: 7,
  mode: 'teaching',
  context: 'ctx',
  skillIds: ['skill-a'],
  messages: [{ role: 'user', content: 'prior' }],
  userInput: 'original-user-input'
})

describe('product-agent-chat-invoker mapping', () => {
  it('maps invoker text to userInput and preserves surrounding payload fields', () => {
    const original = basePayload()
    const mapped = mapProductAgentChatInvokerPayload(original, {
      text: 'from-facade-prompt',
      conversationId: 'conv-new',
      expectedRevision: 9,
      streamId: 'stream-live'
    })

    expect(mapped.userInput).toBe('from-facade-prompt')
    expect(mapped.streamId).toBe('stream-live')
    expect(mapped.conversationId).toBe('conv-new')
    expect(mapped.expectedBranchRevision).toBe(9)
    // Preserved product fields — invoker must not drop transcript/skills/workspace.
    expect(mapped.workspaceId).toBe('ws-1')
    expect(mapped.mode).toBe('teaching')
    expect(mapped.context).toBe('ctx')
    expect(mapped.skillIds).toEqual(['skill-a'])
    expect(mapped.messages).toEqual([{ role: 'user', content: 'prior' }])
    // Original object is not mutated.
    expect(original.userInput).toBe('original-user-input')
    expect(original.expectedBranchRevision).toBe(7)
  })

  it('keeps original CAS/identity when invoker omits optional fields', () => {
    const original = basePayload()
    const mapped = mapProductAgentChatInvokerPayload(original, {
      text: 'only-text'
    })
    expect(mapped.userInput).toBe('only-text')
    expect(mapped.streamId).toBe('stream-orig')
    expect(mapped.conversationId).toBe('conv-orig')
    expect(mapped.expectedBranchRevision).toBe(7)
  })

  it('maps product stream result variants to façade run result', () => {
    expect(
      mapAgentChatStreamResultToRunResult('s1', { canceled: true })
    ).toEqual({ streamId: 's1', canceled: true })

    expect(
      mapAgentChatStreamResultToRunResult('s2', {
        error: true,
        message: 'boom'
      })
    ).toEqual({ streamId: 's2', error: 'boom' })

    expect(
      mapAgentChatStreamResultToRunResult('s3', {
        turns: [],
        finalText: 'answer',
        iterations: 1,
        toolsSupported: false,
        usage: {
          providerCalls: 1,
          toolCalls: 0,
          toolErrors: 0,
          iterations: 1,
          childRuns: 0,
          durationMs: 10
        }
      })
    ).toEqual({ streamId: 's3', finalText: 'answer' })
  })
})
