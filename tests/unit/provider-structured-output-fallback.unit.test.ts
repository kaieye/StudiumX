import { afterEach, describe, expect, it } from 'vitest'

import { callProvider, streamChatProvider, streamProvider } from '../../src/main/ai/provider-adapter'
import { defaultSettings } from '../../src/main/teaching-settings'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function settingsFor(model = 'gpt-5', endpointFormat: 'responses' | 'chat_completions' = 'responses') {
  const settings = defaultSettings('/tmp/provider-structured-output-fallback')
  settings.generator.providerId = 'custom'
  settings.generator.endpointFormat = endpointFormat
  settings.generator.model = model
  settings.generator.reasoningEffort = 'high'
  settings.generator.streaming = endpointFormat === 'responses'
  settings.provider.activeProviderId = 'custom'
  settings.provider.providers = [{
    ...settings.provider.providers[0]!,
    id: 'custom',
    name: 'Fallback fixture',
    baseUrl: 'https://provider.example/v1',
    endpointFormat,
    models: [model],
    apiKey: 'sk-fixture'
  }]
  return settings
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function sseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .concat('data: [DONE]\n\n')
    .join('')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

const request = {
  systemPrompt: 'Return one JSON object.',
  userPrompt: 'Give me the object.',
  jsonMode: true
}

const validJson = '{"ok":true}'

describe('structured-output compatibility fallback', () => {
  it('disables DeepSeek thinking for strict JSON on custom OpenAI-compatible gateways', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      const thinking = body.thinking as { type?: unknown } | undefined
      if (thinking?.type !== 'disabled') {
        return jsonResponse({
          choices: [{
            message: { role: 'assistant', content: '', reasoning_content: 'private reasoning' },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
        })
      }
      return jsonResponse({
        choices: [{
          message: { role: 'assistant', content: validJson },
          finish_reason: 'stop'
        }]
      })
    }) as typeof fetch

    const settings = settingsFor('deepseek-v4-flash', 'chat_completions')
    const result = await callProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request
    })

    expect(result.text).toBe(validJson)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' }
    })
  })

  it('disables DeepSeek thinking for strict JSON streams on custom OpenAI-compatible gateways', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      const thinking = body.thinking as { type?: unknown } | undefined
      if (thinking?.type !== 'disabled') {
        return sseResponse([
          { choices: [{ delta: { reasoning_content: 'private reasoning' }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ])
      }
      return sseResponse([
        { choices: [{ delta: { content: validJson }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ])
    }) as typeof fetch

    const settings = settingsFor('deepseek-v4-flash', 'chat_completions')
    const answer: string[] = []
    const reasoning: string[] = []
    const result = await streamProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request,
      callbacks: {
        onToken: (delta) => answer.push(delta),
        onReasoning: (delta) => reasoning.push(delta)
      }
    })

    expect(result.text).toBe(validJson)
    expect(answer).toEqual([validJson])
    expect(reasoning).toEqual([])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' }
    })
  })

  it('retries once without DeepSeek thinking when a custom gateway rejects the disable control', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      if (requests.length === 1) {
        return new Response('unsupported parameter: thinking', {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'text/plain' }
        })
      }
      return jsonResponse({ choices: [{ message: { content: validJson } }] })
    }) as typeof fetch

    const settings = settingsFor('deepseek-v4-flash', 'chat_completions')
    await expect(callProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request
    })).resolves.toMatchObject({ text: validJson })

    expect(requests).toHaveLength(2)
    expect(requests[0]).toHaveProperty('thinking', { type: 'disabled' })
    expect(requests[1]).not.toHaveProperty('thinking')
    expect(requests[1]).not.toHaveProperty('reasoning_effort')
  })

  it('retries one reasoning-only non-stream response without reasoning controls', async () => {
    const requests: Record<string, unknown>[] = []
    let dispatches = 0
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      if (requests.length === 1) {
        return jsonResponse({
          output_text: '',
          output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'private' }] }],
          usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 }
        })
      }
      return jsonResponse({
        output_text: validJson,
        usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 }
      })
    }) as typeof fetch

    const result = await callProvider({
      settings: settingsFor(),
      provider: settingsFor().provider.providers[0]!,
      request,
      beforeTransportDispatch: () => { dispatches += 1 }
    })

    expect(result.text).toBe(validJson)
    expect(requests).toHaveLength(2)
    expect(requests[0]).toHaveProperty('reasoning')
    expect(requests[1]).not.toHaveProperty('reasoning')
    expect(dispatches).toBe(2)
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 9, totalTokens: 14 })
  })

  it('retries a reasoning-only streaming Responses response and consumes response.completed output', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      if (requests.length === 1) {
        return sseResponse([
          { type: 'response.reasoning_summary_text.delta', delta: 'private' },
          {
            type: 'response.completed',
            response: {
              status: 'completed',
              usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 }
            }
          }
        ])
      }
      return sseResponse([
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output_text: validJson,
            usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 }
          }
        }
      ])
    }) as typeof fetch

    const answer: string[] = []
    const reasoning: string[] = []
    const settings = settingsFor()
    const result = await streamProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request,
      callbacks: {
        onToken: (delta) => answer.push(delta),
        onReasoning: (delta) => reasoning.push(delta)
      }
    })

    expect(result.text).toBe(validJson)
    expect(answer).toEqual([validJson])
    expect(reasoning).toEqual(['private'])
    expect(requests).toHaveLength(2)
    expect(requests[0]).toHaveProperty('reasoning')
    expect(requests[1]).not.toHaveProperty('reasoning')
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 9, totalTokens: 14 })
  })

  it('aggregates compatibility-attempt usage for streaming structured chat', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (requests.length === 1) {
        return sseResponse([
          { type: 'response.reasoning_summary_text.delta', delta: 'private' },
          {
            type: 'response.completed',
            response: {
              status: 'completed',
              usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 }
            }
          }
        ])
      }
      return sseResponse([
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output_text: validJson,
            usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
          }
        }
      ])
    }) as typeof fetch

    const settings = settingsFor()
    const result = await streamChatProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request: {
        messages: [
          { role: 'system', content: 'Return one JSON object.' },
          { role: 'user', content: 'Give me the object.' }
        ],
        jsonMode: true
      },
      callbacks: {}
    })

    expect(result.text).toBe(validJson)
    expect(result.usage).toEqual({ promptTokens: 9, completionTokens: 14, totalTokens: 23 })
    expect(requests).toHaveLength(2)
    expect(requests[0]).toHaveProperty('reasoning')
    expect(requests[1]).not.toHaveProperty('reasoning')
  })

  it('shares the compatibility retry across streaming text timeout recovery', async () => {
    const requests: Record<string, unknown>[] = []
    let dispatches = 0
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      if (requests.length === 1) {
        return sseResponse([
          { type: 'response.reasoning_summary_text.delta', delta: 'private' },
          {
            type: 'response.completed',
            response: {
              status: 'completed',
              usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 }
            }
          }
        ])
      }
      if (requests.length === 2) throw new Error('timeout before first token')
      return jsonResponse({
        output_text: validJson,
        usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 }
      })
    }) as typeof fetch

    const answer: string[] = []
    const settings = settingsFor()
    const result = await streamProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request,
      callbacks: { onToken: (delta) => answer.push(delta) },
      beforeTransportDispatch: () => { dispatches += 1 }
    })

    expect(result.text).toBe(validJson)
    expect(answer).toEqual([validJson])
    expect(requests).toHaveLength(3)
    expect(requests.map((body) => body.stream)).toEqual([true, true, false])
    expect(requests[0]).toHaveProperty('reasoning')
    expect(requests[1]).not.toHaveProperty('reasoning')
    expect(requests[2]).not.toHaveProperty('reasoning')
    expect(dispatches).toBe(3)
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 9, totalTokens: 14 })
  })

  it('shares the compatibility retry across streaming chat timeout recovery', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      if (requests.length === 1) {
        return sseResponse([
          { type: 'response.reasoning_summary_text.delta', delta: 'private' },
          {
            type: 'response.completed',
            response: {
              status: 'completed',
              usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 }
            }
          }
        ])
      }
      if (requests.length === 2) throw new Error('timeout before first token')
      return jsonResponse({
        output_text: validJson,
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
      })
    }) as typeof fetch

    const settings = settingsFor()
    const result = await streamChatProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request: {
        messages: [
          { role: 'system', content: 'Return one JSON object.' },
          { role: 'user', content: 'Give me the object.' }
        ],
        jsonMode: true
      },
      callbacks: {}
    })

    expect(result.text).toBe(validJson)
    expect(requests).toHaveLength(3)
    expect(requests.map((body) => body.stream)).toEqual([true, true, false])
    expect(requests[0]).toHaveProperty('reasoning')
    expect(requests[1]).not.toHaveProperty('reasoning')
    expect(requests[2]).not.toHaveProperty('reasoning')
    expect(result.usage).toEqual({ promptTokens: 9, completionTokens: 14, totalTokens: 23 })
  })

  it('does not grant another compatibility retry after timeout recovery', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (requests.length === 1) {
        return sseResponse([
          { type: 'response.reasoning_summary_text.delta', delta: 'private' },
          {
            type: 'response.completed',
            response: {
              status: 'completed',
              usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 }
            }
          }
        ])
      }
      if (requests.length === 2) throw new Error('timeout before first token')
      return jsonResponse({
        output_text: '',
        output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'still private' }] }],
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
      })
    }) as typeof fetch

    const settings = settingsFor()
    await expect(streamProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request,
      callbacks: {}
    })).rejects.toMatchObject({
      kind: 'parse',
      code: 'reasoning_only',
      usage: { promptTokens: 9, completionTokens: 14, totalTokens: 23 }
    })

    expect(requests).toHaveLength(3)
    expect(requests[2]).not.toHaveProperty('reasoning')
  })

  it('does not grant another compatibility retry after a tools fallback', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (requests.length === 1) {
        return new Response('unsupported parameter: reasoning', {
          status: 400,
          statusText: 'Bad Request'
        })
      }
      if (requests.length === 2) {
        return new Response('function tools are unsupported', {
          status: 400,
          statusText: 'Bad Request'
        })
      }
      return new Response('unsupported parameter: reasoning', {
        status: 400,
        statusText: 'Bad Request'
      })
    }) as typeof fetch

    const settings = settingsFor()
    await expect(streamChatProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request: {
        messages: [
          { role: 'system', content: 'Return one JSON object.' },
          { role: 'user', content: 'Give me the object.' }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Look up a fixture.',
            parameters: { type: 'object', properties: {} }
          }
        }],
        jsonMode: true
      },
      callbacks: {}
    })).rejects.toMatchObject({ kind: 'http' })

    expect(requests).toHaveLength(3)
    expect(requests[0]).toHaveProperty('reasoning')
    expect(requests[0]).toHaveProperty('tools')
    expect(requests[1]).not.toHaveProperty('reasoning')
    expect(requests[1]).toHaveProperty('tools')
    expect(requests[2]).not.toHaveProperty('reasoning')
    expect(requests[2]).not.toHaveProperty('tools')
  })

  it('retries a narrowly classified 400 reasoning-parameter rejection', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (requests.length === 1) {
        return new Response('unsupported parameter: reasoning', {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'text/plain' }
        })
      }
      return jsonResponse({ output_text: validJson })
    }) as typeof fetch

    const settings = settingsFor()
    await expect(callProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request
    })).resolves.toMatchObject({ text: validJson })

    expect(requests).toHaveLength(2)
    expect(requests[1]).not.toHaveProperty('reasoning')
  })

  it('retries Ark Responses once without thinking when the gateway rejects the disable control', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (requests.length === 1) {
        return new Response('unsupported parameter: thinking', {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'text/plain' }
        })
      }
      return jsonResponse({ output_text: validJson })
    }) as typeof fetch

    const settings = settingsFor('deepseek-v4-flash-ga-260731')
    settings.provider.providers[0]!.baseUrl = 'https://ark.cn-beijing.volces.com/api/coding/v3'

    await expect(callProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request
    })).resolves.toMatchObject({ text: validJson })

    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ thinking: { type: 'disabled' } })
    expect(requests[1]).not.toHaveProperty('thinking')
    expect(requests[1]).not.toHaveProperty('reasoning')
  })

  it('does not retry authentication failures or ordinary malformed output', async () => {
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      return new Response('invalid key', { status: 401, statusText: 'Unauthorized' })
    }) as typeof fetch
    const settings = settingsFor()
    await expect(callProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request
    })).rejects.toMatchObject({ kind: 'http' })
    expect(fetches).toBe(1)

    fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      return jsonResponse({ output_text: 'not-json-but-still-text' })
    }) as typeof fetch
    await expect(callProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request
    })).resolves.toMatchObject({ text: 'not-json-but-still-text' })
    expect(fetches).toBe(1)
  })

  it('stops after one compatibility retry when the provider remains reasoning-only', async () => {
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      return jsonResponse({
        output_text: '',
        output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'private' }] }],
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
      })
    }) as typeof fetch
    const settings = settingsFor()
    await expect(callProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request
    })).rejects.toMatchObject({
      kind: 'parse',
      code: 'reasoning_only',
      usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 }
    })
    expect(fetches).toBe(2)
  })

  it('retries a reasoning-only non-JSON chat stream once with thinking disabled', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      if (requests.length === 1) {
        // DeepSeek Responses stream: thinking enabled, only reasoning, no tool call.
        return sseResponse([
          { type: 'response.reasoning_summary_text.delta', delta: 'private plan' },
          {
            type: 'response.completed',
            response: { status: 'completed', usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 } }
          }
        ])
      }
      // Retry with thinking disabled: the non-streaming response carries the tool call.
      return jsonResponse({
        output: [{
          type: 'function_call',
          call_id: 'call_1',
          name: 'submit_mind_map_document',
          arguments: '{"schemaVersion":2,"title":"T","sheets":[]}'
        }],
        usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 }
      })
    }) as typeof fetch

    const settings = settingsFor('deepseek-v4-flash-ga-260731', 'responses')
    const reasoning: string[] = []
    const result = await streamChatProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request: {
        messages: [
          { role: 'system', content: 'Return a mind map.' },
          { role: 'user', content: '根据 notes.md 生成思维导图' }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'submit_mind_map_document',
            description: 'Submit the mind map document.',
            parameters: { type: 'object', properties: {} }
          }
        }],
        jsonMode: false
      },
      callbacks: { onReasoning: (delta) => reasoning.push(delta) }
    })

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]!.function.name).toBe('submit_mind_map_document')
    expect(reasoning).toEqual(['private plan'])
    expect(requests).toHaveLength(2)
    expect(requests[0]).toHaveProperty('reasoning')
    expect(requests[1]).toMatchObject({ thinking: { type: 'disabled' } })
    expect(requests[1]).not.toHaveProperty('reasoning')
  })

  it('stops after one reasoning-disabled retry when a non-JSON chat stream stays reasoning-only', async () => {
    const requests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      if (requests.length === 1) {
        return sseResponse([
          { type: 'response.reasoning_summary_text.delta', delta: 'private plan' },
          { type: 'response.completed', response: { status: 'completed' } }
        ])
      }
      return jsonResponse({
        output_text: '',
        output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'still private' }] }],
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
      })
    }) as typeof fetch

    const settings = settingsFor('deepseek-v4-flash-ga-260731', 'responses')
    await expect(streamChatProvider({
      settings,
      provider: settings.provider.providers[0]!,
      request: {
        messages: [
          { role: 'system', content: 'Return a mind map.' },
          { role: 'user', content: '根据 notes.md 生成思维导图' }
        ],
        jsonMode: false
      },
      callbacks: {}
    })).rejects.toMatchObject({ kind: 'parse', code: 'reasoning_only' })

    expect(requests).toHaveLength(2)
    expect(requests[0]).toHaveProperty('reasoning')
    expect(requests[1]).toMatchObject({ thinking: { type: 'disabled' } })
  })
})
