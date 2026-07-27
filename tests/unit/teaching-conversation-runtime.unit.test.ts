import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentRunStore } from '../../src/main/ai/agent-run-store'
import { ToolRegistry, type ToolContext } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'
import { runTeachingConversationTurn } from '../../src/main/teaching-conversation-runtime'
import type { LessonSummary, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const originalFetch = globalThis.fetch
const createdRoots: string[] = []

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function configuredSettings(root: string): TeachingSettingsV1 {
  const settings = defaultSettings(root)
  const provider = settings.provider.providers[0]!
  provider.baseUrl = 'https://provider.example/v1'
  provider.apiKey = 'sk-temporary-tools-fixture'
  provider.endpointFormat = 'chat_completions'
  settings.provider.activeProviderId = provider.id
  settings.generator.providerId = provider.id
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 1_000
  settings.tools.enabled = true
  settings.tools.webSearch = true
  settings.tools.webFetch = true
  return settings
}


function fixtureCoreTeachingKernelReference() {
  return {
    id: 'teach' as const,
    name: 'teach',
    source: 'builtin-skills/teach/SKILL.md',
    content: '# Teach\n\nApp-shipped Teaching Kernel fixture for runtime tests (ADR-0151).\n'
  }
}

describe('temporary conversation runtime tool availability', () => {
  it('offers configured web tools without exposing workspace tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-temporary-tools-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    const requests: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return jsonResponse({ choices: [{ message: { content: '临时会话已完成。' } }] })
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'temporary-tools-run',
        workspaceId: 'workspace-1',
        conversationId: 'temporary-conversation-1',
        mode: 'temporary',
        messages: [],
        userInput: '请查一下今天的 AI 新闻。'
      },
      {
        streamId: 'temporary-tools-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      {
        id: 'workspace-1',
        name: 'Fixture workspace',
        rootPath: root,
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
        workspaceToolAccessGranted: true
      },
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => { throw new Error('memory should not be created') },
        loadSkillReferences: async () => [],
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )

    expect(result).toMatchObject({ finalText: '临时会话已完成。', toolsSupported: true })
    const tools = requests[0]?.tools as Array<{ function: { name: string } }> | undefined
    expect(tools?.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(['web_search', 'web_fetch']))
    const toolNames = tools?.map((tool) => tool.function.name) ?? []
    // Temporary chat shares agent tools except teaching-product writers / ungranted workspace tools
    // (ADR-0128 §5.4); delegation remains available when tools are enabled.
    for (const forbiddenToolName of [
      'read_workspace_file',
      'list_workspace',
      'write_workspace_file',
      'generate_lesson',
      'memory_search',
      'remember_teaching_memory',
      'forget_teaching_memory'
    ]) {
      expect(toolNames).not.toContain(forbiddenToolName)
    }
    expect(JSON.stringify(requests[0]?.messages?.[0])).toContain('web_search')
  })

  it('executes a temporary web search and forwards its tool lifecycle to the stream', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-temporary-tool-execution-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    const toolEvents = vi.fn()
    const providerBodies: Array<Record<string, unknown>> = []
    let providerCalls = 0
    globalThis.fetch = (async (input, init) => {
      const url = String(input)
      if (url.startsWith('https://provider.example/')) {
        providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        providerCalls += 1
        return providerCalls === 1
          ? jsonResponse({
              choices: [{
                message: {
                  content: null,
                  tool_calls: [{
                    id: 'temporary-search-call',
                    type: 'function',
                    function: { name: 'web_search', arguments: '{\"query\":\"StudiumX\"}' }
                  }]
                }
              }]
            })
          : jsonResponse({ choices: [{ message: { content: '已完成公开网页检索。' } }] })
      }
      if (url.startsWith('https://lite.duckduckgo.com/')) {
        return new Response('<html><body>no matching result</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'temporary-web-search-run',
        workspaceId: 'workspace-1',
        conversationId: 'temporary-conversation-2',
        mode: 'temporary',
        messages: [],
        userInput: '今年的四六级成绩什么时候出？'
      },
      {
        streamId: 'temporary-web-search-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: toolEvents
      },
      {
        id: 'workspace-1',
        name: 'Fixture workspace',
        rootPath: root,
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
        workspaceToolAccessGranted: true
      },
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => { throw new Error('memory should not be created') },
        loadSkillReferences: async () => [],
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )

    expect(result).toMatchObject({ finalText: '已完成公开网页检索。', toolsSupported: true })
    expect(providerCalls).toBe(2)
    expect(providerBodies[0]?.tool_choice).toEqual({
      type: 'function',
      function: { name: 'web_search' }
    })
    expect(toolEvents).toHaveBeenCalledWith(expect.objectContaining({
      toolCall: expect.objectContaining({ id: 'temporary-search-call', name: 'web_search' })
    }))
    expect(toolEvents).toHaveBeenCalledWith(expect.objectContaining({
      toolCall: expect.objectContaining({ id: 'temporary-search-call', name: 'web_search' }),
      result: expect.any(String)
    }))
    const assistantTurn = 'turns' in result ? result.turns.at(-1) : undefined
    expect(assistantTurn?.toolCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'temporary-search-call', name: 'web_search' })
    ]))
  })

  it('recovers with a required web search when the model answers a fresh-fact question without calling a tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-temporary-search-recovery-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    const providerBodies: Array<Record<string, unknown>> = []
    let providerCalls = 0
    globalThis.fetch = (async (input, init) => {
      const url = String(input)
      if (url.startsWith('https://provider.example/')) {
        providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        providerCalls += 1
        if (providerCalls === 1) {
          // Simulate the original failure: the model replies directly despite a
          // fresh-fact question that must be verified online.
          return jsonResponse({ choices: [{ message: { content: '通常考试后不久公布。' } }] })
        }
        if (providerCalls === 2) {
          return jsonResponse({
            choices: [{
              message: {
                content: null,
                tool_calls: [{
                  id: 'recovered-search-call',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query":"2026年大学英语四六级成绩公布时间"}' }
                }]
              }
            }]
          })
        }
        return jsonResponse({ choices: [{ message: { content: '已根据公开信息完成核实。' } }] })
      }
      if (url.startsWith('https://lite.duckduckgo.com/')) {
        return new Response('<html><body>search result</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'temporary-search-recovery-run',
        workspaceId: 'workspace-1',
        conversationId: 'temporary-conversation-3',
        mode: 'temporary',
        messages: [],
        userInput: '今年的四六级成绩什么时候出？'
      },
      {
        streamId: 'temporary-search-recovery-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      {
        id: 'workspace-1',
        name: 'Fixture workspace',
        rootPath: root,
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
        workspaceToolAccessGranted: true
      },
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => { throw new Error('memory should not be created') },
        loadSkillReferences: async () => [],
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )

    expect(result).toMatchObject({ finalText: '已根据公开信息完成核实。', toolsSupported: true })
    expect(providerCalls).toBe(3)
    expect(providerBodies[0]?.tool_choice).toEqual({ type: 'function', function: { name: 'web_search' } })
    expect(providerBodies[1]?.tool_choice).toEqual({ type: 'function', function: { name: 'web_search' } })
    const assistantTurn = 'turns' in result ? result.turns.at(-1) : undefined
    expect(assistantTurn?.toolCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'recovered-search-call', name: 'web_search' })
    ]))
  })

})


const workspaceFileToolNames = [
  'list_workspace',
  'read_workspace_file',
  'search_workspace',
  'glob_workspace',
  'write_workspace_file'
]

function workspaceToolNames(request: Record<string, unknown> | undefined): string[] {
  return ((request?.tools as Array<{ function: { name: string } }> | undefined) ?? [])
    .map((tool) => tool.function.name)
}

function fixtureWorkspace(root: string, workspaceToolAccessGranted: boolean) {
  return {
    id: 'workspace-1',
    name: 'Fixture workspace',
    rootPath: root,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    workspaceToolAccessGranted
  }
}

function fixtureLesson(root: string): LessonSummary {
  return {
    id: 'lesson-1',
    title: 'Fixture lesson',
    objective: 'Verify lesson tool availability.',
    prompt: 'Fixture lesson prompt',
    createdAt: '2026-07-17T00:00:00.000Z',
    durationMinutes: 30,
    courseId: 'course-1',
    courseName: 'Fixture course',
    courseRelativePath: 'courses/fixture',
    courseAbsolutePath: root,
    sessionId: 'session-1',
    sessionName: 'Fixture session',
    sessionRelativePath: 'learning-sessions/session-1',
    sessionAbsolutePath: root,
    relativePath: 'lessons/fixture.md',
    absolutePath: root
  }
}

describe('teaching workspace trust runtime boundary', () => {
  it('fails closed for untrusted workspace file tool definitions, handlers, and ToolContext while retaining lessons and memory scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-untrusted-workspace-tools-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    settings.memory.enabled = false
    const requests: Array<Record<string, unknown>> = []
    const handlerNames: string[][] = []
    const handlerContexts: ToolContext[] = []
    const listMemories = vi.fn(async () => [])
    const originalHandlerMap = ToolRegistry.prototype.handlerMap
    const handlerMapSpy = vi.spyOn(ToolRegistry.prototype, 'handlerMap').mockImplementation(
      function (this: ToolRegistry, ctx: ToolContext) {
        handlerNames.push(this.names())
        handlerContexts.push(ctx)
        return originalHandlerMap.call(this, ctx)
      }
    )
    let providerCalls = 0
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      providerCalls += 1
      if (providerCalls === 1) {
        return jsonResponse({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: 'untrusted-read-call',
                type: 'function',
                function: { name: 'read_workspace_file', arguments: '{"path":"secret.txt"}' }
              }]
            }
          }]
        })
      }
      return jsonResponse({ choices: [{ message: { content: '已在受限工作区中继续教学。' } }] })
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'untrusted-workspace-tools-run',
        workspaceId: 'workspace-1',
        conversationId: 'teaching-conversation-untrusted',
        mode: 'teaching',
        messages: [],
        userInput: '请简要总结当前课程目标。'
      },
      {
        streamId: 'untrusted-workspace-tools-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      fixtureWorkspace(root, false),
      {
        loadSettings: async () => settings,
        listMemories,
        createMemory: async () => { throw new Error('memory should not be created') },
        loadSkillReferences: async () => [fixtureCoreTeachingKernelReference()],
        generateLessonFromBrief: async () => fixtureLesson(root),
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )
    handlerMapSpy.mockRestore()

    expect(result).toMatchObject({ finalText: '已在受限工作区中继续教学。', toolsSupported: true })
    expect(listMemories).toHaveBeenCalledWith(root)
    expect(workspaceToolNames(requests[0])).toContain('generate_lesson')
    for (const name of workspaceFileToolNames) {
      expect(workspaceToolNames(requests[0])).not.toContain(name)
      expect(handlerNames[0]).not.toContain(name)
    }
    expect(handlerContexts[0]?.workspaceRoot).toBeUndefined()
    const toolMessages = (requests[1]?.messages as Array<{ role: string; content?: string }> | undefined) ?? []
    expect(toolMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', content: expect.stringContaining('未知工具：read_workspace_file') })
    ]))
  })

  it('keeps trusted teaching workspace file tool definitions, handlers, and ToolContext root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-trusted-workspace-tools-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    settings.memory.enabled = false
    const requests: Array<Record<string, unknown>> = []
    const handlerNames: string[][] = []
    const handlerContexts: ToolContext[] = []
    const originalHandlerMap = ToolRegistry.prototype.handlerMap
    const handlerMapSpy = vi.spyOn(ToolRegistry.prototype, 'handlerMap').mockImplementation(
      function (this: ToolRegistry, ctx: ToolContext) {
        handlerNames.push(this.names())
        handlerContexts.push(ctx)
        return originalHandlerMap.call(this, ctx)
      }
    )
    let providerCalls = 0
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      providerCalls += 1
      if (providerCalls === 1) {
        return jsonResponse({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: 'trusted-list-call',
                type: 'function',
                function: { name: 'list_workspace', arguments: '{"path":"."}' }
              }]
            }
          }]
        })
      }
      return jsonResponse({ choices: [{ message: { content: '已查看可信工作区。' } }] })
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'trusted-workspace-tools-run',
        workspaceId: 'workspace-1',
        conversationId: 'teaching-conversation-trusted',
        mode: 'teaching',
        messages: [],
        userInput: '列出工作区内容。'
      },
      {
        streamId: 'trusted-workspace-tools-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      fixtureWorkspace(root, true),
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => { throw new Error('memory should not be created') },
        loadSkillReferences: async () => [fixtureCoreTeachingKernelReference()],
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )
    handlerMapSpy.mockRestore()

    expect(result).toMatchObject({ finalText: '已查看可信工作区。', toolsSupported: true })
    expect(workspaceToolNames(requests[0])).toEqual(expect.arrayContaining(workspaceFileToolNames))
    expect(handlerNames[0]).toEqual(expect.arrayContaining(workspaceFileToolNames))
    expect(handlerContexts[0]?.workspaceRoot).toBe(root)
    const toolMessages = (requests[1]?.messages as Array<{ role: string; content?: string }> | undefined) ?? []
    expect(toolMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', content: expect.stringContaining('"root": "."') })
    ]))
  })
})

describe('teaching conversation memory catalog platform degradation', () => {
  it('continues chat without memory tools when memory is disabled (capability-off path)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-memory-unavailable-chat-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    settings.memory.enabled = false
    const requests: Array<Record<string, unknown>> = []
    // Catalog load may still probe listMemories when the host profile is available;
    // tools remain unregistered while memory is disabled.
    const listMemories = vi.fn(async () => [])
    const createMemory = vi.fn(async () => {
      throw new Error('memory must not be created when memory is disabled')
    })
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return jsonResponse({ choices: [{ message: { content: '平台记忆不可用时仍可正常对话。' } }] })
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'memory-unavailable-chat-run',
        workspaceId: 'workspace-1',
        conversationId: 'teaching-conversation-memory-unavailable',
        mode: 'teaching',
        messages: [],
        userInput: '请继续教学，不要因为记忆目录失败而中断。'
      },
      {
        streamId: 'memory-unavailable-chat-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      fixtureWorkspace(root, true),
      {
        loadSettings: async () => settings,
        listMemories,
        createMemory,
        loadSkillReferences: async () => [fixtureCoreTeachingKernelReference()],
        generateLessonFromBrief: async () => fixtureLesson(root),
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )

    expect(result).toMatchObject({
      finalText: '平台记忆不可用时仍可正常对话。',
      toolsSupported: true
    })
    expect(createMemory).not.toHaveBeenCalled()
    const toolNames = ((requests[0]?.tools as Array<{ function: { name: string } }> | undefined) ?? [])
      .map((tool) => tool.function.name)
    expect(toolNames).not.toContain('memory_search')
    expect(toolNames).not.toContain('remember_teaching_memory')
    expect(toolNames).not.toContain('forget_teaching_memory')
  })
})


describe('teaching conversation core kernel fail-closed (ADR-0151)', () => {
  it('fails closed when teaching mode skill references omit reserved teach kernel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-kernel-missing-refs-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    settings.memory.enabled = false
    globalThis.fetch = (async () => {
      throw new Error('provider must not be called when Teaching Kernel is missing')
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'kernel-missing-refs-run',
        workspaceId: 'workspace-1',
        conversationId: 'teaching-conversation-kernel-missing',
        mode: 'teaching',
        messages: [],
        userInput: '继续教学。'
      },
      {
        streamId: 'kernel-missing-refs-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      fixtureWorkspace(root, true),
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => {
          throw new Error('memory should not be created')
        },
        // Simulate host returning non-kernel skills only (or empty) — runtime must fail closed.
        loadSkillReferences: async () => [],
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )

    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('Teaching Kernel unavailable')
    })
  })

  it('fails closed before provider execution when a current-stage skill body is omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-current-stage-body-missing-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    settings.memory.enabled = false
    const loadSkillReferences = vi.fn(async () => [fixtureCoreTeachingKernelReference()])
    globalThis.fetch = (async () => {
      throw new Error('provider must not be called when a current-stage body is missing')
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'current-stage-body-missing-run',
        workspaceId: 'workspace-1',
        conversationId: 'teaching-conversation-current-stage-body-missing',
        mode: 'teaching',
        messages: [],
        skillIds: ['learning-assessor'],
        userInput: '请检查我是否掌握了这个概念。'
      },
      {
        streamId: 'current-stage-body-missing-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      fixtureWorkspace(root, true),
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => {
          throw new Error('memory should not be created')
        },
        loadSkillReferences,
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )

    expect(loadSkillReferences).toHaveBeenCalledWith(
      expect.arrayContaining(['teach', 'learning-assessor']),
      expect.any(String)
    )
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('required current-stage skill body')
    })
  })

  it('fails closed when loadSkillReferences throws for teaching mode kernel load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-kernel-load-throw-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    settings.memory.enabled = false
    globalThis.fetch = (async () => {
      throw new Error('provider must not be called when Teaching Kernel load fails')
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'kernel-load-throw-run',
        workspaceId: 'workspace-1',
        conversationId: 'teaching-conversation-kernel-throw',
        mode: 'teaching',
        messages: [],
        userInput: '继续教学。'
      },
      {
        streamId: 'kernel-load-throw-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      fixtureWorkspace(root, true),
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => {
          throw new Error('memory should not be created')
        },
        loadSkillReferences: async () => {
          throw new Error('core_teaching_kernel_missing: builtin pack absent')
        },
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )

    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('Teaching Kernel unavailable')
    })
    expect(String((result as { message?: string }).message)).toMatch(/core_teaching_kernel_missing|builtin pack absent/)
  })
})

describe('skill orchestration runtime evaluation (ADR-0151 / ADR-0163)', () => {
  it('fails closed visibly for an artifact workflow when the Teaching Kernel loader throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-artifact-kernel-fail-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    settings.memory.enabled = false
    const providerFetch = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'must not run' } }] }))
    globalThis.fetch = providerFetch as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'artifact-kernel-fail-run',
        conversationId: 'artifact-kernel-fail-conversation',
        mode: 'temporary',
        messages: [],
        skillIds: ['teaching-site'],
        userInput: '构建教学站点。'
      },
      { streamId: 'artifact-kernel-fail-run', onChunk: vi.fn(), onStatus: vi.fn(), onTool: vi.fn() },
      null,
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => { throw new Error('memory should not be created') },
        listSkillCatalog: async () => [
          { id: 'teach', installed: true, source: 'builtin' },
          { id: 'teaching-site', installed: true, source: 'builtin' }
        ],
        loadSkillReferences: async () => {
          throw new Error('core_teaching_kernel_missing: app-shipped pack absent')
        },
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )

    expect(result).toMatchObject({ error: true, message: expect.stringContaining('Teaching Kernel unavailable') })
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('uses configured budget pressure for planner deferral while preserving the hard AgentRun budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-orchestration-budget-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    settings.memory.enabled = false
    settings.tools.runBudget.maxTotalTokens = 10_000
    settings.tools.runBudget.warningThreshold = 0.5
    const recordOrchestrationDiagnostics = vi.fn(async () => {})
    globalThis.fetch = (async () => jsonResponse({ choices: [{ message: { content: '预算内完成。' } }] })) as typeof fetch
    const runStore = new AgentRunStore(root)

    const result = await runTeachingConversationTurn(
      {
        streamId: 'orchestration-budget-run',
        conversationId: 'orchestration-budget-conversation',
        mode: 'temporary',
        messages: [],
        skillIds: ['web-visual-assets'],
        userInput: '补充视觉素材。'
      },
      { streamId: 'orchestration-budget-run', onChunk: vi.fn(), onStatus: vi.fn(), onTool: vi.fn() },
      null,
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => { throw new Error('memory should not be created') },
        listSkillCatalog: async () => [
          { id: 'teach', installed: true, source: 'builtin' },
          { id: 'web-visual-assets', installed: true, source: 'builtin' }
        ],
        loadSkillReferences: async () => [fixtureCoreTeachingKernelReference()],
        recordOrchestrationDiagnostics,
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore
      }
    )

    expect(result).toMatchObject({ finalText: '预算内完成。' })
    expect(recordOrchestrationDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      diagnosticCodes: expect.arrayContaining([expect.objectContaining({ code: 'budget_defer' })]),
      promptBudget: expect.objectContaining({ kernelIncludedChars: expect.any(Number) }),
      userOverrideStatus: 'not_supported'
    }))
    const checkpoint = await runStore.readCheckpoint('orchestration-budget-run')
    expect(checkpoint.budget).toMatchObject({ maxTotalTokens: 10_000, warningThreshold: 0.5 })
  })

  it('does not manufacture completed orchestration stages when provider execution is canceled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-orchestration-cancel-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    settings.memory.enabled = false
    const controller = new AbortController()
    const savedStates: Array<{ stages: Array<{ status: string }> }> = []
    globalThis.fetch = (async () => {
      controller.abort()
      const error = new Error('provider aborted')
      error.name = 'AbortError'
      throw error
    }) as typeof fetch

    const result = await runTeachingConversationTurn(
      {
        streamId: 'orchestration-cancel-run',
        conversationId: 'orchestration-cancel-conversation',
        mode: 'teaching',
        messages: [],
        skillIds: ['learning-assessor'],
        userInput: '检查掌握情况。'
      },
      {
        streamId: 'orchestration-cancel-run',
        signal: controller.signal,
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      null,
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => { throw new Error('memory should not be created') },
        listSkillCatalog: async () => [
          { id: 'teach', installed: true, source: 'builtin' },
          { id: 'learning-assessor', installed: true, source: 'builtin' }
        ],
        loadSkillReferences: async () => [
          fixtureCoreTeachingKernelReference(),
          { id: 'learning-assessor', name: 'Assessor', source: 'builtin', content: '# Assessor\nCheck mastery.' }
        ],
        saveOrchestrationState: async (_id, state) => {
          savedStates.push(state as typeof savedStates[number])
        },
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore: new AgentRunStore(root)
      }
    )

    expect(result).toMatchObject({ canceled: true })
    expect(savedStates.length).toBeGreaterThan(0)
    expect(savedStates.flatMap((state) => state.stages).some((stage) => stage.status === 'completed')).toBe(false)
  })
})
