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
  it('clears selection chrome from top-nav while preserving an in-flight pending teaching conversation', () => {
    const pending = {
      workspaceId: 'workspace-1',
      sourceConversationId: null,
      sourceConversationRevision: null,
      mode: 'teaching' as const,
      summary: {
        id: 'pending-teaching', title: 'Teaching', relativePath: 'courses/physics/conversations/pending.json',
        createdAt, updatedAt: createdAt, messageCount: 2, mode: 'teaching' as const, pending: true as const
      },
      turns: [
        { id: 'user-1', role: 'user' as const, content: 'Explain momentum', createdAt },
        { id: 'assistant-1', role: 'assistant' as const, content: '', createdAt }
      ],
      status: '调用工具…',
      toolsSupported: true
    }
    useAppStore.setState({
      view: 'overview', overviewDialogMode: 'teaching', agentChatBusy: true,
      pendingAgentConversation: pending, agentTurns: pending.turns,
      activeConversationId: pending.summary.id, activeConversationScope: 'workspace',
      activeConversationRevision: 3, activeSessionTree: null,
      appState: {
        ...useAppStore.getState().appState,
        selectedLessonPath: 'D:/workspace/courses/physics/lesson.html'
      }
    })

    useAppStore.getState().setOverviewDialogMode('chat')
    useAppStore.getState().openWorkspaceTeachingMode()

    expect(useAppStore.getState()).toMatchObject({
      view: 'overview',
      overviewDialogMode: 'teaching',
      activeConversationId: null,
      activeConversationScope: null,
      activeConversationRevision: null,
      activeSessionTree: null,
      agentChatBusy: true,
      pendingAgentConversation: pending,
      agentTurns: [],
      appState: {
        selectedLessonPath: null
      }
    })
  })

  it('keeps an in-flight conversation when removing a different persisted conversation', async () => {
    const pending = {
      workspaceId: 'workspace-1',
      sourceConversationId: null,
      sourceConversationRevision: null,
      mode: 'teaching' as const,
      summary: {
        id: 'pending-42', title: 'Current turn', relativePath: '.agent-sessions/conversations/pending-42.json',
        absolutePath: '/workspace/.agent-sessions/conversations/pending-42.json',
        createdAt, updatedAt: createdAt, messageCount: 2, pending: true as const
      },
      turns: [
        { id: 'user-1', role: 'user' as const, content: 'Explain momentum', createdAt },
        { id: 'assistant-1', role: 'assistant' as const, content: '', createdAt }
      ],
      status: '回答中…',
      toolsSupported: true
    }
    const refreshedState = appState()
    const removeWorkspaceItem = vi.fn(async () => refreshedState)
    installApi({ removeWorkspaceItem })
    useAppStore.setState({
      agentChatBusy: true,
      pendingAgentConversation: pending,
      agentTurns: pending.turns,
      activeConversationId: pending.summary.id,
      activeConversationScope: 'workspace'
    })

    await useAppStore.getState().removeWorkspaceItem({
      relativePath: '.agent-sessions/conversations/existing-1.json',
      kind: 'conversation'
    })

    expect(removeWorkspaceItem).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      relativePath: '.agent-sessions/conversations/existing-1.json',
      kind: 'conversation',
      mode: 'disk'
    })
    expect(useAppStore.getState()).toMatchObject({
      appState: refreshedState,
      activeConversationId: 'pending-42',
      agentChatBusy: true,
      pendingAgentConversation: pending,
      agentTurns: pending.turns
    })
  })

  it('clears finished teaching conversation chrome when reopening teaching mode from top-nav', () => {
    const turns = [{ id: 'assistant-complete', role: 'assistant' as const, content: 'Completed answer', createdAt }]
    useAppStore.setState({
      view: 'overview', overviewDialogMode: 'chat', agentChatBusy: false,
      pendingAgentConversation: null, agentTurns: turns,
      activeConversationId: 'conversation-complete', activeConversationScope: 'workspace',
      activeConversationRevision: 2
    })

    useAppStore.getState().openWorkspaceTeachingMode()

    expect(useAppStore.getState()).toMatchObject({
      view: 'overview',
      overviewDialogMode: 'teaching',
      activeConversationId: null,
      activeConversationScope: null,
      activeConversationRevision: null,
      agentTurns: []
    })
  })

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
    const recoveryNotice = useAppStore.getState().agentTurns.at(-1)
    expect(recoveryNotice?.content).toContain('当前工作区共有 1 个中断运行需要人工确认')
    expect(recoveryNotice?.content).not.toContain('其余')
    expect(recoveryNotice?.metadata?.provenance).toEqual({ kind: 'recovery_notice' })
    expect(recoveryNotice?.processEvents?.[0]).toMatchObject({ kind: 'status', title: '运行中断' })
    expect(recoveryNotice?.processEvents?.[0]?.status).toBeUndefined()
    expect(recoveryNotice?.processEvents?.[0]?.isError).toBeUndefined()
  })

  it('opens only the newest current-workspace interruption and keeps all current-workspace runs visible for review', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    const recovered = record('newest', 'active', 5)
    const recoveredTree = tree('newest', { newest: { status: 'active', revision: 5 } })
    const readConversation = vi.fn(async (payload: { conversationId: string; scope?: string }) => {
      if (payload.conversationId === 'newest' && payload.scope === 'workspace') return recovered
      throw new Error('Conversation not found.')
    })
    const readTree = vi.fn(async () => recoveredTree)
    installApi({
      getState: vi.fn(async () => appState()),
      getSettings: vi.fn(async () => originalState.settings),
      listInterruptedAgentRuns: vi.fn(async () => [{
        runId: 'older-current', streamId: 'stream-older', workspaceId: 'workspace-1', conversationId: 'older',
        status: 'interrupted', previousStatus: 'running', lastDurableSequence: 1,
        updatedAt: '2026-07-14T09:00:00.000Z', interruptedAt: '2026-07-14T09:00:00.000Z',
        reason: 'restart', operationReviewCount: 0, usage: {}
      }, {
        runId: 'newest-current', streamId: 'stream-newest', workspaceId: 'workspace-1', conversationId: 'newest',
        status: 'interrupted', previousStatus: 'waiting_for_permission', lastDurableSequence: 2,
        updatedAt: '2026-07-14T11:00:00.000Z', interruptedAt: '2026-07-14T11:00:00.000Z',
        reason: 'restart', operationReviewCount: 2, usage: {}
      }, {
        runId: 'other-workspace', streamId: 'stream-other', workspaceId: 'workspace-2', conversationId: 'other',
        status: 'interrupted', previousStatus: 'running', lastDurableSequence: 3,
        updatedAt: '2026-07-14T12:00:00.000Z', interruptedAt: '2026-07-14T12:00:00.000Z',
        reason: 'restart', operationReviewCount: 0, usage: {}
      }] as never),
      readAgentConversation: readConversation as TeachingSystemApi['readAgentConversation'],
      readAgentConversationSessionTree: readTree
    })

    await useAppStore.getState().initialize()

    expect(readConversation).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'newest', scope: 'workspace'
    })
    expect(readConversation).not.toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'older' }))
    expect(readConversation).not.toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'other' }))
    expect(useAppStore.getState()).toMatchObject({
      activeConversationId: 'newest',
      activeConversationScope: 'workspace',
      activeConversationRevision: 5
    })
    const recoveryNotice = useAppStore.getState().agentTurns.at(-1)
    expect(recoveryNotice?.content).toContain('当前工作区共有 2 个中断运行需要人工确认')
    expect(recoveryNotice?.content).toContain('已自动打开最新一项；其余 1 项仍需要检查')
    expect(recoveryNotice?.content).not.toContain('共有 3 个中断运行')
    expect(recoveryNotice?.content).toContain('退出时正在等待写入审批；旧审批已失效。')
    expect(recoveryNotice?.content).toContain('请先检查可能已执行的 2 个写入')
    expect(recoveryNotice?.content).toContain('应用不会自动继续或重做此运行。')
    expect(recoveryNotice?.metadata?.provenance).toEqual({ kind: 'recovery_notice' })
    expect(recoveryNotice?.processEvents?.[0]).toMatchObject({ kind: 'status', title: '运行中断' })
    expect(recoveryNotice?.processEvents?.[0]?.status).toBeUndefined()
    expect(recoveryNotice?.processEvents?.[0]?.isError).toBeUndefined()
  })

  it('opens the newest durable terminal notice without replaying it after restart', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    const recovered = record('terminal-conversation', 'active', 6)
    const recoveredTree = tree('terminal-conversation', { 'terminal-conversation': { status: 'active', revision: 6 } })
    const readConversation = vi.fn(async (payload: { conversationId: string; scope?: string }) => {
      if (payload.conversationId === 'terminal-conversation' && payload.scope === 'workspace') return recovered
      throw new Error('Conversation not found.')
    })
    const readTree = vi.fn(async () => recoveredTree)
    installApi({
      getState: vi.fn(async () => appState()),
      getSettings: vi.fn(async () => originalState.settings),
      listInterruptedAgentRuns: vi.fn(async () => [{
        runId: 'older-interruption', streamId: 'stream-interruption', workspaceId: 'workspace-1', conversationId: 'older',
        status: 'interrupted', previousStatus: 'running', lastDurableSequence: 1,
        updatedAt: '2026-08-05T09:00:00.000Z', interruptedAt: '2026-08-05T09:00:00.000Z',
        reason: 'restart', operationReviewCount: 0, usage: {}
      }] as never),
      listTerminalAgentRunNotices: vi.fn(async () => [{
        runId: 'newer-terminal', streamId: 'stream-terminal', workspaceId: 'workspace-1', conversationId: 'terminal-conversation',
        status: 'failed', stopReason: 'resource_limit', updatedAt: '2026-08-05T11:00:00.000Z',
        completedAt: '2026-08-05T11:00:00.000Z', operationReviewCount: 1,
        usage: {
          providerCalls: 2, toolCalls: 1, childRuns: 0, durationMs: 100,
          resourceGovernance: {
            configured: [],
            terminal: { layer: 'user_budget', meter: 'total_tokens', used: 500, limit: 500, scope: 'run', action: 'resource_limit' }
          }
        }
      }] as never),
      readAgentConversation: readConversation as TeachingSystemApi['readAgentConversation'],
      readAgentConversationSessionTree: readTree
    })

    await useAppStore.getState().initialize()

    expect(readConversation).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'terminal-conversation', scope: 'workspace' })
    expect(readConversation).not.toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'older' }))
    expect(useAppStore.getState()).toMatchObject({ activeConversationId: 'terminal-conversation', activeConversationScope: 'workspace', activeConversationRevision: 6 })
    expect(useAppStore.getState().agentStatus).toContain('不会自动继续或重放')
    const notice = useAppStore.getState().agentTurns.at(-1)
    expect(notice?.content).toContain('资源边界')
    expect(notice?.content).toContain('已用 / 上限：500 / 500')
    expect(notice?.content).toContain('没有创建 canonical conversation settlement')
    expect(notice?.content).toContain('不会重放 provider 或工具工作')
    expect(notice?.content).toContain('开始一个新的明确回合')
    expect(notice?.metadata?.provenance).toEqual({ kind: 'recovery_notice' })
    expect(notice?.processEvents?.[0]).toMatchObject({ kind: 'status', title: '资源边界已停止', status: 'resource_limit' })
  })

  it('presents a durable no-progress terminal distinctly without retrying or replaying after restart', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    const recovered = record('no-progress-conversation', 'active', 3)
    const recoveredTree = tree('no-progress-conversation', { 'no-progress-conversation': { status: 'active', revision: 3 } })
    const readConversation = vi.fn(async (payload: { conversationId: string; scope?: string }) => {
      if (payload.conversationId === 'no-progress-conversation' && payload.scope === 'workspace') return recovered
      throw new Error('Conversation not found.')
    })
    installApi({
      getState: vi.fn(async () => appState()),
      getSettings: vi.fn(async () => originalState.settings),
      listInterruptedAgentRuns: vi.fn(async () => []),
      listTerminalAgentRunNotices: vi.fn(async () => [{
        runId: 'no-progress-terminal', streamId: 'stream-no-progress', workspaceId: 'workspace-1', conversationId: 'no-progress-conversation',
        status: 'failed', stopReason: 'no_progress', updatedAt: '2026-08-05T12:00:00.000Z',
        completedAt: '2026-08-05T12:00:00.000Z', operationReviewCount: 0,
        usage: { providerCalls: 4, toolCalls: 4, childRuns: 0, durationMs: 100 }
      }] as never),
      readAgentConversation: readConversation as TeachingSystemApi['readAgentConversation'],
      readAgentConversationSessionTree: vi.fn(async () => recoveredTree)
    })

    await useAppStore.getState().initialize()

    expect(readConversation).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'no-progress-conversation', scope: 'workspace' })
    expect(useAppStore.getState().agentStatus).toContain('不会自动继续或重放')
    const notice = useAppStore.getState().agentTurns.at(-1)
    expect(notice?.content).toContain('重复操作未带来安全进展')
    expect(notice?.content).toContain('不会自动继续，也不会重放 provider 或工具工作')
    expect(notice?.content).toContain('开始一个新的明确回合')
    expect(notice?.processEvents?.[0]).toMatchObject({
      kind: 'status', title: '重复操作未产生进展', status: 'no_progress'
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

  it('refreshes and retries a stale fork once with the canonical revision without showing an error', async () => {
    const refreshedTree = tree('root', { root: { status: 'active', revision: 2 } })
    const childTree = tree('child', {
      root: { status: 'active', revision: 2 },
      child: { status: 'active', revision: 1 }
    })
    const forkBranch = vi.fn(async (payload) => {
      if (forkBranch.mock.calls.length === 1) {
        throw new Error('Conversation branch revision conflict: expected 1, current 2.')
      }
      expect(payload.expectedRevision).toBe(2)
      return { state: appState(), conversation: record('child', 'active', 1), tree: childTree }
    })
    installApi({
      forkAgentConversationBranch: forkBranch,
      readAgentConversationSessionTree: vi.fn(async () => refreshedTree),
      openAgentConversationBranch: vi.fn(async () => ({ conversation: record('root', 'active', 2), tree: refreshedTree }))
    })
    useAppStore.setState({
      activeConversationId: 'root', activeConversationScope: 'workspace', activeConversationRevision: 1,
      activeSessionTree: tree('root', { root: { status: 'active', revision: 1 } }),
      agentTurns: record('root', 'active', 1).turns
    })

    const forked = await useAppStore.getState().forkAgentConversationBranch('root', 'root-turn', 1)

    expect(forked).toBe(true)
    expect(forkBranch).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState()).toMatchObject({
      activeConversationId: 'child', activeConversationRevision: 1,
      activeSessionTree: { openBranchId: 'branch-child' }, error: null
    })
  })

  it('refreshes a stale branch after a revision conflict without replaying the requested status change', async () => {
    const refreshedTree = tree('root', { root: { status: 'active', revision: 2 } })
    const readTree = vi.fn(async () => refreshedTree)
    const openBranch = vi.fn(async () => ({ conversation: record('root', 'active', 2), tree: refreshedTree }))
    const updateStatus = vi.fn(async () => {
      throw new Error('Conversation branch revision conflict: expected 1, current 2.')
    })
    installApi({
      updateAgentConversationBranchStatus: updateStatus,
      readAgentConversationSessionTree: readTree,
      openAgentConversationBranch: openBranch
    })
    useAppStore.setState({
      activeConversationId: 'root',
      activeConversationScope: 'workspace',
      activeConversationRevision: 1,
      activeSessionTree: tree('root', { root: { status: 'active', revision: 1 } }),
      agentTurns: record('root', 'active', 1).turns
    })

    await useAppStore.getState().updateAgentConversationBranchStatus('root', 'archived', 1)

    expect(updateStatus).toHaveBeenCalledTimes(1)
    expect(readTree).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'root', scope: 'workspace' })
    expect(openBranch).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'root', scope: 'workspace' })
    expect(useAppStore.getState()).toMatchObject({
      activeConversationId: 'root',
      activeConversationRevision: 2,
      activeSessionTree: { openBranchId: 'branch-root' },
      error: null
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
