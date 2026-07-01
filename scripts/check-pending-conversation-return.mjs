import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')

assert.match(
  app,
  /pendingAgentConversation:\s*PendingAgentConversation\s*\|\s*null/,
  'renderer should keep a local pending conversation while agentChatStream is running'
)

assert.match(
  app,
  /restorePendingAgentConversation:\s*\(\)\s*=>\s*void/,
  'renderer should expose a way to switch back to the pending conversation'
)

assert.match(
  app,
  /pendingAgentConversation \? \[pendingAgentConversation\.summary, \.\.\.conversations\] : conversations/,
  'sidebar conversation list should include the pending conversation before it is saved'
)

assert.match(
  app,
  /conversation\.pending\s*\?\s*restorePendingAgentConversation\(\)\s*:\s*void loadAgentConversation\(conversation\.id\)/,
  'clicking the pending sidebar row should restore local streaming turns instead of reading from disk'
)

assert.match(
  app,
  /pendingAgentConversation:\s*\{[\s\S]*summary:\s*createPendingAgentConversationSummary/,
  'agentChat should create a pending sidebar summary as soon as a stream starts'
)

assert.match(
  app,
  /pendingAgentConversation:\s*null/,
  'saving a conversation should clear the pending local sidebar entry'
)

assert.match(
  app,
  /get\(\)\.activeConversationId === pendingConversationId[\s\S]*activeConversationId:\s*saved\.conversation\.id/,
  'saving should replace the pending active id with the persisted id only when the pending conversation is still active'
)

console.log('pending conversation return path ok')
