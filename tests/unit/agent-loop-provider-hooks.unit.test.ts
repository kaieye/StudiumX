import { afterEach, describe, expect, it } from 'vitest'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function settings(): TeachingSettingsV1 {
  const value = defaultSettings('C:/agent-loop-provider-hooks-fixture')
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('runAgentLoop provider hooks end-to-end', () => {
  it('surfaces provider_reported provenance when the provider reports usage', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        choices: [{ message: { content: 'final answer' } }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
      })) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {}
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.usage.totalTokens).toBe(20)
    expect(result.usage.usageProvenance).toBe('provider_reported')
  })

  it('omits provenance when the provider reports no usage', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ choices: [{ message: { content: 'final answer' } }] })) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {}
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.usage).not.toHaveProperty('usageProvenance')
  })

  it('streams reasoning, preparation status, and the buffered final answer in order', async () => {
    globalThis.fetch = (async () => sseResponse([
      { choices: [{ delta: { reasoning_content: '分析问题' } }] },
      { choices: [{ delta: { content: '第一段' } }] },
      { choices: [{ delta: { content: '第二段' } }] }
    ])) as typeof fetch
    const events: Array<{ type: string; delta?: string; status?: string }> = []

    const result = await runAgentLoop({
      settings: settings(), provider: provider(), messages: [{ role: 'user', content: 'hi' }],
      tools: [], toolHandlers: {}, callbacks: { onEvent: (event) => {
        if (event.type === 'reasoning' || event.type === 'token') events.push({ type: event.type, delta: event.delta })
        if (event.type === 'status') events.push({ type: event.type, status: event.status })
      } }
    })

    expect(result.finalText).toBe('第一段第二段')
    expect(events).toEqual([
      { type: 'status', status: 'thinking' },
      { type: 'reasoning', delta: '分析问题' },
      { type: 'status', status: 'answering' },
      { type: 'token', delta: '第一段第二段' },
      { type: 'status', status: 'done' }
    ])
  })

  it('does not concatenate text emitted before a tool call into the final answer', async () => {
    const responses = [
      sseResponse([
        { choices: [{ delta: { content: '我先查一下。' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }] }
      ]),
      sseResponse([{ choices: [{ delta: { content: '这是最终答案' } }] }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    const tokens: string[] = []

    const result = await runAgentLoop({
      settings: settings(), provider: provider(), messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'lookup', parameters: { type: 'object', properties: {} } } }],
      toolHandlers: { lookup: async () => 'tool result' },
      callbacks: { onEvent: (event) => { if (event.type === 'token') tokens.push(event.delta) } }
    })

    expect(result.finalText).toBe('这是最终答案')
    expect(tokens.join('')).toBe('这是最终答案')
  })


  it('suppresses repeated write preambles from every tool-calling iteration', async () => {
    const preamble = '好，让我接下来写入文件。'
    const responses = [
      sseResponse([
        { choices: [{ delta: { content: preamble } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-write-1', type: 'function', function: { name: 'write_workspace_file', arguments: '{\"path\":\"notes-1.md\",\"content\":\"one\"}' } }] } }] }
      ]),
      sseResponse([
        { choices: [{ delta: { content: preamble } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-write-2', type: 'function', function: { name: 'write_workspace_file', arguments: '{\"path\":\"notes-2.md\",\"content\":\"two\"}' } }] } }] }
      ]),
      sseResponse([
        { choices: [{ delta: { content: preamble } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-write-3', type: 'function', function: { name: 'write_workspace_file', arguments: '{\"path\":\"notes-3.md\",\"content\":\"three\"}' } }] } }] }
      ]),
      sseResponse([{ choices: [{ delta: { content: '文件已写入。' } }] }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    const tokens: string[] = []
    let writes = 0

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '把三条笔记写入文件' }],
      tools: [{
        type: 'function',
        function: {
          name: 'write_workspace_file',
          description: 'write a workspace file',
          parameters: { type: 'object', properties: {} }
        }
      }],
      toolHandlers: {
        write_workspace_file: async () => {
          writes += 1
          return JSON.stringify({ ok: true })
        }
      },
      budget: { maxIterations: 4, maxToolCalls: 3, maxProviderCalls: 4 },
      callbacks: { onEvent: (event) => { if (event.type === 'token') tokens.push(event.delta) } }
    })

    expect(result.finalText).toBe('文件已写入。')
    expect(tokens).toEqual(['文件已写入。'])
    expect(tokens.join('')).not.toContain(preamble)
    expect(writes).toBe(3)
    expect(responses).toHaveLength(0)
  })

  it('recovers a required tool when the model returns a premature final answer', async () => {
    const responses = [
      sseResponse([{ choices: [{ delta: { content: '我先直接讲解 MCP。' } }] }]),
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate-after-final', type: 'function', function: { name: 'generate_lesson', arguments: '{\"topic\":\"MCP\",\"firstLessonFocus\":\"解释 MCP 的三个核心角色。\"}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '第一节 MCP 课程已生成。' } }] }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    let generationAttempted = false
    const generateLessonTool = {
      type: 'function' as const,
      function: {
        name: 'generate_lesson',
        description: 'generate lesson',
        parameters: { type: 'object', properties: {} }
      }
    }

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '我想学习skills' }],
      tools: [generateLessonTool],
      toolHandlers: {
        generate_lesson: async () => {
          generationAttempted = true
          return JSON.stringify({ ok: true })
        }
      },
      shouldErrorOnMaxIterations: () => !generationAttempted,
      maxIterationsErrorMessage: '课程尚未生成。',
      iterationLimitRecovery: {
        shouldAttempt: () => !generationAttempted,
        instruction: '立即调用 generate_lesson，不要只返回讲解。',
        tools: [generateLessonTool],
        toolChoice: { type: 'function', function: { name: 'generate_lesson' } },
        maxAttempts: 2
      }
    })

    expect(result.error).toBeUndefined()
    expect(result.finalText).toBe('第一节 MCP 课程已生成。')
    expect(generationAttempted).toBe(true)
    expect(responses).toHaveLength(0)
  })

  it('uses a bounded required-tool recovery pass before failing at the iteration limit', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-lookup', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }]
      }]),
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate', type: 'function', function: { name: 'generate_lesson', arguments: '{\"topic\":\"动量守恒\",\"firstLessonFocus\":\"用碰撞实验判断封闭系统的总动量是否保持不变。\"}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '课程已生成。' } }] }])
    ]
    const requestBodies: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return responses.shift()!
    }) as typeof fetch
    let generationAttempted = false
    const generateLessonTool = {
      type: 'function' as const,
      function: {
        name: 'generate_lesson',
        description: 'generate lesson',
        parameters: { type: 'object', properties: {} }
      }
    }

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '生成课程' }],
      tools: [
        { type: 'function', function: { name: 'lookup', description: 'lookup', parameters: { type: 'object', properties: {} } } },
        generateLessonTool
      ],
      toolHandlers: {
        lookup: async () => 'context',
        generate_lesson: async () => {
          generationAttempted = true
          return JSON.stringify({ ok: true })
        }
      },
      maxIterations: 1,
      shouldErrorOnMaxIterations: () => !generationAttempted,
      maxIterationsErrorMessage: '课程尚未生成。',
      iterationLimitRecovery: {
        shouldAttempt: () => !generationAttempted,
        instruction: '立即调用 generate_lesson，不要调用其他工具。',
        tools: [generateLessonTool],
        toolChoice: { type: 'function', function: { name: 'generate_lesson' } },
        maxAttempts: 2
      }
    })

    expect(result.error).toBeUndefined()
    expect(result.finalText).toBe('课程已生成。')
    expect(generationAttempted).toBe(true)
    expect(requestBodies).toHaveLength(3)
    expect(requestBodies[1]).toMatchObject({
      tool_choice: { type: 'function', function: { name: 'generate_lesson' } },
      tools: [expect.objectContaining({ function: expect.objectContaining({ name: 'generate_lesson' }) })]
    })
    // No-tool finalization is represented by omitting the tool fields at the
    // HTTP boundary; this is accepted by stricter OpenAI-compatible gateways.
    expect(requestBodies[2]).not.toHaveProperty('tool_choice')
    expect(requestBodies[2]).not.toHaveProperty('tools')
  })

  it('bounds required-tool recovery when the provider still refuses the forced tool', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-lookup', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '我还需要继续规划。' } }] }]),
      sseResponse([{ choices: [{ delta: { content: '仍然不调用工具。' } }] }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    let generationAttempted = false
    const generateLessonTool = {
      type: 'function' as const,
      function: {
        name: 'generate_lesson',
        description: 'generate lesson',
        parameters: { type: 'object', properties: {} }
      }
    }

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '生成课程' }],
      tools: [
        { type: 'function', function: { name: 'lookup', description: 'lookup', parameters: { type: 'object', properties: {} } } },
        generateLessonTool
      ],
      toolHandlers: {
        lookup: async () => 'context',
        generate_lesson: async () => {
          generationAttempted = true
          return JSON.stringify({ ok: true })
        }
      },
      maxIterations: 1,
      shouldErrorOnMaxIterations: () => !generationAttempted,
      maxIterationsErrorMessage: '课程尚未生成。',
      iterationLimitRecovery: {
        shouldAttempt: () => !generationAttempted,
        instruction: '立即调用 generate_lesson。',
        tools: [generateLessonTool],
        toolChoice: { type: 'function', function: { name: 'generate_lesson' } },
        maxAttempts: 2
      }
    })

    expect(result.stopReason).toBe('max_iterations')
    expect(result.error).toBe('课程尚未生成。')
    expect(result.usage.providerCalls).toBe(3)
    expect(generationAttempted).toBe(false)
    expect(responses).toHaveLength(0)
  })

  it('switches directly to no-tool finalization after a durable operation succeeds', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate-finalize', type: 'function', function: { name: 'generate_lesson', arguments: '{}' } }] } }]
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
      tools: [
        { type: 'function', function: { name: 'generate_lesson', description: 'generate lesson', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'write_workspace_file', description: 'write file', parameters: { type: 'object', properties: {} } } }
      ],
      toolHandlers: {
        generate_lesson: async () => {
          generated = true
          return JSON.stringify({ ok: true })
        },
        write_workspace_file: async () => { throw new Error('must not run after durable success') }
      },
      shouldFinalizeAfterToolExecution: () => generated
    })

    expect(result.finalText).toBe('课程已生成，可以开始学习。')
    expect(result.usage.toolCalls).toBe(1)
    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]).toHaveProperty('tools')
    expect(requestBodies[1]).not.toHaveProperty('tools')
    expect(requestBodies[1]).not.toHaveProperty('tool_choice')
  })

  it('ignores residual tool calls during durable finalization and keeps stripped prose', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate-residual', type: 'function', function: { name: 'generate_lesson', arguments: '{}' } }] } }]
      }]),
      sseResponse([{
        choices: [{
          delta: {
            content: '课程已生成，可以开始学习。',
            tool_calls: [{ index: 0, id: 'call-extra', type: 'function', function: { name: 'write_workspace_file', arguments: '{}' } }]
          }
        }]
      }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    let generated = false

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '生成课程' }],
      tools: [{ type: 'function', function: { name: 'generate_lesson', description: 'generate lesson', parameters: { type: 'object', properties: {} } } }],
      toolHandlers: {
        generate_lesson: async () => {
          generated = true
          return JSON.stringify({ ok: true })
        }
      },
      shouldFinalizeAfterToolExecution: () => generated
    })

    expect(result.error).toBeUndefined()
    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('课程已生成，可以开始学习。')
    expect(result.degradedReason).toBe('final_answer_ignored_tool_calls')
    expect(result.usage.toolCalls).toBe(1)
  })

  it('uses durable success fallback when finalization only returns tool calls', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate-empty-final', type: 'function', function: { name: 'generate_lesson', arguments: '{}' } }] } }]
      }]),
      sseResponse([{
        choices: [{
          delta: {
            tool_calls: [{ index: 0, id: 'call-extra-2', type: 'function', function: { name: 'write_workspace_file', arguments: '{}' } }]
          }
        }]
      }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    let generated = false
    const fallbackText = '课程已成功生成并保存：《Claude Code 记忆系统分层架构》（lessons/0001-claude-code.html）。最终答复阶段模型未返回可用文本，系统已保留生成结果。'

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '生成课程' }],
      tools: [{ type: 'function', function: { name: 'generate_lesson', description: 'generate lesson', parameters: { type: 'object', properties: {} } } }],
      toolHandlers: {
        generate_lesson: async () => {
          generated = true
          return JSON.stringify({ ok: true })
        }
      },
      shouldFinalizeAfterToolExecution: () => generated,
      durableSuccessFallback: () => generated ? fallbackText : null
    })

    expect(result.error).toBeUndefined()
    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe(fallbackText)
    expect(result.degradedReason).toBe('final_answer_ignored_tool_calls')
  })

  it('uses a deterministic successful-operation fallback when provider budget is exhausted after a durable tool succeeds', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate-budget', type: 'function', function: { name: 'generate_lesson', arguments: '{}' } }] } }]
      }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    let generated = false
    const events: Array<{ type: string; status?: string; delta?: string }> = []
    const fallbackText = '课程已成功生成并保存：Claude Code 记忆系统架构总览（lessons/0001-claude-code.html）。后续整理因本轮模型调用预算到达上限而停止，但不影响已生成课件。'

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '生成课程' }],
      tools: [{ type: 'function', function: { name: 'generate_lesson', description: 'generate lesson', parameters: { type: 'object', properties: {} } } }],
      toolHandlers: {
        generate_lesson: async () => {
          generated = true
          return JSON.stringify({ ok: true, path: 'lessons/0001-claude-code.html' })
        }
      },
      budget: {
        maxDurationMs: 60_000,
        maxProviderCalls: 1,
        maxToolCalls: 4,
        maxTotalTokens: 100_000,
        warningThreshold: 0.8
      },
      budgetExhaustionFallback: (reason) => generated && reason === 'provider_calls' ? fallbackText : null,
      callbacks: { onEvent: (event) => {
        if (event.type === 'status') events.push({ type: event.type, status: event.status })
        if (event.type === 'token') events.push({ type: event.type, delta: event.delta })
      } }
    })

    expect(result.error).toBeUndefined()
    expect(result.stopReason).toBe('degraded')
    expect(result.finalText).toBe(fallbackText)
    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: fallbackText })
    expect(result.usage.budgetStopReason).toBe('provider_calls')
    expect(events).toContainEqual({ type: 'token', delta: fallbackText })
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'status', status: 'error' }))
  })

})
