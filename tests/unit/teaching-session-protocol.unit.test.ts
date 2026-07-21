import { describe, expect, it, vi } from 'vitest'

import { createTeachingSessionRuntime } from '../../src/main/ai/teaching-session-runtime'
import {
  TEACHING_SESSION_PROTOCOL_VERSION,
  type TeachingSessionProtocol
} from '../../src/shared/teaching-types/teaching-session-protocol'
import {
  EXTENSION_MANIFEST_SCHEMA_VERSION,
  isExtensionManifest
} from '../../src/shared/teaching-types/extension-manifest'

function createRuntime(overrides: Partial<Parameters<typeof createTeachingSessionRuntime>[0]> = {}): TeachingSessionProtocol {
  return createTeachingSessionRuntime({
    createConversation: async (input) => ({
      conversationId: input.conversationId?.trim() || 'conv_new',
      mode: input.mode ?? 'teaching',
      workspaceId: input.workspaceId ?? 'ws1'
    }),
    resumeConversation: async (input) => ({
      conversationId: input.conversationId?.trim() || 'conv_resume',
      mode: 'teaching',
      workspaceId: input.workspaceId ?? 'ws1'
    }),
    sendTurn: async () => ({ runId: 'run_1', streamId: 'stream_1', accepted: true }),
    cancelRun: async () => true,
    readUsage: async () => ({
      providerCalls: 2,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      toolCalls: 1
    }),
    now: () => '2026-07-21T00:00:00.000Z',
    createSessionId: () => 'tsess_test',
    ...overrides
  })
}

describe('TeachingSessionProtocol facade', () => {
  it('exposes protocol version 1 and create/send/cancel/usage', async () => {
    const runtime = createRuntime()
    expect(runtime.protocolVersion).toBe(TEACHING_SESSION_PROTOCOL_VERSION)

    const created = await runtime.create({ mode: 'teaching', workspaceId: 'ws1' })
    expect(created).toMatchObject({
      sessionId: 'tsess_test',
      conversationId: 'conv_new',
      mode: 'teaching',
      workspaceId: 'ws1',
      createdAt: '2026-07-21T00:00:00.000Z'
    })

    const sent = await runtime.send({
      sessionId: created.sessionId,
      userInput: 'hello'
    })
    expect(sent).toMatchObject({
      sessionId: created.sessionId,
      runId: 'run_1',
      streamId: 'stream_1',
      accepted: true
    })

    const canceled = await runtime.cancel({ sessionId: created.sessionId })
    expect(canceled).toEqual({ sessionId: created.sessionId, canceled: true })

    const usage = await runtime.usage({ sessionId: created.sessionId })
    expect(usage.usage).toMatchObject({
      providerCalls: 2,
      totalTokens: 15,
      toolCalls: 1
    })
  })

  it('returns explicit not-wired results for optional compact/steer', async () => {
    const runtime = createRuntime()
    const created = await runtime.create({ mode: 'temporary' })
    const compact = await runtime.compact({ sessionId: created.sessionId })
    expect(compact.compacted).toBe(false)
    expect(compact.message).toMatch(/not wired/i)

    const steer = await runtime.steer({
      sessionId: created.sessionId,
      guidance: 'focus on evidence'
    })
    expect(steer.accepted).toBe(false)
    expect(steer.message).toMatch(/not wired/i)
  })

  it('delegates fork when host provides forkConversation', async () => {
    const forkConversation = vi.fn(async () => ({
      sessionId: 'tsess_test',
      forkedConversationId: 'conv_fork',
      parentConversationId: 'conv_new'
    }))
    const runtime = createRuntime({ forkConversation })
    const created = await runtime.create({ mode: 'teaching' })
    const forked = await runtime.fork({ sessionId: created.sessionId })
    expect(forked.forkedConversationId).toBe('conv_fork')
    expect(forkConversation).toHaveBeenCalled()
  })
})

describe('ExtensionManifest', () => {
  it('accepts minimal valid manifests and rejects incomplete ones', () => {
    expect(
      isExtensionManifest({
        schemaVersion: EXTENSION_MANIFEST_SCHEMA_VERSION,
        id: 'demo',
        name: 'Demo',
        version: '0.1.0'
      })
    ).toBe(true)
    expect(isExtensionManifest({ id: 'demo' })).toBe(false)
    expect(isExtensionManifest(null)).toBe(false)
  })
})
