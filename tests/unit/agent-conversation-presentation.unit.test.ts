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
  it('projects a completed tool call as one compact row with safe expandable input and output', () => {
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
        expect.objectContaining({ kind: 'tool_call', label: 'Tool call', state: 'complete' })
      ])
      expect(presentation.turns[0].items[0].detail).toBe('momentum')
      expect(presentation.turns[0].items[0].disclosure).toMatchObject({
        eligible: true,
        label: 'momentum',
        arguments: '{\n  "query": "momentum"\n}',
        result: 'Found one note.',
        resultState: 'available'
      })
    }
  })

  it('maps runtime tool names to the reviewed Bash, READ, and Tool call labels', () => {
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        processEvents: [
          {
            id: 'shell-event',
            kind: 'tool_call',
            title: 'provider-facing-shell-name',
            status: 'tool_done',
            toolCallId: 'shell-call',
            toolName: 'workspace_shell',
            createdAt
          },
          {
            id: 'read-event',
            kind: 'tool_call',
            title: 'provider-facing-read-name',
            status: 'tool_done',
            toolCallId: 'read-call',
            toolName: 'read_workspace_file',
            createdAt
          },
          {
            id: 'unknown-event',
            kind: 'tool_call',
            title: 'provider-facing-unknown-name',
            status: 'tool_done',
            toolCallId: 'unknown-call',
            toolName: 'search_notes',
            createdAt
          }
        ],
        toolCalls: [
          { id: 'shell-call', name: 'workspace_shell', arguments: '{}', result: 'ok' },
          { id: 'read-call', name: 'read_workspace_file', arguments: '{}', result: 'ok' },
          { id: 'unknown-call', name: 'search_notes', arguments: '{}', result: 'ok' }
        ]
      })]
    }).turns[0]

    expect(presentation.items.map((item) => ({ kind: item.kind, label: item.label, state: item.state }))).toEqual([
      { kind: 'tool_call', label: 'Bash', state: 'complete' },
      { kind: 'tool_call', label: 'READ', state: 'complete' },
      { kind: 'tool_call', label: 'Tool call', state: 'complete' }
    ])
  })

  it('derives bounded structured cards for safe terminal, read, diff, and search tool payloads', () => {
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        toolCalls: [
          {
            id: 'shell-card',
            name: 'workspace_shell',
            arguments: JSON.stringify({ command: 'pnpm typecheck', cwd: '.' }),
            result: JSON.stringify({ stdout: 'Types passed\n', stderr: '', exitCode: 0 })
          },
          {
            id: 'read-card',
            name: 'read_workspace_file',
            arguments: JSON.stringify({ path: 'src/example.ts' }),
            result: JSON.stringify({
              path: 'src/example.ts',
              content: 'export const answer = 42',
              offset: 5,
              totalLines: 6
            })
          },
          {
            id: 'edit-card',
            name: 'edit_workspace_file',
            arguments: JSON.stringify({
              path: 'src/example.ts',
              old_string: 'export const answer = 41',
              new_string: 'export const answer = 42'
            }),
            result: JSON.stringify({ ok: true })
          },
          {
            id: 'search-card',
            name: 'search_workspace',
            arguments: JSON.stringify({ pattern: 'answer' }),
            result: JSON.stringify({
              count: 1,
              matches: [{ path: 'src/example.ts', line: 6, text: 'export const answer = 42' }]
            })
          }
        ]
      })]
    }).turns[0]

    const byId = new Map(presentation.items.map((item) => [item.id, item]))

    expect(byId.get('event:durable:shell-card:call')?.disclosure?.content).toMatchObject({
      kind: 'terminal',
      command: 'pnpm typecheck',
      cwd: '.',
      output: 'Types passed\n',
      exitCode: 0,
      running: false,
      failed: false
    })
    expect(byId.get('event:durable:read-card:call')?.disclosure?.content).toMatchObject({
      kind: 'read',
      path: 'src/example.ts',
      lines: [{ number: 6, text: 'export const answer = 42' }],
      totalLines: 6
    })
    expect(byId.get('event:durable:edit-card:call')?.disclosure?.content).toMatchObject({
      kind: 'diff',
      path: 'src/example.ts',
      oldText: 'export const answer = 41',
      newText: 'export const answer = 42'
    })
    expect(byId.get('event:durable:search-card:call')?.disclosure?.content).toMatchObject({
      kind: 'search',
      query: 'answer',
      resultKind: 'matches',
      files: [{
        path: 'src/example.ts',
        matches: [{ lineNumber: 6, text: 'export const answer = 42' }]
      }],
      total: 1
    })
  })

  it('derives bounded structured cards for web, memory, lesson, and permission payloads', () => {
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        toolCalls: [
          {
            id: 'web-search-card',
            name: 'web_search',
            arguments: JSON.stringify({ query: '考公 2026 报名时间' }),
            result: JSON.stringify({
              count: 2,
              results: [
                { title: '公务员考试网', url: 'https://example.com/a', snippet: '报名时间说明。' },
                { title: '新华社', url: 'https://news.example.com/b', snippet: '招考启动。', publishedAt: '2025-10-14' }
              ]
            })
          },
          {
            id: 'web-fetch-card',
            name: 'web_fetch',
            arguments: JSON.stringify({ url: 'https://example.com/a' }),
            result: JSON.stringify({
              url: 'https://example.com/a',
              finalUrl: 'https://example.com/a',
              attempts: [{ url: 'https://example.com/a', ok: true, status: 200 }],
              truncated: false
            })
          },
          {
            id: 'memory-card',
            name: 'memory_search',
            arguments: JSON.stringify({ query: 'RAG 面试' }),
            result: JSON.stringify({
              ok: true,
              count: 1,
              hits: [{ id: 'm1', title: 'RAG 五个步骤', snippet: '加载、切分、检索、生成。' }]
            })
          },
          {
            id: 'lesson-card',
            name: 'generate_lesson',
            arguments: JSON.stringify({ topic: 'RAG 检索增强生成入门' }),
            result: JSON.stringify({
              ok: true,
              lessonId: 'l1',
              title: 'RAG 检索增强生成入门',
              path: 'lessons/rag-入门.md',
              message: '课程已生成并登记。'
            })
          },
          {
            id: 'skill-resource-card',
            name: 'read_skill_resource',
            arguments: JSON.stringify({ skillId: 'teach', path: 'references/scenarios.md' }),
            result: JSON.stringify({ path: 'references/scenarios.md', content: '1| 场景一', totalLines: 12 })
          }
        ]
      })]
    }).turns[0]

    const byId = new Map(presentation.items.map((item) => [item.id, item]))

    expect(byId.get('event:durable:web-search-card:call')?.disclosure?.content).toMatchObject({
      kind: 'web-search',
      query: '考公 2026 报名时间',
      sources: [
        { url: 'https://example.com/a', title: '公务员考试网', snippet: '报名时间说明。' },
        { url: 'https://news.example.com/b', title: '新华社', snippet: '招考启动。', publishedAt: '2025-10-14' }
      ],
      total: 2,
      truncated: false
    })
    expect(byId.get('event:durable:web-fetch-card:call')?.disclosure?.content).toMatchObject({
      kind: 'web-fetch',
      url: 'https://example.com/a',
      statusCode: 200,
      truncated: false
    })
    expect(byId.get('event:durable:memory-card:call')?.disclosure?.content).toMatchObject({
      kind: 'memory',
      query: 'RAG 面试',
      hits: [{ title: 'RAG 五个步骤', snippet: '加载、切分、检索、生成。' }],
      total: 1
    })
    expect(byId.get('event:durable:lesson-card:call')?.disclosure?.content).toMatchObject({
      kind: 'lesson',
      topic: 'RAG 检索增强生成入门',
      title: 'RAG 检索增强生成入门',
      path: 'lessons/rag-入门.md',
      message: '课程已生成并登记。'
    })
    expect(byId.get('event:durable:skill-resource-card:call')?.disclosure?.content).toMatchObject({
      kind: 'read',
      path: 'references/scenarios.md',
      lines: [{ number: 1, text: '场景一' }],
      totalLines: 12
    })
  })

  it('keeps large write, read, and terminal payloads as cards instead of the generic IN/OUT fallback', () => {
    // A write can carry up to 1 MiB (realistic > display budget); a read window
    // is capped at 24 KB by the tool; a terminal result can exceed the old 12 KB.
    const bigWriteContent = 'export const line = "' + 'x'.repeat(60_000) + '"'
    const bigReadContent = 'export const line = "' + 'x'.repeat(20_000) + '"'
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        toolCalls: [
          {
            id: 'big-write',
            name: 'write_workspace_file',
            arguments: JSON.stringify({ path: 'reference/glossary.html', content: bigWriteContent }),
            result: JSON.stringify({ ok: true, path: 'reference/glossary.html' })
          },
          {
            id: 'big-read',
            name: 'read_workspace_file',
            arguments: JSON.stringify({ path: 'src/big.ts' }),
            result: JSON.stringify({ path: 'src/big.ts', content: bigReadContent, totalLines: 2000 })
          },
          {
            id: 'big-shell',
            name: 'run_workspace_command',
            arguments: JSON.stringify({ command: 'pnpm typecheck' }),
            result: JSON.stringify({ stdout: 'OK\n' + 'warning'.repeat(6_000) + '\n', exitCode: 0 })
          }
        ]
      })]
    }).turns[0]

    const byId = new Map(presentation.items.map((item) => [item.id, item]))

    const writeContent = byId.get('event:durable:big-write:call')?.disclosure?.content
    expect(writeContent).toMatchObject({ kind: 'diff', path: 'reference/glossary.html', truncated: true })
    expect((writeContent as { newText: string }).newText.length).toBeLessThanOrEqual(50_000)
    const readContent = byId.get('event:durable:big-read:call')?.disclosure?.content
    expect(readContent).toMatchObject({ kind: 'read', path: 'src/big.ts', totalLines: 2000 })
    expect((readContent as { lines: unknown[] }).lines.length).toBeGreaterThan(0)
    const shellContent = byId.get('event:durable:big-shell:call')?.disclosure?.content
    expect(shellContent).toMatchObject({ kind: 'terminal', command: 'pnpm typecheck', exitCode: 0 })
  })

  it('rehydrates the durable Think → text → tool → Think → final flow without repeating canonical text', () => {
    const turn = assistantTurn({
      content: '模型文字 A。最终输出。',
      processEvents: [
        {
          id: 'think-a',
          kind: 'reasoning',
          title: 'Think',
          detail: '先分析问题。',
          status: 'thinking',
          createdAt
        },
        {
          id: 'bash-a',
          kind: 'tool_call',
          title: 'provider-facing-shell-name',
          status: 'tool_done',
          toolCallId: 'shell-a',
          toolName: 'workspace_shell',
          createdAt
        },
        {
          id: 'think-b',
          kind: 'reasoning',
          title: 'Think',
          detail: '根据工具结果整理答案。',
          status: 'thinking',
          createdAt
        }
      ],
      toolCalls: [{ id: 'shell-a', name: 'workspace_shell', arguments: '{}', result: 'ok' }],
      presentationTimeline: [
        { id: 'p-think-a', sequence: 0, kind: 'process', processEventId: 'think-a', createdAt },
        { id: 'p-text-a', sequence: 1, kind: 'assistant_text', content: '模型文字 A。', createdAt },
        { id: 'p-bash-a', sequence: 2, kind: 'process', processEventId: 'bash-a', createdAt },
        { id: 'p-think-b', sequence: 3, kind: 'process', processEventId: 'think-b', createdAt },
        { id: 'p-final', sequence: 4, kind: 'assistant_text', content: '最终输出。', createdAt }
      ]
    })

    const presentation = buildAgentConversationPresentation({ turns: [turn] }).turns[0]

    expect(presentation.flow).toEqual([
      expect.objectContaining({
        kind: 'process',
        item: expect.objectContaining({ id: 'event:think-a', kind: 'reasoning', label: 'Think' })
      }),
      { id: 'timeline:p-text-a', kind: 'assistant_text', content: '模型文字 A。' },
      expect.objectContaining({
        kind: 'process',
        item: expect.objectContaining({ id: 'event:bash-a', kind: 'tool_call', label: 'Bash' })
      }),
      expect.objectContaining({
        kind: 'process',
        item: expect.objectContaining({ id: 'event:think-b', kind: 'reasoning', label: 'Think' })
      }),
      { id: 'timeline:p-final', kind: 'assistant_text', content: '最终输出。' }
    ])
    const visibleText = presentation.flow
      ?.filter((item) => item.kind === 'assistant_text')
      .map((item) => item.content)
      .join('')
    expect(visibleText).toBe('模型文字 A。最终输出。')
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

  it('keeps archived and oversized tool result bodies out of the visible process presentation', () => {
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
        toolCalls: [{ id: 'large-1', name: 'read_file', arguments: '{"path":"notes/large-output.md"}', result: 'x'.repeat(12_001) }]
      })]
    })

    for (const presentation of [archived, oversized]) {
      expect(presentation.turns[0].items).toHaveLength(1)
      expect(presentation.turns[0].items[0]).toMatchObject({ kind: 'tool_call', state: 'complete' })
      expect(presentation.turns[0].items[0].disclosure).toMatchObject({
        eligible: true,
        resultState: expect.stringMatching(/archived|oversized/),
        notice: expect.stringContaining('未在对话中内联显示')
      })
      expect(presentation.turns[0].items[0].disclosure?.result).toBeUndefined()
      expect(JSON.stringify(presentation)).not.toContain('sensitive full result')
      expect(JSON.stringify(presentation.turns[0].items)).not.toContain('x'.repeat(100))
    }
  })

  it('fails closed for tool payloads that contain secrets or machine-local paths', () => {
    const secret = 'token=do-not-render'
    const absolutePath = '/Users/learner/private/answer-key.md'
    const presentation = buildAgentConversationPresentation({
      turns: [assistantTurn({
        toolCalls: [{
          id: 'unsafe-1',
          name: 'workspace_shell',
          arguments: JSON.stringify({ command: `cat ${absolutePath}`, description: secret }),
          result: `provider payload ${secret}`
        }]
      })]
    }).turns[0]

    const item = presentation.items[0]
    expect(item.disclosure).toMatchObject({
      eligible: true,
      notice: expect.stringContaining('不安全内容')
    })
    expect(item.disclosure?.arguments).toBeUndefined()
    expect(item.disclosure?.result).toBeUndefined()
    expect(item.disclosure?.content).toBeUndefined()
    expect(JSON.stringify(presentation)).not.toContain(secret)
    expect(JSON.stringify(presentation)).not.toContain(absolutePath)
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

  it('keeps structured tool progress active and preserves safe reasoning text', () => {
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
