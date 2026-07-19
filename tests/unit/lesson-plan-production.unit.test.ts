import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultSettings } from '../../src/main/teaching-settings'

const dependencies = vi.hoisted(() => ({
  callProvider: vi.fn(),
  resolveActiveProvider: vi.fn(),
  runAgentLoop: vi.fn(),
  streamProvider: vi.fn(),
  toolsSupportedForFormat: vi.fn(),
  buildDefaultRegistry: vi.fn(),
  buildToolContext: vi.fn(),
  handlerContexts: [] as Array<{ workspaceRoot?: string }>
}))

vi.mock('../../src/main/ai/provider-adapter', () => ({
  callProvider: dependencies.callProvider,
  ProviderAdapterError: class ProviderAdapterError extends Error {},
  resolveActiveProvider: dependencies.resolveActiveProvider,
  streamProvider: dependencies.streamProvider,
  toolsSupportedForFormat: dependencies.toolsSupportedForFormat
}))
vi.mock('../../src/main/ai/agent-loop', () => ({ runAgentLoop: dependencies.runAgentLoop }))
vi.mock('../../src/main/ai/tools/registry', () => ({
  buildDefaultRegistry: dependencies.buildDefaultRegistry,
  buildToolContext: dependencies.buildToolContext
}))

const { produce } = await import('../../src/main/lesson-plan-production')

const workspaceReadTool = { type: 'function', function: { name: 'read_workspace_file' } }
const webSearchTool = { type: 'function', function: { name: 'web_search' } }
const validPlan = {
  title: 'Trust boundary lesson',
  objective: 'Keep first-party lesson inputs while removing untrusted workspace file access.',
  durationMinutes: 15,
  sections: [{ heading: 'Boundary', body: 'The lesson output remains available.' }],
  keyPoints: ['Lesson inputs are retained.', 'Workspace tools require trust.'],
  quiz: [],
  flashcards: [],
  referenceNotes: '',
  learningRecordNote: ''
}

function request(workspaceToolAccessGranted: boolean) {
  const settings = defaultSettings('C:/lesson-production-test')
  settings.tools.enabled = true
  settings.tools.maxIterations = 2
  settings.provider.providers[0]!.apiKey = 'test-key'
  return {
    workspace: { rootPath: 'C:/lesson-production-test/workspace', workspaceToolAccessGranted },
    mission: { title: 'Trust boundary', excerpt: 'Use the learner-provided context.' },
    prompt: 'Teach the trust boundary.',
    sequence: 2,
    settings,
    systemPrompt: 'FIRST_PARTY_MEMORY_INPUT',
    userPrompt: 'FIRST_PARTY_LESSON_INPUT',
    callbacks: {}
  }
}

function toolNames(tools: unknown[]): string[] {
  return tools.map((tool) => (tool as { function: { name: string } }).function.name)
}

describe('nested lesson plan production workspace access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dependencies.handlerContexts.length = 0
    dependencies.resolveActiveProvider.mockReturnValue({ apiKey: 'test-key' })
    dependencies.toolsSupportedForFormat.mockReturnValue(true)
    dependencies.buildToolContext.mockImplementation((_settings, options: { workspaceRoot?: string } = {}) => ({
      workspaceRoot: options.workspaceRoot
    }))
    dependencies.buildDefaultRegistry.mockImplementation((_settings, options: { workspaceRoot?: string } = {}) => {
      const workspaceEnabled = Boolean(options.workspaceRoot)
      return {
        definitions: () => workspaceEnabled ? [workspaceReadTool, webSearchTool] : [webSearchTool],
        handlerMap: (context: { workspaceRoot?: string }) => {
          dependencies.handlerContexts.push(context)
          return workspaceEnabled
            ? { read_workspace_file: vi.fn(), web_search: vi.fn() }
            : { web_search: vi.fn() }
        }
      }
    })
    dependencies.runAgentLoop.mockResolvedValue({ finalText: JSON.stringify(validPlan) })
  })

  it('keeps first-party lesson inputs but withholds workspace definitions, handlers, and root for an untrusted workspace', async () => {
    const result = await produce(request(false))

    expect(result).toMatchObject({ source: 'ai', plan: validPlan })
    expect(dependencies.buildDefaultRegistry).toHaveBeenCalledWith(expect.anything(), {})
    expect(dependencies.buildToolContext).toHaveBeenCalledWith(expect.anything(), {})

    const providerRequest = dependencies.runAgentLoop.mock.calls[0]![0] as {
      messages: Array<{ content: string }>
      tools: unknown[]
      toolHandlers: Record<string, unknown>
    }
    expect(providerRequest.messages).toEqual([
      { role: 'system', content: expect.stringContaining('FIRST_PARTY_MEMORY_INPUT') },
      { role: 'user', content: 'FIRST_PARTY_LESSON_INPUT' }
    ])
    expect(toolNames(providerRequest.tools)).toEqual(['web_search'])
    expect(providerRequest.toolHandlers).toEqual({ web_search: expect.any(Function) })
    expect(dependencies.handlerContexts).toEqual([{ workspaceRoot: undefined }])
  })

  it('retains the established workspace-backed nested lesson production path after trust is granted', async () => {
    const prepared = request(true)
    const result = await produce(prepared)

    expect(result).toMatchObject({ source: 'ai', plan: validPlan })
    expect(dependencies.buildDefaultRegistry).toHaveBeenCalledWith(expect.anything(), {
      workspaceRoot: prepared.workspace.rootPath
    })
    expect(dependencies.buildToolContext).toHaveBeenCalledWith(expect.anything(), {
      workspaceRoot: prepared.workspace.rootPath
    })

    const providerRequest = dependencies.runAgentLoop.mock.calls[0]![0] as {
      tools: unknown[]
      toolHandlers: Record<string, unknown>
    }
    expect(toolNames(providerRequest.tools)).toEqual(['read_workspace_file', 'web_search'])
    expect(providerRequest.toolHandlers).toEqual({
      read_workspace_file: expect.any(Function),
      web_search: expect.any(Function)
    })
    expect(dependencies.handlerContexts).toEqual([{ workspaceRoot: prepared.workspace.rootPath }])
  })
})
