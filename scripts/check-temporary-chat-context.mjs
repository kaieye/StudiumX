import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, css, types, main, commands, service, runtime] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/styles.css', 'utf8'),
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
  types,
  /context\?: string/,
  'agent chat stream payload should allow renderer-provided visible page context'
)

assert.match(
  commands,
  /mode: record\.mode === 'teaching' \? 'teaching' : record\.mode === 'temporary' \? 'temporary' : undefined/,
  'IPC parser should preserve explicit temporary chat mode'
)

assert.match(
  commands,
  /context: optionalString\(record\.context\)/,
  'IPC parser should preserve visible page context for temporary HTML chat'
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
  /function HtmlTemporaryChat\(/,
  'opened HTML lessons should mount a floating temporary AI chat component'
)

assert.match(
  app,
  /function useHtmlAiPanelGeometry\(\)/,
  'floating HTML chat should own draggable and resizable panel geometry'
)

assert.match(
  app,
  /onPointerDown=\{handleHeaderPointerDown\}/,
  'floating HTML chat header should support dragging the panel'
)

assert.match(
  app,
  /className="html-ai-resize-handle"[\s\S]*onPointerDown=\{handleResizePointerDown\}/,
  'floating HTML chat should expose a resize handle'
)

assert.match(
  app,
  /aria-label="历史对话"[\s\S]*<History size=\{14\} \/>/,
  'floating HTML chat should expose a history conversation button'
)

assert.match(
  app,
  /loadHistoryConversation\(conversation\)/,
  'floating HTML chat history rows should load saved temporary conversations'
)

assert.match(
  css,
  /\.html-ai-resize-handle \{[\s\S]*top: 0;[\s\S]*left: 0;/,
  'floating HTML chat resize handle should sit at the top-left corner'
)

assert.match(
  app,
  /mode: 'temporary',[\s\S]*context: pageContext/,
  'floating HTML chat should send current page context in temporary mode'
)

assert.match(
  app,
  /void agentChat\(prompt, \{ mode: 'teaching' \}\)/,
  'teaching submissions should continue through the teaching conversation'
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

assert.match(
  runtime,
  /visiblePageContext: payload\.context/,
  'runtime should pass renderer-provided visible page context into the temporary prompt'
)

assert.match(
  runtime,
  /<visible-page-context>/,
  'temporary prompt should wrap current HTML page text in a visible-page-context block'
)

console.log('temporary chat context isolation ok')
