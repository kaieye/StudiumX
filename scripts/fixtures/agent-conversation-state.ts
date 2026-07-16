import assert from 'node:assert/strict'

import {
  activeTeachingConversationSummary,
  applyAgentChatChunkToPending,
  applyAgentChatStatusToPending,
  applyAgentChatToolEventToPending,
  cancelPendingAgentConversation,
  createAgentConversationTurnDraft,
  failPendingAgentConversation,
  finishPendingAgentConversationSave,
  reconcileAgentTurnsWithLocalProcess,
  selectPendingToolPermission,
  syncPendingAgentConversation
} from '../../src/renderer/src/agent-conversation-state'

const workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  rootPath: 'D:/workspace',
  missionTitle: 'Mission',
  missionExcerpt: '',
  lessons: [],
  courses: [
    {
      name: 'RAG',
      relativePath: 'courses/rag',
      sessions: [],
      sessionCount: 0,
      conversations: []
    }
  ],
  conversations: [],
  fileTree: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const state = {
  activeWorkspace: workspace,
  workspaces: [workspace],
  temporaryConversations: [],
  runtime: {
    status: 'idle',
    currentStep: '',
    queuedTasks: 0,
    providerLabel: ''
  },
  selectedLessonPath: 'D:/workspace/courses/rag/sessions/001.html',
  previewHtml: '',
  previewUrl: ''
}

const draft = createAgentConversationTurnDraft({
  state,
  workspace,
  input: 'Explain retrieval practice',
  mode: 'teaching',
  activeConversationId: null,
  currentTurns: [{ id: 'old-user', role: 'user', content: 'Earlier', createdAt: '2026-01-01T00:00:00.000Z' }],
  selectedCourseRelativePath: 'courses/rag',
  currentSelectedLessonPath: state.selectedLessonPath,
  createdAt: '2026-01-02T00:00:00.000Z',
  idSeed: 123
})

assert.equal(draft.pendingConversationId, 'pending-123')
assert.equal(draft.assistantId, 'a-123')
assert.equal(draft.sourceConversationId, null)
assert.equal(draft.selectedCourseRelativePath, 'courses/rag')
assert.equal(draft.selectedLessonPath, state.selectedLessonPath)
assert.deepEqual(draft.priorMessages, [{ role: 'user', content: 'Earlier' }])
assert.equal(draft.pendingConversation.summary.relativePath, 'courses/rag/conversation/pending-123.md')
assert.equal(draft.pendingConversation.summary.absolutePath, 'D:/workspace/courses/rag/conversation/pending-123.md')

let pending = draft.pendingConversation

let patch = applyAgentChatChunkToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  chunk: { streamId: draft.pendingConversationId, delta: 'First chunk.' },
  updatedAt: '2026-01-02T00:00:01.000Z'
})
assert.ok(patch)
assert.equal(patch.agentTurns?.at(-1)?.content, 'First chunk.')
assert.equal(patch.agentStatus, '思考中…')
pending = patch.pendingAgentConversation!

const permissionRequest = {
  id: 'permission-1',
  kind: 'workspace_write' as const,
  toolName: 'write_workspace_file',
  operation: '创建工作区文件',
  targetPath: 'learning-records/0001-note.md',
  reason: '模型请求写入新的教学资产。',
  creates: true
}

patch = applyAgentChatToolEventToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  event: {
    streamId: draft.pendingConversationId,
    toolCall: { id: 'permission-1', name: 'tool_permission', arguments: JSON.stringify(permissionRequest) },
    permissionRequest
  },
  updatedAt: '2026-01-02T00:00:04.100Z'
})
assert.ok(patch)
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.title, '等待写入审批')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'permission_request')
assert.equal(
  selectPendingToolPermission(patch.agentTurns!, draft.pendingConversationId)?.request.targetPath,
  'learning-records/0001-note.md'
)
pending = patch.pendingAgentConversation!

patch = applyAgentChatToolEventToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  event: {
    streamId: draft.pendingConversationId,
    toolCall: { id: 'permission-1', name: 'tool_permission', arguments: JSON.stringify(permissionRequest) },
    result: '{"decision":"allow"}',
    isError: false,
    permissionRequest
  },
  updatedAt: '2026-01-02T00:00:04.150Z'
})
assert.ok(patch)
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.title, '写入审批已允许')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'permission_resolved')
assert.equal(selectPendingToolPermission(patch.agentTurns!, draft.pendingConversationId), null)
pending = patch.pendingAgentConversation!

patch = applyAgentChatStatusToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  status: { streamId: draft.pendingConversationId, status: 'tool_running', message: 'read_workspace_file' },
  updatedAt: '2026-01-02T00:00:02.000Z'
})
assert.ok(patch)
assert.equal(patch.agentStatus, '调用工具… read_workspace_file')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'status')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.status, 'tool_running')
pending = patch.pendingAgentConversation!

patch = applyAgentChatStatusToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  status: { streamId: draft.pendingConversationId, status: 'tool_running', message: '正在生成课程：调用模型…' },
  updatedAt: '2026-01-02T00:00:02.500Z'
})
assert.ok(patch)
assert.equal(patch.agentStatus, '正在生成课程：调用模型…')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.title, 'generate_lesson：调用模型')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.detail, '课程生成工具')
const eventCountAfterLessonStatus = patch.agentTurns?.at(-1)?.processEvents?.length ?? 0
pending = patch.pendingAgentConversation!

patch = applyAgentChatStatusToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  status: { streamId: draft.pendingConversationId, status: 'tool_running', message: '正在生成课程：调用模型…' },
  updatedAt: '2026-01-02T00:00:02.750Z'
})
assert.ok(patch)
assert.equal(
  patch.agentTurns?.at(-1)?.processEvents?.length,
  eventCountAfterLessonStatus,
  'repeated lesson-generation phases should not spam the process panel'
)
pending = patch.pendingAgentConversation!

patch = applyAgentChatToolEventToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  event: {
    streamId: draft.pendingConversationId,
    toolCall: { id: 'tool-1', name: 'read_workspace_file', arguments: '{"path":"MISSION.md"}' }
  },
  updatedAt: '2026-01-02T00:00:03.000Z'
})
assert.ok(patch)
assert.equal(
  patch.agentTurns?.at(-1)?.toolCalls?.find((toolCall) => toolCall.id === 'tool-1')?.name,
  'read_workspace_file'
)
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'tool_call')
pending = patch.pendingAgentConversation!

patch = applyAgentChatToolEventToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  event: {
    streamId: draft.pendingConversationId,
    toolCall: { id: 'tool-1', name: 'read_workspace_file', arguments: '' },
    result: '{"ok":true}',
    isError: false
  },
  updatedAt: '2026-01-02T00:00:04.000Z'
})
assert.ok(patch)
assert.equal(
  patch.agentTurns?.at(-1)?.toolCalls?.find((toolCall) => toolCall.id === 'tool-1')?.result,
  '{"ok":true}'
)
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'tool_call')
pending = patch.pendingAgentConversation!

patch = applyAgentChatToolEventToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  event: {
    streamId: draft.pendingConversationId,
    toolCall: {
      id: 'ask-1',
      name: 'ask',
      arguments: JSON.stringify({
        questions: [
          {
            question: '这节课优先练哪一种题？',
            options: [{ label: '概念题' }, { label: '应用题' }]
          }
        ]
      })
    }
  },
  updatedAt: '2026-01-02T00:00:04.050Z'
})
assert.ok(patch)
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'elicitation_request')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.title, '等待用户选择')
pending = patch.pendingAgentConversation!

patch = applyAgentChatToolEventToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  event: {
    streamId: draft.pendingConversationId,
    toolCall: { id: 'ask-1', name: 'ask', arguments: '' },
    result: '用户选择：「概念题」',
    isError: false
  },
  updatedAt: '2026-01-02T00:00:04.075Z'
})
assert.ok(patch)
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'elicitation_resolved')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.title, '用户选择已提交')
pending = patch.pendingAgentConversation!

patch = applyAgentChatStatusToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  status: { streamId: draft.pendingConversationId, status: 'tool_running', message: '子任务排队：检查 resources' },
  updatedAt: '2026-01-02T00:00:04.250Z'
})
assert.ok(patch)
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.title, '子任务排队')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'child_run_queued')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.detail, '检查 resources')
pending = patch.pendingAgentConversation!

patch = applyAgentChatStatusToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  status: { streamId: draft.pendingConversationId, status: 'tool_running', message: '子任务进度：child-1：thinking' },
  updatedAt: '2026-01-02T00:00:04.500Z'
})
assert.ok(patch)
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.title, '子任务进度')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'child_run_delta')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.detail, 'child-1：thinking')
pending = patch.pendingAgentConversation!

patch = applyAgentChatStatusToPending({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId,
  status: { streamId: draft.pendingConversationId, status: 'thinking', message: '上下文压缩完成：约节省 120 token' },
  updatedAt: '2026-01-02T00:00:04.750Z'
})
assert.ok(patch)
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'compaction')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.title, '上下文压缩完成')
pending = patch.pendingAgentConversation!

assert.equal(
  applyAgentChatChunkToPending({
    pending,
    activeConversationId: draft.pendingConversationId,
    assistantId: draft.assistantId,
    chunk: { streamId: 'other-stream', delta: 'ignore' }
  }),
  null,
  'stream events for other pending conversations should be ignored'
)

patch = syncPendingAgentConversation({
  pending,
  pendingConversationId: draft.pendingConversationId,
  activeConversationId: draft.pendingConversationId,
  patch: { toolsSupported: true },
  updatedAt: '2026-01-02T00:00:05.000Z'
})
assert.ok(patch)
assert.equal(patch.agentToolsSupported, true)
pending = patch.pendingAgentConversation!

const canceled = cancelPendingAgentConversation({
  pending,
  activeConversationId: draft.pendingConversationId,
  preserveToolsSupported: true
})
assert.equal(canceled.agentChatBusy, false)
assert.equal(canceled.pendingAgentConversation, null)
assert.equal(canceled.activeConversationId, null)
assert.equal(canceled.agentToolsSupported, true)
assert.equal(canceled.agentTurns?.at(-1)?.processEvents?.at(-1)?.status, 'canceled')

const failed = failPendingAgentConversation({
  pending,
  activeConversationId: draft.pendingConversationId,
  assistantId: draft.assistantId
})
assert.equal(failed.agentChatBusy, false)
assert.equal(failed.pendingAgentConversation, null)
assert.equal(failed.agentTurns?.some((turn) => turn.id === draft.assistantId), false)

const saved = finishPendingAgentConversationSave({
  pending,
  activeConversationId: draft.pendingConversationId,
  savedConversationId: 'saved-1',
  turns: pending.turns,
  toolsSupported: true
})
assert.equal(saved.pendingAgentConversation, null)
assert.equal(saved.activeConversationId, 'saved-1')
assert.equal(saved.agentToolsSupported, true)

const reconciled = reconcileAgentTurnsWithLocalProcess(
  [{ id: 'server-a', role: 'assistant', content: 'server', createdAt: '2026-01-02T00:00:06.000Z' }],
  pending.turns
)
assert.equal(reconciled[0].processEvents?.length, pending.turns.at(-1)?.processEvents?.length)

const metadataReconciled = reconcileAgentTurnsWithLocalProcess(
  [
    {
      id: 'server-meta',
      role: 'assistant',
      content: 'server',
      metadata: {
        version: 1,
        sources: [{ sourceId: 'src-1', url: 'https://example.com/source', title: 'Source' }]
      },
      createdAt: '2026-01-02T00:00:06.000Z'
    }
  ],
  [
    {
      id: 'local-meta',
      role: 'assistant',
      content: 'local',
      processEvents: pending.turns.at(-1)?.processEvents,
      metadata: {
        version: 1,
        childRuns: [
          {
            childRunId: 'child-1',
            label: 'Audit',
            profile: 'workspace_audit',
            status: 'completed',
            summary: 'done'
          }
        ]
      },
      createdAt: '2026-01-02T00:00:06.000Z'
    }
  ]
)
assert.equal(metadataReconciled[0].metadata?.sources?.[0]?.sourceId, 'src-1')
assert.equal(metadataReconciled[0].metadata?.childRuns?.[0]?.childRunId, 'child-1')
assert.equal(metadataReconciled[0].processEvents?.length, pending.turns.at(-1)?.processEvents?.length)

assert.equal(
  activeTeachingConversationSummary({
    state,
    workspaceId: workspace.id,
    activeConversationId: pending.summary.id,
    pendingAgentConversation: pending
  })?.id,
  pending.summary.id
)

const temporaryDraft = createAgentConversationTurnDraft({
  state,
  workspace,
  input: 'Temporary question',
  mode: 'temporary',
  activeConversationId: null,
  currentTurns: [],
  selectedCourseRelativePath: 'courses/rag',
  currentSelectedLessonPath: state.selectedLessonPath,
  createdAt: '2026-01-03T00:00:00.000Z',
  idSeed: 456
})
assert.equal(temporaryDraft.selectedCourseRelativePath, null)
assert.equal(temporaryDraft.selectedLessonPath, null)
assert.equal(temporaryDraft.pendingConversation.summary.relativePath, 'conversations/pending-456.md')
assert.equal(
  activeTeachingConversationSummary({
    state,
    workspaceId: workspace.id,
    activeConversationId: temporaryDraft.pendingConversation.summary.id,
    pendingAgentConversation: temporaryDraft.pendingConversation
  }),
  null
)

console.log('agent conversation renderer state ok')
