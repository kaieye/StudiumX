import { afterEach, describe, expect, it } from 'vitest'
import { runAgentLoop } from '../../src/main/ai/agent-loop'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function settings(): TeachingSettingsV1 {
  const value = defaultSettings('C:/agent-loop-context-governance-fixture')
  value.generator.endpointFormat = 'chat_completions'
  value.generator.requestTimeoutMs = 5_000
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

function contextOverflowResponse(): Response {
  return jsonResponse({
    error: {
      message: 'This model\'s maximum context length has been exceeded. Reduce the length of the messages.',
      type: 'context_length_exceeded'
    }
  }, 400)
}

function longTranscript(): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: 'Keep the lesson context safe and local.' }
  ]
  for (let index = 0; index < 24; index += 1) {
    messages.push({ role: 'user', content: `OLD_USER_${index}: ${'historical context '.repeat(200)}` })
    messages.push({ role: 'assistant', content: `OLD_ASSISTANT_${index}: ${'resolved work '.repeat(180)}` })
  }
  messages.push({ role: 'user', content: 'LATEST_USER: continue the lesson.' })
  return messages
}

const forcedCompactionOptions = {
  contextWindowTokens: 60_000,
  // The initial request intentionally remains below the ordinary trigger: this
  // proves an overflow, not aggregate usage, causes the forced compact pass.
  softThresholdTokens: 60_000,
  hardThresholdTokens: 60_000,
  minTailMessages: 4,
  minMessagesToCompact: 4,
  maxSummaryTokens: 96
}

describe('runAgentLoop ADR-0010 context governance', () => {
  it('fails closed before provider dispatch when a normal projection is known to exceed the window', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return jsonResponse({ choices: [{ message: { content: 'must not be sent' } }] })
    }) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'x'.repeat(2_000) }],
      tools: [],
      toolHandlers: {},
      contextCompaction: {
        enabled: false,
        contextWindowTokens: 100
      }
    })

    expect(result.stopReason).toBe('context_unrecoverable')
    expect(result.error).toContain('压缩后仍超过模型窗口')
    expect(fetchCalls).toBe(0)
  })

  it('uses the catalog-capped output ceiling for request fit and the serialized provider request', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const outputReserves: number[] = []
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return sseResponse([{ choices: [{ delta: { content: 'The capped request fits.' } }] }])
    }) as typeof fetch

    const cappedSettings = settings()
    cappedSettings.generator.model = 'claude-opus-4-8'
    cappedSettings.generator.maxOutputTokens = 64_000
    const cataloguedProvider = { ...provider(), id: 'anthropic' }

    const result = await runAgentLoop({
      settings: cappedSettings,
      provider: cataloguedProvider,
      // This is intentionally close to the effective geometry: it fits with
      // Anthropic's 32k catalog cap, but would be rejected under the stale 64k
      // configured-reserve projection before transport dispatch.
      messages: [{ role: 'user', content: 'x'.repeat(1_600) }],
      tools: [],
      toolHandlers: {},
      contextCompaction: {
        enabled: false,
        contextWindowTokens: 34_000
      },
      callbacks: {
        onEvent: (event) => {
          if (event.type === 'context_estimated') {
            outputReserves.push(event.estimate.outputReserveTokens)
          }
        }
      }
    })

    expect(result.stopReason).toBe('final_answer')
    expect(outputReserves).toContain(32_000)
    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]?.max_tokens).toBe(32_000)
  })

  it('fails closed before dispatch when the effective serialized request geometry does not fit', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return sseResponse([{ choices: [{ delta: { content: 'must not be sent' } }] }])
    }) as typeof fetch

    const cappedSettings = settings()
    cappedSettings.generator.model = 'claude-opus-4-8'
    cappedSettings.generator.maxOutputTokens = 64_000

    const result = await runAgentLoop({
      settings: cappedSettings,
      provider: { ...provider(), id: 'anthropic' },
      messages: [{ role: 'user', content: 'x'.repeat(20_000) }],
      tools: [],
      toolHandlers: {},
      contextCompaction: {
        enabled: false,
        contextWindowTokens: 34_000
      }
    })

    expect(result.stopReason).toBe('context_unrecoverable')
    expect(fetchCalls).toBe(0)
  })

  it('compacts ordinary context pressure before the normal send without replaying completed history', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const responses = [
      jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Keep only the compact reference and current task.' } }] }),
      sseResponse([{ choices: [{ delta: { content: 'Continued from the compact provider projection.' } }] }])
    ]
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return responses.shift()!
    }) as typeof fetch

    const events: string[] = []
    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: longTranscript(),
      tools: [],
      toolHandlers: {},
      contextCompaction: {
        ...forcedCompactionOptions,
        softThresholdTokens: 10_000,
        hardThresholdTokens: 20_000
      },
      callbacks: { onEvent: (event) => events.push(event.type) }
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('Continued from the compact provider projection.')
    expect(result.usage.providerCalls).toBe(2)
    expect(events).toContain('context_compaction_started')
    expect(events).toContain('context_compaction_completed')
    const providerRequest = requestBodies.find((body) => body.stream === true)!
    expect(JSON.stringify(providerRequest.messages)).not.toContain('OLD_USER_0')
    expect(JSON.stringify(providerRequest.messages)).toContain('LATEST_USER')
  })

  it('routes native Anthropic tool calls for the messages endpoint format', async () => {
    const messagesSettings = settings()
    messagesSettings.generator.endpointFormat = 'messages'
    const lookupTool = {
      type: 'function' as const,
      function: { name: 'lookup_glossary', description: 'Look up a term', parameters: { type: 'object', properties: { term: { type: 'string' } } } }
    }
    const responses = [
      sseResponse([
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup_glossary' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"term":"glossary"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' }
      ]),
      sseResponse([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Glossary resolved.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' }
      ])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await runAgentLoop({
      settings: messagesSettings,
      provider: { ...provider(), endpointFormat: 'messages' },
      messages: [{ role: 'user', content: 'Look up glossary' }],
      tools: [lookupTool],
      toolHandlers: { lookup_glossary: async () => 'glossary definition' }
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('Glossary resolved.')
    expect(result.messages.some((m) => m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0)).toBe(true)
    expect(responses).toHaveLength(0)
  })

  it('returns context_unrecoverable rather than a budget error when required-operation recovery still overflows', async () => {
    const recoveryTool = {
      type: 'function' as const,
      function: { name: 'required_operation', description: 'required', parameters: { type: 'object', properties: {} } }
    }
    const responses = [
      sseResponse([{ choices: [{ delta: { content: 'I will complete the required operation.' } }] }]),
      contextOverflowResponse(),
      jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Compact the required-operation context.' } }] }),
      contextOverflowResponse()
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: longTranscript(),
      tools: [recoveryTool],
      toolHandlers: { required_operation: async () => 'required operation completed' },
      contextCompaction: forcedCompactionOptions,
      iterationLimitRecovery: {
        shouldAttempt: () => true,
        instruction: 'Call the required operation now.',
        tools: [recoveryTool],
        toolChoice: { type: 'function', function: { name: 'required_operation' } },
        maxAttempts: 1
      }
    })

    expect(result.stopReason).toBe('context_unrecoverable')
    expect(result.error).toContain('上下文无法继续压缩')
    expect(result.usage.providerCalls).toBe(4)
    expect(responses).toHaveLength(0)
  })

  it('returns context_unrecoverable when the maintenance request cannot recover from overflow', async () => {
    const primaryTool = {
      type: 'function' as const,
      function: { name: 'primary_operation', description: 'primary', parameters: { type: 'object', properties: {} } }
    }
    const maintenanceTool = {
      type: 'function' as const,
      function: { name: 'maintenance_operation', description: 'maintenance', parameters: { type: 'object', properties: {} } }
    }
    const responses = [
      sseResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'primary-1', type: 'function', function: { name: 'primary_operation', arguments: '{}' } }] } }] }]),
      contextOverflowResponse(),
      jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Compact the maintenance context.' } }] }),
      contextOverflowResponse()
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: longTranscript(),
      tools: [primaryTool],
      toolHandlers: { primary_operation: async () => 'primary complete' },
      contextCompaction: forcedCompactionOptions,
      shouldFinalizeAfterToolExecution: () => true,
      finalizationTools: [maintenanceTool]
    })

    expect(result.stopReason).toBe('context_unrecoverable')
    expect(result.error).toContain('上下文无法继续压缩')
    expect(result.usage.providerCalls).toBe(4)
    expect(responses).toHaveLength(0)
  })

  it('returns context_unrecoverable when the no-tool final request cannot recover from overflow', async () => {
    const primaryTool = {
      type: 'function' as const,
      function: { name: 'primary_operation', description: 'primary', parameters: { type: 'object', properties: {} } }
    }
    const responses = [
      sseResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'primary-1', type: 'function', function: { name: 'primary_operation', arguments: '{}' } }] } }] }]),
      contextOverflowResponse(),
      jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Compact the final-answer context.' } }] }),
      contextOverflowResponse()
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: longTranscript(),
      tools: [primaryTool],
      toolHandlers: { primary_operation: async () => 'primary complete' },
      contextCompaction: forcedCompactionOptions,
      shouldFinalizeAfterToolExecution: () => true
    })

    expect(result.stopReason).toBe('context_unrecoverable')
    expect(result.error).toContain('上下文无法继续压缩')
    expect(result.usage.providerCalls).toBe(4)
    expect(responses).toHaveLength(0)
  })
  it('forces one projection-only compaction after context overflow, then retries once', async () => {
    const responses = [
      contextOverflowResponse(),
      jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Compact historical work; retain the current lesson task.' } }] }),
      sseResponse([{ choices: [{ delta: { content: 'Recovered after context compaction.' } }] }])
    ]
    const events: string[] = []
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: longTranscript(),
      tools: [],
      toolHandlers: {},
      contextCompaction: forcedCompactionOptions,
      callbacks: { onEvent: (event) => events.push(event.type) }
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('Recovered after context compaction.')
    expect(result.usage.providerCalls).toBe(3)
    expect(events).toContain('context_compaction_started')
    expect(events).toContain('context_compaction_completed')
    expect(responses).toHaveLength(0)
  })

  it('returns context_unrecoverable after the forced retry also overflows', async () => {
    const responses = [
      contextOverflowResponse(),
      jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Compact historical work.' } }] }),
      contextOverflowResponse()
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: longTranscript(),
      tools: [],
      toolHandlers: {},
      contextCompaction: forcedCompactionOptions
    })

    expect(result.stopReason).toBe('context_unrecoverable')
    expect(result.usage.providerCalls).toBe(3)
    expect(responses).toHaveLength(0)
  })

  it('does not send a normal projection that remains outside the context window after compaction fails', async () => {
    const responses = [
      jsonResponse({ choices: [{ message: { role: 'assistant', content: `too large ${'summary '.repeat(30_000)}` } }] }),
      contextOverflowResponse(),
      jsonResponse({ choices: [{ message: { role: 'assistant', content: 'must not be sent' } }] })
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: longTranscript(),
      tools: [],
      toolHandlers: {},
      contextCompaction: {
        ...forcedCompactionOptions,
        contextWindowTokens: 2_000,
        softThresholdTokens: 2_000,
        hardThresholdTokens: 2_000,
        failureCooldownMs: 1_000
      }
    })

    expect(result.stopReason).toBe('context_unrecoverable')
    expect(result.error).toContain('压缩后仍超过模型窗口')
    // The failed compaction summary is the only provider call; the known-unfit
    // normal request must not be dispatched.
    expect(result.usage.providerCalls).toBe(1)
    expect(responses).toHaveLength(2)
  })

  it('does not compact for a billing or quota failure', async () => {
    const events: string[] = []
    globalThis.fetch = (async () => jsonResponse({
      error: { message: 'Insufficient Balance', type: 'billing_error' }
    }, 402)) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: longTranscript(),
      tools: [],
      toolHandlers: {},
      contextCompaction: forcedCompactionOptions,
      callbacks: { onEvent: (event) => events.push(event.type) }
    })

    expect(result.stopReason).toBe('error')
    expect(result.usage.providerCalls).toBe(1)
    expect(events).not.toContain('context_compaction_started')
  })

  it('stops as canceled when cancellation arrives during forced compaction and does not retry', async () => {
    const controller = new AbortController()
    const requestBodies: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (requestBodies.length === 1) return contextOverflowResponse()
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
      })
    }) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: longTranscript(),
      tools: [],
      toolHandlers: {},
      contextCompaction: forcedCompactionOptions,
      signal: controller.signal,
      callbacks: {
        onEvent: (event) => {
          if (event.type === 'context_compaction_started') controller.abort()
        }
      }
    })

    expect(result.stopReason).toBe('canceled')
    expect(requestBodies.filter((body) => body.stream === true)).toHaveLength(1)
  })

  it('records a timed-out tool as a structured result and continues the run', async () => {
    const timedOutTool = {
      type: 'function' as const,
      function: { name: 'slow_lookup', description: 'lookup', parameters: { type: 'object', properties: {} } }
    }
    const requestBodies: Array<Record<string, unknown>> = []
    const toolResults: string[] = []
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{
          index: 0,
          id: 'slow-1',
          type: 'function',
          function: { name: 'slow_lookup', arguments: '{\"topic\":\"ADR-0010\"}' }
        }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: 'I handled the tool timeout safely.' } }] }])
    ]
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return responses.shift()!
    }) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: 'Look this up.' }],
      tools: [timedOutTool],
      toolHandlers: {
        slow_lookup: async () => {
          const error = new Error('lookup timed out')
          error.name = 'TimeoutError'
          throw error
        }
      },
      callbacks: {
        onEvent: (event) => {
          if (event.type === 'tool_result') toolResults.push(event.result)
        }
      }
    })

    expect(result.stopReason).toBe('final_answer')
    expect(result.finalText).toBe('I handled the tool timeout safely.')
    expect(result.usage.providerCalls).toBe(2)
    expect(result.usage.toolErrors).toBe(1)
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toContain('tool_timed_out')
    expect(JSON.stringify(requestBodies[1]?.messages)).toContain('tool_timed_out')
    expect(JSON.stringify(requestBodies[1]?.messages)).not.toContain('budget_exhausted')
  })

  it('stops repeated identical all-error tool calls as no_progress', async () => {
    const tool = {
      type: 'function' as const,
      function: { name: 'unstable_lookup', description: 'lookup', parameters: { type: 'object', properties: {} } }
    }
    const sameCall = (id: string) => sseResponse([{
      choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name: 'unstable_lookup', arguments: '{"topic":"MCP"}' } }] } }]
    }])
    const responses = [sameCall('call-1'), sameCall('call-2'), sameCall('call-3')]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await runAgentLoop({
      settings: settings(),
      provider: provider(),
      messages: [{ role: 'user', content: '查找 MCP 资料。' }],
      tools: [tool],
      toolHandlers: {
        unstable_lookup: async () => { throw new Error('upstream lookup failed') }
      }
    })

    expect(result.stopReason).toBe('no_progress')
    expect(result.error).toContain('工具调用重复且没有产生新的进展')
    expect(result.usage.providerCalls).toBe(3)
    expect(result.usage.toolErrors).toBe(3)
    expect(responses).toHaveLength(0)
  })
})

