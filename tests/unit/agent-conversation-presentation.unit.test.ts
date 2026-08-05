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
  it('presents a completed tool call as one completed row without arguments or result disclosure', () => {
    const toolCall = { id: 'search-1', name: 'search_notes', arguments: '{"query":"momentum"}', result: 'Found one note.' }
    const liveEvents: AgentChatProcessEvent[] = [
      {
        id: 'live-call',
        kind: 'tool_call',
        title: '调用工具：search_notes',
        detail: '{"query":"momentum"}',
        status: 'tool_done',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        createdAt
      },
      {
        id: 'legacy-result',
        kind: 'tool_result',
        title: '工具完成：search_notes',
        detail: 'Found one note.',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        createdAt
      }
    ]
    const live = buildAgentConversationPresentation({
      turns: [assistantTurn({ toolCalls: [toolCall], processEvents: liveEvents })],
      activeTurnId: 'assistant-1'
    })
    const durable = buildAgentConversationPresentation({
      turns: [assistantTurn({ toolCalls: [toolCall] })]
    })

    for (const presentation of [live, durable]) {
      expect(presentation.turns[0].items).toEqual([
        expect.objectContaining({ kind: 'tool_call', label: '调用工具：search_notes', state: 'complete' })
      ])
      expect(presentation.turns[0].items[0].detail).toBeUndefined()
      expect(presentation.turns[0].items[0].disclosure).toBeUndefined()
    }
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

  it('keeps archived and oversized tool results out of the visible process presentation', () => {
    const archived = buildAgentConversationPresentation({
      turns: [assistantTurn({
        toolCalls: [{ id: 'archived-1', name: 'read_file', arguments: '{}', result: 'sensitive full result' }],
        metadata: {
          version: 1,
          toolResults: [{
            toolCallId: 'archived-1', toolName: 'read_file', bytes: 20, lines: 1,
            archive: { kind: 'tool_result', relativePath: 'artifacts/tool-result.txt', sha256: 'abc', bytes: 20 }
          }]
        }
      })]
    })
    const oversized = buildAgentConversationPresentation({
      turns: [assistantTurn({
        toolCalls: [{ id: 'large-1', name: 'read_file', arguments: '{"path":"secret"}', result: 'x'.repeat(12_001) }]
      })]
    })

    for (const presentation of [archived, oversized]) {
      expect(presentation.turns[0].items).toHaveLength(1)
      expect(presentation.turns[0].items[0]).toMatchObject({ kind: 'tool_call', state: 'complete' })
      expect(presentation.turns[0].items[0].detail).toBeUndefined()
      expect(presentation.turns[0].items[0].disclosure).toBeUndefined()
      expect(JSON.stringify(presentation)).not.toContain('sensitive full result')
      expect(JSON.stringify(presentation.turns[0].items)).not.toContain('secret')
    }
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
  it('projects repeated reasoning as bounded learner-visible progress while preserving tool progress', () => {
    const repeatedPreamble = '好，让我接下来写入文件。'
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        processEvents: [
          { id: 'reasoning-1', kind: 'reasoning', title: '思考过程', detail: repeatedPreamble, createdAt },
          { id: 'write-1', kind: 'tool_call', title: '调用工具：write_workspace_file', status: 'tool_done', toolCallId: 'write-1', toolName: 'write_workspace_file', createdAt },
          { id: 'reasoning-2', kind: 'reasoning', title: '思考过程', detail: repeatedPreamble, createdAt },
          { id: 'write-2', kind: 'tool_call', title: '调用工具：write_workspace_file', status: 'tool_done', toolCallId: 'write-2', toolName: 'write_workspace_file', createdAt },
          { id: 'reasoning-3', kind: 'reasoning', title: '思考过程', detail: repeatedPreamble, createdAt }
        ],
        toolCalls: [
          { id: 'write-1', name: 'write_workspace_file', arguments: '{}', result: 'ok' },
          { id: 'write-2', name: 'write_workspace_file', arguments: '{}', result: 'ok' }
        ]
      })],
      activeTurnId: 'assistant-1'
    }).turns[0]

    expect(presentation.items.filter((item) => item.kind === 'reasoning')).toEqual([
      expect.objectContaining({ id: 'event:reasoning-1', label: '思考过程', detail: repeatedPreamble, state: 'complete' }),
      expect.objectContaining({ id: 'event:reasoning-2', label: '思考过程', detail: repeatedPreamble, state: 'complete' }),
      expect.objectContaining({ id: 'event:reasoning-3', label: '思考过程', detail: repeatedPreamble, state: 'active' })
    ])
    expect(presentation.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'event:write-1', kind: 'tool_call', state: 'complete' }),
      expect.objectContaining({ id: 'event:write-2', kind: 'tool_call', state: 'complete' })
    ]))
    expect(JSON.stringify(presentation)).toContain(repeatedPreamble)
  })

  it('keeps structured tool progress active and preserves provider reasoning verbatim', () => {
    const reasoning = `第一行\n${'很长的思考内容'.repeat(40)}\n最后一行`
    const processEvents: AgentChatProcessEvent[] = [
      { id: 'reasoning-1', kind: 'reasoning', title: '思考过程', detail: reasoning, createdAt },
      { id: 'tool-1', kind: 'tool_call', title: '调用工具：search_notes', status: 'tool_done', toolCallId: 'search-1', toolName: 'search_notes', createdAt },
      { id: 'reasoning-2', kind: 'reasoning', title: '思考过程', detail: '继续整理答案', createdAt }
    ]
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        processEvents,
        toolCalls: [{ id: 'search-1', name: 'search_notes', arguments: '{}', result: 'ok' }]
      })],
      activeTurnId: 'assistant-1'
    }).turns[0]

    expect(presentation.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'event:reasoning-1', kind: 'reasoning', label: '思考过程', detail: reasoning, state: 'complete' }),
      expect.objectContaining({ id: 'event:tool-1', kind: 'tool_call', state: 'complete' }),
      expect.objectContaining({ id: 'event:reasoning-2', kind: 'reasoning', label: '思考过程', detail: '继续整理答案', state: 'active' })
    ]))
    expect(presentation.items.find((item) => item.id === 'event:reasoning-1')?.detail).toBe(reasoning)
    expect(presentation.items.find((item) => item.id === 'event:reasoning-2')?.detail).toBe('继续整理答案')
  })

  it('projects durable recovery notices as interrupted attention instead of errors or completion', () => {
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        processEvents: [{
          id: 'interrupted-1',
          kind: 'status',
          title: 'process ended unexpectedly',
          detail: 'The app exited while the run was still active.',
          status: 'error',
          isError: true,
          createdAt
        }],
        metadata: {
          version: 1,
          provenance: { kind: 'recovery_notice' }
        }
      })],
      activeTurnId: 'assistant-1'
    }).turns[0]

    expect(presentation).toMatchObject({ active: false, status: { kind: 'interrupted' } })
    expect(presentation.items).toEqual([
      expect.objectContaining({ id: 'event:interrupted-1', state: 'interrupted' })
    ])
  })

  it.each([
    'resource_limit',
    'suspended',
    'retry_exhausted',
    'no_progress',
    'context_unrecoverable'
  ] as const)('preserves recovered %s as its structured terminal state rather than interruption or completion', (status) => {
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        processEvents: [{
          id: `recovered-${status}`,
          kind: 'status',
          title: `recovered-${status}`,
          status,
          createdAt
        }],
        metadata: {
          version: 1,
          provenance: { kind: 'recovery_notice' }
        }
      })],
      activeTurnId: 'assistant-1'
    }).turns[0]

    expect(presentation).toMatchObject({ active: false, status: { kind: status } })
    expect(presentation.items).toEqual([
      expect.objectContaining({ id: `event:recovered-${status}`, state: status })
    ])
  })

  it('keeps real failed, canceled, and completed terminal states distinct', () => {
    const terminal = (status: 'error' | 'canceled' | 'done') => buildAgentConversationPresentation({
      turns: [assistantTurn({ processEvents: [{
        id: `terminal-${status}`,
        kind: 'status',
        title: `terminal-${status}`,
        status,
        isError: status === 'error',
        createdAt
      }] })],
      activeTurnId: 'assistant-1'
    }).turns[0]

    expect(terminal('error')).toMatchObject({
      active: false,
      status: { kind: 'failed' },
      items: [expect.objectContaining({ state: 'error' })]
    })
    expect(terminal('canceled')).toMatchObject({
      active: false,
      status: { kind: 'canceled' },
      items: [expect.objectContaining({ state: 'canceled' })]
    })
    expect(terminal('done')).toMatchObject({
      active: false,
      status: { kind: 'completed' },
      items: [expect.objectContaining({ state: 'complete' })]
    })
  })

  it.each(['no_progress', 'context_unrecoverable'] as const)(
    'keeps %s distinct from failure and completion in the process presentation',
    (status) => {
      const presentation = buildAgentConversationPresentation({
        turns: [assistantTurn({ processEvents: [{
          id: `terminal-${status}`,
          kind: 'status',
          title: `terminal-${status}`,
          status,
          createdAt
        }] })],
        activeTurnId: 'assistant-1'
      }).turns[0]

      expect(presentation).toMatchObject({ active: false, status: { kind: status } })
      expect(presentation.items).toEqual([
        expect.objectContaining({ id: `event:terminal-${status}`, state: status })
      ])
    }
  )

  it('stops presenting a turn as active as soon as a terminal status arrives', () => {
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({ processEvents: [
        { id: 'reasoning-1', kind: 'reasoning', title: '思考过程', detail: '完成分析', createdAt },
        { id: 'done-1', kind: 'status', title: '处理完成', status: 'done', createdAt }
      ] })],
      activeTurnId: 'assistant-1'
    }).turns[0]

    expect(presentation.active).toBe(false)
    expect(presentation.items.every((item) => item.state !== 'active')).toBe(true)
  })


  it('exposes web search sources as reply references instead of plan-card items', () => {
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        content: '最终答复',
        metadata: {
          version: 1,
          sources: [{
            sourceId: 'src-1',
            url: 'https://example.com/claude-code',
            title: 'Claude Code Guide',
            snippet: 'Skills and hooks',
            provider: 'Tavily'
          }]
        }
      })]
    }).turns[0]

    expect(presentation.items.some((item) => item.kind === 'source')).toBe(false)
    expect(presentation.sources).toEqual([{
      id: 'src-1',
      title: 'Claude Code Guide',
      url: 'https://example.com/claude-code',
      snippet: 'Skills and hooks',
      provider: 'Tavily'
    }])
  })

})

describe('Agent conversation files-touched projection', () => {
  it('projects successful workspace file tools as learner reference rows', () => {
    const presentation = buildAgentConversationPresentation({
      turns: [
        assistantTurn({
          toolCalls: [
            {
              id: 'r1',
              name: 'read_workspace_file',
              arguments: JSON.stringify({ path: 'lessons/intro.md' }),
              result: '# intro'
            },
            {
              id: 'w1',
              name: 'write_workspace_file',
              arguments: JSON.stringify({ path: 'notes/out.md', content: 'x' }),
              result: 'ok'
            }
          ]
        })
      ]
    })
    const turn = presentation.turns[0]
    expect(turn.fileTouches?.role).toBe('reference_projection')
    expect(turn.fileTouches?.title).toBeTruthy()
    expect(turn.fileTouches?.rows.map((row) => ({ path: row.displayPath, kind: row.kind }))).toEqual([
      { path: 'lessons/intro.md', kind: 'read' },
      { path: 'notes/out.md', kind: 'modified' }
    ])
  })

  it('prefers durable metadata.fileTouches over toolCalls rebuild', () => {
    const presentation = buildAgentConversationPresentation({
      turns: [
        assistantTurn({
          toolCalls: [
            {
              id: 'r1',
              name: 'read_workspace_file',
              arguments: JSON.stringify({ path: 'from-tools.md' }),
              result: 'x'
            }
          ],
          metadata: {
            version: 1,
            fileTouches: {
              role: 'reference_projection',
              files: [{ path: 'from-metadata.md', kind: 'modified' }]
            }
          }
        })
      ]
    })
    expect(presentation.turns[0].fileTouches?.rows.map((r) => r.displayPath)).toEqual(['from-metadata.md'])
  })

  it('omits fileTouches when no workspace file tools succeeded', () => {
    const presentation = buildAgentConversationPresentation({
      turns: [
        assistantTurn({
          toolCalls: [
            {
              id: 's1',
              name: 'web_search',
              arguments: JSON.stringify({ query: 'x' }),
              result: '[]'
            }
          ]
        })
      ]
    })
    expect(presentation.turns[0].fileTouches).toBeUndefined()
  })
})