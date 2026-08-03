import { describe, expect, it, vi } from 'vitest'

const intent = {
  target: {
    kind: 'canonical' as const,
    workspaceId: 'workspace-1',
    scope: 'workspace' as const,
    conversationId: 'conversation-1'
  },
  clientRequestId: 'request-1',
  text: 'continue',
  mode: 'teaching' as const,
  delivery: 'follow_up' as const
}

describe('AgentConversationTurnLane restart-safe identities', () => {
  it('does not reuse the durable stream id when process-local module state restarts', async () => {
    vi.resetModules()
    const firstModule = await import('../../src/main/ai/agent-conversation-turn-lane')
    const first = new firstModule.AgentConversationTurnLane().submit(intent)
    expect(first.code).toBe('started')

    vi.resetModules()
    const restartedModule = await import('../../src/main/ai/agent-conversation-turn-lane')
    const restarted = new restartedModule.AgentConversationTurnLane().submit({
      ...intent,
      clientRequestId: 'request-after-restart'
    })
    expect(restarted.code).toBe('started')

    if (first.code !== 'started' || restarted.code !== 'started') throw new Error('expected started dispositions')
    expect(restarted.streamId).not.toBe(first.streamId)
  })
})
