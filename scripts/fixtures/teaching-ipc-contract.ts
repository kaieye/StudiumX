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
assert.equal('cleanupAgentArtifacts' in teachingInvokeChannels, false, 'agent artifact cleanup must not be a renderer IPC capability')
assert.equal(Object.values(teachingInvokeChannels).includes('teach:cleanup-agent-artifacts'), false, 'agent artifact cleanup channel must not be published')
assert.equal(teachingInvokeChannels.projectAgentConversationSummaries, 'teach:project-agent-conversation-summaries')
assert.equal(teachingEventChannels.lessonStreamChunk, 'teach:generate-lesson-chunk')
assert.equal(teachingEventChannels.agentChatTool, 'teach:agent-chat-tool')
assert.equal(teachingEventChannels.agentChatEvent, 'teach:agent-chat-event')

const requiredInvokeCapabilities: TeachingInvokeCapability[] = [
  'getState',
  'generateLessonStream',
  'agentChatStream',
  'replayAgentChatEvents',
  'createAgentConversationCheckpoint',
  'projectAgentConversationSummaries',
  'resolveAgentConversationCheckpoint',
  'queryAgentArchivedHistory',
  'rebuildAgentHistoryIndex',
  'listUpstreamModels',
  'getConnectorStatuses',
  'openAppDataDir'
]
for (const capability of requiredInvokeCapabilities) {
  assert.equal(typeof teachingInvokeChannels[capability], 'string')
}

console.log('teaching IPC contract ok')
