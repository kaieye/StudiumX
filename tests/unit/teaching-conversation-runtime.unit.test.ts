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
    expect(tools?.map((tool) => tool.function.name)).not.toEqual(expect.arrayContaining([
      'read_workspace_file',
      'list_workspace_files',
      'write_workspace_file',
      'generate_lesson'
    ]))
    expect(JSON.stringify(requests[0]?.messages?.[0])).toContain('web_search')
  })
})
