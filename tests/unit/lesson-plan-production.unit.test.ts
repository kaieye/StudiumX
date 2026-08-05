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

const researchPrompt = '请检索官方文档中当前版本的 API 使用方法，并给出引用来源。'

function request(workspaceToolAccessGranted: boolean, prompt = 'Teach the trust boundary.') {
  const settings = defaultSettings('C:/lesson-production-test')
  settings.tools.enabled = true
  settings.provider.providers[0]!.apiKey = 'test-key'
  return {
    workspace: { rootPath: 'C:/lesson-production-test/workspace', workspaceToolAccessGranted },
    mission: { title: 'Trust boundary', excerpt: 'Use the learner-provided context.' },
    prompt,
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

function resultText(result: Awaited<ReturnType<typeof produce>>): string {
  return [
    result.plan.title,
    result.plan.objective,
    ...result.plan.sections.flatMap((section) => [section.heading, section.body]),
    ...result.plan.keyPoints,
    ...result.plan.quiz.flatMap((quiz) => [quiz.question, quiz.explanation]),
    result.plan.referenceNotes,
    result.plan.learningRecordNote
  ].join('\n')
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

  it('uses one direct structured request for ordinary lessons without loading or running research tools', async () => {
    dependencies.callProvider.mockResolvedValueOnce({ text: JSON.stringify(validPlan) })

    const result = await produce(request(false))

    expect(result).toMatchObject({ source: 'ai', plan: validPlan })
    expect(dependencies.runAgentLoop).not.toHaveBeenCalled()
    expect(dependencies.buildDefaultRegistry).not.toHaveBeenCalled()
    expect(dependencies.buildToolContext).not.toHaveBeenCalled()
    expect(dependencies.callProvider).toHaveBeenCalledTimes(1)
  })

  it('respects the configured provider timeout instead of imposing a longer lesson timeout', async () => {
    dependencies.callProvider.mockResolvedValueOnce({ text: JSON.stringify(validPlan) })

    const result = await produce(request(false))

    expect(result.source).toBe('ai')
    const directRequest = dependencies.callProvider.mock.calls[0]![0] as { settings: { generator: { requestTimeoutMs: number } } }
    expect(directRequest.settings.generator.requestTimeoutMs).toBe(60_000)
  })

  it('respects the configured output-token budget instead of silently expanding it', async () => {
    dependencies.callProvider.mockResolvedValueOnce({ text: JSON.stringify(validPlan) })
    const prepared = request(false)
    prepared.settings.generator.maxOutputTokens = 4096

    const result = await produce(prepared)

    expect(result.source).toBe('ai')
    const directRequest = dependencies.callProvider.mock.calls[0]![0] as { settings: { generator: { maxOutputTokens: number } } }
    expect(directRequest.settings.generator.maxOutputTokens).toBe(4096)
  })

  it('uses one compact regeneration after an invalid direct response', async () => {
    dependencies.callProvider
      .mockResolvedValueOnce({ text: '首次输出不是 JSON。' })
      .mockResolvedValueOnce({ text: JSON.stringify(validPlan) })

    const result = await produce(request(false))

    expect(result).toMatchObject({ source: 'ai', plan: validPlan })
    expect(result.reason).toMatch(/紧凑重试/)
    expect(dependencies.runAgentLoop).not.toHaveBeenCalled()
    expect(dependencies.callProvider).toHaveBeenCalledTimes(2)
    expect(dependencies.callProvider.mock.calls[1]![0].request.userPrompt).toMatch(/上一次课程计划输出未通过 JSON 校验/)
  })

  it('falls back locally after the direct response and one compact regeneration both fail validation', async () => {
    dependencies.callProvider
      .mockResolvedValueOnce({ text: '首次输出不是 JSON。' })
      .mockResolvedValueOnce({ text: '紧凑重试仍不是 JSON。' })

    const prepared = request(false)
    prepared.prompt = [
      '基于教学对话中已澄清的学习任务生成一节短小 lesson。',
      '- 主题：公务员考试行测“言语理解与表达”中的逻辑填空（选词填空）解题技巧',
      '- 学习者背景：正确率已达到 75% 以上，想突破瓶颈',
      '- 学习目标：建立可复用的语境对应分析流程',
      '- 本节课要完成的动作：用五大语境对应关系讲透“先找语境对应、再精确辨析词语”的完整解题流程'
    ].join('\n')

    const result = await produce(prepared)

    expect(result.source).toBe('fallback')
    expect(result.reason).toMatch(/结构校验失败|本地学习任务模板/)
    expect(dependencies.callProvider).toHaveBeenCalledTimes(2)
    expect(resultText(result)).toMatch(/逻辑填空|言语理解|选词填空/)
    expect(resultText(result)).toContain('先找语境对应、再精确辨析词语')
    expect(resultText(result)).not.toMatch(/写出可执行的学习使命|StudiumX|MISSION\.md|learning-records|文件系统是真相来源/)
  })

  it('falls back locally after a provider request failure without starting more retries', async () => {
    dependencies.callProvider.mockRejectedValueOnce(new Error('network unavailable'))

    const result = await produce(request(false))

    expect(result.source).toBe('fallback')
    expect(result.reason).toContain('network unavailable')
    expect(dependencies.callProvider).toHaveBeenCalledTimes(1)
    expect(dependencies.runAgentLoop).not.toHaveBeenCalled()
  })

  it('keeps first-party lesson inputs but withholds workspace definitions, handlers, and root for an untrusted research lesson', async () => {
    const result = await produce(request(false, researchPrompt))

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

  it('does not attach aggregate budgets to nested research runs', async () => {
    const prepared = request(false, researchPrompt)
    await produce(prepared)

    const toolRequest = dependencies.runAgentLoop.mock.calls[0]![0] as Record<string, unknown>
    expect(toolRequest).not.toHaveProperty('maxIterations')
    expect(toolRequest).not.toHaveProperty('budget')
  })

  it('forwards the host-owned resource policy snapshot to nested research runs', async () => {
    const prepared = request(false, researchPrompt)
    prepared.resourceGovernance = {
      deploymentPolicy: {
        limits: [{
          meter: 'provider_transport_attempts',
          limit: 2,
          scope: 'deployment',
          auditId: 'managed-lesson-research-attempts'
        }]
      }
    }

    await produce(prepared)

    const toolRequest = dependencies.runAgentLoop.mock.calls[0]![0] as {
      resourceGovernor?: { audit: () => unknown }
    }
    expect(toolRequest.resourceGovernor).toEqual(expect.objectContaining({
      audit: expect.any(Function)
    }))
    expect(toolRequest.resourceGovernor!.audit()).toMatchObject({
      configured: expect.arrayContaining([expect.objectContaining({
        layer: 'deployment_policy',
        meter: 'provider_transport_attempts',
        limit: 2,
        scope: 'deployment'
      })])
    })
  })

  it('retains the workspace-backed nested lesson production path after trust is granted for a research lesson', async () => {
    const prepared = request(true, researchPrompt)
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

  it('propagates a nested resource terminal instead of retrying or publishing a local fallback lesson', async () => {
    dependencies.runAgentLoop.mockResolvedValueOnce({
      finalText: JSON.stringify(validPlan),
      stopReason: 'resource_limit',
      usage: {
        providerCalls: 1,
        toolCalls: 0,
        toolErrors: 0,
        iterations: 1,
        childRuns: 0,
        durationMs: 250,
        resourceGovernance: {
          configured: [{
            layer: 'user_budget',
            meter: 'provider_transport_attempts',
            limit: 1,
            scope: 'task',
            auditId: 'user-budget-1'
          }],
          terminal: {
            layer: 'user_budget',
            meter: 'provider_transport_attempts',
            used: 1,
            limit: 1,
            scope: 'task',
            auditId: 'user-budget-1',
            action: 'resource_limit'
          }
        }
      }
    })

    await expect(produce(request(false, researchPrompt))).rejects.toMatchObject({
      name: 'LessonGenerationResourceTerminalError',
      stopReason: 'resource_limit',
      terminal: expect.objectContaining({
        meter: 'provider_transport_attempts',
        used: 1,
        limit: 1,
        scope: 'task'
      })
    })
    expect(dependencies.callProvider).not.toHaveBeenCalled()
    expect(dependencies.runAgentLoop).toHaveBeenCalledTimes(1)
  })


  it('does not publish a local fallback when the direct structured response reaches an explicit total-token boundary', async () => {
    dependencies.callProvider.mockResolvedValueOnce({
      text: JSON.stringify(validPlan),
      usage: { totalTokens: 5 }
    })
    const prepared = request(false)
    prepared.resourceGovernance = {
      userBudget: {
        limits: [{ meter: 'total_tokens', limit: 5, scope: 'task', auditId: 'direct-total-boundary' }]
      }
    }

    await expect(produce(prepared)).rejects.toMatchObject({
      name: 'LessonGenerationResourceTerminalError',
      stopReason: 'resource_limit',
      terminal: expect.objectContaining({ meter: 'total_tokens', used: 5, limit: 5 })
    })
    expect(dependencies.callProvider).toHaveBeenCalledTimes(1)
  })

  it('keeps component-only provider usage as local observability instead of charging a total-token boundary', async () => {
    dependencies.callProvider.mockResolvedValueOnce({
      text: JSON.stringify(validPlan),
      usage: { promptTokens: 1, completionTokens: 1 }
    })
    const prepared = request(false)
    prepared.resourceGovernance = {
      userBudget: {
        limits: [{ meter: 'total_tokens', limit: 2, scope: 'task', auditId: 'components-not-quota' }]
      }
    }

    await expect(produce(prepared)).resolves.toMatchObject({ source: 'ai', plan: validPlan })
  })

  it('aggregates explicit totals from the initial direct request and compact retry', async () => {
    dependencies.callProvider
      .mockResolvedValueOnce({ text: '首次输出不是 JSON。', usage: { totalTokens: 5 } })
      .mockResolvedValueOnce({ text: JSON.stringify(validPlan), usage: { totalTokens: 5 } })
    const prepared = request(false)
    prepared.resourceGovernance = {
      userBudget: {
        limits: [{ meter: 'total_tokens', limit: 10, scope: 'task', auditId: 'initial-and-compact-totals' }]
      }
    }

    await expect(produce(prepared)).rejects.toMatchObject({
      name: 'LessonGenerationResourceTerminalError',
      stopReason: 'resource_limit',
      terminal: expect.objectContaining({
        meter: 'total_tokens',
        used: 10,
        limit: 10,
        auditId: 'initial-and-compact-totals'
      })
    })
    expect(dependencies.callProvider).toHaveBeenCalledTimes(2)
  })

  it('aggregates research and direct explicit totals in separate child lanes', async () => {
    dependencies.runAgentLoop.mockImplementationOnce(async (input: {
      resourceGovernor: { consume: (meter: 'total_tokens', amount: number) => void }
    }) => {
      input.resourceGovernor.consume('total_tokens', 5)
      return { finalText: '工具输出不是 JSON。', stopReason: 'error', usage: {} }
    })
    dependencies.callProvider.mockResolvedValueOnce({ text: JSON.stringify(validPlan), usage: { totalTokens: 5 } })
    const prepared = request(false, researchPrompt)
    prepared.resourceGovernance = {
      userBudget: {
        limits: [{ meter: 'total_tokens', limit: 10, scope: 'task', auditId: 'research-and-direct-totals' }]
      }
    }

    await expect(produce(prepared)).rejects.toMatchObject({
      name: 'LessonGenerationResourceTerminalError',
      stopReason: 'resource_limit',
      terminal: expect.objectContaining({
        meter: 'total_tokens',
        used: 10,
        limit: 10,
        auditId: 'research-and-direct-totals'
      })
    })
    expect(dependencies.runAgentLoop).toHaveBeenCalledTimes(1)
    expect(dependencies.callProvider).toHaveBeenCalledTimes(1)
  })

  it('preflights the compact retry against the same direct-action governor instead of falling back after a resource terminal', async () => {
    dependencies.callProvider.mockResolvedValueOnce({ text: '首次输出不是 JSON。' })
    const prepared = request(false)
    prepared.resourceGovernance = {
      userBudget: {
        limits: [{ meter: 'logical_requests', limit: 1, scope: 'task', auditId: 'one-direct-request' }]
      }
    }

    await expect(produce(prepared)).rejects.toMatchObject({
      name: 'LessonGenerationResourceTerminalError',
      stopReason: 'resource_limit',
      terminal: expect.objectContaining({ meter: 'logical_requests', used: 1, limit: 1 })
    })
    expect(dependencies.callProvider).toHaveBeenCalledTimes(1)
  })

  it('shares one governor between tool-enabled research and a direct fallback request', async () => {
    dependencies.runAgentLoop.mockImplementationOnce(async (input: {
      resourceGovernor: { claim: (meter: 'provider_transport_attempts') => void }
    }) => {
      input.resourceGovernor.claim('provider_transport_attempts')
      return { finalText: '工具输出不是 JSON。', stopReason: 'error', usage: {} }
    })
    let directDispatches = 0
    dependencies.callProvider.mockImplementationOnce(async (input: {
      beforeTransportDispatch?: () => void | Promise<void>
    }) => {
      await input.beforeTransportDispatch?.()
      directDispatches += 1
      return { text: JSON.stringify(validPlan) }
    })
    const prepared = request(false, researchPrompt)
    prepared.resourceGovernance = {
      userBudget: {
        limits: [{ meter: 'provider_transport_attempts', limit: 1, scope: 'task', auditId: 'shared-research-and-direct' }]
      }
    }

    await expect(produce(prepared)).rejects.toMatchObject({
      name: 'LessonGenerationResourceTerminalError',
      stopReason: 'resource_limit',
      terminal: expect.objectContaining({ meter: 'provider_transport_attempts', used: 1, limit: 1 })
    })
    expect(dependencies.runAgentLoop).toHaveBeenCalledTimes(1)
    // The facade is entered so its adapter preflight can reject the dispatch;
    // no provider request is simulated after the shared boundary is reached.
    expect(dependencies.callProvider).toHaveBeenCalledTimes(1)
    expect(directDispatches).toBe(0)
  })

  it('keeps the no-provider fallback aligned with the explicit lesson brief instead of emitting StudiumX onboarding content', async () => {
    dependencies.resolveActiveProvider.mockReturnValueOnce(null)

    const prepared = request(false)
    prepared.sequence = 1
    prepared.mission = {
      title: '搭建个人化 AI 教学系统的第一版工作流',
      excerpt: '旧工作区使命，不应覆盖本轮明确的课程请求。'
    }
    prepared.prompt = [
      '基于教学对话中已澄清的学习任务生成一节短小 lesson。',
      '- 主题：公务员考试行测“言语理解与表达”中的逻辑填空（选词填空）解题技巧',
      '- 学习者背景：正确率已达到 75% 以上，想突破瓶颈',
      '- 学习目标：建立可复用的语境对应分析流程',
      '- 本节课要完成的动作：用五大语境对应关系讲透“先找语境对应、再精确辨析词语”的完整解题流程'
    ].join('\n')

    const result = await produce(prepared)

    expect(result.source).toBe('fallback')
    expect(resultText(result)).toMatch(/逻辑填空|言语理解|选词填空/)
    expect(resultText(result)).toContain('先找语境对应、再精确辨析词语')
    expect(resultText(result)).not.toMatch(/写出可执行的学习使命|StudiumX|MISSION\.md|learning-records|文件系统是真相来源/)
  })
})
