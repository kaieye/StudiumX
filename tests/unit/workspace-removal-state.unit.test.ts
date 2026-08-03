import { describe, expect, it } from 'vitest'
import { deriveWorkspaceRemovalUiPatch } from '../../src/shared/workspace-removal-state'
import type { TeachingAppState } from '../../src/shared/teaching-types'

function nextState(conversationIds: string[]): Pick<TeachingAppState, 'activeWorkspace' | 'temporaryConversations'> {
  return {
    activeWorkspace: {
      id: 'workspace-1',
      name: 'Physics',
      rootPath: '/workspace',
      missionPath: '/workspace/MISSION.md',
      resourcesPath: '/workspace/resources',
      lessonsDir: '/workspace/lessons',
      recordsDir: '/workspace/records',
      referenceDir: '/workspace/reference',
      reviewsDir: '/workspace/reviews',
      createdAt: '2026-08-03T10:00:00.000Z',
      updatedAt: '2026-08-03T10:00:00.000Z',
      agentWorkspaceTrust: 'trusted',
      missionTitle: 'Physics',
      missionExcerpt: '',
      courses: [],
      fileTree: [],
      conversations: conversationIds.map((id) => ({
        id,
        workspaceId: 'workspace-1',
        title: id,
        createdAt: '2026-08-03T10:00:00.000Z',
        updatedAt: '2026-08-03T10:00:00.000Z',
        relativePath: `.agent-sessions/conversations/${id}.json`,
        absolutePath: `/workspace/.agent-sessions/conversations/${id}.json`,
        messageCount: 2
      })),
      resources: [],
      records: [],
      lessons: [],
      referenceCount: 0,
      assetsReady: true,
      git: null
    },
    temporaryConversations: []
  }
}

describe('deriveWorkspaceRemovalUiPatch', () => {
  it('does not clear an in-flight pending conversation when another conversation is removed', () => {
    const patch = deriveWorkspaceRemovalUiPatch(
      { relativePath: '.agent-sessions/conversations/existing-1.json', kind: 'conversation' },
      {
        activeConversationId: 'pending-42',
        pendingConversationId: 'pending-42'
      },
      nextState([])
    )

    expect(patch.clearActiveConversation).toBe(false)
  })

  it('clears a persisted active conversation when that conversation is removed', () => {
    const patch = deriveWorkspaceRemovalUiPatch(
      { relativePath: '.agent-sessions/conversations/existing-1.json', kind: 'conversation' },
      { activeConversationId: 'existing-1', pendingConversationId: null },
      nextState([])
    )

    expect(patch.clearActiveConversation).toBe(true)
  })
})
