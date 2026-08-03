import { describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_BUSY_QUEUED_ACK } from '../../src/shared/agent-session-busy-ack'
import { selectPendingAsk } from '../../src/renderer/src/agent-conversation-state'
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

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AgentConversationTurnRunner ADR-0170 host submission', () => {
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

    await harness.runner.run({ inputOverride: 'First question' })
    await harness.runner.run({ inputOverride: 'Queued question' })
    expect(harness.getState().agentBusyFollowUpQueue).toEqual([
      expect.objectContaining({
        text: 'Queued question',
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
      { role: 'user', content: 'Queued question' },
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

})
