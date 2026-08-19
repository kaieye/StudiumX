import { describe, expect, it } from 'vitest'
import { readChatSseStream, readSseStream } from '../../src/main/ai/provider-adapter/sse-parser'

function sseBody(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    }
  })
}

describe('provider SSE reasoning', () => {
  it('streams OpenAI-compatible reasoning separately from answer text', async () => {
    const answer: string[] = []
    const reasoning: string[] = []
    const result = await readChatSseStream(
      sseBody([
        { choices: [{ delta: { reasoning_content: '先分析' } }] },
        { choices: [{ delta: { content: '最终答案' } }] }
      ]),
      'chat_completions',
      (delta) => answer.push(delta),
      (delta) => reasoning.push(delta)
    )

    expect(reasoning).toEqual(['先分析'])
    expect(answer).toEqual(['最终答案'])
    expect(result.text).toBe('最终答案')
  })

  it('streams Anthropic thinking deltas separately from answer text', async () => {
    const answer: string[] = []
    const reasoning: string[] = []
    const result = await readSseStream(
      sseBody([
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '检查资料' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: '回答' } }
      ]),
      'messages',
      (delta) => answer.push(delta),
      (delta) => reasoning.push(delta)
    )

    expect(reasoning).toEqual(['检查资料'])
    expect(answer).toEqual(['回答'])
    expect(result.text).toBe('回答')
  })

  it('accepts OpenAI-compatible array content parts and missing tool call ids', async () => {
    const answer: string[] = []
    const result = await readChatSseStream(
      sseBody([
        { choices: [{ delta: { content: [{ type: 'text', text: '分段' }, { type: 'text', text: '内容' }] } }] },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { name: 'web_search', arguments: '{"query":"ai"}' }
              }]
            }
          }]
        }
      ]),
      'chat_completions',
      (delta) => answer.push(delta)
    )

    expect(answer).toEqual(['分段内容'])
    expect(result.text).toBe('分段内容')
    expect(result.toolCalls).toEqual([
      {
        id: 'call_0',
        type: 'function',
        function: { name: 'web_search', arguments: '{"query":"ai"}' }
      }
    ])
  })

  it('recovers complete Responses text carried only by response.completed', async () => {
    const answer: string[] = []
    const result = await readSseStream(
      sseBody([
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output_text: '{"schemaVersion":1}'
          }
        }
      ]),
      'responses',
      (delta) => answer.push(delta)
    )

    expect(result.text).toBe('{"schemaVersion":1}')
    expect(answer).toEqual(['{"schemaVersion":1}'])
  })

  it('does not duplicate a Responses completed body after output deltas', async () => {
    const answer: string[] = []
    const result = await readSseStream(
      sseBody([
        { type: 'response.output_text.delta', delta: '{"schema' },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output_text: '{"schemaVersion":1}'
          }
        }
      ]),
      'responses',
      (delta) => answer.push(delta)
    )

    expect(result.text).toBe('{"schemaVersion":1}')
    expect(answer).toEqual(['{"schema', 'Version":1}'])
  })

  it('marks reasoning-only Responses streams without exposing reasoning as text', async () => {
    const reasoning: string[] = []
    const result = await readSseStream(
      sseBody([
        { type: 'response.reasoning_summary_text.delta', delta: 'internal plan' },
        { type: 'response.completed', response: { status: 'completed' } }
      ]),
      'responses',
      () => {},
      (delta) => reasoning.push(delta)
    )

    expect(result.text).toBe('')
    expect(result.hadReasoning).toBe(true)
    expect(reasoning).toEqual(['internal plan'])
  })
})
