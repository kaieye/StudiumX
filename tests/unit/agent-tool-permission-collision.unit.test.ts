import { describe, expect, it } from 'vitest'
import {
  applyAgentChatToolEventToPending,
  selectPendingToolPermission,
  type PendingAgentConversation
} from '../../src/renderer/src/agent-conversation-state'

const createdAt = '2026-07-16T10:00:00.000Z'

function pendingConversation(): PendingAgentConversation {
  return {
    workspaceId: 'workspace-1',
    sourceConversationId: null,
    sourceConversationRevision: null,
    mode: 'teaching',
    summary: {
      id: 'stream-1',
      title: 'Test',
      relativePath: 'conversations/test.json',
      createdAt,
      updatedAt: createdAt,
      messageCount: 2,
      mode: 'teaching',
      pending: true
    },
    turns: [{ id: 'assistant-1', role: 'assistant', content: '', createdAt }],
    status: '思考中…',
    toolsSupported: true
  }
}

describe('write tool permission projection', () => {
  it('keeps the approval request selectable when it reuses the write tool call id', () => {
    const writeCall = applyAgentChatToolEventToPending({
      pending: pendingConversation(),
      activeConversationId: 'stream-1',
      assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: {
          id: 'call-write-1',
          name: 'write_workspace_file',
          arguments: '{"path":"MISSION.md","content":"updated"}'
        }
      }
    })!.pendingAgentConversation!

    const permissionArguments = JSON.stringify({
      id: 'call-write-1',
      kind: 'workspace_write',
      toolName: 'write_workspace_file',
      operation: '覆盖工作区文件',
      targetPath: 'MISSION.md'
    })
    const waitingForPermission = applyAgentChatToolEventToPending({
      pending: writeCall,
      activeConversationId: 'stream-1',
      assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'call-write-1', name: 'tool_permission', arguments: permissionArguments }
      }
    })!.pendingAgentConversation!

    expect(waitingForPermission.turns[0].processEvents?.at(-1)).toMatchObject({
      kind: 'permission_request',
      title: '等待写入审批',
      toolCallId: 'call-write-1'
    })
    expect(selectPendingToolPermission(waitingForPermission.turns, 'stream-1')).toMatchObject({
      streamId: 'stream-1',
      toolCallId: 'call-write-1',
      request: { operation: '覆盖工作区文件', targetPath: 'MISSION.md' }
    })


    const permissionResolved = applyAgentChatToolEventToPending({
      pending: waitingForPermission,
      activeConversationId: 'stream-1',
      assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'call-write-1', name: 'tool_permission', arguments: permissionArguments },
        result: '{"decision":"allow_once"}'
      }
    })!.pendingAgentConversation!

    expect(selectPendingToolPermission(permissionResolved.turns, 'stream-1')).toBeNull()
    expect(permissionResolved.turns[0].processEvents).toMatchObject([
      { kind: 'tool_call', toolName: 'write_workspace_file' },
      { kind: 'permission_resolved', toolName: 'tool_permission', title: '写入审批已允许，继续执行' }
    ])

    const writeResolved = applyAgentChatToolEventToPending({
      pending: permissionResolved,
      activeConversationId: 'stream-1',
      assistantId: 'assistant-1',
      event: {
        streamId: 'stream-1',
        toolCall: { id: 'call-write-1', name: 'write_workspace_file', arguments: '' },
        result: '{"path":"MISSION.md"}'
      }
    })!.pendingAgentConversation!

    expect(writeResolved.turns[0].toolCalls).toMatchObject([
      { id: 'call-write-1', name: 'write_workspace_file', result: '{"path":"MISSION.md"}' },
      { id: 'call-write-1', name: 'tool_permission', result: '{"decision":"allow_once"}' }
    ])
    expect(writeResolved.turns[0].processEvents).toMatchObject([
      { kind: 'tool_call', toolName: 'write_workspace_file', status: 'tool_done' },
      { kind: 'permission_resolved', toolName: 'tool_permission', status: 'tool_done' }
    ])
  })
})
