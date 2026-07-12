import assert from 'node:assert/strict'

import {
  parseAgentChatStreamPayload,
  parseListUpstreamModelsPayload,
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
    mode: 'temporary',
    conversationId: null,
    selectedLessonPath: null,
    selectedCourseRelativePath: null,
    turns: [{ id: 't1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' }, null]
  }),
  {
    workspaceId: 'workspace-1',
    mode: 'temporary',
    conversationId: null,
    selectedLessonPath: null,
    selectedCourseRelativePath: null,
    courseName: undefined,
    turns: [{ id: 't1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' }]
  }
)

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
