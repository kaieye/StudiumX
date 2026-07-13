import assert from 'node:assert/strict'

import { defaultSettings } from '../../src/main/teaching-settings'
import {
  callChatProvider,
  callProvider,
  ProviderAdapterError,
  streamChatProvider,
  streamProvider,
  type ChatAdapterCallbacks,
  type ChatAdapterRequest,
  type ToolDefinition
} from '../../src/main/ai/provider-adapter'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const settings = (): TeachingSettingsV1 => {
  const value = defaultSettings('C:/provider-invocation-fixture')
  value.generator.endpointFormat = 'chat_completions'
  value.generator.requestTimeoutMs = 25
  return value
}

const provider = (apiKey = 'sk-provider-fixture-secret'): TeachingModelProviderProfile => ({
  ...settings().provider.providers[0]!,
  baseUrl: 'https://provider.example/v1',
  endpointFormat: 'chat_completions',
  apiKey
})

const textRequest = {
  systemPrompt: 'Be concise.',
  userPrompt: 'Hello.',
  jsonMode: false
}

const tool = {
  type: 'function',
  function: {
    name: 'lookup',
    description: 'Look up one fact.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  }
} satisfies ToolDefinition

const chatRequest: ChatAdapterRequest = {
  messages: [{ role: 'user', content: 'Find one fact.' }],
  tools: [tool]
}

const responseJson = (content: string, usage = { prompt_tokens: 3, completion_tokens: 5 }): Response => new Response(
  JSON.stringify({ choices: [{ message: { content } }], usage }),
  { status: 200, headers: { 'content-type': 'application/json' } }
)

const sse = (events: unknown[]): Response => new Response(
  `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
  { status: 200, headers: { 'content-type': 'text/event-stream' } }
)

const originalFetch = globalThis.fetch

async function withFetch(
  handler: typeof fetch,
  run: () => Promise<void>
): Promise<void> {
  globalThis.fetch = handler
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

try {
  // 1. All four public entries retain their observable JSON/SSE behavior.
  await withFetch(async () => responseJson('plain answer'), async () => {
    const statuses: string[] = []
    const result = await callProvider({
      settings: settings(),
      provider: provider(),
      request: textRequest,
      callbacks: { onStatus: (step) => statuses.push(step) }
    })
    assert.equal(result.text, 'plain answer')
    assert.deepEqual(result.usage, { promptTokens: 3, completionTokens: 5, totalTokens: 8 })
    assert.deepEqual(statuses, ['calling'])
  })

  await withFetch(async () => sse([
    { choices: [{ delta: { content: 'stream ' } }] },
    { choices: [{ delta: { content: 'answer' } }] }
  ]), async () => {
    const events: string[] = []
    const result = await streamProvider({
      settings: settings(),
      provider: provider(),
      request: textRequest,
      callbacks: {
        onStatus: (step) => events.push(`status:${step}`),
        onToken: (token) => events.push(`token:${token}`)
      }
    })
    assert.equal(result.text, 'stream answer')
    assert.deepEqual(events, ['status:calling', 'status:streaming', 'token:stream ', 'token:answer'])
  })

  await withFetch(async () => responseJson('chat answer', { prompt_tokens: 7, completion_tokens: 2 }), async () => {
    const events: string[] = []
    const result = await callChatProvider({
      settings: settings(),
      provider: provider(),
      request: { messages: [{ role: 'user', content: 'Hello.' }] },
      callbacks: { onStatus: (step) => events.push(`status:${step}`) }
    })
    assert.equal(result.text, 'chat answer')
    assert.deepEqual(result.usage, { promptTokens: 7, completionTokens: 2, totalTokens: 9 })
    assert.deepEqual(events, ['status:calling'])
  })

  await withFetch(async () => sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: '{"q":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"RAG"}' } }] } }] }
  ]), async () => {
    const events: string[] = []
    const callbacks: ChatAdapterCallbacks = {
      onStatus: (step) => events.push(`status:${step}`),
      onToolCalls: (calls) => events.push(`tools:${calls.map((call) => call.function.arguments).join('|')}`)
    }
    const result = await streamChatProvider({ settings: settings(), provider: provider(), request: chatRequest, callbacks })
    assert.equal(result.text, '')
    assert.deepEqual(result.toolCalls, [{
      id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"RAG"}' }
    }])
    assert.deepEqual(events, ['status:calling', 'status:streaming', 'tools:{"q":"RAG"}'])
  })

  // 2. API-key policy occurs before any request builder or transport work.
  let emptyKeyCalls = 0
  await withFetch(async () => {
    emptyKeyCalls += 1
    return responseJson('must not run')
  }, async () => {
    await assert.rejects(
      callProvider({ settings: settings(), provider: provider('   '), request: textRequest }),
      (error: unknown) => error instanceof ProviderAdapterError && error.kind === 'no_api_key'
    )
    assert.equal(emptyKeyCalls, 0)
  })

  // 3. A caller cancellation never starts the first-token fallback request.
  let canceledCalls = 0
  await withFetch(async () => {
    canceledCalls += 1
    throw new Error('The operation was aborted')
  }, async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      streamProvider({
        settings: settings(), provider: provider(), request: textRequest,
        callbacks: {}, signal: controller.signal
      }),
      (error: unknown) => error instanceof ProviderAdapterError && error.kind === 'network'
    )
    assert.equal(canceledCalls, 1)
  })

  // 4. Only a first-token timeout falls back once, with a single terminal callback sequence.
  let fallbackCalls = 0
  await withFetch(async () => {
    fallbackCalls += 1
    if (fallbackCalls === 1) throw new Error('Request timeout before first token')
    return responseJson('fallback answer')
  }, async () => {
    const events: string[] = []
    const result = await streamProvider({
      settings: settings(), provider: provider(), request: textRequest,
      callbacks: {
        onStatus: (step) => events.push(`status:${step}`),
        onToken: (token) => events.push(`token:${token}`)
      }
    })
    assert.equal(result.text, 'fallback answer')
    assert.equal(fallbackCalls, 2)
    assert.deepEqual(events, ['status:calling', 'status:streaming', 'token:fallback answer'])
  })

  // 5. Provider HTTP diagnostics redact credentials from server bodies.
  await withFetch(async () => new Response(
    '{"error":{"message":"Authorization: Bearer sk-leaked-provider-secret api_key=also-leaked"}}',
    { status: 500, statusText: 'Server Error' }
  ), async () => {
    await assert.rejects(
      callProvider({ settings: settings(), provider: provider(), request: textRequest }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderAdapterError)
        assert.equal(error.kind, 'http')
        assert.doesNotMatch(error.message, /sk-leaked-provider-secret|also-leaked/)
        assert.match(error.message, /\[redacted\]/)
        return true
      }
    )
  })

  // 6. A tools-specific 4xx retries exactly once without tools and reports one degraded result.
  const toolBodies: Array<{ tools?: unknown[] }> = []
  await withFetch(async (_url, init) => {
    toolBodies.push(JSON.parse(String(init?.body)) as { tools?: unknown[] })
    if (toolBodies.length === 1) {
      return new Response('{"error":{"message":"tools field is not supported"}}', { status: 400, statusText: 'Bad Request' })
    }
    return responseJson('degraded answer')
  }, async () => {
    const result = await callChatProvider({ settings: settings(), provider: provider(), request: chatRequest })
    assert.equal(result.text, 'degraded answer')
    assert.equal(result.degradedReason, 'provider_rejected_tools')
    assert.equal(toolBodies.length, 2)
    assert.ok(Array.isArray(toolBodies[0]?.tools))
    assert.equal(toolBodies[1]?.tools, undefined)
  })

  console.log('provider invocation boundaries ok')
} finally {
  globalThis.fetch = originalFetch
}
