import { describe, expect, it } from 'vitest'
import {
  agentTurnsToMessages,
  agentTurnsToMessageTurnIds,
  presentAgentTurnProvenance
} from '../../src/renderer/src/agent-conversation-state'
import type { AgentChatTurn } from '../../src/shared/teaching-types'

const createdAt = '2026-07-14T10:00:00.000Z'

function turn(metadata?: AgentChatTurn['metadata'], overrides: Partial<AgentChatTurn> = {}): AgentChatTurn {
  return { id: 'turn-1', role: 'assistant', content: 'Answer', createdAt, metadata, ...overrides }
}

describe('presentAgentTurnProvenance', () => {
  it('treats legacy turns without provenance as original', () => {
    expect(presentAgentTurnProvenance(turn())).toEqual({
      kind: 'original',
      label: '原始轮次',
      detail: '当前分支的原始对话记录'
    })
  })

  it('presents replayed turns with their source branch and turn', () => {
    expect(presentAgentTurnProvenance(turn({
      version: 1,
      provenance: {
        kind: 'replayed',
        sourceConversationId: 'conversation-source',
        sourceBranchId: 'branch-source',
        sourceTurnId: 'turn-source',
        replayId: 'replay-1'
      }
    }))).toEqual({
      kind: 'replayed',
      label: '回放结果',
      detail: '来源 branch-source · turn-source'
    })
  })

  it('labels recovery notices as recovery boundaries rather than replayed model output', () => {
    expect(presentAgentTurnProvenance(turn({
      version: 1,
      provenance: { kind: 'recovery_notice' }
    }))).toEqual({
      kind: 'recovery_notice',
      label: '恢复提示',
      detail: '运行恢复边界，不是模型重放结果'
    })
  })
})

import {
  applyAgentChatChunkToPending,
  applyAgentChatToolEventToPending,
  reconcileAgentTurnsWithLocalProcess,
  selectPendingAsk,
  selectPendingToolPermission,
  type PendingAgentConversation
} from '../../src/renderer/src/agent-conversation-state'

function pendingConversation(): PendingAgentConversation {
  return {
    workspaceId: 'workspace-1',
    sourceConversationId: null,
    sourceConversationRevision: null,
    mode: 'teaching',
    summary: {
      id: 'stream-1', title: 'Test', relativePath: 'conversations/test.json', createdAt, updatedAt: createdAt,
      messageCount: 2, mode: 'teaching', pending: true
    },
    turns: [turn(undefined, { id: 'assistant-1', content: '' })],
    status: '思考中…',
    toolsSupported: true
  }
}

function applyStreamChunk(
  pending: PendingAgentConversation,
  delta: string,
  sequence: number,
  channel?: 'answer' | 'reasoning'
): PendingAgentConversation {
  const patch = applyAgentChatChunkToPending({
    pending,
    activeConversationId: 'stream-1',
    assistantId: 'assistant-1',
    chunk: { streamId: 'stream-1', delta, ...(channel ? { channel } : {}) },
    realtimeEvent: { sequence, createdAt }
  })
  expect(patch).not.toBeNull()
  return patch!.pendingAgentConversation!
}

describe('model history projection', () => {
  it('excludes recovery notices by structured provenance while preserving durable and replayed history with aligned IDs', () => {
    const turns: AgentChatTurn[] = [
      { id: 'u-durable', role: 'user', content: 'Durable user input', createdAt },
      {
        id: 'a-replayed',
        role: 'assistant',
        content: 'Replay-safe durable answer',
        createdAt,
        metadata: {
          version: 1,
          provenance: { kind: 'replayed', sourceTurnId: 'a-source', replayId: 'replay-1' }
        }
      },
      {
        id: 'a-text-coincidence',
        role: 'assistant',
        content: 'Renderer-only recovery notice',
        createdAt
      },
      ...(['done', 'canceled', 'error'] as const).map((status) => ({
        id: `a-${status}`,
        role: 'assistant' as const,
        content: `Durable ${status} result`,
        createdAt,
        processEvents: [{
          id: `status-${status}`,
          kind: 'status' as const,
          title: status,
          status,
          createdAt
        }]
      })),
      {
        id: 'interrupted-run-9',
        role: 'assistant',
        content: 'Renderer-only recovery notice',
        createdAt,
        metadata: { version: 1, provenance: { kind: 'recovery_notice' } }
      }
    ]

    expect(agentTurnsToMessages(turns)).toEqual([
      { role: 'user', content: 'Durable user input' },
      { role: 'assistant', content: 'Replay-safe durable answer' },
      { role: 'assistant', content: 'Renderer-only recovery notice' },
      { role: 'assistant', content: 'Durable done result' },
      { role: 'assistant', content: 'Durable canceled result' },
      { role: 'assistant', content: 'Durable error result' }
    ])
    expect(agentTurnsToMessageTurnIds(turns)).toEqual([
      'u-durable', 'a-replayed', 'a-text-coincidence', 'a-done', 'a-canceled', 'a-error'
    ])
  })
})

describe('agent streamed reasoning state', () => {
  it('coalesces reasoning deltas into process evidence without mixing them into the answer', () => {
    const first = applyAgentChatChunkToPending({
      pending: pendingConversation(), activeConversationId: 'stream-1', assistantId: 'assistant-1',
      chunk: { streamId: 'stream-1', delta: '先分析', channel: 'reasoning' }
    })!.pendingAgentConversation!
    const second = applyAgentChatChunkToPending({
      pending: first, activeConversationId: 'stream-1', assistantId: 'assistant-1',
      chunk: { streamId: 'stream-1', delta: '再验证', channel: 'reasoning' }
    })!.pendingAgentConversation!
    const answered = applyAgentChatChunkToPending({
      pending: second, activeConversationId: 'stream-1', assistantId: 'assistant-1',
      chunk: { streamId: 'stream-1', delta: '最终回答' }
    })!.pendingAgentConversation!

    expect(answered.turns[0].content).toBe('最终回答')
    expect(answered.turns[0].processEvents).toHaveLength(1)
    expect(answered.turns[0].processEvents?.[0]).toMatchObject({
      kind: 'reasoning', title: '思考过程', detail: '先分析再验证'
    })
    expect(answered.turns[0].presentationTimeline).toMatchObject([
      { kind: 'process', processEventId: answered.turns[0].processEvents?.[0]?.id },
      { kind: 'assistant_text', content: '最终回答' }
    ])
  })
})


describe('agent streamed presentation safety', () => {
  it('drops unsafe live answer/reasoning chunks while preserving the safe Think/text/tool/Think/final order', () => {
    let pending = applyStreamChunk(pendingConversation(), '先检查已有上下文。', 10, 'reasoning')
    const unsafeChunks: Array<{ delta: string; channel: 'answer' | 'reasoning' }> = [
      { delta: 'RAW-PROMPT: do not render', channel: 'reasoning' },
      { delta: 'provider_payload: do not render', channel: 'answer' },
      { delta: 'system-prompt: do not render', channel: 'reasoning' },
      { delta: '读取 /Users/learner/private/notes.md', channel: 'answer' },
      { delta: '读取 C:\\Users\\learner\\private\\notes.md', channel: 'reasoning' },
      { delta: '读取 \\\\server\\share\\private.md', channel: 'answer' },
      { delta: '读取 ~/private/notes.md', channel: 'reasoning' },
      { delta: 'token=do-not-store', channel: 'answer' }
    ]
    for (const [offset, unsafe] of unsafeChunks.entries()) {
      pending = applyStreamChunk(pending, unsafe.delta, 11 + offset, unsafe.channel)
    }

    pending = applyStreamChunk(pending, '模型文字 A。', 20)
    pending = applyAgentChatToolEventToPending({
      pending,
      activeConversationId: 'stream-1',
      assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'tool-1', name: 'workspace_shell', arguments: '{}' }
      },
      realtimeEvent: { sequence: 30, createdAt }
    })!.pendingAgentConversation!
    pending = applyAgentChatToolEventToPending({
      pending,
      activeConversationId: 'stream-1',
      assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'tool-1', name: 'workspace_shell', arguments: '{}' },
        result: 'not learner-visible'
      },
      realtimeEvent: { sequence: 31, createdAt }
    })!.pendingAgentConversation!
    pending = applyStreamChunk(pending, '再组织最终回答。', 40, 'reasoning')
    pending = applyStreamChunk(pending, '最终输出。', 50)

    const assistant = pending.turns[0]!
    const processEvents = assistant.processEvents ?? []
    expect(assistant.content).toBe('模型文字 A。最终输出。')
    expect(processEvents).toMatchObject([
      { kind: 'reasoning', title: '思考过程', detail: '先检查已有上下文。' },
      { kind: 'tool_call', title: 'Bash', toolCallId: 'tool-1', status: 'tool_done' },
      { kind: 'reasoning', title: '思考过程', detail: '再组织最终回答。' }
    ])
    expect(assistant.presentationTimeline?.map((entry) => entry.kind === 'assistant_text'
      ? `text:${entry.content}`
      : `process:${entry.processEventId}`
    )).toEqual([
      `process:${processEvents[0]?.id}`,
      'text:模型文字 A。',
      `process:${processEvents[1]?.id}`,
      `process:${processEvents[2]?.id}`,
      'text:最终输出。'
    ])

    const visibleText = [
      assistant.content,
      ...(assistant.presentationTimeline ?? [])
        .filter((entry): entry is Extract<typeof entry, { kind: 'assistant_text' }> => entry.kind === 'assistant_text')
        .map((entry) => entry.content),
      ...processEvents.map((event) => event.detail ?? '')
    ].join('\n')
    const serializedTurn = JSON.stringify(assistant)
    for (const unsafe of unsafeChunks) {
      expect(visibleText).not.toContain(unsafe.delta)
      // JSON encoding preserves the escaped representation of Windows/UNC
      // paths too, so this verifies that no raw chunk survives anywhere on the
      // renderer's pending turn—not only in the visible text projection.
      expect(serializedTurn).not.toContain(JSON.stringify(unsafe.delta).slice(1, -1))
    }
    expect(visibleText).not.toContain('[redacted]')
  })

  it('does not concatenate a split CHAIN-OF-THOUGHT reasoning marker into the pending turn', () => {
    let pending = applyStreamChunk(pendingConversation(), 'CHAIN-', 1, 'reasoning')
    pending = applyStreamChunk(pending, 'OF-THOUGHT', 2, 'reasoning')

    const assistant = pending.turns[0]!
    expect(assistant.content).toBe('')
    expect(assistant.processEvents).toMatchObject([
      { kind: 'reasoning', detail: 'CHAIN-' }
    ])
    expect(assistant.presentationTimeline?.map((entry) => entry.kind === 'assistant_text'
      ? entry.content
      : entry.processEventId
    )).toEqual([assistant.processEvents?.[0]?.id])

    const visibleText = [
      assistant.content,
      ...(assistant.presentationTimeline ?? [])
        .filter((entry): entry is Extract<typeof entry, { kind: 'assistant_text' }> => entry.kind === 'assistant_text')
        .map((entry) => entry.content),
      ...(assistant.processEvents ?? []).map((event) => event.detail ?? '')
    ].join('\n')
    expect(visibleText).not.toContain('CHAIN-OF-THOUGHT')
    expect(visibleText).not.toContain('OF-THOUGHT')
    expect(JSON.stringify(assistant)).not.toContain('CHAIN-OF-THOUGHT')
  })
})

describe('agent streamed tool state', () => {
  it('settles one payload-free tool row in place without adding a completion boundary', () => {
    const called = applyAgentChatToolEventToPending({
      pending: pendingConversation(), activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'tool-1', name: 'list_workspace', arguments: '{"path":".","recursive":true}' }
      },
      realtimeEvent: { sequence: 11, createdAt: '2026-07-14T10:00:11.000Z' }
    })!.pendingAgentConversation!
    const completed = applyAgentChatToolEventToPending({
      pending: called, activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'tool-1', name: 'list_workspace', arguments: '{"path":".","recursive":true}' },
        result: 'src/App.tsx'
      },
      realtimeEvent: { sequence: 12, createdAt: '2026-07-14T10:00:12.000Z' }
    })!.pendingAgentConversation!

    const processEvents = completed.turns[0].processEvents
    expect(processEvents).toHaveLength(1)
    expect(processEvents?.[0]).toMatchObject({
      kind: 'tool_call',
      title: 'Search',
      status: 'tool_done',
      toolCallId: 'tool-1'
    })
    expect(processEvents?.[0]?.detail).toBeUndefined()
    expect(completed.turns[0].presentationTimeline).toEqual([
      expect.objectContaining({
        kind: 'process', sequence: 11, processEventId: processEvents?.[0]?.id
      })
    ])
  })
})

describe('multi-step ask selection', () => {
  it('shows the second ask after the first ask on the same assistant turn is answered', () => {
    const firstArguments = JSON.stringify({
      questions: [{ question: '第一个问题？', options: [{ label: 'A' }, { label: 'B' }] }]
    })
    const secondArguments = JSON.stringify({
      questions: [{ question: '第二个问题？', options: [{ label: 'C' }, { label: 'D' }] }]
    })
    const firstPending = applyAgentChatToolEventToPending({
      pending: pendingConversation(), activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: { streamId: 'stream-1', toolCall: { id: 'ask-1', name: 'ask', arguments: firstArguments } }
    })!.pendingAgentConversation!
    const firstAnswered = applyAgentChatToolEventToPending({
      pending: firstPending, activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'ask-1', name: 'ask', arguments: firstArguments },
        result: '用户选择：A'
      }
    })!.pendingAgentConversation!
    const secondPending = applyAgentChatToolEventToPending({
      pending: firstAnswered, activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: { streamId: 'stream-1', toolCall: { id: 'ask-2', name: 'ask', arguments: secondArguments } }
    })!.pendingAgentConversation!

    expect(selectPendingAsk(secondPending.turns, 'stream-1')).toMatchObject({
      streamId: 'stream-1',
      toolCallId: 'ask-2',
      questions: [{ prompt: '第二个问题？' }]
    })
    expect(secondPending.turns[0].processEvents).toMatchObject([
      { kind: 'elicitation_resolved', toolCallId: 'ask-1' },
      { kind: 'elicitation_request', toolCallId: 'ask-2' }
    ])
  })
})



describe('multi-step write permission selection', () => {
  it('shows the newest pending write approval after an earlier approval was resolved', () => {
    const firstArguments = JSON.stringify({
      id: 'permission-1', kind: 'workspace_write', toolName: 'write_workspace_file',
      operation: '写入第一份文件', targetPath: 'notes/one.md'
    })
    const secondArguments = JSON.stringify({
      id: 'permission-2', kind: 'workspace_write', toolName: 'write_workspace_file',
      operation: '写入第二份文件', targetPath: 'notes/two.md'
    })
    const firstPending = applyAgentChatToolEventToPending({
      pending: pendingConversation(), activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: { streamId: 'stream-1', toolCall: { id: 'permission-1', name: 'tool_permission', arguments: firstArguments } }
    })!.pendingAgentConversation!
    const firstResolved = applyAgentChatToolEventToPending({
      pending: firstPending, activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'permission-1', name: 'tool_permission', arguments: firstArguments },
        result: '{"decision":"allow_once"}'
      }
    })!.pendingAgentConversation!
    const secondPending = applyAgentChatToolEventToPending({
      pending: firstResolved, activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: { streamId: 'stream-1', toolCall: { id: 'permission-2', name: 'tool_permission', arguments: secondArguments } }
    })!.pendingAgentConversation!

    expect(selectPendingToolPermission(secondPending.turns, 'stream-1')).toMatchObject({
      streamId: 'stream-1',
      toolCallId: 'permission-2',
      request: { operation: '写入第二份文件', targetPath: 'notes/two.md' }
    })
  })
})


describe('reconcileAgentTurnsWithLocalProcess collapses multi-assistant runs', () => {
  it('maps one local process timeline onto one collapsed server assistant turn', () => {
    const createdAt = '2026-07-16T13:52:23.000Z'
    const serverTurns = [
      { id: 'u0', role: 'user' as const, content: 'learn', createdAt },
      {
        id: 't1', role: 'assistant' as const, content: '', createdAt,
        toolCalls: [{ id: 'c1', name: 'list_workspace', arguments: '{}' }]
      },
      {
        id: 't2', role: 'assistant' as const, content: 'final answer', createdAt,
        metadata: { version: 1 as const, sources: [{ sourceId: 'src-1', url: 'https://example.com', title: 'Guide' }] }
      }
    ]
    const localTurns = [
      { id: 'u0', role: 'user' as const, content: 'learn', createdAt },
      {
        id: 'a-local', role: 'assistant' as const, content: '', createdAt,
        processEvents: [{
          id: 'status-1', kind: 'status' as const, title: '处理完成', status: 'done' as const, createdAt
        }],
        presentationTimeline: [{
          id: 'local-status-row', sequence: 9, kind: 'process' as const,
          processEventId: 'status-1', createdAt
        }]
      }
    ]

    const reconciled = reconcileAgentTurnsWithLocalProcess(serverTurns, localTurns)
    expect(reconciled).toHaveLength(2)
    expect(reconciled[1]).toMatchObject({
      role: 'assistant',
      content: 'final answer'
    })
    expect(reconciled[1].toolCalls?.map((tool) => tool.name)).toEqual(['list_workspace'])
    expect(reconciled[1].processEvents?.[0]?.title).toBe('处理完成')
    expect(reconciled[1].presentationTimeline).toEqual([
      {
        id: 'local-status-row',
        sequence: 0,
        kind: 'process',
        processEventId: 'status-1',
        createdAt
      }
    ])
    expect(reconciled[1].metadata?.sources?.[0]?.url).toBe('https://example.com')
  })
})
