import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')

assert.match(
  app,
  /function isInputComposing\(event: ReactKeyboardEvent<[^>]+>\): boolean \{[\s\S]*nativeEvent\.isComposing[\s\S]*nativeEvent\.keyCode === 229[\s\S]*\}/,
  'dialog inputs should detect active IME composition, including Chromium keyCode 229 fallback'
)

const enterHandlers = app.match(/if \(event\.key === 'Enter' && !event\.shiftKey\) \{[\s\S]*?\n\s*\}/g) ?? []
assert.ok(enterHandlers.length >= 2, 'expected Enter submit handlers for lesson and chat dialog inputs')

for (const handler of enterHandlers) {
  assert.match(
    handler,
    /isInputComposing\(event\)/,
    'Enter submit handlers must not intercept IME composition confirmation'
  )
}

console.log('dialog IME composition handling ok')
