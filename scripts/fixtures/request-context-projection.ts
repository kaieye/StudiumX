import assert from 'node:assert/strict'

import { RequestContextProjector } from '../../src/main/ai/request-context-projection'
import type { ChatMessage, ToolDefinition } from '../../src/main/ai/provider-adapter'

const tool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup',
    description: 'Lookup a study fact.',
    parameters: { type: 'object', properties: { query: { type: 'string' } } }
  }
}

const largeToolResult = `${Array.from({ length: 310 }, (_, index) =>
  index === 120 ? 'ERROR: REQUEST_CONTEXT_PROJECTION_SIGNAL' : `historical tool output ${index} ${'x'.repeat(100)}`
).join('\n')}\n`

const hygieneTranscript: ChatMessage[] = [
  { role: 'system', content: 'Use the current study request.' },
  { role: 'user', content: 'Look up the archived fact.' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: 'old-tool',
      type: 'function',
      function: { name: 'lookup', arguments: JSON.stringify({ query: 'old fact', payload: 'x'.repeat(12_000) }) }
    }]
  },
  { role: 'tool', tool_call_id: 'old-tool', content: largeToolResult },
  {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'recent-tool', type: 'function', function: { name: 'lookup', arguments: '{"query":"current fact"}' } }]
  },
  { role: 'tool', tool_call_id: 'recent-tool', content: 'CURRENT_CONTEXT_PROJECTION_TOOL_RESULT' },
  { role: 'user', content: 'Answer only the current request.' }
]

const hygieneProjector = new RequestContextProjector({
  modelId: 'fixture-model',
  compaction: { enabled: false },
  summarize: async () => 'not used'
})
const hygiened = await hygieneProjector.project(hygieneTranscript, [tool])
assert.deepEqual(hygiened.trace.map((event) => event.type), ['context_hygiene_applied', 'context_estimated'])
assert.equal(hygiened.trace[0]?.type, 'context_hygiene_applied')
assert.equal(hygiened.trace[0]?.changed, true)
assert.ok(hygiened.trace[0]?.savedTokens > 0)
assert.equal(hygieneTranscript[3]?.role === 'tool' ? hygieneTranscript[3].content : '', largeToolResult, 'projection must not mutate the transcript')
const projectedOldTool = hygiened.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'old-tool')
assert.match(projectedOldTool?.role === 'tool' ? projectedOldTool.content : '', /REQUEST_CONTEXT_PROJECTION_SIGNAL/)
assertToolPairs(hygiened.messages)

const compactionTranscript = buildLongTranscript()
let summaryCalls = 0
const compactionProjector = new RequestContextProjector({
  modelId: 'fixture-model',
  compaction: {
    enabled: true,
    force: true,
    contextWindowTokens: 1_600,
    minTailMessages: 3,
    minMessagesToCompact: 3,
    summaryInputTokenLimit: 900,
    maxSummaryTokens: 300
  },
  summarize: async (request) => {
    summaryCalls += 1
    assert.equal(request.mode, 'manual')
    return 'REQUEST_CONTEXT_PROJECTION_COMPACTED_SUMMARY'
  }
})
const compacted = await compactionProjector.project(compactionTranscript, [tool])
assert.equal(summaryCalls, 1)
assert.deepEqual(compacted.trace.map((event) => event.type), [
  'context_hygiene_applied',
  'context_compaction_started',
  'context_compaction_completed',
  'context_estimated'
])
assert.ok(compacted.messages.length < compactionTranscript.length)
assert.ok(compacted.messages.some((message) => message.role === 'system' && String(message.content).includes('REQUEST_CONTEXT_PROJECTION_COMPACTED_SUMMARY')))
assertToolPairs(compacted.messages)

const failedProjector = new RequestContextProjector({
  modelId: 'fixture-model',
  compaction: {
    enabled: true,
    force: true,
    contextWindowTokens: 1_600,
    minTailMessages: 3,
    minMessagesToCompact: 3
  },
  summarize: async () => {
    throw new Error('summary unavailable')
  }
})
const failed = await failedProjector.project(compactionTranscript, [tool])
assert.deepEqual(failed.trace.map((event) => event.type), [
  'context_hygiene_applied',
  'context_compaction_started',
  'context_compaction_failed',
  'context_estimated'
])
assert.equal(failed.messages.length, compactionTranscript.length)
assertToolPairs(failed.messages)

console.log('request context projection boundaries ok')

function buildLongTranscript(): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Use context summaries only as historical reference.' },
    { role: 'user', content: 'Initial study context.' },
    { role: 'assistant', content: 'I understand.' }
  ]
  for (let index = 0; index < 12; index += 1) {
    messages.push({ role: 'user', content: `OLD_REQUEST_${index}: ${'historical study detail '.repeat(50)}` })
    messages.push({ role: 'assistant', content: `OLD_ANSWER_${index}: ${'resolved study detail '.repeat(50)}` })
  }
  messages.push({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'retained-tool', type: 'function', function: { name: 'lookup', arguments: '{"query":"tail"}' } }]
  })
  messages.push({ role: 'tool', tool_call_id: 'retained-tool', content: 'RETAINED_TOOL_PAIR' })
  messages.push({ role: 'user', content: 'LATEST_REQUEST_CONTEXT_PROJECTION' })
  return messages
}

function assertToolPairs(messages: ChatMessage[]): void {
  const ids = new Set(
    messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.tool_calls ?? [])
      .map((call) => call.id)
  )
  for (const message of messages) {
    if (message.role !== 'tool') continue
    assert.ok(ids.has(message.tool_call_id), `orphan provider tool result ${message.tool_call_id}`)
  }
}
