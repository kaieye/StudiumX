import { afterEach, describe, expect, it } from 'vitest'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function settings(): TeachingSettingsV1 {
  const value = defaultSettings('C:/agent-loop-finalization-tools-fixture')
  value.generator.endpointFormat = 'chat_completions'
  value.generator.requestTimeoutMs = 50
  return value
}

function provider(): TeachingModelProviderProfile {
  return {
    ...settings().provider.providers[0]!,
    baseUrl: 'https://provider.example/v1',
    endpointFormat: 'chat_completions',
    apiKey: 'sk-fixture'
  }
}

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const generateLessonTool = {
  type: 'function' as const,
  function: { name: 'generate_lesson', description: 'generate lesson', parameters: { type: 'object', properties: {} } }
}
const writeWorkspaceFileTool = {
  type: 'function' as const,
  function: { name: 'write_workspace_file', description: 'write file', parameters: { type: 'object', properties: {} } }
}
const readWorkspaceFileTool = {
  type: 'function' as const,
  function: { name: 'read_workspace_file', description: 'read file', parameters: { type: 'object', properties: {} } }
}
const webSearchTool = {
  type: 'function' as const,
  function: { name: 'web_search', description: 'web search', parameters: { type: 'object', properties: {} } }
}

describe('runAgentLoop durable-finalization maintenance tools', () => {
  it('runs an allow-listed maintenance tool after generate_lesson succeeds, then produces the full final answer', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate', type: 'function', function: { name: 'generate_lesson', arguments: '{}' } }] } }]
      }]),
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-sync-glossary', type: 'function', function: { name: 'write_workspace_file', arguments: '{"path":"GLOSSARY.md","content":"updated"}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '课程已生成。术语表已同步，可以开始学习了。' } }] }])
    ]
    const requestBodies: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return responses.shift()!
    }) as typeof fetch
    let generated = false
    let glossarySynced = false

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '生成课程' }],
      tools: [generateLessonTool, writeWorkspaceFileTool, readWorkspaceFileTool, webSearchTool],
      toolHandlers: {
        generate_lesson: async () => {
          generated = true
          return JSON.stringify({ ok: true, lessonId: '0001' })
        },
        write_workspace_file: async () => {
          glossarySynced = true
          return JSON.stringify({ ok: true })
        },
        read_workspace_file: async () => JSON.stringify({ ok: true }),
        web_search: async () => JSON.stringify({ ok: true })
      },
      shouldFinalizeAfterToolExecution: () => generated,
      finalizationTools: [writeWorkspaceFileTool, readWorkspaceFileTool]
    })

    expect(result.error).toBeUndefined()
    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('课程已生成。术语表已同步，可以开始学习了。')
    expect(glossarySynced).toBe(true)
    // Main loop (generate_lesson) + maintenance round (write_workspace_file) + no-tool final answer.
    expect(requestBodies).toHaveLength(3)
    expect(requestBodies[0]).toHaveProperty('tools')
    const maintenanceBody = requestBodies[1]!
    const maintenanceTools = maintenanceBody.tools as Array<{ function: { name: string } }>
    expect(maintenanceTools.map((tool) => tool.function.name)).toEqual(['write_workspace_file', 'read_workspace_file'])
    expect(requestBodies[2]).not.toHaveProperty('tools')
  })

  it('rejects non-allow-listed tool calls in the maintenance round without invoking their handler', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate', type: 'function', function: { name: 'generate_lesson', arguments: '{}' } }] } }]
      }]),
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-web', type: 'function', function: { name: 'web_search', arguments: '{}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '课程已生成。' } }] }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    let generated = false
    let webSearchCalled = false

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '生成课程' }],
      tools: [generateLessonTool, webSearchTool],
      toolHandlers: {
        generate_lesson: async () => {
          generated = true
          return JSON.stringify({ ok: true })
        },
        web_search: async () => {
          webSearchCalled = true
          return JSON.stringify({ ok: true })
        }
      },
      shouldFinalizeAfterToolExecution: () => generated,
      finalizationTools: [writeWorkspaceFileTool]
    })

    expect(result.error).toBeUndefined()
    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('课程已生成。')
    expect(webSearchCalled).toBe(false)
  })

  it('uses direct maintenance prose as the final answer without an extra no-tool round', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate', type: 'function', function: { name: 'generate_lesson', arguments: '{}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '课程已生成。术语表已同步，可以开始学习了。' } }] }])
    ]
    const requestBodies: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return responses.shift()!
    }) as typeof fetch
    let generated = false

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '生成课程' }],
      tools: [generateLessonTool, writeWorkspaceFileTool],
      toolHandlers: {
        generate_lesson: async () => {
          generated = true
          return JSON.stringify({ ok: true })
        },
        write_workspace_file: async () => JSON.stringify({ ok: true })
      },
      shouldFinalizeAfterToolExecution: () => generated,
      finalizationTools: [writeWorkspaceFileTool]
    })

    expect(result.error).toBeUndefined()
    expect(result.finalText).toBe('课程已生成。术语表已同步，可以开始学习了。')
    // Main loop + maintenance round; no separate no-tool round when the model answers directly.
    expect(requestBodies).toHaveLength(2)
  })

  it('keeps legacy no-tool finalization when no maintenance tools are offered', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate', type: 'function', function: { name: 'generate_lesson', arguments: '{}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '课程已生成，可以开始学习。' } }] }])
    ]
    const requestBodies: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return responses.shift()!
    }) as typeof fetch
    let generated = false

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '生成课程' }],
      tools: [generateLessonTool],
      toolHandlers: {
        generate_lesson: async () => {
          generated = true
          return JSON.stringify({ ok: true })
        }
      },
      shouldFinalizeAfterToolExecution: () => generated
    })

    expect(result.error).toBeUndefined()
    expect(result.finalText).toBe('课程已生成，可以开始学习。')
    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[1]).not.toHaveProperty('tools')
  })
})
