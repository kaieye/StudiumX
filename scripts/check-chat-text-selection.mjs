import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile('src/renderer/src/styles.css', 'utf8')
const app = await readFile('src/renderer/src/App.tsx', 'utf8')

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))
  assert.ok(match, `missing CSS rule for ${selector}`)
  return match[1]
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
assert.match(ruleFor('.overview-dialog-message.is-user > .markdown-message'), /background:\s*#f3f3f4;/i, 'user message capsule should use #F3F3F4')
assert.match(ruleFor('.overview-dialog-message.is-user > .markdown-message'), /color:\s*#24324a;/i, 'user message capsule should use readable dark text')

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
