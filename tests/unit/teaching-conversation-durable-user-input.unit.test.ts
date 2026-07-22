import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parentTurnStageSafeTextDigest } from '../../src/main/ai/agent-parent-turn-staging'
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
  provider.apiKey = 'sk-durable-user-input-fixture'
  provider.endpointFormat = 'chat_completions'
  settings.provider.activeProviderId = provider.id
  settings.generator.providerId = provider.id
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 1_000
  settings.tools.enabled = true
  settings.memory.enabled = false
  return settings
}

describe('durable conversation user input vs parent-turn staging', () => {
  it('returns the raw user input (not teaching-context packet) for conversation save digests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-durable-user-input-'))
    createdRoots.push(root)
    const settings = configuredSettings(root)
    const userInput = '/course-ebook-publishing 我要学习MCP'
    const providerMessages: Array<Array<{ role: string; content?: string }>> = []

    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role: string; content?: string }> }
      if (body.messages) providerMessages.push(body.messages)
      return jsonResponse({ choices: [{ message: { content: '课程已生成。' } }] })
    }) as typeof fetch

    const runStore = new AgentRunStore(root)
    const result = await runTeachingConversationTurn(
      {
        streamId: 'durable-user-input-run',
        workspaceId: 'workspace-1',
        conversationId: undefined,
        mode: 'teaching',
        messages: [],
        userInput
      },
      {
        streamId: 'durable-user-input-run',
        onChunk: vi.fn(),
        onStatus: vi.fn(),
        onTool: vi.fn()
      },
      {
        id: 'workspace-1',
        name: 'Fixture workspace',
        rootPath: root,
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
        workspaceToolAccessGranted: true
      },
      {
        loadSettings: async () => settings,
        listMemories: async () => [],
        createMemory: async () => {
          throw new Error('memory should not be created')
        },
        loadSkillReferences: async () => [
          {
            id: 'teach',
            name: 'teach',
            source: 'builtin',
            content: '# Teach\nUse generate_lesson when ready.'
          },
          {
            id: 'course-ebook-publishing',
            name: 'course-ebook-publishing',
            source: 'user',
            content: '# Course ebook publishing\nPublish a course.'
          }
        ],
        generateLessonFromBrief: async () => ({
          id: 'lesson-1',
          title: 'MCP',
          objective: 'Learn MCP',
          prompt: userInput,
          createdAt: '2026-07-22T00:00:00.000Z',
          durationMinutes: 30,
          courseId: 'course-1',
          courseName: 'MCP',
          courseRelativePath: 'courses/mcp',
          courseAbsolutePath: root,
          sessionId: 'session-1',
          sessionName: 'Session 1',
          sessionRelativePath: 'learning-sessions/session-1',
          sessionAbsolutePath: root,
          relativePath: 'lessons/0002-fc-mcp.html',
          absolutePath: join(root, 'lessons/0002-fc-mcp.html')
        }),
        buildTemporaryChatContext: async () => ({ learnerProfiles: [], courses: [] }),
        runStore
      }
    )

    expect(result).toMatchObject({ finalText: '课程已生成。' })
    expect('turns' in result).toBe(true)
    if (!('turns' in result)) return

    const finalUser = [...result.turns].reverse().find((turn) => turn.role === 'user')
    expect(finalUser?.content).toBe(userInput)
    expect(finalUser?.content).not.toContain('<teaching-context-packet>')

    // Provider still receives the composed packet for this turn.
    const firstUserToProvider = providerMessages[0]?.find((message) => message.role === 'user')
    expect(firstUserToProvider?.content).toContain('<teaching-context-packet>')
    expect(firstUserToProvider?.content).toContain(userInput)

    const stage = await runStore.readParentTurnStage('durable-user-input-run')
    expect(parentTurnStageSafeTextDigest(finalUser!.content)).toBe(stage.userInput.sha256)
    expect(parentTurnStageSafeTextDigest(result.finalText)).toBe(stage.confirmedAssistant?.sha256)
  })
})
