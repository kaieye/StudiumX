import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DelegationRuntime } from '../../src/main/ai/delegation-runtime'
import { defaultSettings } from '../../src/main/teaching-settings'

const originalFetch = globalThis.fetch
const roots: string[] = []
afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('DelegationRuntime bounded finalization', () => {
  it('returns a partial research summary instead of failing when the child reaches its iteration limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-child-finalize-'))
    roots.push(root)
    await writeFile(join(root, 'MISSION.md'), '# Mission\nLearn memory systems.\n', 'utf8')
    const settings = defaultSettings(root)
    settings.generator.endpointFormat = 'chat_completions'
    settings.generator.requestTimeoutMs = 100
    settings.tools.maxIterations = 1
    const provider = {
      ...settings.provider.providers[0]!,
      baseUrl: 'https://provider.example/v1',
      endpointFormat: 'chat_completions' as const,
      apiKey: 'sk-fixture'
    }
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-list', type: 'function', function: { name: 'list_workspace', arguments: '{}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '已读取工作区；可确认当前任务是学习记忆系统。其余来源尚未验证。' } }] }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await new DelegationRuntime({ settings, provider, workspaceRoot: root }).runChild({
      label: '检查工作区',
      prompt: '读取工作区并总结任务。',
      profile: 'workspace_audit',
      maxIterations: 1
    })

    expect(result.status).toBe('completed')
    expect(result.summary).toContain('其余来源尚未验证')
    expect(result.usage).toMatchObject({ providerCalls: 2, toolCalls: 1 })
    expect(responses).toHaveLength(0)
  })
})
