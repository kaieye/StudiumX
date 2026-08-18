import { describe, expect, it } from 'vitest'
import {
  attachAgentConversationRuntimeTimeline,
  buildAgentRunPresentation
} from '../../src/main/ai/agent-run-presentation'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'

const createdAt = '2026-08-16T12:00:00.000Z'

describe('agent-run presentation timeline', () => {
  it('preserves safe Think/text/tool interleaving and settles a tool in its stable row', () => {
    const events: AgentLoopEvent[] = [
      { type: 'reasoning', delta: '先检查已有上下文。' },
      { type: 'token', delta: '模型文字 A。' },
      {
        type: 'tool_call',
        toolCall: {
          id: 'call-1',
          function: { name: 'workspace_shell', arguments: '{"command":"cat ~/.ssh/id_rsa"}' }
        }
      },
      {
        type: 'tool_result',
        toolCallId: 'call-1',
        name: 'workspace_shell',
        result: 'super-secret-tool-result',
        isError: false
      },
      { type: 'reasoning', delta: '再组织最终回答。' },
      { type: 'token', delta: '最终输出。' }
    ]

    const projection = buildAgentRunPresentation(events, {
      streamId: 'stream-1',
      now: () => createdAt
    })

    expect(projection.processEvents).toMatchObject([
      { kind: 'reasoning', title: 'Think', detail: '先检查已有上下文。' },
      { kind: 'tool_call', title: 'Bash', status: 'tool_done', toolCallId: 'call-1' },
      { kind: 'reasoning', title: 'Think', detail: '再组织最终回答。' }
    ])
    expect(projection.presentationTimeline?.map((entry) => entry.kind === 'assistant_text'
      ? `text:${entry.content}`
      : `process:${entry.processEventId}`
    )).toEqual([
      `process:${projection.processEvents?.[0]?.id}`,
      'text:模型文字 A。',
      `process:${projection.processEvents?.[1]?.id}`,
      `process:${projection.processEvents?.[2]?.id}`,
      'text:最终输出。'
    ])
    expect(projection.presentationTimeline?.filter((entry) => entry.kind === 'process')).toHaveLength(3)

    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('cat ~/.ssh/id_rsa')
    expect(serialized).not.toContain('super-secret-tool-result')

    const turns = attachAgentConversationRuntimeTimeline([
      { id: 'u-1', role: 'user', content: '请帮我完成任务', createdAt },
      { id: 'a-1', role: 'assistant', content: '模型文字 A。最终输出。', createdAt }
    ], events, { streamId: 'stream-1', now: () => createdAt })

    expect(turns[1]).toMatchObject({
      id: 'a-1',
      presentationTimeline: projection.presentationTimeline,
      processEvents: projection.processEvents
    })
  })

  it('fails closed for unsafe reasoning/text while retaining safe adjacent timeline entries', () => {
    const projection = buildAgentRunPresentation([
      { type: 'reasoning', delta: '安全的思考。' },
      { type: 'token', delta: '安全文字。' },
      { type: 'reasoning', delta: 'RAW-PROMPT: do not show this' },
      { type: 'token', delta: 'token=do-not-store' },
      { type: 'reasoning', delta: '读取 /Users/learner/private/notes.md' },
      { type: 'token', delta: '仍然安全的最终文字。' }
    ], { now: () => createdAt })

    expect(projection.processEvents).toMatchObject([
      { kind: 'reasoning', detail: '安全的思考。' }
    ])
    expect(projection.presentationTimeline?.map((entry) => entry.kind === 'assistant_text'
      ? entry.content
      : entry.processEventId
    )).toEqual([
      projection.processEvents?.[0]?.id,
      '安全文字。仍然安全的最终文字。'
    ])

    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('RAW-PROMPT')
    expect(serialized).not.toContain('do-not-store')
    expect(serialized).not.toContain('/Users/learner')
  })

  it('does not concatenate a split CHAIN-OF-THOUGHT marker into a durable Think row', () => {
    const projection = buildAgentRunPresentation([
      { type: 'reasoning', delta: 'CHAIN-' },
      { type: 'reasoning', delta: 'OF-THOUGHT' },
      { type: 'token', delta: '安全最终输出。' }
    ], { now: () => createdAt })

    expect(projection.processEvents).toMatchObject([
      { kind: 'reasoning', title: 'Think', detail: 'CHAIN-' }
    ])
    expect(projection.presentationTimeline?.map((entry) => entry.kind === 'assistant_text'
      ? entry.content
      : entry.processEventId
    )).toEqual([
      projection.processEvents?.[0]?.id,
      '安全最终输出。'
    ])

    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('CHAIN-OF-THOUGHT')
    expect(serialized).not.toContain('OF-THOUGHT')
  })
})
