import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')
const appStore = await readFile('src/renderer/src/app-shell/appStore.ts', 'utf8')
const stateModule = await readFile('src/renderer/src/agent-conversation-state.ts', 'utf8')

assert.match(
  appStore,
  /pendingAgentConversation:\s*PendingAgentConversation\s*\|\s*null/,
  'renderer should keep a local pending conversation while agentChatStream is running'
)

assert.match(
  appStore,
  /restorePendingAgentConversation:\s*\(\)\s*=>\s*void/,
  'renderer should expose a way to switch back to the pending conversation'
)

assert.match(
  app,
  /pendingAgentConversation \? \[pendingAgentConversation\.summary, \.\.\.conversations\.filter\(\(conversation\) => !sameRelativePath\(conversation\.relativePath, pendingAgentConversation\.summary\.relativePath\)\)\] : conversations/,
  'sidebar conversation list should include only temporary pending conversations before they are saved'
)

assert.match(
  app,
  /!isCourseAgentConversationPath\(storedPendingAgentConversation\.summary\.relativePath\)/,
  'course-scoped pending conversations should stay out of the flat conversation section'
)

assert.match(
  app,
  /withPendingCourseConversation\(workspaces, pendingAgentConversation\)/,
  'course sidebar should merge course-scoped pending conversations into the course tree'
)

assert.match(
  app,
  /withPendingCourseConversation\(appState\.workspaces, pendingAgentConversation\)/,
  'course library should merge course-scoped pending conversations before rendering course cards'
)

assert.match(
  app,
  /conversation\.pending\s*\?\s*restorePendingAgentConversation\(\)\s*:\s*void loadAgentConversation\(conversation\.id,\s*conversation\.workspaceId\)/,
  'clicking the pending sidebar row should restore local streaming turns instead of reading from disk'
)

assert.match(
  stateModule,
  /const pendingConversation:\s*PendingAgentConversation\s*=\s*\{[\s\S]*summary:\s*createPendingAgentConversationSummary/,
  'agent conversation state module should create a pending sidebar summary as soon as a stream starts'
)

assert.match(
  stateModule,
  /pendingAgentConversation:\s*null/,
  'pending lifecycle helpers should clear the pending local sidebar entry'
)

assert.match(
  stateModule,
  /activeConversationId === pending\.summary\.id[\s\S]*activeConversationId:\s*savedConversationId/,
  'saving should replace the pending active id with the persisted id only when the pending conversation is still active'
)

console.log('pending conversation return path ok')
