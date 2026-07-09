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
assert.equal(patch.agentTurns?.at(-1)?.toolCalls?.[0]?.name, 'read_workspace_file')
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
assert.equal(patch.agentTurns?.at(-1)?.toolCalls?.[0]?.result, '{"ok":true}')
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.kind, 'tool_result')
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
assert.equal(patch.agentTurns?.at(-1)?.processEvents?.at(-1)?.detail, 'child-1：thinking')
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
