import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTeachingSettingsDefaults } from '../../src/shared/teaching-settings-schema'
import type {
  AgentConversationRecord,
  InterruptedAgentRun,
  TeachingAppState,
  TeachingSystemApi,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'

const createdAt = '2026-08-16T12:20:18.030Z'
const originalState = useAppStore.getState()

function workspace(conversations: Array<{ id: string; relativePath: string }>): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1',
    name: '考公',
    rootPath: '/workspace',
    missionPath: '/workspace/MISSION.md',
    resourcesPath: '/workspace/RESOURCES.md',
    lessonsDir: '/workspace/lessons',
    recordsDir: '/workspace/records',
    referenceDir: '/workspace/references',
    reviewsDir: '/workspace/reviews',
    createdAt,
    updatedAt: createdAt,
    missionTitle: 'Mission',
    missionExcerpt: 'Excerpt',
    courses: [],
    fileTree: [],
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      workspaceId: 'workspace-1',
      title: conversation.id,
      createdAt,
      updatedAt: createdAt,
      relativePath: conversation.relativePath,
      absolutePath: `/workspace/${conversation.relativePath}`,
      messageCount: 1
    })),
    resources: [],
    records: [],
    lessons: [],
    referenceCount: 0,
    assetsReady: true,
    git: null
  }
}

function appState(temporaryConversations: Array<{ id: string; relativePath: string }>): TeachingAppState {
  const activeWorkspace = workspace([])
  return {
    workspaces: [activeWorkspace],
    activeWorkspace,
    temporaryConversations: temporaryConversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.id,
      createdAt,
      updatedAt: createdAt,
      relativePath: conversation.relativePath,
      absolutePath: `/app-data/${conversation.relativePath}`,
      messageCount: 1
    })),
    previewHtml: '',
    previewUrl: '',
    selectedLessonPath: null,
    runtime: { status: 'idle', currentStep: '', queuedTasks: 0, providerLabel: '' },
    recentChangeSummary: null
  }
}

function record(id: string): AgentConversationRecord {
  return {
    id,
    workspaceId: 'workspace-1',
    title: id,
    createdAt,
    updatedAt: createdAt,
    relativePath: `conversations/${id}.md`,
    absolutePath: `/app-data/conversations/${id}.md`,
    messageCount: 1,
    turns: [{ id: `${id}-turn`, role: 'assistant', content: id, createdAt }],
    branch: { schemaVersion: 1, sessionId: id, branchId: id, revision: 1, status: 'active' }
  }
}

function interruptedNotice(conversationId: string): InterruptedAgentRun {
  return {
    runId: `conversation-stream-${conversationId}`,
    streamId: `stream-${conversationId}`,
    workspaceId: 'workspace-1',
    conversationId,
    status: 'interrupted',
    previousStatus: 'awaiting_conversation_save',
    lastDurableSequence: 1,
    updatedAt: createdAt,
    interruptedAt: createdAt,
    reason: 'interrupted',
    operationReviewCount: 0,
    usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolResults: 0, externalWriteCount: 0, privilegedCount: 0 }
  }
}

function installApi(api: Partial<TeachingSystemApi>): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: api as TeachingSystemApi
  })
}

function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  })
}

beforeEach(() => {
  stubMatchMedia()
  useAppStore.setState({
    ...originalState,
    appState: appState([]),
    activeConversationId: null,
    activeConversationScope: null,
    activeConversationRevision: null,
    activeSessionTree: null,
    agentTurns: [],
    agentChatBusy: false,
    pendingAgentConversation: null,
    error: null
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('appStore startup recovery vs removed conversations', () => {
  it('does not resurrect a conversation the user removed from the list (archived), even with a durable interrupted-run notice', async () => {
    const archivedId = 'chat-20260816-191716-hello'
    // The catalog excludes the archived conversation; its files are still on
    // disk, so readAgentConversation succeeds — the exact stale-checkpoint case.
    installApi({
      getState: async () => appState([]),
      getSettings: async () => createTeachingSettingsDefaults('/workspace'),
      listInterruptedAgentRuns: async () => [interruptedNotice(archivedId)],
      listTerminalAgentRunNotices: async () => [],
      readAgentConversation: async () => record(archivedId),
      readAgentConversationSessionTree: async () => null
    })

    await useAppStore.getState().initialize()

    expect(useAppStore.getState()).toMatchObject({
      activeConversationId: null,
      activeConversationScope: null,
      agentTurns: []
    })
  })

  it('still recovers a visible conversation that has a durable interrupted-run notice', async () => {
    const visibleId = 'chat-visible'
    installApi({
      getState: async () => appState([{ id: visibleId, relativePath: `conversations/${visibleId}.md` }]),
      getSettings: async () => createTeachingSettingsDefaults('/workspace'),
      listInterruptedAgentRuns: async () => [interruptedNotice(visibleId)],
      listTerminalAgentRunNotices: async () => [],
      readAgentConversation: async ({ scope }) => {
        // A temporary conversation resolves only in the temporary scope.
        if (scope === 'temporary') return record(visibleId)
        throw new Error('Conversation not found.')
      },
      readAgentConversationSessionTree: async () => null
    })

    await useAppStore.getState().initialize()

    expect(useAppStore.getState().activeConversationId).toBe(visibleId)
    expect(useAppStore.getState().activeConversationScope).toBe('temporary')
    expect(useAppStore.getState().agentTurns.length).toBeGreaterThan(0)
  })
})
