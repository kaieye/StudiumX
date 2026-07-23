import { describe, expect, it } from 'vitest'
import { extractUsage } from '../../src/main/ai/provider-adapter/response-parser'
import { readChatSseStream, readSseStream } from '../../src/main/ai/provider-adapter/sse-parser'
import { buildChatRequest, buildRequest } from '../../src/main/ai/provider-adapter/request-builder'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[index]))
      index += 1
    }
  })
}

describe('extractUsage stream event shapes', () => {
  it('reads top-level OpenAI chat usage', () => {
    expect(extractUsage('chat_completions', {
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
    })).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 })
  })

  it('reads Anthropic message_delta.usage', () => {
    expect(extractUsage('messages', {
      type: 'message_delta',
      usage: { input_tokens: 20, output_tokens: 5 }
    })).toEqual({ promptTokens: 20, completionTokens: 5, totalTokens: 25 })
  })

  it('reads responses.completed nested usage', () => {
    expect(extractUsage('responses', {
      type: 'response.completed',
      response: { usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } }
    })).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 })
  })
})

describe('readChatSseStream usage', () => {
  it('captures usage from the final OpenAI-compatible SSE chunk', async () => {
    const result = await readChatSseStream(
      sseBody([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n\n',
        'data: ' + JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
        }) + '\n\n',
        'data: [DONE]\n\n'
      ]),
      'chat_completions'
    )
    expect(result.text).toBe('hi')
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 })
  })

  it('omits usage when the stream never reports it', async () => {
    const result = await readChatSseStream(
      sseBody([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'x' } }] }) + '\n\n',
        'data: [DONE]\n\n'
      ]),
      'chat_completions'
    )
    expect(result.usage).toBeUndefined()
  })
})

describe('readSseStream usage (shared framing)', () => {
  it('captures usage from the final OpenAI-compatible text SSE chunk', async () => {
    const tokens: string[] = []
    const result = await readSseStream(
      sseBody([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n\n',
        'data: ' + JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 }
        }) + '\n\n',
        'data: [DONE]\n\n'
      ]),
      'chat_completions',
      (delta) => tokens.push(delta)
    )
    expect(tokens).toEqual(['hi'])
    expect(result.text).toBe('hi')
    expect(result.usage).toEqual({ promptTokens: 9, completionTokens: 2, totalTokens: 11 })
  })

  it('omits usage when the text stream never reports it', async () => {
    const result = await readSseStream(
      sseBody([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'x' } }] }) + '\n\n',
        'data: [DONE]\n\n'
      ]),
      'chat_completions',
      () => {}
    )
    expect(result.text).toBe('x')
    expect(result.usage).toBeUndefined()
  })
})

describe('buildChatRequest stream usage option', () => {
  const provider = {
    id: 'p',
    name: 'P',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'k'
  } as TeachingModelProviderProfile
  const generator = {
    model: 'm',
    temperature: 0.2,
    maxOutputTokens: 100,
    endpointFormat: 'chat_completions'
  } as TeachingSettingsV1['generator']

  it('requests include_usage for streaming chat completions', () => {
    const built = buildChatRequest('chat_completions', {
      provider,
      generator,
      request: { messages: [{ role: 'user', content: 'hi' }] },
      stream: true,
      includeTools: false
    })
    const body = JSON.parse(String(built.init.body))
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('requests include_usage for streaming text completions builds', () => {
    const built = buildRequest('chat_completions', {
      provider,
      generator,
      request: { systemPrompt: 's', userPrompt: 'u', jsonMode: false },
      stream: true
    })
    const body = JSON.parse(String(built.init.body))
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('does not send stream_options for non-stream requests', () => {
    const built = buildChatRequest('chat_completions', {
      provider,
      generator,
      request: { messages: [{ role: 'user', content: 'hi' }] },
      stream: false,
      includeTools: false
    })
    const body = JSON.parse(String(built.init.body))
    expect(body.stream_options).toBeUndefined()
  })
})
