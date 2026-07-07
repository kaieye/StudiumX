import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')
const appStore = await readFile('src/renderer/src/app-shell/appStore.ts', 'utf8')

assert.match(
  appStore,
  /agentInputHistory:\s*string\[\]/,
  'renderer store should keep sent input text history'
)

assert.match(
  appStore,
  /const MAX_AGENT_INPUT_HISTORY = 20/,
  'sent input history should keep the latest 20 entries'
)

assert.match(
  appStore,
  /const AGENT_INPUT_HISTORY_STORAGE_KEY = 'teachos:agent-input-history'/,
  'sent input history should use a stable local storage key'
)

assert.match(
  appStore,
  /agentInputHistory:\s*readPersistedAgentInputHistory\(\)/,
  'renderer store should restore persisted sent input history on startup'
)

assert.match(
  appStore,
  /rememberAgentInput:\s*\(input:\s*string\)\s*=>\s*void/,
  'renderer store should expose a way to remember sent input text'
)

assert.match(
  appStore,
  /function appendAgentInputHistory\(history:\s*string\[\],\s*input:\s*string\):\s*string\[\]/,
  'sent input history should be normalized through a helper'
)

assert.match(
  appStore,
  /window\.localStorage\.getItem\(AGENT_INPUT_HISTORY_STORAGE_KEY\)/,
  'sent input history should be read from local storage'
)

assert.match(
  appStore,
  /window\.localStorage\.setItem\(\s*AGENT_INPUT_HISTORY_STORAGE_KEY,/,
  'sent input history should be saved to local storage'
)

assert.match(
  appStore,
  /persistAgentInputHistory\(nextHistory\)/,
  'remembering sent input should persist the updated history'
)

assert.match(
  app,
  /const sentInputHistory = useMemo\([\s\S]*mergeAgentInputHistory\(agentInputHistory,\s*userTurnInputHistory\(agentTurns\)\)/,
  'chat composer should combine stored sent prompts with visible user turns'
)

assert.match(
  app,
  /const submitTeachingPrompt = \(value:\s*string\):\s*void => \{[\s\S]*?rememberAgentInput\(prompt\)[\s\S]*?agentChat\(prompt,\s*\{ mode:\s*'teaching' \}\)/,
  'teaching submits should remember the outgoing prompt before routing to the conversation'
)

assert.match(
  app,
  /const submitChatPrompt = \(value:\s*string\):\s*void => \{[\s\S]*rememberAgentInput\(prompt\)[\s\S]*agentChat\(prompt,\s*\{ mode:\s*'temporary' \}\)/,
  'chat submits should remember the outgoing prompt text'
)

assert.match(
  app,
  /const navigateSentInputHistory = \(event:\s*ReactKeyboardEvent<HTMLTextAreaElement>\):\s*boolean/,
  'chat textarea should handle sent-message keyboard history navigation'
)

assert.match(
  app,
  /event\.key !== 'ArrowUp' && event\.key !== 'ArrowDown'/,
  'message history navigation should be limited to ArrowUp and ArrowDown'
)

assert.match(
  app,
  /event\.key === 'ArrowUp' && selectionStart !== 0/,
  'ArrowUp history navigation should only run from the start of the textarea'
)

assert.match(
  app,
  /event\.key === 'ArrowDown' && selectionStart !== value\.length/,
  'ArrowDown history navigation should only run from the end of the textarea'
)

assert.match(
  app,
  /setInputFromHistory\(sentInputHistory\[nextIndex\] \?\? ''\)/,
  'history navigation should fill the composer with sent message text'
)

assert.doesNotMatch(
  app,
  /navigateConversationHistory|conversationHistoryForDialog/,
  'keyboard history must not switch conversation sessions'
)

console.log('message history keyboard navigation ok')
