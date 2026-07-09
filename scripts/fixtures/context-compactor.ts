import assert from 'node:assert/strict'

import { ContextCompactor } from '../../src/main/ai/context-compactor'
import { ContextEstimator } from '../../src/main/ai/context-estimator'
import type { ChatMessage, ToolCall } from '../../src/main/ai/provider-adapter'

const makeToolCall = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})

const buildMessages = (): ChatMessage[] => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'System policy stays first.' }
  ]
  for (let index = 0; index < 24; index += 1) {
    messages.push({
      role: 'user',
      content: `OLD_USER_${index}: ${'historical context '.repeat(30)}`
    })
    messages.push({
      role: 'assistant',
      content: `OLD_ASSISTANT_${index}: ${'resolved work '.repeat(26)}`
    })
  }
  messages.push({
    role: 'assistant',
    content: null,
    tool_calls: [makeToolCall('recent-call', 'lookup', { query: 'tail' })]
  })
  messages.push({
    role: 'tool',
    tool_call_id: 'recent-call',
    content: 'RECENT_TOOL_RESULT should keep its assistant pair.'
  })
  messages.push({ role: 'user', content: 'LATEST_USER: answer this now.' })
  return messages
}

const estimator = new ContextEstimator()
const messages = buildMessages()
const events: string[] = []
const compactor = new ContextCompactor({
  estimator,
  contextWindowTokens: 1_600,
  softThresholdTokens: 500,
  hardThresholdTokens: 900,
  minTailMessages: 4,
  minMessagesToCompact: 4,
  summaryInputTokenLimit: 1_200,
  summarize: async (request) => {
    events.push(`${request.mode}:${request.reason}:${request.sourceDigest}`)
    assert.ok(request.inputTokens > 0)
    assert.ok(request.messages.some((message) => message.role === 'user' && message.content.includes('messages-to-compact')))
    return [
      'Preserved constraints: keep system policy and current task.',
      'Historical task snapshot: old turns were completed.',
      'Recent work state: continue from the retained tail.'
    ].join('\n')
  }
})

const compacted = await compactor.compactIfNeeded({ messages })
assert.equal(compacted.changed, true)
assert.ok(events.length === 1, 'compactor should call the summarizer once for a new source digest')
assert.ok(compacted.estimateAfter.totalTokens < compacted.estimateBefore.totalTokens)
const sentText = serialize(compacted.messages)
assert.match(sentText, /CONTEXT COMPACTION - REFERENCE ONLY/)
assert.match(sentText, /Use this only as background/)
assert.match(sentText, /LATEST_USER/)
assert.doesNotMatch(sentText, /OLD_USER_0/)
assertRetainedToolPair(compacted.messages, 'recent-call')
assertNoOrphanToolResults(compacted.messages)
assert.equal(compacted.events[0]?.type, 'context_compaction_started')
assert.equal(compacted.events[1]?.type, 'context_compaction_completed')

const cached = await compactor.compactIfNeeded({ messages })
assert.equal(cached.changed, true)
assert.ok(events.length === 1, 'compactor should reuse a cached summary for the same digest')
const cachedCompleted = cached.events.find((event) => event.type === 'context_compaction_completed')
assert.equal(cachedCompleted?.type === 'context_compaction_completed' ? cachedCompleted.cached : false, true)

let now = Date.parse('2026-07-06T00:00:00.000Z')
let failureAttempts = 0
const failingCompactor = new ContextCompactor({
  estimator,
  contextWindowTokens: 1_600,
  softThresholdTokens: 500,
  hardThresholdTokens: 900,
  failureCooldownMs: 60_000,
  now: () => now,
  summarize: async () => {
    failureAttempts += 1
    throw new Error('summary provider unavailable')
  }
})
const failed = await failingCompactor.compactIfNeeded({ messages })
assert.equal(failed.changed, false)
assert.equal(failureAttempts, 1)
assert.equal(failed.messages, messages, 'failed compaction must preserve the original message array')
assert.ok(failed.events.some((event) => event.type === 'context_compaction_failed'))
const skipped = await failingCompactor.compactIfNeeded({ messages })
assert.equal(skipped.changed, false)
assert.equal(failureAttempts, 1, 'failure cooldown should avoid retrying every request')
now += 60_001
await failingCompactor.compactIfNeeded({ messages })
assert.equal(failureAttempts, 2, 'cooldown expiry should allow a later retry')

console.log('context compactor ok')

function assertRetainedToolPair(messages: ChatMessage[], toolCallId: string): void {
  const assistant = messages.find(
    (message) => message.role === 'assistant' && message.tool_calls?.some((call) => call.id === toolCallId)
  )
  const tool = messages.find((message) => message.role === 'tool' && message.tool_call_id === toolCallId)
  assert.ok(assistant, 'retained tool result must keep its assistant tool call')
  assert.ok(tool, 'retained assistant tool call must keep its tool result')
}

function assertNoOrphanToolResults(messages: ChatMessage[]): void {
  const toolCallIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const call of message.tool_calls ?? []) toolCallIds.add(call.id)
  }
  for (const message of messages) {
    if (message.role === 'tool') assert.ok(toolCallIds.has(message.tool_call_id))
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value)
}
