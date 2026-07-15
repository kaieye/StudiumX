import type { AgentChatTurn } from '../../../../shared/teaching-types'
import type { PendingAgentConversation } from '../../agent-conversation-state'

export type PetAssistantConversationProjection = {
  identity: string | null
  runIdentity: string | null
  source: 'empty' | 'pending' | 'saved'
  turns: AgentChatTurn[]
}

/**
 * Selects one coherent conversation snapshot for the modeless Pet Assistant.
 * Pending runs are projected directly from their own state instead of mixing
 * interruption state from the run with turns from a previously opened branch.
 */
export function projectPetAssistantConversation(input: {
  workspaceId: string | null
  activeConversationId: string | null
  activeConversationBelongsToWorkspace: boolean
  agentTurns: AgentChatTurn[]
  pendingConversation: PendingAgentConversation | null
}): PetAssistantConversationProjection {
  const pending = input.pendingConversation
  if (pending && (!input.workspaceId || pending.workspaceId === input.workspaceId)) {
    return {
      identity: pending.summary.id,
      runIdentity: pending.summary.id,
      source: 'pending',
      turns: pending.turns
    }
  }

  if (
    !input.workspaceId ||
    !input.activeConversationId ||
    input.activeConversationId.startsWith('pending-') ||
    !input.activeConversationBelongsToWorkspace
  ) {
    return { identity: null, runIdentity: null, source: 'empty', turns: [] }
  }

  return {
    identity: input.activeConversationId,
    runIdentity: null,
    source: 'saved',
    turns: input.agentTurns
  }
}

export type PetAssistantAnnouncementSnapshot = {
  busy: boolean
  runIdentity: string | null
  conversationIdentity: string | null
  conversationSource: PetAssistantConversationProjection['source']
  interruption: { kind: 'question' | 'permission'; identity: string } | null
  errorToken: unknown | null
}

export type PetAssistantAnnouncementEvent = {
  key: string
  kind: 'started' | 'question' | 'permission' | 'completed' | 'failed' | 'canceled'
}

/** Projects only meaningful run events; streamed token content is intentionally absent. */
export function projectPetAssistantAnnouncement(
  previous: PetAssistantAnnouncementSnapshot | null,
  current: PetAssistantAnnouncementSnapshot
): PetAssistantAnnouncementEvent | null {
  if (current.runIdentity && current.interruption) {
    const key = `${current.runIdentity}:${current.interruption.kind}:${current.interruption.identity}`
    const previousKey = previous?.runIdentity && previous.interruption
      ? `${previous.runIdentity}:${previous.interruption.kind}:${previous.interruption.identity}`
      : null
    if (key !== previousKey) return { key, kind: current.interruption.kind }
  }

  if (current.busy && current.runIdentity && (!previous?.busy || previous.runIdentity !== current.runIdentity)) {
    return { key: `${current.runIdentity}:started`, kind: 'started' }
  }

  if (previous?.busy && previous.runIdentity && !current.busy) {
    if (current.errorToken && current.errorToken !== previous.errorToken) {
      return { key: `${previous.runIdentity}:failed`, kind: 'failed' }
    }
    if (current.conversationSource === 'saved' && current.conversationIdentity) {
      return { key: `${previous.runIdentity}:completed`, kind: 'completed' }
    }
    return { key: `${previous.runIdentity}:canceled`, kind: 'canceled' }
  }

  return null
}
