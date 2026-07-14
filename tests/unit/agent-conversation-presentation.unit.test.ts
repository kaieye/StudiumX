import { describe, expect, it } from 'vitest'
import { buildAgentConversationPresentation } from '../../src/renderer/src/agent-conversation-presentation'
import type { AgentChatProcessEvent, AgentChatTurn } from '../../src/shared/teaching-types'

const createdAt = '2026-07-14T10:00:00.000Z'

function assistantTurn(overrides: Partial<AgentChatTurn> = {}): AgentChatTurn {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    createdAt,
    ...overrides
  }
}

describe('Agent conversation presentation', () => {
  it('normalizes equivalent live and durable tool evidence into the same provenance ordering', () => {
    const toolCall = { id: 'search-1', name: 'search_notes', arguments: '{"query":"momentum"}', result: 'Found one note.' }
    const liveEvents: AgentChatProcessEvent[] = [
      {
        id: 'live-call',
        kind: 'tool_call',
        title: '调用工具：search_notes',
        detail: '{"query":"momentum"}',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        createdAt
      },
      {
        id: 'live-result',
        kind: 'tool_result',
        title: '工具完成：search_notes',
        detail: 'Found one note.',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        createdAt
      }
    ]
    const live = buildAgentConversationPresentation({
      turns: [assistantTurn({ toolCalls: [toolCall], processEvents: liveEvents })]
    })
    const durable = buildAgentConversationPresentation({
      turns: [assistantTurn({ toolCalls: [toolCall] })]
    })

    const signature = (presentation: typeof live) => presentation.turns[0].items.map((item) => [item.kind, item.label])
    expect(signature(live)).toEqual(signature(durable))
    expect(signature(durable)).toEqual([
      ['tool_call', '调用工具：search_notes'],
      ['tool_result', '工具完成：search_notes']
    ])
  })

  it('exposes the correct blocked command for pending Ask and tool-permission interruptions', () => {
    const ask = buildAgentConversationPresentation({
      turns: [],
      interruption: {
        kind: 'ask',
        streamId: 'stream-ask',
        toolCallId: 'ask-1',
        questions: [{ id: 'goal', prompt: 'Choose a goal', options: [{ label: 'A' }, { label: 'B' }] }]
      }
    })
    const permission = buildAgentConversationPresentation({
      turns: [],
      interruption: {
        kind: 'tool_permission',
        streamId: 'stream-permission',
        toolCallId: 'permission-1',
        request: { id: 'request-1', kind: 'workspace_write', toolName: 'write_file', operation: 'Write', targetPath: 'notes/a.md' }
      }
    })

    expect(ask.blocked).toMatchObject({
      kind: 'ask',
      command: { kind: 'answer_ask', streamId: 'stream-ask', toolCallId: 'ask-1' }
    })
    expect(ask.commands).toEqual([{ kind: 'answer_ask', streamId: 'stream-ask', toolCallId: 'ask-1' }])
    expect(permission.blocked).toMatchObject({
      kind: 'tool_permission',
      command: { kind: 'answer_tool_permission', streamId: 'stream-permission', toolCallId: 'permission-1' }
    })
  })

  it('makes archived, missing, and oversized tool results disclosure-only', () => {
    const archived = buildAgentConversationPresentation({
      turns: [assistantTurn({
        toolCalls: [{ id: 'archived-1', name: 'read_file', arguments: '{}', result: 'sensitive full result' }],
        metadata: {
          version: 1,
          toolResults: [{
            toolCallId: 'archived-1',
            toolName: 'read_file',
            bytes: 20,
            lines: 1,
            archive: { kind: 'tool_result', relativePath: 'artifacts/tool-result.txt', sha256: 'abc', bytes: 20 }
          }]
        }
      })]
    })
    const missing = buildAgentConversationPresentation({
      turns: [assistantTurn({
        toolCalls: [{ id: 'missing-1', name: 'read_file', arguments: '{}' }],
        metadata: { version: 1, toolResults: [{ toolCallId: 'missing-1', toolName: 'read_file', bytes: 0, lines: 0 }] }
      })]
    })
    const oversized = buildAgentConversationPresentation({
      turns: [assistantTurn({
        toolCalls: [{ id: 'large-1', name: 'read_file', arguments: '{}', result: 'x'.repeat(12_001) }]
      })]
    })

    const resultDisclosure = (presentation: typeof archived) => presentation.turns[0].items.find((item) => item.kind === 'tool_result')?.disclosure
    const resultItem = (presentation: typeof archived) => presentation.turns[0].items.find((item) => item.kind === 'tool_result')
    expect(resultDisclosure(archived)).toMatchObject({ resultState: 'archived', result: undefined })
    expect(resultDisclosure(archived)?.notice).toContain('未在对话中内嵌')
    expect(resultDisclosure(missing)).toMatchObject({ resultState: 'missing', result: undefined })
    expect(resultDisclosure(oversized)).toMatchObject({ resultState: 'oversized', result: undefined })
    expect(resultItem(archived)?.detail).toBeUndefined()
    expect(resultItem(oversized)?.detail).toBeUndefined()
  })

  it('turns unknown future events into stable generic cards', () => {
    const futureEvent = {
      id: 'future-1',
      kind: 'future_event',
      title: '',
      createdAt
    } as unknown as AgentChatProcessEvent
    const input = [assistantTurn({ processEvents: [futureEvent] })]

    const first = buildAgentConversationPresentation({ turns: input })
    const second = buildAgentConversationPresentation({ turns: input })

    expect(first.turns[0].items).toEqual(second.turns[0].items)
    expect(first.turns[0].items[0]).toMatchObject({
      id: 'event:future-1',
      kind: 'unknown',
      label: 'Agent 活动',
      state: 'complete'
    })
  })
})
