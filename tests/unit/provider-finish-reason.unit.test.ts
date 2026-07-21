import { describe, expect, it } from 'vitest'
import { extractFinishReason } from '../../src/main/ai/provider-adapter/response-parser'
import { readChatSseStream } from '../../src/main/ai/provider-adapter/sse-parser'

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

describe('extractFinishReason', () => {
  it('maps chat_completions finish_reason stop / length / tool_calls', () => {
    expect(extractFinishReason('chat_completions', {
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }]
    })).toBe('stop')
    expect(extractFinishReason('chat_completions', {
      choices: [{ finish_reason: 'length', message: { content: 'trunc' } }]
    })).toBe('length')
    expect(extractFinishReason('chat_completions', {
      choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [] } }]
    })).toBe('tool_calls')
    expect(extractFinishReason('chat_completions', {
      choices: [{ finish_reason: 'max_tokens', message: { content: 'x' } }]
    })).toBe('length')
  })

  it('returns undefined when no finish signal is present (must not forge stop)', () => {
    expect(extractFinishReason('chat_completions', {
      choices: [{ message: { content: 'ok' } }]
    })).toBeUndefined()
    expect(extractFinishReason('chat_completions', {})).toBeUndefined()
  })

  it('maps messages stop_reason and responses status', () => {
    expect(extractFinishReason('messages', { stop_reason: 'end_turn', content: 'hi' })).toBe('stop')
    expect(extractFinishReason('messages', { stop_reason: 'max_tokens' })).toBe('length')
    expect(extractFinishReason('messages', { stop_reason: 'tool_use' })).toBe('tool_calls')
    expect(extractFinishReason('responses', { status: 'completed' })).toBe('stop')
    expect(extractFinishReason('responses', {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' }
    })).toBe('length')
  })
})

describe('readChatSseStream finishReason', () => {
  it('captures finish_reason from a terminal SSE chunk', async () => {
    const result = await readChatSseStream(
      sseBody([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hello' } }] }) + '\n\n',
        'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] }) + '\n\n',
        'data: [DONE]\n\n'
      ]),
      'chat_completions'
    )
    expect(result.text).toBe('hello')
    expect(result.finishReason).toBe('length')
  })

  it('captures tool_calls finish_reason with assembled tool calls', async () => {
    const result = await readChatSseStream(
      sseBody([
        'data: ' + JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{}' } }]
            }
          }]
        }) + '\n\n',
        'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + '\n\n',
        'data: [DONE]\n\n'
      ]),
      'chat_completions'
    )
    expect(result.toolCalls).toHaveLength(1)
    expect(result.finishReason).toBe('tool_calls')
  })

  it('omits finishReason when stream never reports one', async () => {
    const result = await readChatSseStream(
      sseBody([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'only text' } }] }) + '\n\n',
        'data: [DONE]\n\n'
      ]),
      'chat_completions'
    )
    expect(result.text).toBe('only text')
    expect(result.finishReason).toBeUndefined()
  })
})
