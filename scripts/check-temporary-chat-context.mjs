import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, types, main, commands, service, runtime] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/shared/teaching-types.ts', 'utf8'),
  readFile('src/main/index.ts', 'utf8'),
  readFile('src/main/teaching-ipc-commands.ts', 'utf8'),
  readFile('src/main/teaching-workspace.ts', 'utf8'),
  readFile('src/main/teaching-conversation-runtime.ts', 'utf8')
])

assert.match(
  types,
  /export type AgentChatMode = 'temporary' \| 'teaching'/,
  'agent chat payload should carry an explicit temporary/teaching mode'
)

assert.match(
  types,
  /mode\?: AgentChatMode/,
  'agent chat stream payload should include the optional mode'
)

assert.match(
  commands,
  /mode: record\.mode === 'teaching' \? 'teaching' : record\.mode === 'temporary' \? 'temporary' : undefined/,
  'IPC parser should preserve explicit temporary chat mode'
)

assert.match(
  main,
  /parseAgentChatStreamPayload\(payload\)/,
  'main IPC adapter should delegate agent chat payload parsing to the command module'
)

assert.match(
  app,
  /void agentChat\(prompt, \{ mode: 'temporary' \}\)/,
  'ordinary chat submit should send temporary mode to the backend'
)

assert.match(
  app,
  /void get\(\)\.agentChat\(prompt, \{ mode: 'teaching' \}\)/,
  'lesson clarification fallback should continue through teaching mode'
)

assert.match(
  app,
  /<ProjectFolderPicker mode=\{isTeachingMode \? 'workspace' : 'temporary'\} \/>/,
  'overview chat status bar should label temporary sessions instead of the workspace folder'
)

assert.match(
  app,
  /\{isTeachingMode \? <GitBranchPicker workspaceRoot=\{active\?\.rootPath \?\? ''\} \/> : null\}/,
  'temporary chat status bar should not show workspace Git branch controls'
)

assert.match(
  service,
  /runTeachingConversationTurn\(payload, stream, workspace,/,
  'teaching workspace service should delegate agent chat turns through the runtime module'
)

assert.match(
  runtime,
  /const isTeachingConversation = \(payload\.mode \?\? 'teaching'\) === 'teaching'/,
  'runtime should derive workspace access from the explicit chat mode'
)

assert.match(
  runtime,
  /const workspaceRoot = isTeachingConversation \? workspace\?\.rootPath : undefined/,
  'temporary chat should not bind workspaceRoot for tools'
)

assert.match(
  runtime,
  /buildAgentChatSystemPrompt\(\{[\s\S]*mode: isTeachingConversation \? 'teaching' : 'temporary'/,
  'system prompt should receive the chat mode'
)

assert.match(
  runtime,
  /当前是临时会话/,
  'temporary chat prompt should explicitly tell the model it is in a temporary session'
)

console.log('temporary chat context isolation ok')
