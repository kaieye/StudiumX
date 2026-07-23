import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// styles.css is an @import graph; resolve the modules this check needs.
const css = (
  await Promise.all([
    readFile('src/renderer/src/styles/base.css', 'utf8'),
    readFile('src/renderer/src/styles/messages.css', 'utf8'),
    readFile('src/renderer/src/styles/overview.css', 'utf8')
  ])
).join('\n')
const app = await readFile('src/renderer/src/App.tsx', 'utf8')

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Prefer the most complete rule when the same selector appears more than once.
  const re = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, 'gm')
  let match
  let best = null
  while ((match = re.exec(css))) {
    const body = match[1]
    if (!best || body.length > best.length) best = body
  }
  assert.ok(best, `missing CSS rule for ${selector}`)
  return best
}

for (const selector of [
  '.overview-dialog-thread',
  '.overview-dialog-message',
  '.markdown-message',
  '.agent-process-panel'
]) {
  const rule = ruleFor(selector)
  assert.match(rule, /user-select:\s*text;/, `${selector} should allow selecting conversation text`)
  assert.match(rule, /-webkit-user-select:\s*text;/, `${selector} should allow selecting text in Electron/Chromium`)
  assert.match(rule, /-webkit-app-region:\s*no-drag;/, `${selector} should not behave as a draggable window region`)
}

assert.match(ruleFor('::selection'), /background:\s*rgba\(79,\s*124,\s*245,\s*0\.26\);/, 'selected text should have a visible highlight')
assert.match(
  ruleFor('.overview-dialog-message.is-user > .markdown-message'),
  /background:\s*(?:#f3f3f4|var\(--surface-muted\));/i,
  'user message capsule should use muted surface'
)
assert.match(
  ruleFor('.overview-dialog-message.is-user > .markdown-message'),
  /color:\s*(?:#24324a|var\(--text\));/i,
  'user message capsule should use readable text color'
)

const assistantRule = ruleFor('.overview-dialog-message.is-assistant > .markdown-message')
assert.match(assistantRule, /background:\s*transparent;/, 'assistant content should not be in a bubble')
assert.match(assistantRule, /border-color:\s*transparent;/, 'assistant content should not have a bubble border')
assert.match(assistantRule, /padding:\s*0;/, 'assistant content should align like normal text')

assert.doesNotMatch(
  app,
  /<span>\{turn\.role === 'user' \? '你' : '助手'\}<\/span>/,
  'conversation messages should not render role labels above each turn'
)

console.log('chat message selection and layout styles ok')
