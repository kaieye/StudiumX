import { describe, expect, it } from 'vitest'
import { projectCompletedAgentConversationIntoAppState } from '../../src/renderer/src/agent-conversation-projection'
import type {
  AgentConversationRecord,
  AgentConversationSummary,
  TeachingAppState,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'

const createdAt = '2026-08-03T10:00:00.000Z'

function workspace(overrides: Partial<TeachingWorkspaceSummary> = {}): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1',
    name: 'Physics',
    rootPath: '/workspace',
    missionPath: '/workspace/MISSION.md',
    resourcesPath: '/workspace/resources',
    lessonsDir: '/workspace/lessons',
    recordsDir: '/workspace/records',
    referenceDir: '/workspace/reference',
    reviewsDir: '/workspace/reviews',
    createdAt,
    updatedAt: createdAt,
    agentWorkspaceTrust: 'trusted',
    missionTitle: 'Physics',
    missionExcerpt: 'Learn physics',
    courses: [],
    fileTree: [],
    conversations: [],
    resources: [],
    records: [],
    lessons: [],
    referenceCount: 0,
    assetsReady: true,
    git: null,
    ...overrides
  }
}

function appState(activeWorkspace: TeachingWorkspaceSummary): TeachingAppState {
  return {
    workspaces: [activeWorkspace],
    activeWorkspace,
    temporaryConversations: [],
    previewHtml: '',
    previewUrl: '',
    selectedLessonPath: null,
    runtime: { status: 'idle', currentStep: '', queuedTasks: 0, providerLabel: '' },
    recentChangeSummary: null
  }
}

function conversation(overrides: Partial<AgentConversationRecord> = {}): AgentConversationRecord {
  return {
    id: 'conversation-1',
    workspaceId: 'workspace-1',
    title: 'Momentum',
    createdAt,
    updatedAt: createdAt,
    relativePath: '.agent-sessions/conversations/conversation-1.json',
    absolutePath: '/workspace/.agent-sessions/conversations/conversation-1.json',
    messageCount: 2,
    turns: [],
    ...overrides
  }
}

function existingSummary(overrides: Partial<AgentConversationSummary> = {}): AgentConversationSummary {
  return {
    id: 'existing-conversation',
    workspaceId: 'workspace-1',
    title: 'Existing title',
    createdAt,
    updatedAt: createdAt,
    relativePath: 'courses/mechanics/conversations/conversation-1.json',
    absolutePath: '/workspace/courses/mechanics/conversations/conversation-1.json',
    messageCount: 1,
    ...overrides
  }
}

describe('projectCompletedAgentConversationIntoAppState', () => {
  it('reconciles a completed course conversation into workspace and course catalogs', () => {
    const staleSummary = existingSummary({ pinned: true })
    const activeWorkspace = workspace({
      conversations: [staleSummary],
      courses: [{
        id: 'mechanics',
        name: 'Mechanics',
        relativePath: 'courses/mechanics',
        absolutePath: '/workspace/courses/mechanics',
        lessonCount: 0,
        sessionCount: 1,
        sessions: [],
        conversations: [staleSummary]
      }]
    })
    const completed = conversation({
      id: 'conversation-1',
      title: 'Updated momentum',
      updatedAt: '2026-08-03T10:01:00.000Z',
      relativePath: 'courses/mechanics/conversations/conversation-1.json',
      absolutePath: '/workspace/courses/mechanics/conversations/conversation-1.json',
      messageCount: 4
    })

    const projected = projectCompletedAgentConversationIntoAppState({
      appState: appState(activeWorkspace),
      workspaceId: activeWorkspace.id,
      conversation: completed
    })

    expect(projected.workspaces[0]?.conversations).toEqual([
      expect.objectContaining({ id: completed.id, title: completed.title, messageCount: 4, pinned: true })
    ])
    expect(projected.workspaces[0]?.courses[0]?.conversations).toEqual([
      expect.objectContaining({ id: completed.id, title: completed.title, messageCount: 4, pinned: true })
    ])
    expect(projected.workspaces[0]?.courses[0]?.sessionCount).toBe(1)
    expect(projected.activeWorkspace).toBe(projected.workspaces[0])
  })

  it('reconciles a completed temporary conversation without changing workspace catalogs', () => {
    const activeWorkspace = workspace()
    const completed = conversation({
      id: 'temporary-1',
      title: 'Quick question',
      relativePath: 'conversations/temporary-1.json',
      absolutePath: '/workspace/conversations/temporary-1.json'
    })
    const state = appState(activeWorkspace)

    const projected = projectCompletedAgentConversationIntoAppState({
      appState: state,
      workspaceId: activeWorkspace.id,
      conversation: completed
    })

    expect(projected.temporaryConversations).toEqual([
      expect.objectContaining({ id: completed.id, title: completed.title })
    ])
    expect(projected.workspaces).toBe(state.workspaces)
    expect(projected.activeWorkspace).toBe(activeWorkspace)
  })
})
