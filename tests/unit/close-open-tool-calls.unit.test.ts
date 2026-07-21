import { describe, expect, it } from 'vitest'
import {
  closeOpenToolCalls,
  listOpenToolCalls
} from '../../src/main/ai/close-open-tool-calls'
import { TOOL_CANCELED_MESSAGE } from '../../src/main/ai/tools/tool-arguments'
import type { ChatMessage } from '../../src/main/ai/provider-adapter'

describe('closeOpenToolCalls', () => {
  it('appends synthetic tool results for unpaired tool_calls only', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'search_notes', arguments: '{}' } },
          { id: 'call-2', type: 'function', function: { name: 'read_file', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' }
    ]

    const open = listOpenToolCalls(messages)
    expect(open.map((c) => c.id)).toEqual(['call-2'])

    const closed = closeOpenToolCalls(messages)
    expect(closed.closed).toEqual([{ toolCallId: 'call-2', name: 'read_file' }])
    expect(closed.messages).toHaveLength(messages.length + 1)
    const toolMsg = closed.messages.at(-1)
    expect(toolMsg).toMatchObject({ role: 'tool', tool_call_id: 'call-2' })
    expect(JSON.parse(String(toolMsg?.content))).toEqual({
      error: 'tool_canceled',
      message: TOOL_CANCELED_MESSAGE
    })
    // Original unpaired id is now paired.
    expect(listOpenToolCalls(closed.messages)).toEqual([])
  })

  it('is a no-op when every tool_call already has a result', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'search_notes', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'done' }
    ]
    const closed = closeOpenToolCalls(messages)
    expect(closed.closed).toEqual([])
    expect(closed.messages).toEqual(messages)
  })

  it('does not invent tool_calls when the transcript has none open', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' }
    ]
    const closed = closeOpenToolCalls(messages)
    expect(closed.closed).toEqual([])
    expect(closed.messages).toEqual(messages)
    expect(listOpenToolCalls(messages)).toEqual([])
  })
})
