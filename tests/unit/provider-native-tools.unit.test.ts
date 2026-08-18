import { describe, expect, it } from 'vitest'
import { buildChatRequest } from '../../src/main/ai/provider-adapter/request-builder'
import { extractToolCalls } from '../../src/main/ai/provider-adapter/response-parser'
import { readChatSseStream } from '../../src/main/ai/provider-adapter/sse-parser'
import { defaultSettings } from '../../src/main/teaching-settings'
import type {
  ChatAdapterRequest,
  ToolCall
} from '../../src/main/ai/provider-adapter'
import type { TeachingModelProviderProfile } from '../../src/shared/teaching-types'

function provider(): TeachingModelProviderProfile {
  const settings = defaultSettings('C:/provider-native-tools-fixture')
  return {
    ...settings.provider.providers[0]!,
    baseUrl: 'https://provider.example/v1',
    apiKey: 'sk-fixture'
  }
}

function generator() {
  const settings = defaultSettings('C:/provider-native-tools-fixture')
  return settings.generator
}

function toolDefinition(name: string) {
  return {
    type: 'function' as const,
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: { term: { type: 'string' } } }
    }
  }
}

function toolCall(name: string, id: string, args: string): ToolCall {
  return { id, type: 'function', function: { name, arguments: args } }
}

function readBody(built: { url: string; init: RequestInit }): { url: string; body: Record<string, unknown> } {
  return { url: built.url, body: JSON.parse(String(built.init.body)) }
}

describe('buildChatRequest native tool formats', () => {
  it('builds a Responses API request with native tools and tool_choice', () => {
    const request: ChatAdapterRequest = {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' }
      ],
      tools: [toolDefinition('lookup_glossary')],
      toolChoice: 'auto'
    }
    const { url, body } = readBody(buildChatRequest('responses', {
      provider: provider(),
      generator: generator(),
      request,
      stream: true,
      includeTools: true
    }))
    expect(url).toContain('/v1/responses')
    expect(body.instructions).toBe('sys')
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hello' }] }
    ])
    expect(body.tools).toEqual([
      { type: 'function', name: 'lookup_glossary', description: 'lookup_glossary description', parameters: { type: 'object', properties: { term: { type: 'string' } } } }
    ])
    expect(body.tool_choice).toBe('auto')
    expect(body.stream).toBe(true)
  })

  it('builds a Responses API request carrying a prior tool call and result', () => {
    const request: ChatAdapterRequest = {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'thinking', tool_calls: [toolCall('lookup_glossary', 'fc_1', '{"term":"x"}')] },
        { role: 'tool', tool_call_id: 'fc_1', content: 'result' },
        { role: 'user', content: 'follow-up' }
      ],
      tools: [toolDefinition('lookup_glossary')]
    }
    const { body } = readBody(buildChatRequest('responses', {
      provider: provider(), generator: generator(), request, stream: false, includeTools: true
    }))
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'thinking' }] },
      {
        type: 'function_call',
        call_id: 'fc_1',
        name: 'lookup_glossary',
        arguments: '{"term":"x"}'
      },
      { type: 'function_call_output', call_id: 'fc_1', output: 'result' },
      { role: 'user', content: [{ type: 'input_text', text: 'follow-up' }] }
    ])
  })

  it('builds an Anthropic Messages request with native tools and role merging', () => {
    const request: ChatAdapterRequest = {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: null, tool_calls: [toolCall('lookup_glossary', 'toolu_1', '{"term":"x"}')] },
        { role: 'tool', tool_call_id: 'toolu_1', content: 'result' },
        { role: 'user', content: 'q3' }
      ],
      tools: [toolDefinition('lookup_glossary')],
      toolChoice: { type: 'function', function: { name: 'lookup_glossary' } }
    }
    const { url, body } = readBody(buildChatRequest('messages', {
      provider: provider(), generator: generator(), request, stream: false, includeTools: true
    }))
    expect(url).toContain('/v1/messages')
    expect(body.system).toBe('sys')
    const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
    // Consecutive user turns are merged into alternating roles.
    const roles = messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    const assistantToolUse = messages[3]!.content
    expect(assistantToolUse.some((c) => c.type === 'tool_use' && c.id === 'toolu_1' && c.name === 'lookup_glossary')).toBe(true)
    // tool result folds into the following user turn.
    const lastUser = messages[4]!.content
    expect(lastUser.some((c) => c.type === 'tool_result' && c.tool_use_id === 'toolu_1')).toBe(true)
    expect(lastUser.some((c) => c.type === 'text' && c.text === 'q3')).toBe(true)
    expect(body.tools).toEqual([
      { name: 'lookup_glossary', description: 'lookup_glossary description', input_schema: { type: 'object', properties: { term: { type: 'string' } } } }
    ])
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'lookup_glossary' })
  })

  it('omits tools when includeTools is false', () => {
    const request: ChatAdapterRequest = {
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }],
      tools: [toolDefinition('lookup_glossary')]
    }
    for (const format of ['responses', 'messages'] as const) {
      const { body } = readBody(buildChatRequest(format, {
        provider: provider(), generator: generator(), request, stream: false, includeTools: false
      }))
      expect(body.tools).toBeUndefined()
      expect(body.tool_choice).toBeUndefined()
    }
  })
})

describe('extractToolCalls native formats', () => {
  it('extracts function_call items from a Responses body', () => {
    const calls = extractToolCalls('responses', {
      output: [
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'lookup_glossary',
          arguments: '{"term":"x"}'
        },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }
      ]
    })
    expect(calls).toEqual([toolCall('lookup_glossary', 'call_1', '{"term":"x"}')])
  })

  it('extracts tool_use blocks from an Anthropic Messages body', () => {
    const calls = extractToolCalls('messages', {
      content: [
        { type: 'text', text: 'thinking' },
        { type: 'tool_use', id: 'toolu_1', name: 'lookup_glossary', input: { term: 'x' } }
      ]
    })
    expect(calls).toEqual([toolCall('lookup_glossary', 'toolu_1', '{"term":"x"}')])
  })

  it('returns empty when no native tool output exists', () => {
    expect(extractToolCalls('responses', { output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }] })).toEqual([])
    expect(extractToolCalls('messages', { content: [{ type: 'text', text: 'hi' }] })).toEqual([])
  })
})

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) { controller.close(); return }
      controller.enqueue(encoder.encode(chunks[index]))
      index += 1
    }
  })
}

describe('readChatSseStream native tool streaming', () => {
  it('assembles Anthropic tool_use deltas into a tool call', async () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup_glossary' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"term"' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':"x"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' }
    ]
    const body = sseBody(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).concat('data: [DONE]\n\n'))
    const result = await readChatSseStream(body, 'messages')
    expect(result.toolCalls).toEqual([toolCall('lookup_glossary', 'toolu_1', '{"term":"x"}')])
    expect(result.finishReason).toBe('tool_calls')
    expect(result.text).toBe('')
  })

  it('assembles Responses function_call deltas into a tool call', async () => {
    const events = [
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup_glossary' } },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"term":"x"}' },
      { type: 'response.completed', response: { status: 'completed' } }
    ]
    const body = sseBody(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).concat('data: [DONE]\n\n'))
    const result = await readChatSseStream(body, 'responses')
    expect(result.toolCalls).toEqual([toolCall('lookup_glossary', 'call_1', '{"term":"x"}')])
    expect(result.finishReason).toBe('stop')
  })

  it('streams Responses output text and reasoning deltas', async () => {
    const events = [
      { type: 'response.reasoning_summary_text.delta', delta: 'thinking' },
      { type: 'response.output_text.delta', delta: 'Hello ' },
      { type: 'response.output_text.delta', delta: 'world.' },
      { type: 'response.completed', response: { status: 'completed' } }
    ]
    const body = sseBody(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).concat('data: [DONE]\n\n'))
    const tokens: string[] = []
    const result = await readChatSseStream(body, 'responses', (d) => tokens.push(d))
    expect(result.text).toBe('Hello world.')
    expect(tokens.join('')).toBe('Hello world.')
    expect(result.toolCalls).toEqual([])
  })
})


