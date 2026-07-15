import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import type {
  AgentChatTurn,
  LessonSummary,
  TeachingAppState,
  TeachingSystemApi,
  TeachingWorkspaceSummary
} from '../../src/shared/teaching-types'

const originalState = useAppStore.getState()
const createdAt = '2026-07-15T08:00:00.000Z'

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

function lesson(id: string, relativePath = `courses/physics/${id}.html`): LessonSummary {
  return {
    id,
    title: `Lesson ${id}`,
    objective: 'Learn physics',
    prompt: 'Generate a lesson',
    createdAt,
    durationMinutes: 20,
    courseId: 'physics',
    courseName: 'Physics',
    courseRelativePath: 'courses/physics',
    courseAbsolutePath: '/workspace/courses/physics',
    sessionId: 'session-1',
    sessionName: 'Session 1',
    sessionRelativePath: 'courses/physics/session-1',
    sessionAbsolutePath: '/workspace/courses/physics/session-1',
    relativePath,
    absolutePath: `/workspace/${relativePath}`
  }
}

function completedAgentTurns(): AgentChatTurn[] {
  return [
    { id: 'user-1', role: 'user', content: 'Help me', createdAt },
    { id: 'assistant-1', role: 'assistant', content: 'Done', createdAt }
  ]
}

function successfulAgentApi(conversationId = 'conversation-1'): Partial<TeachingSystemApi> {
  return {
    agentChatStream: vi.fn(async () => ({ turns: completedAgentTurns(), toolsSupported: true })),
    saveAgentConversation: vi.fn(async (payload) => ({
      state: appState(),
      conversation: {
        id: conversationId,
        title: 'Completed conversation',
        createdAt,
        updatedAt: createdAt,
        relativePath: `.studiumx/agent-conversations/${conversationId}.json`,
        absolutePath: `/workspace/.studiumx/agent-conversations/${conversationId}.json`,
        messageCount: payload.turns.length
      }
    })),
    readAgentConversationSessionTree: vi.fn(async () => ({
      schemaVersion: 1,
      sessionId: 'session-1',
      rootConversationId: conversationId,
      activeConversationId: conversationId,
      branches: []
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
    taskPrompt: 'Generate a lesson',
    agentInput: 'Help me',
    agentTurns: [],
    activeConversationId: null,
    activeConversationScope: null,
    activeConversationRevision: null,
    activeSessionTree: null,
    agentChatBusy: false,
    pendingAgentConversation: null,
    generating: false,
    lessonGenerationRunId: null,
    agentPetNotificationResult: null,
    lessonGenerationPetNotificationResult: null,
    error: null,
    petNotificationErrors: []
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useAppStore.setState(originalState)
})

describe('appStore Pet operation error sources', () => {
  it('records a successful Agent result only after the same run saves its conversation', async () => {
    installApi(successfulAgentApi('conversation-1'))

    await useAppStore.getState().agentChat()

    expect(useAppStore.getState().agentPetNotificationResult).toMatchObject({
      runId: expect.stringMatching(/^pending-/),
      resultId: expect.stringMatching(/^pending-.*:conversation-1$/),
      targetId: 'conversation-1'
    })
  })

  it('does not reuse an Agent result identity across consecutive runs', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    installApi(successfulAgentApi('conversation-shared'))

    await useAppStore.getState().agentChat()
    const first = useAppStore.getState().agentPetNotificationResult
    useAppStore.setState({ activeConversationId: null, agentInput: 'Help again' })
    await useAppStore.getState().agentChat()
    const second = useAppStore.getState().agentPetNotificationResult

    expect(first?.runId).not.toBe(second?.runId)
    expect(first?.resultId).not.toBe(second?.resultId)
    expect(first?.targetId).toBe('conversation-shared')
    expect(second?.targetId).toBe('conversation-shared')
  })

  it.each([
    ['canceled', { canceled: true as const }],
    ['failed', { error: true as const, message: 'Agent unavailable' }]
  ])('does not record an Agent result when the run is %s', async (_label, done) => {
    useAppStore.setState({
      agentPetNotificationResult: {
        runId: 'old-run',
        resultId: 'old-run:old-conversation',
        targetId: 'old-conversation',
        createdAt: 1
      }
    })
    installApi({ agentChatStream: vi.fn(async () => done) })

    await useAppStore.getState().agentChat()

    expect(useAppStore.getState().agentPetNotificationResult).toBeNull()
  })

  it('records Agent runner failures with the pending conversation lifecycle id', async () => {
    installApi({
      agentChatStream: vi.fn(async () => ({ error: true as const, message: 'Agent unavailable' }))
    })

    await useAppStore.getState().agentChat()

    expect(useAppStore.getState().petNotificationErrors).toEqual([
      expect.objectContaining({
        source: 'agent',
        sourceId: expect.stringMatching(/^pending-/),
        error: expect.objectContaining({ message: 'Agent unavailable' })
      })
    ])
  })

  it('records lesson generation failures without classifying unrelated global errors', async () => {
    useAppStore.setState({
      selectedCoursePreviewFile: {
        title: 'Old preview',
        relativePath: 'courses/physics/old.html',
        absolutePath: '/workspace/courses/physics/old.html'
      },
      lessonGenerationPetNotificationResult: {
        runId: 'old-run',
        resultId: 'old-run:old-lesson',
        targetId: 'courses/physics/old.html',
        createdAt: 1
      }
    })
    installApi({
      generateLesson: vi.fn(async () => { throw new Error('Lesson unavailable') }),
      showNotification: vi.fn(async () => undefined)
    })

    await useAppStore.getState().generateLesson()

    expect(useAppStore.getState().petNotificationErrors).toEqual([
      expect.objectContaining({
        source: 'lesson-generation',
        sourceId: expect.stringMatching(/^workspace-1:/),
        error: expect.objectContaining({ message: 'Lesson unavailable' })
      })
    ])
    expect(useAppStore.getState().lessonGenerationPetNotificationResult).toBeNull()

    useAppStore.setState({ error: { message: 'Settings failed', severity: 'error' } })
    expect(useAppStore.getState().petNotificationErrors).toHaveLength(1)
  })

  it('associates a successful lesson result with the run that produced the new preview', async () => {
    const generated = lesson('lesson-1')
    installApi({
      generateLesson: vi.fn(async () => ({
        kind: 'lesson' as const,
        state: appState(),
        lesson: generated,
        source: 'ai' as const
      })),
      showNotification: vi.fn(async () => undefined)
    })

    await useAppStore.getState().generateLesson()

    expect(useAppStore.getState().lessonGenerationPetNotificationResult).toMatchObject({
      runId: expect.stringMatching(/^workspace-1:/),
      resultId: expect.stringMatching(/:lesson-1$/),
      targetId: generated.relativePath
    })
  })

  it('uses fresh run and result identities for consecutive lesson generations', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const generatedLessons = [lesson('lesson-1'), lesson('lesson-2')]
    installApi({
      generateLesson: vi.fn(async () => {
        const generated = generatedLessons.shift()!
        return {
          kind: 'lesson' as const,
          state: appState(),
          lesson: generated,
          source: 'ai' as const
        }
      }),
      showNotification: vi.fn(async () => undefined)
    })

    await useAppStore.getState().generateLesson()
    const first = useAppStore.getState().lessonGenerationPetNotificationResult
    await useAppStore.getState().generateLesson()
    const second = useAppStore.getState().lessonGenerationPetNotificationResult

    expect(first?.runId).not.toBe(second?.runId)
    expect(first?.resultId).toMatch(/:lesson-1$/)
    expect(second?.resultId).toMatch(/:lesson-2$/)
  })
})
