import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import type {
  AgentConversationBranchStatus,
  AgentConversationRecord,
  AgentConversationSessionTree,
  TeachingAppState,
  TeachingSystemApi,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'

const createdAt = '2026-07-14T10:00:00.000Z'
const originalState = useAppStore.getState()

function workspace(): TeachingWorkspaceSummary {
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
    git: null
  }
}

function appState(): TeachingAppState {
  const activeWorkspace = workspace()
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

function record(id: string, status: AgentConversationBranchStatus, revision: number): AgentConversationRecord {
  return {
    id,
    workspaceId: 'workspace-1',
    title: id,
    createdAt,
    updatedAt: createdAt,
    relativePath: `conversations/${id}.md`,
    absolutePath: `/workspace/conversations/${id}.md`,
    messageCount: 1,
    turns: [{ id: `${id}-turn`, role: 'assistant', content: id, createdAt }],
    branch: {
      schemaVersion: 1,
      sessionId: 'session-1',
      branchId: `branch-${id}`,
      revision,
      status,
      ...(id === 'root' ? {} : { parentBranchId: 'branch-root' })
    }
  }
}

function tree(
  openConversationId: string,
  statuses: Record<string, { status: AgentConversationBranchStatus; revision: number }>
): AgentConversationSessionTree {
  return {
    schemaVersion: 1,
    sessionId: 'session-1',
    openBranchId: `branch-${openConversationId}`,
    branches: Object.entries(statuses).map(([conversationId, value]) => ({
      sessionId: 'session-1',
      branchId: `branch-${conversationId}`,
      conversationId,
      title: conversationId,
      status: value.status,
      revision: value.revision,
      ...(conversationId === 'root' ? {} : { parentBranchId: 'branch-root' }),
      head: { turnId: `${conversationId}-turn`, turnCount: 1, updatedAt: createdAt },
      relativePath: `.agent-sessions/conversations/${conversationId}.json`,
      isOpen: conversationId === openConversationId
    }))
  }
}

function installApi(api: Partial<TeachingSystemApi>): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: api as TeachingSystemApi
  })
}

beforeEach(() => {
  useAppStore.setState({
    ...originalState,
    appState: appState(),
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

describe('appStore Agent session lifecycle', () => {
  it('recovers a temporary interrupted branch with an explicit storage scope', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    const recovered = record('root', 'active', 4)
    const recoveredTree = tree('root', { root: { status: 'active', revision: 4 } })
    const readConversation = vi.fn(async (payload: { scope?: string }) => {
      if (payload.scope === 'temporary') return recovered
      throw new Error('Conversation not found.')
    })
    const readTree = vi.fn(async () => recoveredTree)
    installApi({
      getState: vi.fn(async () => appState()),
      getSettings: vi.fn(async () => originalState.settings),
      listInterruptedAgentRuns: vi.fn(async () => [{
        runId: 'run-1',
        streamId: 'stream-1',
        workspaceId: 'workspace-1',
        conversationId: 'root',
        status: 'interrupted',
        previousStatus: 'running',
        lastDurableSequence: 1,
        updatedAt: createdAt,
        interruptedAt: createdAt,
        reason: 'restart',
        operationReviewCount: 0,
        usage: {}
      }] as never),
      readAgentConversation: readConversation as TeachingSystemApi['readAgentConversation'],
      readAgentConversationSessionTree: readTree
    })

    await useAppStore.getState().initialize()

    expect(readConversation).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'root', scope: 'workspace'
    })
    expect(readConversation).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'root', scope: 'temporary'
    })
    expect(readTree).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'root', scope: 'temporary'
    })
    expect(useAppStore.getState()).toMatchObject({
      activeConversationId: 'root',
      activeConversationScope: 'temporary',
      activeConversationRevision: 4,
      activeSessionTree: { openBranchId: 'branch-root' }
    })
  })

  it('durably opens an active branch loaded from the catalog', async () => {
    const initialTree = tree('root', {
      root: { status: 'active', revision: 2 },
      child: { status: 'active', revision: 4 }
    })
    const openedTree = tree('child', {
      root: { status: 'active', revision: 2 },
      child: { status: 'active', revision: 4 }
    })
    const readConversation = vi.fn()
    const openBranch = vi.fn(async () => ({ conversation: record('child', 'active', 4), tree: openedTree }))
    installApi({
      readAgentConversationSessionTree: vi.fn(async () => initialTree),
      readAgentConversation: readConversation,
      openAgentConversationBranch: openBranch
    })

    await useAppStore.getState().loadAgentConversation('child')

    expect(openBranch).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'child', scope: 'workspace' })
    expect(readConversation).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      activeConversationId: 'child',
      activeConversationRevision: 4,
      activeSessionTree: { openBranchId: 'branch-child' }
    })
  })

  it('routes a temporary conversation and later branch operations to temporary storage', async () => {
    const sessionTree = tree('root', { root: { status: 'active', revision: 4 } })
    const readTree = vi.fn(async () => sessionTree)
    const openBranch = vi.fn(async () => ({ conversation: record('root', 'active', 4), tree: sessionTree }))
    const replayBranch = vi.fn(async () => ({ turns: [], replaySource: {
      sourceConversationId: 'root', sourceBranchId: 'branch-root', sourceTurnId: 'root-turn',
      sourceTurnCount: 1, sourceDigest: 'a'.repeat(64), replayId: 'replay-1'
    } }))
    installApi({
      readAgentConversationSessionTree: readTree,
      openAgentConversationBranch: openBranch,
      replayAgentConversationBranch: replayBranch
    })

    await useAppStore.getState().loadAgentConversation('root', 'workspace-1', 'temporary')
    await useAppStore.getState().replayAgentConversationBranch('root', 'root-turn')

    expect(readTree).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'root', scope: 'temporary'
    })
    expect(openBranch).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'root', scope: 'temporary'
    })
    expect(replayBranch).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'root', scope: 'temporary', sourceTurnId: 'root-turn'
    })
    expect(useAppStore.getState().activeConversationScope).toBe('temporary')
  })

  it('loads an archived branch as an explicit read-only view without changing durable open state', async () => {
    const sessionTree = tree('root', {
      root: { status: 'active', revision: 2 },
      archived: { status: 'archived', revision: 5 }
    })
    const openBranch = vi.fn()
    installApi({
      readAgentConversationSessionTree: vi.fn(async () => sessionTree),
      readAgentConversation: vi.fn(async () => record('archived', 'archived', 5)),
      openAgentConversationBranch: openBranch
    })

    await useAppStore.getState().loadAgentConversation('archived')

    expect(openBranch).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      activeConversationId: 'archived',
      activeConversationRevision: 5,
      activeSessionTree: { openBranchId: 'branch-root' }
    })
  })

  it('switches to a restored branch and refreshes the conversation catalog state', async () => {
    const restoredTree = tree('archived', {
      root: { status: 'active', revision: 2 },
      archived: { status: 'active', revision: 6 }
    })
    const refreshedState = appState()
    useAppStore.setState({
      activeConversationId: 'root',
      activeConversationRevision: 2,
      activeSessionTree: tree('root', {
        root: { status: 'active', revision: 2 },
        archived: { status: 'archived', revision: 5 }
      }),
      agentTurns: record('root', 'active', 2).turns
    })
    installApi({
      updateAgentConversationBranchStatus: vi.fn(async () => ({
        state: refreshedState,
        conversation: record('archived', 'active', 6),
        tree: restoredTree
      }))
    })

    await useAppStore.getState().updateAgentConversationBranchStatus('archived', 'active', 5)

    expect(useAppStore.getState()).toMatchObject({
      appState: refreshedState,
      activeConversationId: 'archived',
      activeConversationRevision: 6,
      activeSessionTree: { openBranchId: 'branch-archived' }
    })
  })

  it('passes the displayed source revision when forking a branch', async () => {
    const forkedTree = tree('child', {
      root: { status: 'active', revision: 4 },
      child: { status: 'active', revision: 1 }
    })
    const forkBranch = vi.fn(async () => ({
      state: appState(),
      conversation: record('child', 'active', 1),
      tree: forkedTree
    }))
    installApi({ forkAgentConversationBranch: forkBranch })

    await useAppStore.getState().forkAgentConversationBranch('root', 'root-turn', 4)

    expect(forkBranch).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      conversationId: 'root',
      scope: 'workspace',
      sourceTurnId: 'root-turn',
      expectedRevision: 4
    })
    expect(useAppStore.getState()).toMatchObject({
      activeConversationId: 'child',
      activeConversationRevision: 1,
      activeSessionTree: { openBranchId: 'branch-child' }
    })
  })

  it('falls back to the durable open branch after archiving the viewed branch', async () => {
    const fallbackTree = tree('child', {
      root: { status: 'archived', revision: 3 },
      child: { status: 'active', revision: 4 }
    })
    useAppStore.setState({
      activeConversationId: 'root',
      activeConversationRevision: 2,
      activeSessionTree: tree('root', {
        root: { status: 'active', revision: 2 },
        child: { status: 'active', revision: 4 }
      }),
      agentTurns: record('root', 'active', 2).turns
    })
    const openBranch = vi.fn(async () => ({ conversation: record('child', 'active', 4), tree: fallbackTree }))
    installApi({
      updateAgentConversationBranchStatus: vi.fn(async () => ({
        state: appState(),
        conversation: record('root', 'archived', 3),
        tree: fallbackTree
      })),
      openAgentConversationBranch: openBranch
    })

    await useAppStore.getState().updateAgentConversationBranchStatus('root', 'archived', 2)

    expect(openBranch).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'child', scope: 'workspace' })
    expect(useAppStore.getState()).toMatchObject({
      activeConversationId: 'child',
      activeConversationRevision: 4,
      activeSessionTree: { openBranchId: 'branch-child' }
    })
  })
})
