import assert from 'node:assert/strict'

import {
  parseAgentChatStreamPayload,
  parseCleanupAgentArtifactsPayload,
  parseCreateAgentConversationCheckpointPayload,
  parseListUpstreamModelsPayload,
  parseQueryAgentArchivedHistoryPayload,
  parseRebuildAgentHistoryIndexPayload,
  parseResolveAgentConversationCheckpointPayload,
  parseSaveAgentConversationPayload,
  parseStreamId,
  parseWorkspaceItemRemovePayload,
  requireHttpUrl,
  requireWindowControlAction
} from '../../src/main/teaching-ipc-commands'

assert.deepEqual(
  parseAgentChatStreamPayload({
    streamId: 'pending-123',
    workspaceId: 'workspace-1',
    mode: 'temporary',
    context: undefined,
    contextCompaction: {
      force: true,
      enabled: true,
      contextWindowTokens: 4096,
      softThresholdTokens: 2048,
      hardThresholdTokens: 3072,
      now: 'ignored',
      failureCooldownMs: 1
    },
    userInput: ' hello ',
    messages: [
      { role: 'system', content: 'ignored by runtime later' },
      { role: 'assistant', content: null },
      { role: 'tool', toolCallId: 'call-1', content: 'result' },
      { role: 'invalid', content: 'drop me' }
    ]
  }),
  {
    streamId: 'pending-123',
    conversationId: undefined,
    workspaceId: 'workspace-1',
    mode: 'temporary',
    context: undefined,
    contextCompaction: {
      force: true,
      enabled: true,
      contextWindowTokens: 4096,
      softThresholdTokens: 2048,
      hardThresholdTokens: 3072
    },
    userInput: ' hello ',
    messages: [
      { role: 'system', content: 'ignored by runtime later', toolCallId: undefined, toolCalls: undefined },
      { role: 'assistant', content: null, toolCallId: undefined, toolCalls: undefined },
      { role: 'tool', content: 'result', toolCallId: 'call-1', toolCalls: undefined }
    ]
  }
)

assert.equal(parseAgentChatStreamPayload({ mode: 'teaching', userInput: 'go' }).mode, 'teaching')
assert.equal(parseAgentChatStreamPayload({ mode: 'bad', userInput: 'go' }).mode, undefined)
assert.equal(parseStreamId(' stream:1 '), 'stream:1')
assert.throws(() => parseStreamId('../bad'), /streamId/)

assert.deepEqual(
  parseSaveAgentConversationPayload({
    workspaceId: 'workspace-1',
    runId: ' run-save-1 ',
    mode: 'temporary',
    conversationId: null,
    selectedLessonPath: null,
    selectedCourseRelativePath: null,
    turns: [{ id: 't1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' }, null]
  }),
  {
    workspaceId: 'workspace-1',
    runId: 'run-save-1',
    mode: 'temporary',
    conversationId: null,
    selectedLessonPath: null,
    selectedCourseRelativePath: null,
    courseName: undefined,
    turns: [{ id: 't1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' }]
  }
)

assert.throws(
  () => parseSaveAgentConversationPayload({ workspaceId: 'workspace-1', runId: '../bad', turns: [] }),
  /streamId/
)


assert.deepEqual(parseCreateAgentConversationCheckpointPayload({
  workspaceId: 'workspace-1',
  conversationId: 'chat-1',
  label: ' before refactor ',
  reason: 'manual'
}), {
  workspaceId: 'workspace-1',
  conversationId: 'chat-1',
  label: 'before refactor',
  reason: 'manual'
})
assert.deepEqual(parseResolveAgentConversationCheckpointPayload({
  workspaceId: 'workspace-1', conversationId: 'chat-1', checkpointId: 'checkpoint-1'
}), {
  workspaceId: 'workspace-1', conversationId: 'chat-1', checkpointId: 'checkpoint-1'
})
assert.deepEqual(parseQueryAgentArchivedHistoryPayload({
  workspaceId: 'workspace-1',
  scope: 'all',
  conversationId: 'chat-1',
  from: '2026-07-14T00:00:00Z',
  types: ['tool_result', 'checkpoint'],
  limit: 20,
  maxBytes: 4096,
  maxExcerptBytes: 256
}), {
  workspaceId: 'workspace-1',
  scope: 'all',
  conversationId: 'chat-1',
  from: '2026-07-14T00:00:00.000Z',
  to: undefined,
  types: ['tool_result', 'checkpoint'],
  checkpointId: undefined,
  limit: 20,
  maxBytes: 4096,
  maxExcerptBytes: 256
})
assert.throws(() => parseQueryAgentArchivedHistoryPayload({
  workspaceId: 'workspace-1', types: ['everything']
}), /invalid archived history item type/)
assert.deepEqual(parseRebuildAgentHistoryIndexPayload({ workspaceId: 'workspace-1', scope: 'workspace' }), {
  workspaceId: 'workspace-1', scope: 'workspace'
})
assert.deepEqual(parseCleanupAgentArtifactsPayload({
  workspaceId: 'workspace-1', scope: 'temporary', dryRun: false, retentionDays: 30, graceHours: 12
}), {
  workspaceId: 'workspace-1',
  scope: 'temporary',
  dryRun: false,
  retentionDays: 30,
  graceHours: 12,
  maxTotalBytes: undefined
})

const providers = [
  { id: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', endpointFormat: 'chat_completions' as const }
]
assert.deepEqual(parseListUpstreamModelsPayload('openai', providers), {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk',
  endpointFormat: 'chat_completions'
})
assert.deepEqual(parseListUpstreamModelsPayload({ providerId: 'openai' }, providers), {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk',
  endpointFormat: 'chat_completions'
})
assert.equal(parseListUpstreamModelsPayload('missing', providers), null)
assert.deepEqual(
  parseListUpstreamModelsPayload({
    baseUrl: 'https://custom.example/v1',
    apiKey: 'custom',
    endpointFormat: 'responses'
  }, providers),
  {
    baseUrl: 'https://custom.example/v1',
    apiKey: 'custom',
    endpointFormat: 'responses'
  }
)

assert.deepEqual(parseWorkspaceItemRemovePayload({
  workspaceId: 'workspace-1',
  relativePath: 'courses/rag',
  kind: 'directory'
}), {
  workspaceId: 'workspace-1',
  relativePath: 'courses/rag',
  kind: 'directory',
  mode: 'disk'
})
assert.throws(() => parseWorkspaceItemRemovePayload({
  workspaceId: 'workspace-1',
  relativePath: 'courses/rag',
  kind: 'bad'
}), /kind/)

assert.equal(requireHttpUrl('https://example.com/path'), 'https://example.com/path')
assert.throws(() => requireHttpUrl('file:///tmp/secret'), /http/)
assert.equal(requireWindowControlAction('toggle-maximize'), 'toggle-maximize')
assert.throws(() => requireWindowControlAction('resize'), /Unsupported window control action/)

console.log('teaching IPC command parsers ok')
