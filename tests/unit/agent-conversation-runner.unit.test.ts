import { describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_BUSY_QUEUED_ACK } from '../../src/shared/agent-session-busy-ack'
import {
  AgentConversationTurnRunner,
  type AgentConversationTurnRunnerApi,
  type AgentConversationTurnRunnerPatch,
  type AgentConversationTurnRunnerState
} from '../../src/renderer/src/app-shell/agent-conversation-runner'
import type {
  AgentChatStreamDone,
  AgentChatTurn,
  AgentConversationSessionTree,
  LessonSummary,
  TeachingAppState,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'

type TestState = AgentConversationTurnRunnerState & { error: string | null }

type TestApi = Omit<AgentConversationTurnRunnerApi, 'readAgentConversationSessionTree'> &
  Partial<Pick<AgentConversationTurnRunnerApi, 'readAgentConversationSessionTree'>>

type Harness = {
  getState: () => TestState
  setState: (patch: Partial<TestState>) => void
  patches: Array<AgentConversationTurnRunnerPatch<string>>
  effects: LessonSummary[][]
  runner: AgentConversationTurnRunner<string>
}

const createdAt = '2026-07-14T10:00:00.000Z'

function deferredDone(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((res) => { resolve = res })
  return { promise, resolve }
}

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

function appState(activeWorkspace = workspace()): TeachingAppState {
  return {
    workspaces: [activeWorkspace],
    activeWorkspace,
    temporaryConversations: [],
    previewHtml: '',
    previewUrl: '',
    selectedLessonPath: '/workspace/lessons/mechanics/session-1.md',
    runtime: { status: 'idle', currentStep: '', queuedTasks: 0, providerLabel: '' },
    recentChangeSummary: null
  }
}

function makeHarness(
  api: TestApi,
  overrides: Partial<TestState> = {}
): Harness {
  let state: TestState = {
    appState: appState(),
    overviewDialogMode: 'teaching',
    agentInput: 'unused input',
    agentChatBusy: false,
    agentBusyAckMessage: null,
    agentBusyFollowUpQueue: [],
    agentStatus: '',
    agentTurns: [],
    activeConversationId: null,
    activeConversationScope: null,
    activeConversationRevision: null,
    activeSessionTree: null,
    agentToolsSupported: null,
    pendingAgentConversation: null,
    selectedCourseRelativePath: 'courses/mechanics',
    taskPrompt: 'previous prompt',
    error: null,
    ...overrides
  }
  const runnerApi: AgentConversationTurnRunnerApi = {
    readAgentConversationSessionTree: vi.fn(async ({ conversationId }) => sessionTree(conversationId)),
    ...api
  }
  const patches: Array<AgentConversationTurnRunnerPatch<string>> = []
  const effects: LessonSummary[][] = []
  const runner = new AgentConversationTurnRunner<string>({
    getState: () => state,
    setState: (patch) => {
      patches.push(patch)
      state = { ...state, ...patch }
    },
    getApi: () => runnerApi,
    toUserError: (error) => `user:${error instanceof Error ? error.message : String(error)}`,
    onGeneratedLessons: (lessons) => effects.push(lessons),
    now: () => createdAt,
    nextIdSeed: () => 42
  })
  return {
    getState: () => state,
    setState: (patch) => { state = { ...state, ...patch } },
    patches,
    effects,
    runner
  }
}

function completedTurn(content = 'Saved answer'): AgentChatStreamDone {
  return {
    streamId: 'pending-42',
    turns: [
      { id: 'u-42', role: 'user', content: 'Explain momentum', createdAt },
      {
        id: 'a-42',
        role: 'assistant',
        content,
        toolCalls: [{ id: 'tool-1', name: 'search_notes', arguments: '{}' }],
        createdAt
      }
    ],
    finalText: content,
    iterations: 1,
    toolsSupported: true,
    usage: { providerCalls: 1, toolCalls: 1, toolErrors: 0, iterations: 1, childRuns: 0, durationMs: 1 }
  }
}

function sessionTree(conversationId = 'conversation-9', revision = 1): AgentConversationSessionTree {
  return {
    schemaVersion: 1,
    sessionId: 'session-tree-1',
    openBranchId: `branch-${conversationId}`,
    branches: [{
      sessionId: 'session-tree-1',
      branchId: `branch-${conversationId}`,
      conversationId,
      title: 'Momentum',
      status: 'active',
      revision,
      head: { turnId: 'a-42', turnCount: 2, updatedAt: createdAt },
      relativePath: `.agent-sessions/conversations/${conversationId}.json`,
      isOpen: true
    }]
  }
}

function generatedLesson(): LessonSummary {
  return {
    id: 'lesson-1',
    title: 'Momentum',
    objective: 'Understand momentum',
    prompt: 'Momentum',
    createdAt,
    durationMinutes: 15,
    courseId: 'course-1',
    courseName: 'Mechanics',
    courseRelativePath: 'courses/mechanics',
    courseAbsolutePath: '/workspace/courses/mechanics',
    sessionId: 'session-1',
    sessionName: 'Session 1',
    sessionRelativePath: 'courses/mechanics/session-1.md',
    sessionAbsolutePath: '/workspace/courses/mechanics/session-1.md',
    relativePath: 'courses/mechanics/session-1.md',
    absolutePath: '/workspace/courses/mechanics/session-1.md'
  }
}

describe('AgentConversationTurnRunner', () => {
  it('streams, reconciles, saves a teaching turn with its Course/Session attachment, then emits generated-Lesson effects', async () => {
    const stream = vi.fn(async (_payload, onChunk, onStatus, onTool, onInvalidation) => {
      onStatus({ streamId: 'pending-42', status: 'answering' })
      onChunk({ streamId: 'pending-42', delta: 'Local preview' })
      onTool({ streamId: 'pending-42', toolCall: { id: 'tool-1', name: 'search_notes', arguments: '{}' } })
      onTool({ streamId: 'pending-42', toolCall: { id: 'tool-1', name: 'search_notes', arguments: '{}' }, result: 'found notes' })
      onInvalidation?.({
        streamId: 'pending-42',
        reason: 'replay_gap',
        requestedAfterSequence: 1,
        fromSequence: 2,
        nextSequence: 3
      })
      return { ...completedTurn(), generatedLessons: [generatedLesson()] }
    })
    const save = vi.fn(async (payload) => ({
      state: { ...appState(), previewHtml: 'saved-state' },
      conversation: { id: 'conversation-9', title: 'Momentum', createdAt, updatedAt: createdAt, relativePath: 'courses/mechanics/conversations/momentum.md', absolutePath: '/workspace/courses/mechanics/conversations/momentum.md', messageCount: payload.turns.length }
    }))
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: save,
      cancelAgentChatStream: vi.fn()
    })

    await harness.runner.run({ inputOverride: ' Explain momentum ', skillIds: ['physics'] })

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({
      streamId: 'pending-42',
      workspaceId: 'workspace-1',
      mode: 'teaching',
      conversationId: undefined,
      userInput: 'Explain momentum',
      skillIds: ['physics'],
      messages: []
    }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      runId: 'pending-42',
      mode: 'teaching',
      conversationId: null,
      selectedCourseRelativePath: 'courses/mechanics',
      selectedLessonPath: '/workspace/lessons/mechanics/session-1.md'
    }))
    const savedTurns = save.mock.calls[0][0].turns as AgentChatTurn[]
    expect(savedTurns[1]).toMatchObject({ content: 'Saved answer' })
    expect(savedTurns[1].processEvents?.map((event) => event.kind)).toEqual(expect.arrayContaining([
      'status',
      'tool_call'
    ]))
    expect(savedTurns[1].processEvents?.filter((event) => event.kind === 'tool_call')).toEqual([
      expect.objectContaining({ status: 'tool_done' })
    ])
    expect(savedTurns[1].processEvents?.some((event) => event.kind === 'tool_result')).toBe(false)
    expect(harness.getState()).toMatchObject({
      appState: { previewHtml: 'saved-state' },
      taskPrompt: 'Explain momentum',
      agentChatBusy: false,
      pendingAgentConversation: null,
      activeConversationId: 'conversation-9',
      agentToolsSupported: true
    })
    expect(harness.effects).toEqual([[generatedLesson()]])
  })

  it('sends the expected branch revision and refreshes revision and tree after saving', async () => {
    const readTree = vi.fn(async () => sessionTree('conversation-7', 8))
    const save = vi.fn(async (payload) => ({
      state: appState(),
      conversation: {
        id: 'conversation-7',
        title: 'Momentum branch',
        createdAt,
        updatedAt: createdAt,
        relativePath: '.agent-sessions/conversations/conversation-7.json',
        absolutePath: '/workspace/.agent-sessions/conversations/conversation-7.json',
        messageCount: payload.turns.length,
        branch: {
          schemaVersion: 1 as const,
          sessionId: 'session-tree-1',
          branchId: 'branch-conversation-7',
          revision: 8,
          status: 'active' as const
        }
      }
    }))
    const priorTurn: AgentChatTurn = { id: 'u-prior', role: 'user', content: 'Prior question', createdAt }
    const stream = vi.fn(async () => completedTurn())
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: save,
      cancelAgentChatStream: vi.fn(),
      readAgentConversationSessionTree: readTree
    }, {
      activeConversationId: 'conversation-7',
      activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7),
      agentTurns: [priorTurn]
    })

    await harness.runner.run({ inputOverride: 'Continue the branch' })

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-7',
      expectedBranchRevision: 7
    }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-7',
      expectedBranchRevision: 7
    }))
    expect(readTree).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'conversation-7', scope: 'workspace' })
    expect(harness.getState()).toMatchObject({
      activeConversationId: 'conversation-7',
      activeConversationRevision: 8,
      activeSessionTree: { branches: [expect.objectContaining({ conversationId: 'conversation-7', revision: 8 })] }
    })
  })

  it('excludes a renderer-only recovery notice from the next model request and its lineage while retaining durable history', async () => {
    const recoveryNoticeText = 'RECOVERY-NOTICE: do not send this renderer-only notice to the model'
    const stream = vi.fn(async () => completedTurn())
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: vi.fn(async (payload) => ({
        state: appState(),
        conversation: {
          id: 'conversation-7',
          title: 'Momentum branch',
          createdAt,
          updatedAt: createdAt,
          relativePath: '.agent-sessions/conversations/conversation-7.json',
          absolutePath: '/workspace/.agent-sessions/conversations/conversation-7.json',
          messageCount: payload.turns.length
        }
      })),
      cancelAgentChatStream: vi.fn()
    }, {
      activeConversationId: 'conversation-7',
      activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7),
      agentTurns: [
        { id: 'u-durable', role: 'user', content: 'What is momentum?', createdAt },
        { id: 'a-durable', role: 'assistant', content: 'Mass times velocity.', createdAt },
        {
          id: 'interrupted-run-9',
          role: 'assistant',
          content: recoveryNoticeText,
          createdAt,
          metadata: { version: 1, provenance: { kind: 'recovery_notice' } }
        }
      ]
    })

    await harness.runner.run({ inputOverride: 'Now explain impulse instead.' })

    const request = stream.mock.calls[0]?.[0]
    expect(request).toMatchObject({
      userInput: 'Now explain impulse instead.',
      messages: [
        { role: 'user', content: 'What is momentum?' },
        { role: 'assistant', content: 'Mass times velocity.' }
      ],
      messageTurnIds: ['u-durable', 'a-durable']
    })
    expect(request.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ content: recoveryNoticeText })
    ]))
    expect(request.messageTurnIds).not.toContain('interrupted-run-9')
  })

  it('clears a stale tree when post-save refresh fails', async () => {
    const save = vi.fn(async (payload) => ({
      state: appState(),
      conversation: {
        id: 'conversation-7',
        title: 'Momentum branch',
        createdAt,
        updatedAt: createdAt,
        relativePath: '.agent-sessions/conversations/conversation-7.json',
        absolutePath: '/workspace/.agent-sessions/conversations/conversation-7.json',
        messageCount: payload.turns.length,
        branch: {
          schemaVersion: 1 as const,
          sessionId: 'session-tree-1',
          branchId: 'branch-conversation-7',
          revision: 8,
          status: 'active' as const
        }
      }
    }))
    const harness = makeHarness({
      agentChatStream: vi.fn(async () => completedTurn()),
      saveAgentConversation: save,
      cancelAgentChatStream: vi.fn(),
      readAgentConversationSessionTree: vi.fn(async () => { throw new Error('tree unavailable') })
    }, {
      activeConversationId: 'conversation-7',
      activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7),
      agentTurns: [{ id: 'u-prior', role: 'user', content: 'Prior question', createdAt }]
    })

    await harness.runner.run({ inputOverride: 'Continue the branch' })

    expect(harness.getState()).toMatchObject({
      activeConversationId: 'conversation-7',
      activeConversationRevision: 8,
      activeSessionTree: null,
      error: 'user:tree unavailable'
    })
  })

  it('does not overwrite branch navigation that completes during post-save tree refresh', async () => {
    let resolveTree: ((tree: AgentConversationSessionTree) => void) | undefined
    const readTree = vi.fn(() => new Promise<AgentConversationSessionTree>((resolve) => { resolveTree = resolve }))
    const save = vi.fn(async (payload) => ({
      state: appState(),
      conversation: {
        id: 'conversation-7',
        title: 'Momentum branch',
        createdAt,
        updatedAt: createdAt,
        relativePath: '.agent-sessions/conversations/conversation-7.json',
        absolutePath: '/workspace/.agent-sessions/conversations/conversation-7.json',
        messageCount: payload.turns.length,
        branch: {
          schemaVersion: 1 as const,
          sessionId: 'session-tree-1',
          branchId: 'branch-conversation-7',
          revision: 8,
          status: 'active' as const
        }
      }
    }))
    const harness = makeHarness({
      agentChatStream: vi.fn(async () => completedTurn()),
      saveAgentConversation: save,
      cancelAgentChatStream: vi.fn(),
      readAgentConversationSessionTree: readTree
    }, {
      activeConversationId: 'conversation-7',
      activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7),
      agentTurns: [{ id: 'u-prior', role: 'user', content: 'Prior question', createdAt }]
    })

    const running = harness.runner.run({ inputOverride: 'Continue the branch' })
    await vi.waitFor(() => expect(readTree).toHaveBeenCalled())
    const branchBTree = sessionTree('conversation-b', 3)
    harness.setState({
      activeConversationId: 'conversation-b',
      activeConversationRevision: 3,
      activeSessionTree: branchBTree,
      agentTurns: [{ id: 'b-turn', role: 'assistant', content: 'Branch B', createdAt }]
    })
    resolveTree?.(sessionTree('conversation-7', 8))
    await running

    expect(harness.getState()).toMatchObject({
      activeConversationId: 'conversation-b',
      activeConversationRevision: 3,
      activeSessionTree: branchBTree,
      agentTurns: [{ id: 'b-turn', content: 'Branch B' }],
      pendingAgentConversation: null,
      agentChatBusy: false
    })
  })

  it('starts a fresh teaching conversation when switching from a temporary branch', async () => {
    const stream = vi.fn(async () => completedTurn())
    const save = vi.fn(async (payload) => ({
      state: appState(),
      conversation: {
        id: 'conversation-teaching',
        title: 'Teaching branch',
        createdAt,
        updatedAt: createdAt,
        relativePath: 'conversations/conversation-teaching.md',
        absolutePath: '/workspace/conversations/conversation-teaching.md',
        messageCount: payload.turns.length
      }
    }))
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: save,
      cancelAgentChatStream: vi.fn()
    }, {
      overviewDialogMode: 'teaching',
      activeConversationId: 'conversation-temporary',
      activeConversationScope: 'temporary',
      activeConversationRevision: 2,
      activeSessionTree: sessionTree('conversation-temporary', 2),
      agentTurns: [{ id: 'u-prior', role: 'user', content: 'Temporary question', createdAt }]
    })

    await harness.runner.run({ inputOverride: 'Teach me momentum', mode: 'teaching' })

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: undefined,
      expectedBranchRevision: undefined,
      mode: 'teaching',
      messages: []
    }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: null,
      expectedBranchRevision: undefined,
      mode: 'teaching'
    }))
  })
  it('continues a temporary legacy branch with revision zero under CAS', async () => {
    const stream = vi.fn(async () => completedTurn())
    const save = vi.fn(async (payload) => ({
      state: appState(),
      conversation: {
        id: 'conversation-legacy',
        title: 'Legacy branch',
        createdAt,
        updatedAt: createdAt,
        relativePath: 'conversation/conversation-legacy.md',
        absolutePath: '/workspace/conversation/conversation-legacy.md',
        messageCount: payload.turns.length,
        branch: {
          schemaVersion: 1 as const,
          sessionId: 'session-tree-1',
          branchId: 'conversation-legacy',
          revision: 1,
          status: 'active' as const
        }
      }
    }))
    const readTree = vi.fn(async () => sessionTree('conversation-legacy', 1))
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: save,
      cancelAgentChatStream: vi.fn(),
      readAgentConversationSessionTree: readTree
    }, {
      overviewDialogMode: 'teaching',
      activeConversationId: 'conversation-legacy',
      activeConversationScope: 'temporary',
      activeConversationRevision: 0,
      activeSessionTree: sessionTree('conversation-legacy', 0),
      agentTurns: [{ id: 'u-prior', role: 'user', content: 'Legacy question', createdAt }]
    })

    await harness.runner.run({ inputOverride: 'Continue legacy branch' })

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-legacy',
      expectedBranchRevision: 0,
      mode: 'temporary'
    }), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-legacy',
      expectedBranchRevision: 0,
      mode: 'temporary'
    }))
    expect(readTree).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'conversation-legacy', scope: 'temporary'
    })
  })

  it('refuses to run a persisted branch without a concurrency revision', async () => {
    const stream = vi.fn(async () => completedTurn())
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: vi.fn(),
      cancelAgentChatStream: vi.fn()
    }, {
      activeConversationId: 'conversation-7',
      activeConversationRevision: null,
      activeSessionTree: null,
      agentTurns: [{ id: 'u-prior', role: 'user', content: 'Prior question', createdAt }]
    })

    await harness.runner.run({ inputOverride: 'Continue without revision' })

    expect(stream).not.toHaveBeenCalled()
    expect(harness.getState().error).toContain('revision is unavailable')
  })

  it('refuses to run an archived branch before invoking the provider', async () => {
    const stream = vi.fn(async () => completedTurn())
    const save = vi.fn()
    const archivedTree = sessionTree('conversation-7', 8)
    archivedTree.branches[0] = { ...archivedTree.branches[0], status: 'archived', isOpen: false }
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: save,
      cancelAgentChatStream: vi.fn()
    }, {
      activeConversationId: 'conversation-7',
      activeConversationRevision: 8,
      activeSessionTree: archivedTree,
      agentTurns: [{ id: 'u-prior', role: 'user', content: 'Prior question', createdAt }]
    })

    await harness.runner.run({ inputOverride: 'Continue the archived branch' })

    expect(stream).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(harness.getState()).toMatchObject({
      agentChatBusy: false,
      activeConversationId: 'conversation-7',
      error: expect.stringContaining('read-only')
    })
  })

  it('keeps temporary turns detached from the selected Course and Session', async () => {
    const save = vi.fn(async () => ({
      state: appState(),
      conversation: { id: 'temporary-9', title: 'Quick question', createdAt, updatedAt: createdAt, relativePath: '.studiumx/conversations/temporary-9.md', absolutePath: '', messageCount: 2 }
    }))
    const harness = makeHarness({
      agentChatStream: vi.fn(async () => completedTurn()),
      saveAgentConversation: save,
      cancelAgentChatStream: vi.fn()
    }, { overviewDialogMode: 'chat' })

    await harness.runner.run({ inputOverride: 'Quick question' })

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'temporary',
      conversationId: null,
      selectedCourseRelativePath: null,
      selectedLessonPath: null
    }))
  })

  it('cancels a pending run before IPC cancellation and ignores its later terminal result', async () => {
    let resolveStream!: (done: AgentChatStreamDone) => void
    const stream = vi.fn(() => new Promise<AgentChatStreamDone>((resolve) => { resolveStream = resolve }))
    const cancel = vi.fn(async () => ({ canceled: true }))
    const save = vi.fn()
    const harness = makeHarness({ agentChatStream: stream, cancelAgentChatStream: cancel, saveAgentConversation: save })

    const running = harness.runner.run({ inputOverride: 'Stop this' })
    expect(harness.getState().pendingAgentConversation?.summary.id).toBe('pending-42')

    await harness.runner.cancel()
    expect(cancel).toHaveBeenCalledWith('pending-42')
    expect(harness.getState()).toMatchObject({ agentChatBusy: false, pendingAgentConversation: null, activeConversationId: null })
    expect(harness.getState().agentTurns.at(-1)?.processEvents?.at(-1)).toMatchObject({ status: 'canceled' })

    resolveStream({ streamId: 'pending-42', canceled: true })
    await running
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps the visible conversation and streamed process when a run reaches the tool limit', async () => {
    const toolLimitMessage = '工具调用上限已用完，generate_lesson 尚未执行，所以课程尚未生成。请重试，或在设置里提高工具调用上限。'
    const harness = makeHarness({
      agentChatStream: vi.fn(async (_payload, onChunk, onStatus, onTool) => {
        onStatus({ streamId: 'pending-42', status: 'thinking', message: '正在规划课程' })
        onChunk({ streamId: 'pending-42', channel: 'reasoning', delta: '先分析学习目标。' })
        onTool({
          streamId: 'pending-42',
          toolCall: { id: 'tool-ask', name: 'ask', arguments: '{"questions":[]}' }
        })
        onTool({
          streamId: 'pending-42',
          toolCall: { id: 'tool-ask', name: 'ask', arguments: '{"questions":[]}' },
          result: '{"answers":[]}'
        })
        return { streamId: 'pending-42', error: true, message: toolLimitMessage }
      }),
      saveAgentConversation: vi.fn(),
      cancelAgentChatStream: vi.fn()
    })

    await harness.runner.run({ inputOverride: '为我生成课程' })

    expect(harness.getState()).toMatchObject({
      error: `user:${toolLimitMessage}`,
      agentChatBusy: false,
      activeConversationId: 'pending-42',
      agentStatus: ''
    })
    expect(harness.getState().pendingAgentConversation).toMatchObject({
      summary: { id: 'pending-42' },
      status: toolLimitMessage
    })
    expect(harness.getState().agentTurns).toEqual([
      expect.objectContaining({ id: 'u-42', role: 'user', content: '为我生成课程' }),
      expect.objectContaining({
        id: 'a-42',
        role: 'assistant',
        processEvents: expect.arrayContaining([
          expect.objectContaining({ kind: 'reasoning', detail: '先分析学习目标。' }),
          expect.objectContaining({ kind: 'elicitation_resolved', toolCallId: 'tool-ask' }),
          expect.objectContaining({ status: 'error', detail: toolLimitMessage })
        ])
      })
    ])
  })


  it('durably saves a failed lesson-generation turn so navigation cannot discard the conversation', async () => {
    const toolLimitMessage = '课程尚未生成：本轮未能完成正式生成。当前对话和规划内容已保留，请继续发送“生成课程”重试。'
    const save = vi.fn(async (payload) => ({
      state: appState(workspace({
        conversations: [{
          id: 'conversation-failed',
          title: 'AI 课程规划',
          createdAt,
          updatedAt: createdAt,
          relativePath: '.agent-sessions/conversations/conversation-failed.json',
          absolutePath: '/workspace/.agent-sessions/conversations/conversation-failed.json',
          messageCount: payload.turns.length
        }]
      })),
      conversation: {
        id: 'conversation-failed',
        title: 'AI 课程规划',
        createdAt,
        updatedAt: createdAt,
        relativePath: '.agent-sessions/conversations/conversation-failed.json',
        absolutePath: '/workspace/.agent-sessions/conversations/conversation-failed.json',
        messageCount: payload.turns.length,
        branch: {
          sessionId: 'session-tree-1',
          branchId: 'branch-conversation-failed',
          revision: 1,
          status: 'active' as const
        }
      }
    }))
    const harness = makeHarness({
      agentChatStream: vi.fn(async (_payload, onChunk) => {
        onChunk({ streamId: 'pending-42', channel: 'reasoning', delta: '已完成课程规划。' })
        return { streamId: 'pending-42', error: true, message: toolLimitMessage }
      }),
      saveAgentConversation: save,
      cancelAgentChatStream: vi.fn()
    })

    await harness.runner.run({ inputOverride: '生成课程' })

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      mode: 'teaching',
      conversationId: null,
      turns: [
        expect.objectContaining({ id: 'u-42', role: 'user', content: '生成课程' }),
        expect.objectContaining({
          id: 'a-42',
          role: 'assistant',
          processEvents: expect.arrayContaining([
            expect.objectContaining({ kind: 'reasoning', detail: '已完成课程规划。' }),
            expect.objectContaining({ status: 'error', detail: toolLimitMessage })
          ])
        })
      ]
    }))
    expect(save.mock.calls[0][0]).not.toHaveProperty('runId')
    expect(harness.getState()).toMatchObject({
      error: `user:${toolLimitMessage}`,
      agentChatBusy: false,
      activeConversationId: 'conversation-failed',
      activeConversationScope: 'workspace',
      activeConversationRevision: 1,
      pendingAgentConversation: null
    })
    expect(harness.getState().appState.activeWorkspace?.conversations).toEqual([
      expect.objectContaining({ id: 'conversation-failed' })
    ])
  })

  it('retries a failed pending turn on its original persisted conversation branch', async () => {
    const originalConversation = {
      id: 'conversation-7',
      title: 'Mechanics',
      createdAt,
      updatedAt: createdAt,
      relativePath: '.agent-sessions/conversations/conversation-7.json',
      absolutePath: '/workspace/.agent-sessions/conversations/conversation-7.json',
      messageCount: 2
    }
    const activeWorkspace = workspace({ conversations: [originalConversation] })
    const stream = vi.fn()
      .mockResolvedValueOnce({ streamId: 'pending-42', error: true, message: 'temporary failure' })
      .mockResolvedValueOnce({ streamId: 'pending-42', error: true, message: 'second temporary failure' })
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: vi.fn(),
      cancelAgentChatStream: vi.fn()
    }, {
      appState: appState(activeWorkspace),
      activeConversationId: 'conversation-7',
      activeConversationScope: 'workspace',
      activeConversationRevision: 3,
      activeSessionTree: sessionTree('conversation-7', 3),
      agentTurns: [
        { id: 'u-prior', role: 'user', content: 'Prior question', createdAt },
        { id: 'a-prior', role: 'assistant', content: 'Prior answer', createdAt }
      ]
    })

    await harness.runner.run({ inputOverride: '生成课程' })
    expect(harness.getState().activeConversationId).toBe('pending-42')

    await harness.runner.run({ inputOverride: '重试生成课程' })

    expect(stream).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId: 'conversation-7',
        expectedBranchRevision: 3,
        messages: [
          { role: 'user', content: 'Prior question' },
          { role: 'assistant', content: 'Prior answer' },
          { role: 'user', content: '生成课程' }
        ],
        messageTurnIds: ['u-prior', 'a-prior', 'u-42']
      }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )
  })

  it('keeps the reconciled pending conversation recoverable when durable saving fails', async () => {
    const harness = makeHarness({
      agentChatStream: vi.fn(async () => completedTurn()),
      saveAgentConversation: vi.fn(async () => { throw new Error('disk full') }),
      cancelAgentChatStream: vi.fn()
    })

    await harness.runner.run({ inputOverride: 'Explain momentum' })

    expect(harness.getState()).toMatchObject({
      error: 'user:disk full',
      agentChatBusy: false,
      activeConversationId: 'pending-42',
      agentStatus: ''
    })
    expect(harness.getState().pendingAgentConversation).toMatchObject({
      summary: { id: 'pending-42' },
      status: '保存对话…',
      toolsSupported: true
    })
  })

  it('queues follow-up while busy with closed-copy ack and does not start a second stream', async () => {
    const gate = deferredDone()
    const stream = vi.fn(async () => {
      await gate.promise
      return completedTurn()
    })
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: vi.fn(async ({ turns, conversationId }) => ({
        state: appState(),
        conversation: {
          id: conversationId ?? 'conversation-1',
          title: 'Physics',
          createdAt,
          updatedAt: createdAt,
          relativePath: '.agent-sessions/conversations/conversation-1.json',
          absolutePath: '/workspace/.agent-sessions/conversations/conversation-1.json',
          messageCount: turns.length
        }
      })),
      cancelAgentChatStream: vi.fn()
    })

    const first = harness.runner.run({ inputOverride: 'first turn' })
    await Promise.resolve()
    expect(harness.getState().agentChatBusy).toBe(true)
    expect(stream).toHaveBeenCalledTimes(1)

    await harness.runner.run({ inputOverride: 'queued follow-up' })
    expect(stream).toHaveBeenCalledTimes(1)
    expect(harness.getState()).toMatchObject({
      agentBusyAckMessage: AGENT_SESSION_BUSY_QUEUED_ACK,
      agentBusyFollowUpQueue: [{ text: 'queued follow-up' }]
    })

    gate.resolve()
    await first

    expect(stream).toHaveBeenCalledTimes(2)
    expect(stream.mock.calls[1][0]).toEqual(expect.objectContaining({
      userInput: 'queued follow-up'
    }))
    expect(harness.getState()).toMatchObject({
      agentChatBusy: false,
      agentBusyAckMessage: null,
      agentBusyFollowUpQueue: []
    })
  })

  it('clears busy follow-up queue on cancel and does not drain after cancel', async () => {
    const gate = deferredDone()
    const stream = vi.fn(async () => {
      await gate.promise
      return { streamId: 'pending-42', canceled: true as const }
    })
    const cancel = vi.fn(async () => ({ canceled: true as const }))
    const harness = makeHarness({
      agentChatStream: stream,
      saveAgentConversation: vi.fn(),
      cancelAgentChatStream: cancel
    })

    const first = harness.runner.run({ inputOverride: 'live' })
    await Promise.resolve()
    await harness.runner.run({ inputOverride: 'should-drop' })
    expect(harness.getState().agentBusyFollowUpQueue).toHaveLength(1)

    await harness.runner.cancel()
    expect(cancel).toHaveBeenCalled()
    expect(harness.getState()).toMatchObject({
      agentBusyFollowUpQueue: [],
      agentBusyAckMessage: null
    })

    gate.resolve()
    await first
    // Still only the original stream; no drain of dropped follow-up.
    expect(stream).toHaveBeenCalledTimes(1)
  })

})
