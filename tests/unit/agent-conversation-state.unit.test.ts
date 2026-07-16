import { describe, expect, it } from 'vitest'
import { presentAgentTurnProvenance } from '../../src/renderer/src/agent-conversation-state'
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
  })
})


describe('agent streamed tool state', () => {
  it('resolves a tool call in place without exposing arguments or appending a completion row', () => {
    const called = applyAgentChatToolEventToPending({
      pending: pendingConversation(), activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'tool-1', name: 'list_workspace', arguments: '{"path":".","recursive":true}' }
      }
    })!.pendingAgentConversation!
    const completed = applyAgentChatToolEventToPending({
      pending: called, activeConversationId: 'stream-1', assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'tool-1', name: 'list_workspace', arguments: '{"path":".","recursive":true}' },
        result: 'src/App.tsx'
      }
    })!.pendingAgentConversation!

    expect(completed.turns[0].processEvents).toHaveLength(1)
    expect(completed.turns[0].processEvents?.[0]).toMatchObject({
      kind: 'tool_call', title: '调用工具：list_workspace', status: 'tool_done'
    })
    expect(completed.turns[0].processEvents?.[0].detail).toBeUndefined()
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
    expect(reconciled[1].metadata?.sources?.[0]?.url).toBe('https://example.com')
  })
})
