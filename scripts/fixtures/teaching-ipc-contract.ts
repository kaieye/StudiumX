import assert from 'node:assert/strict'

import {
  teachingEventChannels,
  teachingInvokeChannels,
  type TeachingInvokeCapability
} from '../../src/shared/teaching-ipc-contract'

const invokeEntries = Object.entries(teachingInvokeChannels)
const eventEntries = Object.entries(teachingEventChannels)
const invokeValues = invokeEntries.map(([, channel]) => channel)
const eventValues = eventEntries.map(([, channel]) => channel)

assert.equal(invokeValues.length, new Set(invokeValues).size, 'invoke channels should be unique')
assert.equal(eventValues.length, new Set(eventValues).size, 'event channels should be unique')
assert.equal(teachingInvokeChannels.listUpstreamModels, 'teach:list-upstream-models')
assert.equal(teachingInvokeChannels.applyLessonStyle, 'teach:apply-lesson-style')
assert.equal(teachingEventChannels.lessonStreamChunk, 'teach:generate-lesson-chunk')
assert.equal(teachingEventChannels.agentChatTool, 'teach:agent-chat-tool')

const requiredInvokeCapabilities: TeachingInvokeCapability[] = [
  'getState',
  'generateLessonStream',
  'agentChatStream',
  'listUpstreamModels',
  'getConnectorStatuses',
  'openAppDataDir'
]
for (const capability of requiredInvokeCapabilities) {
  assert.equal(typeof teachingInvokeChannels[capability], 'string')
}

console.log('teaching IPC contract ok')
