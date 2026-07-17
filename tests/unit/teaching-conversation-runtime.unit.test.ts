import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentRunStore } from '../../src/main/ai/agent-run-store'
import { defaultSettings } from '../../src/main/teaching-settings'
import { runTeachingConversationTurn } from '../../src/main/teaching-conversation-runtime'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'

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
        updatedAt: '2026-07-17T00:00:00.000Z'
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
    for (const forbiddenToolName of [
      'read_workspace_file',
      'list_workspace',
      'write_workspace_file',
      'generate_lesson',
      'delegate_task',
      'read_only_task',
      'parallel_tasks'
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
        updatedAt: '2026-07-17T00:00:00.000Z'
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
        updatedAt: '2026-07-17T00:00:00.000Z'
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
