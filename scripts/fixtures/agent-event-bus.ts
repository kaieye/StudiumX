import assert from 'node:assert/strict'

import { createAgentEventBus } from '../../src/main/ai/agent-event-bus'
import { createAgentRealtimeDelivery } from '../../src/preload/agent-realtime-delivery'
import type { AgentLoopEvent } from '../../src/main/ai/agent-loop'
import type {
  AgentRealtimeEvent,
  AgentChatStreamChunk,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentProjectionInvalidation
} from '../../src/shared/teaching-types'

const chunks: AgentChatStreamChunk[] = []
const statuses: AgentChatStreamStatus[] = []
const tools: AgentChatStreamToolEvent[] = []
const realtimeEvents: AgentRealtimeEvent[] = []
let tick = 0

const bus = createAgentEventBus({
  streamId: 'stream-1',
  maxReplayBytes: 16 * 1024,
  now: () => `2026-07-12T00:00:0${tick++}.000Z`,
  onChunk: (chunk) => chunks.push(chunk),
  onStatus: (status) => statuses.push(status),
  onTool: (event) => tools.push(event),
  onRealtimeEvent: (event) => realtimeEvents.push(event)
})

const events: AgentLoopEvent[] = [
  { type: 'status', status: 'thinking', message: 'reading' },
  { type: 'token', delta: 'hello' },
  {
    type: 'tool_call',
    toolCall: {
      id: 'call-1',
      type: 'function',
      function: { name: 'list_workspace', arguments: '{"path":"."}' }
    }
  },
  { type: 'tool_result', toolCallId: 'call-1', name: 'list_workspace', result: '{"ok":true}', isError: false },
  {
    type: 'child_run_delta',
    childRunId: 'child-1',
    message: 'halfway'
  },
  {
    type: 'context_compaction_completed',
    reason: 'soft_threshold',
    mode: 'normal',
    sourceDigest: 'digest',
    beforeTokens: 1000,
    afterTokens: 600,
    replacedTokens: 500,
    summaryTokens: 120,
    replacedMessages: 4,
    tailMessages: 6,
    cached: false
  },
  { type: 'status', status: 'done' }
]

for (const event of events) bus.publishLoopEvent(event)

assert.deepEqual(chunks, [{ streamId: 'stream-1', delta: 'hello' }])
assert.deepEqual(statuses.map((status) => status.status), ['thinking', 'tool_running', 'thinking', 'done'])
assert.equal(statuses[2]?.message, '上下文压缩完成：约节省 380 token')
assert.equal(tools.length, 2)
assert.deepEqual(tools[0]?.toolCall, { id: 'call-1', name: 'list_workspace', arguments: '{"path":"."}' })
assert.equal(tools[1]?.result, '{"ok":true}')
assert.deepEqual(realtimeEvents.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8])

const terminal = bus.terminal()
assert.equal(terminal?.kind, 'terminal')
assert.equal(terminal?.sequence, 8)
if (terminal?.kind === 'terminal') assert.equal(terminal.outcome, 'done')

const replay = bus.recentReplay()
assert.equal(replay.streamId, 'stream-1')
assert.equal(replay.available, true)
assert.equal(replay.hasGap, false)
assert.equal(replay.fromSequence, 1)
assert.equal(replay.nextSequence, 9)
assert.deepEqual(replay.events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8])
assert.deepEqual(replay.events.map((event) => event.kind), [
  'status',
  'chunk',
  'tool',
  'tool',
  'status',
  'status',
  'status',
  'terminal'
])

const replayAfterToolCall = bus.replayAfter(3)
assert.equal(replayAfterToolCall.requestedAfterSequence, 3)
assert.equal(replayAfterToolCall.fromSequence, 4)
assert.equal(replayAfterToolCall.hasGap, false)
assert.deepEqual(replayAfterToolCall.events.map((event) => event.sequence), [4, 5, 6, 7, 8])

const deliveredKinds: string[] = []
const delivery = createAgentRealtimeDelivery({
  streamId: 'stream-1',
  replay: async (_streamId, afterSequence) => bus.replayAfter(afterSequence),
  onChunk: () => deliveredKinds.push('chunk'),
  onStatus: () => deliveredKinds.push('status'),
  onTool: () => deliveredKinds.push('tool')
})
await delivery.accept(realtimeEvents[0]!)
await delivery.accept(realtimeEvents[2]!)
await delivery.flush()
assert.equal(delivery.lastSequence(), 8)
assert.deepEqual(deliveredKinds, ['status', 'chunk', 'tool', 'tool', 'status', 'status', 'status'])

const compactBus = createAgentEventBus({
  streamId: 'stream-2',
  maxReplayBytes: 1024,
  now: () => '2026-07-12T00:00:00.000Z',
  onChunk: () => undefined,
  onStatus: () => undefined,
  onTool: () => undefined
})

compactBus.publishChunk('a'.repeat(900))
compactBus.publishChunk('b'.repeat(900))
compactBus.publishChunk('c'.repeat(900))
const compactReplay = compactBus.recentReplay()
assert.equal(compactReplay.hasGap, true)
assert.equal(compactReplay.droppedEvents > 0, true)
assert.equal(compactReplay.events.at(-1)?.kind, 'chunk')
assert.equal(compactReplay.nextSequence, 4)

const gapInvalidations: AgentProjectionInvalidation[] = []
const gapStatuses: AgentChatStreamStatus[] = []
const retainedGapEvent: AgentRealtimeEvent = {
  streamId: 'stream-gap',
  sequence: 3,
  createdAt: '2026-07-12T00:00:03.000Z',
  kind: 'status',
  payload: { streamId: 'stream-gap', status: 'thinking', message: 'retained truth projection' }
}
const liveGapEvent: AgentRealtimeEvent = {
  streamId: 'stream-gap',
  sequence: 4,
  createdAt: '2026-07-12T00:00:04.000Z',
  kind: 'status',
  payload: { streamId: 'stream-gap', status: 'done' }
}
const gapDelivery = createAgentRealtimeDelivery({
  streamId: 'stream-gap',
  replay: async () => ({
    streamId: 'stream-gap',
    available: true,
    requestedAfterSequence: 0,
    fromSequence: 3,
    nextSequence: 5,
    hasGap: true,
    droppedEvents: 2,
    droppedBytes: 512,
    events: [retainedGapEvent]
  }),
  onChunk: () => undefined,
  onStatus: (status) => gapStatuses.push(status),
  onTool: () => undefined,
  onInvalidation: (event) => gapInvalidations.push(event)
})
await gapDelivery.accept(liveGapEvent)
assert.deepEqual(gapInvalidations.map((event) => event.reason), ['replay_gap'])
assert.deepEqual(gapStatuses.map((status) => status.status), ['thinking', 'done'])
assert.equal(gapDelivery.lastSequence(), 4)

const unavailableInvalidations: AgentProjectionInvalidation[] = []
const unavailableDelivery = createAgentRealtimeDelivery({
  streamId: 'stream-unavailable',
  replay: async () => ({
    streamId: 'stream-unavailable',
    available: false,
    requestedAfterSequence: 0,
    fromSequence: 1,
    nextSequence: 6,
    hasGap: false,
    droppedEvents: 0,
    droppedBytes: 0,
    events: []
  }),
  onChunk: () => undefined,
  onStatus: () => undefined,
  onTool: () => undefined,
  onInvalidation: (event) => unavailableInvalidations.push(event)
})
const unavailableLive: AgentRealtimeEvent = {
  streamId: 'stream-unavailable',
  sequence: 5,
  createdAt: '2026-07-12T00:00:05.000Z',
  kind: 'status',
  payload: { streamId: 'stream-unavailable', status: 'error', message: 'saved truth required' }
}
await unavailableDelivery.accept(unavailableLive)
await unavailableDelivery.accept({ ...unavailableLive, sequence: 7 })
assert.deepEqual(unavailableInvalidations.map((event) => event.reason), ['replay_unavailable'])
assert.equal(unavailableDelivery.lastSequence(), 7)

console.log('check:agent-event-bus passed')
