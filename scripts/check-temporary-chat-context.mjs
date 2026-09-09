import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const [app, types, main, commands, agentChatCommands, service, runtime, turnContext, prompt] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/shared/teaching-types/agent.ts', 'utf8'),
  readFile('src/main/index.ts', 'utf8'),
  readFile('src/main/teaching-ipc-commands.ts', 'utf8'),
  readFile('src/main/ai/agent-chat-ipc-commands.ts', 'utf8'),
  readFile('src/main/teaching-workspace.ts', 'utf8'),
  readFile('src/main/teaching-conversation-runtime.ts', 'utf8'),
  readFile('src/main/teaching-conversation-turn-context.ts', 'utf8'),
  readFile('src/main/teaching-conversation-prompt.ts', 'utf8')
])

assert.match(types, /export type AgentChatMode = 'temporary' \| 'teaching'/)
assert.match(types, /mode\?: AgentChatMode/)
assert.match(commands, /const mode = parseSubmitConversationTurnMode\(record\.mode\)/)
assert.match(commands, /function parseSubmitConversationTurnMode\(/)
assert.match(commands, /value === 'teaching' \|\| value === 'temporary'/, 'submitConversationTurn mode must be parsed fail-closed into teaching|temporary.')
assert.match(agentChatCommands, /parser: \(payload\) => parseAgentChatStreamPayload\(payload\)/)
assert.match(app, /void agentChat\(prompt, \{\s*mode: 'temporary',\s*skillIds:/)
assert.match(app, /void agentChat\(prompt, \{\s*mode: 'teaching',\s*skillIds:/)
assert.match(app, /<ProjectFolderPicker mode=\{isTeachingMode \? 'workspace' : 'temporary'\} \/>/)
assert.match(app, /\{isTeachingMode \? <GitBranchPicker workspaceRoot=\{active\?\.rootPath \?\? ''\} \/> : null\}/)
assert.match(service, /runTeachingConversationTurn\(payload, stream, runtimeWorkspace,/)

assert.match(runtime, /deriveConversationTurnContext\(\{/)
assert.match(runtime, /workspaceRoot: conversation\.workspaceRoot/)
assert.match(runtime, /mode: conversation\.mode/)
assert.match(runtime, /createLessonToolLifecycle\(\{/)
assert.match(runtime, /finalizeLearnerMemoryCapture\(\{/)
assert.match(turnContext, /const workspaceRoot = workspaceToolAccessGranted \? options\.workspace\?\.rootPath : undefined/)
assert.match(turnContext, /workspaceToolAccessGranted =\s*\n\s*isTeachingConversation && options\.workspace\?\.workspaceToolAccessGranted === true/, 'workspace file tools must require an explicit trust grant in teaching mode.')
assert.match(turnContext, /const memoryWorkspaceRoot = options\.workspace\?\.rootPath/)
assert.match(prompt, /当前是临时会话/)

const tempParent = join(process.cwd(), '.studiumx')
await mkdir(tempParent, { recursive: true })
const tempRoot = await mkdtemp(join(tempParent, 'conversation-turn-policies-'))
const outfile = join(tempRoot, 'conversation-turn-policies.mjs')
try {
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: [join(process.cwd(), 'scripts', 'fixtures', 'conversation-turn-policies.ts')],
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

console.log('temporary chat context isolation ok')
