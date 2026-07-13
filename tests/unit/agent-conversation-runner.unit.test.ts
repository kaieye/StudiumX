import { describe, expect, it, vi } from 'vitest'
import {
  AgentConversationTurnRunner,
  type AgentConversationTurnRunnerApi,
  type AgentConversationTurnRunnerPatch,
  type AgentConversationTurnRunnerState
} from '../../src/renderer/src/app-shell/agent-conversation-runner'
import type {
  AgentChatStreamDone,
  AgentChatTurn,
  LessonSummary,
  TeachingAppState,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'

type TestState = AgentConversationTurnRunnerState & { error: string | null }

type Harness = {
  getState: () => TestState
  patches: Array<AgentConversationTurnRunnerPatch<string>>
  effects: LessonSummary[][]
  runner: AgentConversationTurnRunner<string>
}

const createdAt = '2026-07-14T10:00:00.000Z'

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
  api: AgentConversationTurnRunnerApi,
  overrides: Partial<TestState> = {}
): Harness {
  let state: TestState = {
    appState: appState(),
    overviewDialogMode: 'teaching',
    agentInput: 'unused input',
    agentChatBusy: false,
    agentStatus: '',
    agentTurns: [],
    activeConversationId: null,
    agentToolsSupported: null,
    pendingAgentConversation: null,
    selectedCourseRelativePath: 'courses/mechanics',
    taskPrompt: 'previous prompt',
    error: null,
    ...overrides
  }
  const patches: Array<AgentConversationTurnRunnerPatch<string>> = []
  const effects: LessonSummary[][] = []
  const runner = new AgentConversationTurnRunner<string>({
    getState: () => state,
    setState: (patch) => {
      patches.push(patch)
      state = { ...state, ...patch }
    },
    getApi: () => api,
    toUserError: (error) => `user:${error instanceof Error ? error.message : String(error)}`,
    onGeneratedLessons: (lessons) => effects.push(lessons),
    now: () => createdAt,
    nextIdSeed: () => 42
  })
  return { getState: () => state, patches, effects, runner }
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
      mode: 'teaching',
      conversationId: null,
      selectedCourseRelativePath: 'courses/mechanics',
      selectedLessonPath: '/workspace/lessons/mechanics/session-1.md'
    }))
    const savedTurns = save.mock.calls[0][0].turns as AgentChatTurn[]
    expect(savedTurns[1]).toMatchObject({ content: 'Saved answer' })
    expect(savedTurns[1].processEvents?.map((event) => event.kind)).toEqual(expect.arrayContaining([
      'status',
      'tool_call',
      'tool_result'
    ]))
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

  it('removes the optimistic assistant turn and exposes a classified error when streaming fails', async () => {
    const harness = makeHarness({
      agentChatStream: vi.fn(async () => { throw new Error('provider unavailable') }),
      saveAgentConversation: vi.fn(),
      cancelAgentChatStream: vi.fn()
    })

    await harness.runner.run({ inputOverride: 'Explain inertia' })

    expect(harness.getState()).toMatchObject({
      error: 'user:provider unavailable',
      agentChatBusy: false,
      pendingAgentConversation: null,
      activeConversationId: null
    })
    expect(harness.getState().agentTurns).toEqual([
      expect.objectContaining({ id: 'u-42', role: 'user', content: 'Explain inertia' })
    ])
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
})
