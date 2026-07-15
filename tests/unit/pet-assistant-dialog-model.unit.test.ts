import { describe, expect, it } from 'vitest'
import type { AgentChatTurn } from '../../src/shared/teaching-types'
import type { PendingAgentConversation } from '../../src/renderer/src/agent-conversation-state'
import { projectPetAssistantConversation } from '../../src/renderer/src/views/pet/pet-assistant-dialog-model'

const savedTurns: AgentChatTurn[] = [{ id: 'saved-turn', role: 'assistant', content: 'saved', createdAt: '2026-01-01' }]
const pendingTurns: AgentChatTurn[] = [{ id: 'pending-turn', role: 'assistant', content: 'pending', createdAt: '2026-01-02' }]

function pending(id = 'pending-1', workspaceId = 'workspace-1'): PendingAgentConversation {
  return {
    workspaceId,
    sourceConversationId: null,
    sourceConversationRevision: null,
    mode: 'temporary',
    summary: {
      id,
      workspaceId,
      title: 'Pending',
      createdAt: '2026-01-02',
      updatedAt: '2026-01-02',
      relativePath: '.studiumx/pending.md',
      absolutePath: '/tmp/pending.md',
      messageCount: 1,
      pending: true
    },
    turns: pendingTurns,
    status: 'thinking',
    toolsSupported: null
  }
}

describe('projectPetAssistantConversation', () => {
  it('uses the real pending identity and turns without mixing saved turns', () => {
    expect(projectPetAssistantConversation({
      workspaceId: 'workspace-1',
      activeConversationId: 'saved-1',
      activeConversationBelongsToWorkspace: true,
      agentTurns: savedTurns,
      pendingConversation: pending()
    })).toEqual({
      identity: 'pending-1',
      runIdentity: 'pending-1',
      source: 'pending',
      turns: pendingTurns
    })
  })

  it('changes identity for consecutive pending runs', () => {
    const first = projectPetAssistantConversation({
      workspaceId: 'workspace-1', activeConversationId: null,
      activeConversationBelongsToWorkspace: false, agentTurns: savedTurns,
      pendingConversation: pending('pending-1')
    })
    const second = projectPetAssistantConversation({
      workspaceId: 'workspace-1', activeConversationId: null,
      activeConversationBelongsToWorkspace: false, agentTurns: savedTurns,
      pendingConversation: pending('pending-2')
    })
    expect(first.identity).toBe('pending-1')
    expect(second.identity).toBe('pending-2')
  })

  it('does not expose stale turns after cancellation, failure, or a workspace switch', () => {
    expect(projectPetAssistantConversation({
      workspaceId: 'workspace-2',
      activeConversationId: 'pending-1',
      activeConversationBelongsToWorkspace: false,
      agentTurns: savedTurns,
      pendingConversation: pending('pending-1', 'workspace-1')
    })).toEqual({ identity: null, runIdentity: null, source: 'empty', turns: [] })
  })

  it('uses saved turns only for a real conversation in the active workspace', () => {
    expect(projectPetAssistantConversation({
      workspaceId: 'workspace-1', activeConversationId: 'saved-1',
      activeConversationBelongsToWorkspace: true, agentTurns: savedTurns,
      pendingConversation: null
    })).toEqual({ identity: 'saved-1', runIdentity: null, source: 'saved', turns: savedTurns })
  })
})
