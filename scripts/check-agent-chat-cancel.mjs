import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  systemApiTypes,
  preload,
  gateway,
  gatewayContext,
  agentChatCommands,
  app,
  appStore,
  agentLoop,
  executionState,
  providerAdapterInvocation
] = await Promise.all([
  readFile('src/shared/teaching-types/system-api.ts', 'utf8'),
  readFile('src/preload/index.ts', 'utf8'),
  readFile('src/main/teaching-ipc-gateway.ts', 'utf8'),
  readFile('src/main/teaching-ipc-gateway-context.ts', 'utf8'),
  readFile('src/main/ai/agent-chat-ipc-commands.ts', 'utf8'),
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/app-shell/appStore.ts', 'utf8'),
  readFile('src/main/ai/agent-loop.ts', 'utf8'),
  readFile('src/main/ai/agent-loop-execution-state.ts', 'utf8'),
  readFile('src/main/ai/provider-adapter/invocation.ts', 'utf8')
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
  gatewayContext,
  /export type GatewayContext = TeachingIpcRegistration & \{[\s\S]*?activeAgentChatStreams: Map<string, AbortController>/,
  'teaching IPC gateway context should own active agent chat AbortControllers'
)

assert.match(
  gateway,
  /activeAgentChatStreams: new Map\(\)/,
  'teaching IPC gateway should initialize active agent chat AbortController tracking'
)

assert.match(
  agentChatCommands,
  /channel: teachingInvokeChannels\.agentChatStream[\s\S]*?context\.activeAgentChatStreams\.set\(streamId, controller\)/,
  'agent chat stream should register its AbortController before invoking the service'
)

assert.match(
  agentChatCommands,
  /channel: teachingInvokeChannels\.cancelAgentChatStream[\s\S]*?context\.activeAgentChatStreams\.get\(streamId\)[\s\S]*?controller\.abort\(\)[\s\S]*?context\.activeAgentChatStreams\.delete\(streamId\)/,
  'agent chat command group should abort and retire the matching stream on cancel'
)

assert.match(
  appStore,
  /cancelAgentChat:\s*async\s*\(\)\s*=>[\s\S]*getAgentConversationTurnRunner\(\)\.cancel\(\)/,
  'renderer store should delegate active conversation cancellation to its turn runner'
)

assert.match(
  appStore,
  /agentConversationTurnRunner \?\?= createAgentConversationTurnRunner\(get, set\)/,
  'the store should memoize its agent conversation turn runner'
)

assert.match(
  app,
  /const canCancelAgentChat = agentChatBusy && Boolean\(pendingAgentConversation\)[\s\S]*?activeTurnPresentation\?\.active === true/,
  'chat composer should expose cancellation only for the active pending turn or an interruption'
)

assert.match(
  app,
  /const shouldCancel = canCancelAgentChat && !inputValue\.trim\(\) && !hasDraftImages[\s\S]*\{shouldCancel\s*\? <Square size=\{16\} \/>/,
  'empty composer send button should become a stop button while the active turn is running (and no image draft is attached)'
)

assert.match(
  executionState,
  /emit\(\{ type: 'status', status: 'canceled' \}\)/,
  'agent loop execution state should emit a canceled status'
)

assert.match(
  providerAdapterInvocation,
  /composeAbortSignal\(base\.settings\.generator\.requestTimeoutMs, base\.signal\)/,
  'provider calls should use the user abort signal together with request timeout'
)

console.log('agent chat cancellation path ok')
