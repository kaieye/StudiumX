import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')
const appStore = await readFile('src/renderer/src/app-shell/appStore.ts', 'utf8')
const stateModule = await readFile('src/renderer/src/agent-conversation-state.ts', 'utf8')
const projectionModule = await readFile('src/renderer/src/agent-conversation-projection.ts', 'utf8')

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
  projectionModule,
  /export function projectVisibleSidebarConversations/,
  'renderer should project pending flat sidebar conversations outside App.tsx'
)

assert.match(
  projectionModule,
  /isCourseAgentConversationPath\(pendingAgentConversation\.summary\.relativePath\)/,
  'course-scoped pending conversations should stay out of the flat conversation section'
)

assert.match(
  projectionModule,
  /function withPendingCourseConversation/,
  'course-scoped pending conversations should be merged by the projection module'
)

assert.match(
  app,
  /projectVisibleAgentConversationWorkspaces\(/,
  'App should consume projected visible workspace data instead of implementing pending insertion'
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

const tempParent = join(process.cwd(), '.studiumx')
await mkdir(tempParent, { recursive: true })
const tempRoot = await mkdtemp(join(tempParent, 'agent-conversation-projection-check-'))
const outfile = join(tempRoot, 'agent-conversation-projection.mjs')

try {
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: [join(process.cwd(), 'scripts', 'fixtures', 'agent-conversation-projection.ts')],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent'
  })
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

console.log('pending conversation return path ok')
