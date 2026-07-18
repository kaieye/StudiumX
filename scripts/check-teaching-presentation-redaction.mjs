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
assert.match(presentation, /technicalDiagnostic:/, 'Teaching projection must expose a typed technical diagnostic.')
assert.match(presentation, /export type TeachingTurnTechnicalDiagnostic = \{/, 'Technical diagnostic must be a typed adapter, not a parallel projector.')

const teachingReader = reader.match(/function TeachingTurnReader\([\s\S]*?\nfunction /)?.[0] ?? ''
assert.ok(teachingReader, 'TeachingTurnReader must remain the learner presentation seam.')
assert.doesNotMatch(teachingReader, /item\.detail|disclosure\.|answer\.split|tool-call-body/, 'Teaching reader must not put raw technical or answer content in the DOM.')
assert.match(teachingReader, /presentation\.technicalDiagnostic/, 'Teaching diagnostics must come from TeachingTurnPresentation only.')
assert.match(reader, /<details className="teaching-turn-panel__diagnostic">/, 'Technical diagnostics must render inside a collapsed details adapter.')
assert.doesNotMatch(reader, /processEvents|toolCalls|metadata\?\./, 'Reader must not inspect raw process payloads directly.')
assert.doesNotMatch(reader, /answer\.split|tool-call-body/, 'Reader must not reconstruct raw answer or tool payloads.')
assert.match(reader, /function safeDiagnosticLabel\(/, 'Technical diagnostics must use generic allow-listed labels.')
assert.match(reader, /function safeProcessSecondaryText\(/, 'Process secondary text must pass through a typed redaction adapter.')
assert.match(reader, /redactAgentSecretText\(/, 'Process secondary text must redact secrets before DOM entry.')

const outsideSanitizer = reader.replace(/function safeProcessSecondaryText\([\s\S]*?\n\}/, 'function safeProcessSecondaryText(){}')
assert.doesNotMatch(outsideSanitizer, /item\.detail/, 'Raw item.detail may only be read inside the diagnostic sanitizer.')
assert.doesNotMatch(reader, /\{item\.detail\}/, 'Raw item.detail must never be interpolated into the DOM.')

assert.match(unit, /never projects raw teaching or technical payloads/, 'Unit coverage must retain redaction assertions.')
assert.match(unit, /collapsed-by-default technical diagnostic|diagnostic disclosure stays collapsed/, 'Unit coverage must prove collapsed diagnostic defaults.')
assert.match(unit, /does not leak secrets|no secret|secret\/answer\/path/, 'Unit coverage must prove secret/answer/path non-leakage in the reader.')

console.log('teaching presentation redaction gate ok')
