import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const presentation = await readFile(resolve(root, 'src/renderer/src/teaching-turn-presentation.ts'), 'utf8')
const reader = await readFile(resolve(root, 'src/renderer/src/views/agent-conversation/AgentConversationReader.tsx'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/teaching-turn-presentation.unit.test.ts'), 'utf8')

const eventContract = presentation.match(/export type TeachingTurnEvent = \{([\s\S]*?)\n\}/)?.[1] ?? ''
assert.ok(eventContract, 'Teaching event contract must be declared.')
for (const forbiddenField of ['prompt', 'answer', 'reasoning', 'assessment', 'provider', 'secret', 'path', 'hash', 'artifact']) {
  assert.doesNotMatch(eventContract, new RegExp(`\\b${forbiddenField}\\b`, 'i'), `Teaching event must not expose ${forbiddenField}.`)
}
assert.match(presentation, /function safeSourceIds\(/, 'Source identifiers must be allow-listed.')
assert.match(presentation, /secret\|token\|password\|answer\|prompt\|provider\|key/, 'Unsafe source identifiers must be rejected.')
assert.ok(presentation.includes('[a-f0-9]{64}'), 'Hash-like source identifiers must be rejected.')
assert.doesNotMatch(reader, /item\.detail|disclosure\.|answer\.split|tool-call-body/, 'Reader must not put raw technical or answer content in the DOM.')
assert.doesNotMatch(reader, /processEvents|toolCalls|metadata\?\./, 'Reader must not inspect raw process payloads directly.')
assert.match(reader, /safeDiagnosticLabel\(/, 'Technical diagnostics must use generic allow-listed labels.')
assert.match(unit, /never projects raw teaching or technical payloads/, 'Unit coverage must retain redaction assertions.')

console.log('teaching presentation redaction gate ok')