import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  systemApiTypes,
  preload,
  main,
  app,
  appStore,
  agentLoop,
  providerAdapter
] = await Promise.all([
  readFile('src/shared/teaching-types/system-api.ts', 'utf8'),
  readFile('src/preload/index.ts', 'utf8'),
  readFile('src/main/index.ts', 'utf8'),
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/app-shell/appStore.ts', 'utf8'),
  readFile('src/main/ai/agent-loop.ts', 'utf8'),
  readFile('src/main/ai/provider-adapter.ts', 'utf8')
])

assert.match(
  systemApiTypes,
  /cancelAgentChatStream:\s*\(streamId:\s*string\)\s*=>\s*Promise<\{\s*canceled:\s*boolean\s*\}>/,
  'renderer API should expose agent chat cancellation'
)

assert.match(
  preload,
  /cancelAgentChatStream:\s*\(streamId\)\s*=>\s*ipcRenderer\.invoke\(teachingInvokeChannels\.cancelAgentChatStream,\s*streamId\)/,
  'preload should bridge cancelAgentChatStream to ipcMain'
)

assert.match(
  main,
  /const activeAgentChatStreams = new Map<string,\s*AbortController>\(\)/,
  'main process should track active agent chat AbortControllers'
)

assert.match(
  main,
  /ipcMain\.handle\(teachingInvokeChannels\.cancelAgentChatStream[\s\S]*controller\.abort\(\)/,
  'main process should abort the matching stream on cancel'
)

assert.match(
  appStore,
  /cancelAgentChat:\s*async\s*\(\)\s*=>[\s\S]*cancelAgentChatStream\(pending\.summary\.id\)/,
  'renderer store should call the cancel API for the active pending conversation'
)

assert.match(
  app,
  /const canCancelAgentChat = agentChatBusy && Boolean\(pendingAgentConversation\)/,
  'chat composer should know when the pending conversation can be canceled'
)

assert.match(
  app,
  /canCancelAgentChat \? <Square size=\{16\} \/>/,
  'send button should become a stop button while agent chat is running'
)

assert.match(
  agentLoop,
  /status:\s*'canceled'/,
  'agent loop should emit a canceled status'
)

assert.match(
  providerAdapter,
  /composeAbortSignal\(settings\.generator\.requestTimeoutMs,\s*signal\)/,
  'provider calls should use the user abort signal together with request timeout'
)

console.log('agent chat cancellation path ok')
