import { afterEach, describe, expect, it } from 'vitest'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import { buildAgentRunPresentation } from '../../src/main/ai/agent-run-presentation'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
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

  it('reports unknown provenance when the provider reports no usage', async () => {
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
    expect(result.usage.usageProvenance).toBe('unknown')
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

  it('keeps visible prose before a tool call in the real presentation flow', async () => {
    const responses = [
      sseResponse([
        { choices: [{ delta: { reasoning_content: '先读取已有笔记。' } }] },
        { choices: [{ delta: { content: '我会先查看笔记，再给你准确的答案。' } }] },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call-read-notes',
                type: 'function',
                function: { name: 'read_workspace_file', arguments: '{"path":"notes.md"}' }
              }]
            }
          }]
        }
      ]),
      sseResponse([
        { choices: [{ delta: { reasoning_content: '笔记已经核对完毕。' } }] },
        { choices: [{ delta: { content: '这是基于笔记整理出的最终答案。' } }] }
      ])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    const events: AgentLoopEvent[] = []

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '请根据笔记回答问题' }],
      tools: [{
        type: 'function',
        function: {
          name: 'read_workspace_file',
          description: 'read one workspace file',
          parameters: { type: 'object', properties: {} }
        }
      }],
      toolHandlers: {
        read_workspace_file: async () => JSON.stringify({ ok: true, content: 'private tool result' })
      },
      callbacks: { onEvent: (event) => events.push(event) }
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('这是基于笔记整理出的最终答案。')
    expect(events.flatMap((event) => {
      if (event.type === 'reasoning' || event.type === 'token') return [`${event.type}:${event.delta}`]
      if (event.type === 'tool_call') return [`tool_call:${event.toolCall.function.name}`]
      if (event.type === 'tool_result') return [`tool_result:${event.name}`]
      return []
    })).toEqual([
      'reasoning:先读取已有笔记。',
      'token:我会先查看笔记，再给你准确的答案。',
      'tool_call:read_workspace_file',
      'tool_result:read_workspace_file',
      'reasoning:笔记已经核对完毕。',
      'token:这是基于笔记整理出的最终答案。'
    ])

    const projection = buildAgentRunPresentation(events, {
      streamId: 'tool-prose-order',
      now: () => '2026-08-16T12:00:00.000Z'
    })
    const processEvents = projection.processEvents ?? []
    expect(processEvents).toMatchObject([
      { kind: 'reasoning', title: 'Think', detail: '先读取已有笔记。' },
      { kind: 'tool_call', title: 'READ', status: 'tool_done', toolCallId: 'call-read-notes' },
      { kind: 'reasoning', title: 'Think', detail: '笔记已经核对完毕。' }
    ])
    expect(projection.presentationTimeline?.map((entry) => entry.kind === 'assistant_text'
      ? `text:${entry.content}`
      : `process:${entry.processEventId}`
    )).toEqual([
      `process:${processEvents[0]?.id}`,
      'text:我会先查看笔记，再给你准确的答案。',
      `process:${processEvents[1]?.id}`,
      `process:${processEvents[2]?.id}`,
      'text:这是基于笔记整理出的最终答案。'
    ])
    expect(JSON.stringify(projection)).not.toContain('private tool result')
  })

  it('accounts every adapter transport dispatch when a streaming request falls back after timeout', async () => {
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      if (fetches === 1) throw new Error('timeout before first token')
      return jsonResponse({ choices: [{ message: { content: 'fallback answer' }, finish_reason: 'stop' }] })
    }) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {}
    })

    expect(result.stopReason).toBe('final_answer')
    expect(fetches).toBe(2)
    expect(result.usage.operationAccounting).toMatchObject({
      logicalRequests: 1,
      providerTransportAttempts: 2
    })
    expect(result.usage.providerCalls).toBe(2)
  })

  it('accounts the no-tool adapter retry after a provider rejects function tools', async () => {
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      if (fetches === 1) return jsonResponse({ error: { message: 'function tools are not supported' } }, 400)
      return jsonResponse({ choices: [{ message: { content: 'degraded answer' }, finish_reason: 'stop' }] })
    }) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'lookup', parameters: { type: 'object', properties: {} } } }],
      toolHandlers: {}
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.degradedReason).toBe('provider_rejected_tools')
    expect(fetches).toBe(2)
    expect(result.usage.operationAccounting).toMatchObject({
      logicalRequests: 1,
      providerTransportAttempts: 2
    })
  })

  it('counts all three dispatches when a streaming timeout is followed by a tool rejection retry', async () => {
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      if (fetches === 1) throw new Error('timeout before first token')
      if (fetches === 2) return jsonResponse({ error: { message: 'tool functions are unsupported' } }, 400)
      return jsonResponse({ choices: [{ message: { content: 'recovered answer' }, finish_reason: 'stop' }] })
    }) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'lookup', parameters: { type: 'object', properties: {} } } }],
      toolHandlers: {}
    })

    expect(result.stopReason).toBe('final_answer')
    expect(fetches).toBe(3)
    expect(result.usage.operationAccounting).toMatchObject({
      logicalRequests: 1,
      providerTransportAttempts: 3
    })
  })

  it('stops at the host resource boundary before a fallback can make a second network dispatch', async () => {
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      throw new Error('timeout before first token')
    }) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHandlers: {},
      resourceGovernance: {
        userBudget: {
          limits: [{ meter: 'provider_transport_attempts', limit: 1, scope: 'task', auditId: 'one-transport' }]
        }
      }
    })

    expect(result.stopReason).toBe('resource_limit')
    expect(result.finalText).toBe('')
    expect(fetches).toBe(1)
    expect(result.usage.operationAccounting).toMatchObject({
      logicalRequests: 1,
      providerTransportAttempts: 1
    })
    expect(result.usage.resourceGovernance?.terminal).toMatchObject({
      meter: 'provider_transport_attempts',
      used: 1,
      limit: 1,
      scope: 'task',
      action: 'resource_limit'
    })
  })

  it('keeps text emitted before a tool call in arrival order without polluting the final answer', async () => {
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
    expect(tokens).toEqual(['我先查一下。', '这是最终答案'])
  })


  it('keeps repeated write preambles from tool-calling iterations in arrival order', async () => {
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
      callbacks: { onEvent: (event) => { if (event.type === 'token') tokens.push(event.delta) } }
    })

    expect(result.finalText).toBe('文件已写入。')
    expect(tokens).toEqual([preamble, preamble, preamble, '文件已写入。'])
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

  it('uses a bounded required-tool recovery pass after normal work returns premature prose', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-lookup', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '资料已查到。' } }] }]),
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
    expect(requestBodies).toHaveLength(4)
    expect(requestBodies[2]).toMatchObject({
      tool_choice: { type: 'function', function: { name: 'generate_lesson' } },
      tools: [expect.objectContaining({ function: expect.objectContaining({ name: 'generate_lesson' }) })]
    })
    // No-tool finalization is represented by omitting the tool fields at the
    // HTTP boundary; this is accepted by stricter OpenAI-compatible gateways.
    expect(requestBodies[3]).not.toHaveProperty('tool_choice')
    expect(requestBodies[3]).not.toHaveProperty('tools')
  })

  it('bounds required-tool recovery when the provider still refuses the forced tool', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-lookup', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '我还需要继续规划。' } }] }]),
      sseResponse([{ choices: [{ delta: { content: '仍然不调用工具。' } }] }]),
      sseResponse([{ choices: [{ delta: { content: '恢复阶段仍未调用必要工具。' } }] }])
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
      iterationLimitRecovery: {
        shouldAttempt: () => !generationAttempted,
        instruction: '立即调用 generate_lesson。',
        tools: [generateLessonTool],
        toolChoice: { type: 'function', function: { name: 'generate_lesson' } },
        maxAttempts: 2
      }
    })

    expect(result.stopReason).toBe('error')
    expect(result.error).toBe('必要操作未完成，无法安全继续本段执行。请调整请求或开始新的续接。')
    expect(result.usage.providerCalls).toBe(4)
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

  it('continues to finalization after durable success despite legacy aggregate usage thresholds', async () => {
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-generate-budget', type: 'function', function: { name: 'generate_lesson', arguments: '{}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '课程已生成并可以开始学习。' } }] }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch
    let generated = false
    const events: Array<{ type: string; status?: string; delta?: string }> = []
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
      callbacks: { onEvent: (event) => {
        if (event.type === 'status') events.push({ type: event.type, status: event.status })
        if (event.type === 'token') events.push({ type: event.type, delta: event.delta })
      } }
    })

    expect(result.error).toBeUndefined()
    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('课程已生成并可以开始学习。')
    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: '课程已生成并可以开始学习。' })
    expect(result.usage.providerCalls).toBe(2)
    expect(result.usage).not.toHaveProperty('budgetStopReason')
    expect(events).toContainEqual({ type: 'token', delta: '课程已生成并可以开始学习。' })
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'status', status: 'error' }))
  })

})
