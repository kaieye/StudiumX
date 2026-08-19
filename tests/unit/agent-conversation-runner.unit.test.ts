import { describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_BUSY_QUEUED_ACK } from '../../src/shared/agent-session-busy-ack'
import { selectPendingAsk } from '../../src/renderer/src/agent-conversation-state'
import { openLessonReaderContext } from '../../src/renderer/src/app-shell/contextTransitions'
import { projectTeachingWorkspaceNavigator } from '../../src/renderer/src/app-shell/teaching-workspace-navigator-state'
import {
  AgentConversationTurnRunner,
  type AgentConversationTurnRunnerApi,
  type AgentConversationTurnRunnerPatch,
  type AgentConversationTurnRunnerState
} from '../../src/renderer/src/app-shell/agent-conversation-runner'
import type {
  AgentConversationSessionTree,
  AgentRealtimeEvent,
  LessonSummary,
  TeachingAppState,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'

type TestState = AgentConversationTurnRunnerState & { error: string | null }
type TestApi = Partial<AgentConversationTurnRunnerApi>

type Harness = {
  getState: () => TestState
  setState: (patch: Partial<TestState>) => void
  patches: Array<AgentConversationTurnRunnerPatch<string>>
  runner: AgentConversationTurnRunner<string>
  event: (event: AgentRealtimeEvent) => void
}

const createdAt = '2026-08-03T10:00:00.000Z'
const requestIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
]

function workspace(overrides: Partial<TeachingWorkspaceSummary> = {}): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1', name: 'Physics', rootPath: '/workspace', missionPath: '/workspace/MISSION.md',
    resourcesPath: '/workspace/resources', lessonsDir: '/workspace/lessons', recordsDir: '/workspace/records',
    referenceDir: '/workspace/reference', reviewsDir: '/workspace/reviews', createdAt, updatedAt: createdAt,
    missionTitle: 'Physics', missionExcerpt: 'Learn physics', courses: [], fileTree: [], conversations: [],
    resources: [], records: [], lessons: [], referenceCount: 0, assetsReady: true, git: null, ...overrides
  }
}

function appState(activeWorkspace = workspace()): TeachingAppState {
  return {
    workspaces: [activeWorkspace], activeWorkspace, temporaryConversations: [], previewHtml: '', previewUrl: '',
    selectedLessonPath: '/workspace/lessons/mechanics/session-1.md',
    runtime: { status: 'idle', currentStep: '', queuedTasks: 0, providerLabel: '' }, recentChangeSummary: null
  }
}

function sessionTree(conversationId = 'conversation-7', revision = 7): AgentConversationSessionTree {
  return {
    schemaVersion: 1, sessionId: 'session-tree-1', openBranchId: `branch-${conversationId}`,
    branches: [{ sessionId: 'session-tree-1', branchId: `branch-${conversationId}`, conversationId,
      title: 'Momentum', status: 'active', revision,
      head: { turnId: 'a-prior', turnCount: 2, updatedAt: createdAt },
      relativePath: `.agent-sessions/conversations/${conversationId}.json`, isOpen: true }]
  }
}

function conversation(conversationId = 'conversation-7', revision = 8) {
  return {
    id: conversationId, title: 'Momentum', createdAt, updatedAt: createdAt,
    relativePath: `.agent-sessions/conversations/${conversationId}.json`, absolutePath: `/workspace/.agent-sessions/conversations/${conversationId}.json`,
    messageCount: 4,
    branch: { schemaVersion: 1 as const, sessionId: 'session-tree-1', branchId: `branch-${conversationId}`, revision, status: 'active' as const },
    turns: [
      { id: 'u-prior', role: 'user' as const, content: 'Prior question', createdAt },
      { id: 'a-prior', role: 'assistant' as const, content: 'Prior answer', createdAt },
      { id: 'u-42', role: 'user' as const, content: 'Continue the branch', createdAt },
      { id: 'a-42', role: 'assistant' as const, content: 'Host answer', createdAt }
    ]
  }
}

function makeHarness(api: TestApi, overrides: Partial<TestState> = {}): Harness {
  let state: TestState = {
    appState: appState(), overviewDialogMode: 'teaching', agentInput: 'unused input', agentChatBusy: false,
    agentBusyAckMessage: null, agentBusyFollowUpQueue: [], agentStatus: '', agentTurns: [], activeConversationId: null,
    activeConversationScope: null, activeConversationRevision: null, activeSessionTree: null, agentToolsSupported: null,
    pendingAgentConversation: null, selectedCourseRelativePath: 'courses/mechanics', taskPrompt: 'previous prompt', error: null,
    ...overrides
  }
  let handler: ((event: AgentRealtimeEvent) => void) | undefined
  const runnerApi: AgentConversationTurnRunnerApi = {
    submitConversationTurn: vi.fn(async () => ({ code: 'started', activeTurnId: 'turn-1', streamId: 'host-stream-1' })),
    onAgentChatEvent: vi.fn((next) => { handler = next; return () => { handler = undefined } }),
    cancelConversationTurn: vi.fn(async () => ({
      code: 'cancelled', cancelledActiveTurnId: 'turn-1', clearedQueuedCount: 0
    })),
    readAgentConversation: vi.fn(async ({ conversationId }) => conversation(conversationId)),
    readAgentConversationSessionTree: vi.fn(async ({ conversationId }) => sessionTree(conversationId, 8)),
    getState: vi.fn(async () => state.appState),
    ...api
  }
  const patches: Array<AgentConversationTurnRunnerPatch<string>> = []
  let requestIndex = 0
  const runner = new AgentConversationTurnRunner<string>({
    getState: () => state,
    setState: (patch) => { patches.push(patch); state = { ...state, ...patch } },
    getApi: () => runnerApi,
    toUserError: (error) => `user:${error instanceof Error ? error.message : String(error)}`,
    onGeneratedLessons: (_lessons: LessonSummary[]) => undefined,
    now: () => createdAt,
    nextIdSeed: () => 42,
    nextClientRequestId: () => requestIds[requestIndex++]!
  })
  return {
    getState: () => state,
    setState: (patch) => { state = { ...state, ...patch } },
    patches,
    runner,
    event: (event) => handler?.(event)
  }
}

function collectSidebarPaths(node: { relativePath: string; children?: Array<{ relativePath: string; children?: unknown[] }> }): string[] {
  return [
    node.relativePath,
    ...(node.children ?? []).flatMap((child) => collectSidebarPaths(child as typeof node))
  ]
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AgentConversationTurnRunner ADR-0004 host submission', () => {
  it('submits canonical continuation with the observed revision, scoped target, UUID idempotency key, skills, and follow-up delivery', async () => {
    const submit = vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-7', streamId: 'host-stream-7', conversationId: 'conversation-7' }))
    const harness = makeHarness({ submitConversationTurn: submit }, {
      activeConversationId: 'conversation-7', activeConversationScope: 'workspace', activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7),
      agentTurns: [
        { id: 'u-prior', role: 'user', content: 'Prior question', createdAt },
        { id: 'a-prior', role: 'assistant', content: 'Prior answer', createdAt }
      ]
    })

    await harness.runner.run({ inputOverride: ' Continue the branch ', skillIds: ['physics'] })

    expect(submit).toHaveBeenCalledWith({
      target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-7' },
      clientRequestId: '11111111-1111-4111-8111-111111111111', text: 'Continue the branch', mode: 'teaching',
      delivery: 'follow_up', expectedBranchRevision: 7, skillIds: ['physics']
    })
    expect(harness.getState()).toMatchObject({ agentChatBusy: true, activeConversationId: 'pending-42' })
  })

  it('submits a new temporary turn with a discriminated pending target and no invented branch revision', async () => {
    const submit = vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-new', streamId: 'host-stream-new' }))
    const harness = makeHarness({ submitConversationTurn: submit }, { overviewDialogMode: 'chat' })

    await harness.runner.run({ inputOverride: 'Quick question' })

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'pending', workspaceId: 'workspace-1', scope: 'temporary', pendingConversationId: 'pending-42' },
      text: 'Quick question', mode: 'temporary', delivery: 'follow_up'
    }))
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('expectedBranchRevision')
  })

  it('retains the host runtime stream id for Ask replies while projecting into the local pending draft', async () => {
    const submit = vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-ask', streamId: 'host-stream-ask', conversationId: 'conversation-7' }))
    const harness = makeHarness({ submitConversationTurn: submit }, {
      activeConversationId: 'conversation-7', activeConversationScope: 'workspace', activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7)
    })

    await harness.runner.run({ inputOverride: 'Ask me which direction to take' })
    harness.event({
      sequence: 1,
      streamId: 'host-stream-ask',
      kind: 'tool',
      createdAt,
      payload: {
        streamId: 'host-stream-ask',
        toolCall: {
          id: 'ask-call-1',
          name: 'ask',
          arguments: JSON.stringify({
            questions: [{ id: 'direction', question: 'Choose a direction', options: [{ label: 'A' }, { label: 'B' }] }]
          })
        }
      }
    })

    const pending = harness.getState().pendingAgentConversation
    expect(pending?.runtimeStreamId).toBe('host-stream-ask')
    expect(selectPendingAsk(harness.getState().agentTurns, pending?.runtimeStreamId ?? pending?.summary.id ?? '')).toMatchObject({
      streamId: 'host-stream-ask',
      toolCallId: 'ask-call-1'
    })
  })

  it('projects host realtime events for a started stream and refreshes instead of renderer-saving on completion', async () => {
    const submit = vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-7', streamId: 'host-stream-7', conversationId: 'conversation-7' }))
    const read = vi.fn(async () => conversation('conversation-7', 8))
    const harness = makeHarness({ submitConversationTurn: submit, readAgentConversation: read }, {
      activeConversationId: 'conversation-7', activeConversationScope: 'workspace', activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7), agentTurns: [{ id: 'u-prior', role: 'user', content: 'Prior question', createdAt }]
    })

    await harness.runner.run({ inputOverride: 'Continue the branch' })
    harness.event({ sequence: 1, streamId: 'host-stream-7', kind: 'status', createdAt, payload: { streamId: 'host-stream-7', status: 'answering' } })
    harness.event({ sequence: 2, streamId: 'host-stream-7', kind: 'chunk', createdAt, payload: { streamId: 'host-stream-7', delta: 'Host ' } })
    harness.event({ sequence: 3, streamId: 'host-stream-7', kind: 'chunk', createdAt, payload: { streamId: 'host-stream-7', delta: 'answer' } })
    expect(harness.getState().agentTurns.at(-1)).toMatchObject({ content: 'Host answer' })

    harness.event({ sequence: 4, streamId: 'host-stream-7', kind: 'terminal', createdAt, outcome: 'done' })
    await flush()

    expect(read).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'conversation-7', scope: 'workspace' })
    expect(harness.getState()).toMatchObject({ agentChatBusy: false, pendingAgentConversation: null, activeConversationRevision: 8 })
    expect(harness.getState().appState.activeWorkspace?.conversations).toEqual([
      expect.objectContaining({ id: 'conversation-7', title: 'Momentum', messageCount: 4 })
    ])
  })

  it('keeps the streamed turn visible when the terminal transcript read returns a stale snapshot', async () => {
    const submit = vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-7', streamId: 'host-stream-7', conversationId: 'conversation-7' }))
    const staleConversation = {
      ...conversation('conversation-7', 7),
      messageCount: 2,
      turns: conversation('conversation-7', 7).turns.slice(0, 2)
    }
    const read = vi.fn(async () => staleConversation)
    const harness = makeHarness({ submitConversationTurn: submit, readAgentConversation: read }, {
      activeConversationId: 'conversation-7', activeConversationScope: 'workspace', activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7), agentTurns: staleConversation.turns
    })

    await harness.runner.run({ inputOverride: 'Continue the branch' })
    harness.event({ sequence: 1, streamId: 'host-stream-7', kind: 'chunk', createdAt, payload: { streamId: 'host-stream-7', delta: 'Host answer' } })
    expect(harness.getState().agentTurns.slice(-2)).toMatchObject([
      { role: 'user', content: 'Continue the branch' },
      { role: 'assistant', content: 'Host answer' }
    ])

    harness.event({ sequence: 2, streamId: 'host-stream-7', kind: 'terminal', createdAt, outcome: 'done' })
    await flush()

    expect(harness.getState()).toMatchObject({
      agentChatBusy: false,
      pendingAgentConversation: null,
      activeConversationId: 'conversation-7'
    })
    expect(harness.getState().agentTurns.slice(-2)).toMatchObject([
      { role: 'user', content: 'Continue the branch' },
      { role: 'assistant', content: 'Host answer' }
    ])
  })

  it('keeps a canonical completed conversation cataloged when the session tree is temporarily unavailable', async () => {
    const submit = vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-7', streamId: 'host-stream-7', conversationId: 'conversation-7' }))
    const readTree = vi.fn(async () => { throw new Error('session tree is not ready yet') })
    const harness = makeHarness({ submitConversationTurn: submit, readAgentConversationSessionTree: readTree }, {
      activeConversationId: 'conversation-7', activeConversationScope: 'workspace', activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7), agentTurns: [{ id: 'u-prior', role: 'user', content: 'Prior question', createdAt }]
    })

    await harness.runner.run({ inputOverride: 'Continue the branch' })
    harness.event({ sequence: 1, streamId: 'host-stream-7', kind: 'terminal', createdAt, outcome: 'done' })
    await flush()

    expect(harness.getState()).toMatchObject({ agentChatBusy: false, pendingAgentConversation: null })
    expect(harness.getState().appState.activeWorkspace?.conversations).toEqual([
      expect.objectContaining({ id: 'conversation-7', title: 'Momentum', messageCount: 4 })
    ])
  })

  it('settles the optimistic conversation and refreshes the workspace catalog when terminal transcript reads are temporarily unavailable', async () => {
    const submit = vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-7', streamId: 'host-stream-7', conversationId: 'conversation-7' }))
    const refreshedAppState = appState(workspace({ name: 'Physics with generated lesson' }))
    const read = vi.fn(async () => { throw new Error('transcript is not ready yet') })
    const readTree = vi.fn(async () => { throw new Error('session tree is not ready yet') })
    const getState = vi.fn(async () => refreshedAppState)
    const harness = makeHarness({
      submitConversationTurn: submit,
      readAgentConversation: read,
      readAgentConversationSessionTree: readTree,
      getState
    }, {
      activeConversationId: 'conversation-7', activeConversationScope: 'workspace', activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7), agentTurns: [{ id: 'u-prior', role: 'user', content: 'Prior question', createdAt }]
    })

    await harness.runner.run({ inputOverride: 'Generate the lesson' })
    harness.event({ sequence: 1, streamId: 'host-stream-7', kind: 'chunk', createdAt, payload: { streamId: 'host-stream-7', delta: '课程已生成。' } })
    harness.event({ sequence: 2, streamId: 'host-stream-7', kind: 'terminal', createdAt, outcome: 'done' })
    await flush()

    expect(getState).toHaveBeenCalledOnce()
    expect(harness.getState()).toMatchObject({
      appState: {
        activeWorkspace: {
          name: 'Physics with generated lesson',
          conversations: [expect.objectContaining({ id: 'conversation-7' })]
        }
      },
      agentChatBusy: false,
      pendingAgentConversation: null,
      activeConversationId: 'conversation-7'
    })
    expect(harness.getState().agentTurns.at(-1)).toMatchObject({ content: '课程已生成。' })
  })

  it('keeps a newly completed course session in the sidebar after opening its generated file when catalog reads are stale', async () => {
    const generatedLesson = {
      id: 'lesson-1',
      courseRelativePath: 'courses/mechanics',
      title: 'Momentum lesson',
      relativePath: 'courses/mechanics/lessons/momentum.html',
      absolutePath: '/workspace/courses/mechanics/lessons/momentum.html',
      createdAt,
      updatedAt: createdAt,
      completed: false,
      pinned: false
    }
    const courseWorkspace = workspace({
      courses: [{
        id: 'mechanics',
        name: 'Mechanics',
        relativePath: 'courses/mechanics',
        absolutePath: '/workspace/courses/mechanics',
        lessonCount: 1,
        sessionCount: 1,
        sessions: [{ id: 'session-1', lesson: generatedLesson, status: 'active', updatedAt: createdAt }],
        conversations: []
      }],
      lessons: [generatedLesson]
    })
    const staleCatalogState = appState(courseWorkspace)
    const submit = vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-new', streamId: 'host-stream-new', conversationId: 'conversation-new' }))
    const harness = makeHarness({
      submitConversationTurn: submit,
      readAgentConversation: vi.fn(async () => { throw new Error('transcript is not ready yet') }),
      readAgentConversationSessionTree: vi.fn(async () => { throw new Error('session tree is not ready yet') }),
      getState: vi.fn(async () => staleCatalogState)
    }, {
      appState: staleCatalogState,
      selectedCourseRelativePath: 'courses/mechanics'
    })

    await harness.runner.run({ inputOverride: 'Generate a momentum lesson' })
    harness.event({ sequence: 1, streamId: 'host-stream-new', kind: 'chunk', createdAt, payload: { streamId: 'host-stream-new', delta: '课程已生成。' } })
    harness.event({ sequence: 2, streamId: 'host-stream-new', kind: 'terminal', createdAt, outcome: 'done' })
    await flush()

    const settled = harness.getState()
    const fileSelection = openLessonReaderContext({
      appState: settled.appState,
      workspace: settled.appState.activeWorkspace!,
      previewFile: {
        title: generatedLesson.title,
        relativePath: generatedLesson.relativePath,
        absolutePath: generatedLesson.absolutePath
      },
      previewHtml: '<p>Momentum</p>',
      courseRelativePath: generatedLesson.courseRelativePath
    })
    const navigator = projectTeachingWorkspaceNavigator({
      workspaces: fileSelection.appState.workspaces,
      activeWorkspace: fileSelection.appState.activeWorkspace,
      temporaryConversations: fileSelection.appState.temporaryConversations,
      pendingAgentConversation: settled.pendingAgentConversation,
      showAllCourseFiles: false
    })
    const sidebarPaths = navigator.workspaceFolders.flatMap(({ node }) => collectSidebarPaths(node))

    expect(fileSelection.activeConversationId).toBeNull()
    expect(settled.pendingAgentConversation).toBeNull()
    expect(sidebarPaths).toContain('courses/mechanics/conversation/2026/08/conversation-new.md')
  })

  it('submits a busy follow-up to the host, mirrors queued UX, and never locally drains after the active stream settles', async () => {
    const submit = vi.fn()
      .mockResolvedValueOnce({ code: 'started', activeTurnId: 'turn-1', streamId: 'host-stream-1', conversationId: 'conversation-7' })
      .mockResolvedValueOnce({ code: 'queued', queuePosition: 1, activeTurnId: 'turn-1' })
    const harness = makeHarness({ submitConversationTurn: submit })

    await harness.runner.run({ inputOverride: 'First question' })
    await harness.runner.run({ inputOverride: 'Follow up', skillIds: ['physics'] })

    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[1]![0]).toMatchObject({ target: { kind: 'pending', pendingConversationId: 'pending-42' }, text: 'Follow up', delivery: 'follow_up', skillIds: ['physics'] })
    expect(harness.getState()).toMatchObject({ agentInput: '', agentBusyAckMessage: AGENT_SESSION_BUSY_QUEUED_ACK, agentBusyFollowUpQueue: [expect.objectContaining({ text: 'Follow up' })] })

    harness.event({ sequence: 1, streamId: 'host-stream-1', kind: 'terminal', createdAt, outcome: 'done' })
    await flush()
    expect(submit).toHaveBeenCalledTimes(2)
    expect(harness.getState().agentBusyFollowUpQueue).toEqual([expect.objectContaining({ text: 'Follow up' })])
  })

  it('binds a queued receipt to its host lifecycle event, creates a safe projection, and settles the queued stream', async () => {
    const submit = vi.fn()
      .mockResolvedValueOnce({ code: 'started', activeTurnId: 'turn-1', streamId: 'host-stream-1', conversationId: 'conversation-7' })
      .mockResolvedValueOnce({ code: 'queued', queuePosition: 1, activeTurnId: 'turn-1' })
    const read = vi.fn(async () => conversation('conversation-7', 9))
    const harness = makeHarness({ submitConversationTurn: submit, readAgentConversation: read })
    const imageAttachment = {
      id: 'image-1',
      name: 'diagram.png',
      mimeType: 'image/png' as const,
      dataBase64: 'iVBORw0KGgo=',
      sizeBytes: 8
    }

    await harness.runner.run({ inputOverride: 'First question' })
    await harness.runner.run({ inputOverride: 'Queued question', imageAttachments: [imageAttachment] })
    expect(harness.getState().agentBusyFollowUpQueue).toEqual([
      expect.objectContaining({
        text: 'Queued question',
        imageAttachments: [imageAttachment],
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        target: { kind: 'pending', workspaceId: 'workspace-1', scope: 'workspace', pendingConversationId: 'pending-42' }
      })
    ])

    // A lifecycle event for another renderer/request never creates a draft.
    harness.event({ sequence: 0, streamId: 'other-stream', kind: 'conversation_turn_started', createdAt, activeTurnId: 'turn-other', clientRequestId: 'not-ours', conversationId: 'conversation-7' })
    expect(harness.getState().agentBusyFollowUpQueue).toHaveLength(1)

    // Simulate the first owner having completed elsewhere. This renderer has no
    // canonical transcript to reuse, so queued activation must start a fresh,
    // local-only projection rather than fabricate one from unrelated state.
    harness.setState({ agentChatBusy: false, pendingAgentConversation: null, activeConversationId: null, agentTurns: [] })
    harness.event({ sequence: 0, streamId: 'queued-stream-2', kind: 'conversation_turn_started', createdAt, activeTurnId: 'turn-2', clientRequestId: '22222222-2222-4222-8222-222222222222', conversationId: 'conversation-7' })
    expect(harness.getState()).toMatchObject({ agentChatBusy: true, activeConversationId: 'pending-43', agentBusyFollowUpQueue: [] })
    expect(harness.getState().agentTurns).toMatchObject([
      { role: 'user', content: 'Queued question', imageAttachments: [imageAttachment] },
      { role: 'assistant', content: '' }
    ])

    harness.event({ sequence: 1, streamId: 'queued-stream-2', kind: 'chunk', createdAt, payload: { streamId: 'queued-stream-2', delta: 'Queued answer' } })
    harness.event({ sequence: 2, streamId: 'queued-stream-2', kind: 'terminal', createdAt, outcome: 'done' })
    await flush()

    expect(read).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'conversation-7', scope: 'workspace' })
    expect(harness.getState()).toMatchObject({ agentChatBusy: false, pendingAgentConversation: null, activeConversationId: 'conversation-7' })
  })

  it('cancels exactly the stream announced for a queued receipt', async () => {
    const submit = vi.fn()
      .mockResolvedValueOnce({ code: 'started', activeTurnId: 'turn-1', streamId: 'host-stream-1', conversationId: 'conversation-7' })
      .mockResolvedValueOnce({ code: 'queued', queuePosition: 1, activeTurnId: 'turn-1' })
    const cancel = vi.fn(async () => ({
      code: 'cancelled' as const, cancelledActiveTurnId: 'turn-2', clearedQueuedCount: 0
    }))
    const harness = makeHarness({ submitConversationTurn: submit, cancelConversationTurn: cancel })

    await harness.runner.run({ inputOverride: 'First question' })
    await harness.runner.run({ inputOverride: 'Queued question' })
    harness.setState({ agentChatBusy: false, pendingAgentConversation: null, activeConversationId: null, agentTurns: [] })
    harness.event({ sequence: 0, streamId: 'queued-stream-cancel', kind: 'conversation_turn_started', createdAt, activeTurnId: 'turn-2', clientRequestId: '22222222-2222-4222-8222-222222222222', conversationId: 'conversation-7' })

    await harness.runner.cancel()
    expect(cancel).toHaveBeenCalledWith({
      target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-7' },
      clientRequestId: '33333333-3333-4333-8333-333333333333',
      expectedActiveTurnId: 'turn-2'
    })
    harness.event({ sequence: 1, streamId: 'queued-stream-cancel', kind: 'terminal', createdAt, outcome: 'canceled' })
    await flush()
    expect(harness.getState()).toMatchObject({
      agentChatBusy: false,
      pendingAgentConversation: expect.objectContaining({ status: '已中止' })
    })
  })

  it('refreshes safely without replaying or surfacing a raw revision conflict when host requires refresh', async () => {
    const submit = vi.fn(async () => ({ code: 'refresh_required' as const, reason: 'stale_branch' as const }))
    const harness = makeHarness({ submitConversationTurn: submit }, {
      activeConversationId: 'conversation-7', activeConversationScope: 'workspace', activeConversationRevision: 7,
      activeSessionTree: sessionTree('conversation-7', 7)
    })
    const refresh = vi.fn(async () => harness.setState({
      activeConversationId: 'conversation-7', activeConversationScope: 'workspace', activeConversationRevision: 8,
      activeSessionTree: sessionTree('conversation-7', 8), pendingAgentConversation: null, agentChatBusy: false
    }))
    const runner = new AgentConversationTurnRunner<string>({
      getState: harness.getState, setState: harness.setState, getApi: () => ({
        submitConversationTurn: submit, cancelConversationTurn: vi.fn(async () => ({
          code: 'rejected' as const, reason: 'lane_unavailable' as const
        })), onAgentChatEvent: vi.fn(() => () => undefined),
        readAgentConversation: vi.fn(), readAgentConversationSessionTree: vi.fn(), getState: vi.fn()
      }),
      toUserError: (error) => `user:${String(error)}`, onGeneratedLessons: vi.fn(), onRevisionConflict: refresh,
      now: () => createdAt, nextIdSeed: () => 42, nextClientRequestId: () => requestIds[0]!
    })

    await runner.run({ inputOverride: 'Continue safely' })

    expect(refresh).toHaveBeenCalledWith({ workspaceId: 'workspace-1', conversationId: 'conversation-7', scope: 'workspace' })
    expect(submit).toHaveBeenCalledOnce()
    expect(harness.getState()).toMatchObject({ agentInput: 'Continue safely', agentChatBusy: false, error: null })
  })

  it('preserves rejected input with learner-safe feedback and uses the returned host stream id for cancellation', async () => {
    const rejected = vi.fn(async () => ({ code: 'rejected' as const, reason: 'queue_full' as const }))
    const rejectedHarness = makeHarness({ submitConversationTurn: rejected })
    await rejectedHarness.runner.run({ inputOverride: 'Do not lose this' })
    expect(rejectedHarness.getState()).toMatchObject({ agentInput: 'Do not lose this', agentChatBusy: false, error: 'user:当前对话队列已满，请稍后再试。' })

    const cancel = vi.fn(async () => ({
      code: 'cancelled' as const, cancelledActiveTurnId: 'turn-1', clearedQueuedCount: 0
    }))
    const startedHarness = makeHarness({
      submitConversationTurn: vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-1', streamId: 'host-stream-cancel' })),
      cancelConversationTurn: cancel
    })
    await startedHarness.runner.run({ inputOverride: 'Stop this' })
    await startedHarness.runner.cancel()
    expect(cancel).toHaveBeenCalledWith({
      target: { kind: 'pending', workspaceId: 'workspace-1', scope: 'workspace', pendingConversationId: 'pending-42' },
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      expectedActiveTurnId: 'turn-1'
    })
  })

  it('does not duplicate local queued presentation for an idempotent queued disposition', async () => {
    const harness = makeHarness({ submitConversationTurn: vi.fn(async () => ({ code: 'duplicate' as const, originalCode: 'queued' as const })) }, {
      agentChatBusy: true,
      pendingAgentConversation: {
        workspaceId: 'workspace-1', sourceConversationId: null, sourceConversationRevision: null, mode: 'teaching',
        summary: { id: 'pending-42', title: 'Existing', createdAt, updatedAt: createdAt, messageCount: 2, relativePath: '', absolutePath: '', pending: true },
        turns: [], status: '思考中…', toolsSupported: null
      },
      activeConversationId: 'pending-42'
    })

    await harness.runner.run({ inputOverride: 'Already queued' })

    expect(harness.getState()).toMatchObject({ agentInput: '', agentBusyAckMessage: AGENT_SESSION_BUSY_QUEUED_ACK, agentBusyFollowUpQueue: [] })
  })

  it('retains the active projection when host cancellation is not accepted', async () => {
    const cancel = vi.fn(async () => ({
      code: 'refresh_required' as const,
      reason: 'active_turn_mismatch' as const
    }))
    const harness = makeHarness({ cancelConversationTurn: cancel })

    await harness.runner.run({ inputOverride: 'Keep this active' })
    await harness.runner.cancel()

    expect(cancel).toHaveBeenCalledWith({
      target: { kind: 'pending', workspaceId: 'workspace-1', scope: 'workspace', pendingConversationId: 'pending-42' },
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      expectedActiveTurnId: 'turn-1'
    })
    expect(harness.getState()).toMatchObject({
      agentChatBusy: true,
      pendingAgentConversation: expect.objectContaining({ summary: expect.objectContaining({ id: 'pending-42' }) }),
      error: 'user:当前对话状态已变化，请刷新后再试。'
    })

    harness.event({ sequence: 1, streamId: 'host-stream-1', kind: 'terminal', createdAt, outcome: 'canceled' })
    await flush()
    expect(harness.getState()).toMatchObject({
      agentChatBusy: false,
      pendingAgentConversation: expect.objectContaining({ status: '已中止' })
    })
  })

  it('keeps a resource terminal pending and does not project it as completed', async () => {
    const harness = makeHarness({})

    await harness.runner.run({ inputOverride: 'Use the explicit task budget' })
    harness.event({
      sequence: 2,
      streamId: 'host-stream-1',
      kind: 'terminal',
      createdAt,
      outcome: 'resource_limit',
      message: '已达到为本次任务明确设置的资源边界。'
    })
    await flush()

    expect(harness.getState()).toMatchObject({
      agentChatBusy: false,
      agentStatus: '已达到明确资源边界',
      pendingAgentConversation: expect.objectContaining({ status: '已达到明确资源边界' })
    })
    expect(harness.getState().pendingAgentConversation).not.toBeNull()
  })

  it.each([
    ['no_progress', '重复操作未产生安全进展；未自动重试或重放'],
    ['context_unrecoverable', '上下文无法安全压缩；请开始新的明确对话，或选择更大的 context window']
  ] as const)('keeps %s pending without refreshing it as a completed turn', async (outcome, status) => {
    const read = vi.fn(async ({ conversationId }: { conversationId: string }) => conversation(conversationId))
    const harness = makeHarness({ readAgentConversation: read })

    await harness.runner.run({ inputOverride: 'Do not automatically continue this turn' })
    harness.event({
      sequence: 2,
      streamId: 'host-stream-1',
      kind: 'terminal',
      createdAt,
      outcome,
      message: 'Host stopped safely.'
    })
    await flush()

    expect(read).not.toHaveBeenCalled()
    expect(harness.getState()).toMatchObject({
      agentChatBusy: false,
      agentStatus: status,
      pendingAgentConversation: expect.objectContaining({ status })
    })
  })

  it('settles a fast error terminal that arrives before the started disposition resolves', async () => {
    let resolveSubmit!: (value: {
      code: 'started'
      activeTurnId: string
      streamId: string
    }) => void
    const submit = vi.fn(() => new Promise<{
      code: 'started'
      activeTurnId: string
      streamId: string
    }>((resolve) => { resolveSubmit = resolve }))
    const harness = makeHarness({ submitConversationTurn: submit })

    const running = harness.runner.run({ inputOverride: 'Fail quickly' })
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce())
    harness.event({
      sequence: 1,
      streamId: 'host-stream-fast-error',
      kind: 'terminal',
      createdAt,
      outcome: 'error',
      message: 'Conversation turn failed before completion.'
    })
    resolveSubmit({ code: 'started', activeTurnId: 'turn-fast-error', streamId: 'host-stream-fast-error' })
    await running
    await flush()

    expect(harness.getState()).toMatchObject({
      agentChatBusy: false,
      error: 'user:Conversation turn failed before completion.',
      pendingAgentConversation: {
        status: 'Conversation turn failed before completion.',
        turns: expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            processEvents: expect.arrayContaining([
              expect.objectContaining({ status: 'error' })
            ])
          })
        ])
      }
    })
  })

  it('retains and surfaces a completed answer after a new temporary lane is promoted', async () => {
    const submit = vi.fn(async () => ({ code: 'started' as const, activeTurnId: 'turn-pending', streamId: 'host-stream-pending' }))
    const harness = makeHarness({ submitConversationTurn: submit })

    await harness.runner.run({ inputOverride: 'Ask pet question', mode: 'temporary' })
    expect(harness.getState().activeConversationId).toBe('pending-42')
    harness.event({ sequence: 1, streamId: 'host-stream-pending', kind: 'chunk', createdAt, payload: { streamId: 'host-stream-pending', delta: 'Pet ' } })
    harness.event({ sequence: 2, streamId: 'host-stream-pending', kind: 'chunk', createdAt, payload: { streamId: 'host-stream-pending', delta: 'answer' } })
    harness.event({ sequence: 3, streamId: 'host-stream-pending', kind: 'terminal', createdAt, outcome: 'done' })
    await flush()

    // The host has now saved + promoted the pending lane. The refreshed catalog
    // includes the temporary conversation and the lifecycle event names it so the
    // renderer can point the active projection at the saved conversation.
    harness.setState({
      appState: {
        ...appState(workspace()),
        temporaryConversations: [{
          id: 'temp-1', workspaceId: 'workspace-1', title: 'Ask pet question',
          createdAt, updatedAt: createdAt,
          relativePath: 'conversations/temp-1.md', absolutePath: '/workspace/conversations/temp-1.md',
          messageCount: 2,
          branch: { schemaVersion: 1, sessionId: 'temp-1', branchId: 'temp-1', revision: 1, status: 'active' }
        }]
      }
    })
    harness.event({ sequence: 0, streamId: 'host-stream-pending', kind: 'conversation_promoted', createdAt, conversationId: 'temp-1' })
    await flush()

    expect(harness.getState()).toMatchObject({
      agentChatBusy: false,
      pendingAgentConversation: null,
      activeConversationId: 'temp-1',
      activeConversationScope: 'temporary',
      activeConversationRevision: 1
    })
    expect(harness.getState().agentTurns.at(-1)).toMatchObject({ role: 'assistant', content: 'Pet answer' })
  })
})
