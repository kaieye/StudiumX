import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const presentation = await readFile(resolve(root, 'src/renderer/src/teaching-turn-presentation.ts'), 'utf8')
const reader = await readFile(resolve(root, 'src/renderer/src/views/agent-conversation/AgentConversationReader.tsx'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/teaching-turn-presentation.unit.test.ts'), 'utf8')
const readerUnit = await readFile(resolve(root, 'tests/unit/agent-conversation-reader.unit.test.tsx'), 'utf8')

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
assert.match(reader, /function processPrimaryLabel\(/, 'Process primary labels must pass through a single learner-safe projector.')
const primaryLabelFn = reader.match(/function processPrimaryLabel\([\s\S]*?\n(?=function )/)?.[0] ?? ''
assert.ok(primaryLabelFn, 'processPrimaryLabel body must be extractable.')
assert.match(primaryLabelFn, /redactAgentSecretText\(/, 'Primary labels must run through the shared secret redactor.')
assert.match(primaryLabelFn, /redacted\s*!==\s*candidate|candidate\s*!==\s*redacted/, 'Primary labels must fail closed when the redactor mutates the original label.')
assert.match(primaryLabelFn, /containsRedactionRemnant\(|\[redacted/, 'Primary labels must reject redaction remnants rather than rendering them.')
assert.match(primaryLabelFn, /isUnsafeDiagnosticText\(/, 'Primary labels must fail closed on unsafe diagnostic text after secret checks.')
assert.match(primaryLabelFn, /safeDiagnosticLabel\(/, 'Unsafe primary labels must fall back to allow-listed kind labels.')
assert.doesNotMatch(primaryLabelFn, /return\s+redacted\b/, 'Primary labels must not return redaction remnants to the DOM.')

assert.match(reader, /function containsAbsoluteOrHomePath\(/, 'Absolute/home path detection must be centralized.')
const absolutePathFn = reader.match(/function containsAbsoluteOrHomePath\([\s\S]*?\n(?=function )/)?.[0] ?? ''
assert.ok(absolutePathFn, 'containsAbsoluteOrHomePath body must be extractable.')
assert.ok(/\[A-Za-z\]:(?:\\\\|\\\/)/.test(absolutePathFn) || absolutePathFn.includes('[A-Za-z]:(?:\\\\|\\/)'), 'Windows drive absolute paths (D:\\x or C:/x) must be rejected.')
assert.ok(absolutePathFn.includes('\\\\\\\\') || /\\\\\[A-Za-z0-9/.test(absolutePathFn), 'UNC paths must be rejected.')
assert.ok(absolutePathFn.includes('\$HOME') || absolutePathFn.includes('$HOME') || absolutePathFn.includes('~'), 'Home prefixes must be rejected.')
assert.ok(absolutePathFn.includes('[A-Za-z0-9._+-]') && absolutePathFn.includes('\\/'), 'Unix absolute paths must be rejected without keyword allow-lists.')
// Guard against reintroducing the keyword-only path hole (Users|Windows|private only).
assert.doesNotMatch(
  absolutePathFn,
  /\[A-Za-z\]:\\\\(?:Users\|Windows\|private)/,
  'Absolute path detection must not be limited to Users/Windows/private keywords.'
)

const secondaryFn = reader.match(/function safeProcessSecondaryText\([\s\S]*?\n(?=function )/)?.[0] ?? ''
assert.ok(secondaryFn, 'safeProcessSecondaryText body must be extractable.')
assert.match(secondaryFn, /redacted\s*!==\s*candidate|candidate\s*!==\s*redacted/, 'Secondary diagnostics must fail closed when the redactor mutates text.')
assert.match(secondaryFn, /containsRedactionRemnant\(|\[redacted/, 'Secondary diagnostics must reject redaction remnants.')

const outsideDetailSanitizer = reader.replace(/function safeProcessSecondaryText\([\s\S]*?\n\}/, 'function safeProcessSecondaryText(){}')
assert.doesNotMatch(outsideDetailSanitizer, /item\.detail/, 'Raw item.detail may only be read inside the diagnostic sanitizer.')
assert.doesNotMatch(reader, /\{item\.detail\}/, 'Raw item.detail must never be interpolated into the DOM.')

const outsideLabelProjector = reader.replace(/function processPrimaryLabel\([\s\S]*?\n\}/, 'function processPrimaryLabel(){ return "" }')
assert.doesNotMatch(outsideLabelProjector, /item\.label|latest\.label/, 'Raw process labels may only be read inside the primary-label projector.')
assert.doesNotMatch(reader, /\{item\.label\}|\{latest\.label\}/, 'Raw process labels must never be interpolated into the DOM.')

assert.match(unit, /never projects raw teaching or technical payloads/, 'Unit coverage must retain redaction assertions.')
assert.match(unit, /collapsed-by-default technical diagnostic|diagnostic disclosure stays collapsed/, 'Unit coverage must prove collapsed diagnostic defaults.')
assert.match(unit, /does not leak secrets|no secret|secret\/answer\/path/, 'Unit coverage must prove secret/answer/path non-leakage in the reader.')

// Unit coverage presence is checked by suite title + behavioral case titles, not by embedding
// secret/path fixtures into this gate (avoids fragile string self-certification).
assert.match(readerUnit, /learner-safe process primary labels/i, 'Unit suite must cover learner-safe process primary labels.')
assert.match(readerUnit, /absolute Windows\/UNC\/Unix\/home paths/i, 'Unit suite must cover absolute path contracts beyond keyword lists.')
assert.match(readerUnit, /redactor-owned secrets|never surfaces \[redacted/i, 'Unit suite must cover redactor-owned secrets without rendering remnants.')
assert.match(readerUnit, /does not misclassify safe learner-visible labels/i, 'Unit suite must prove safe labels are not false-positive rejected.')
assert.match(readerUnit, /typed-title contract follow-up|upstream typed-title/i, 'Unit suite must record unmarked answer sentences as upstream typed-title follow-up.')
assert.match(readerUnit, /展开辅助任务历史|aria-label|accessible|历史/, 'Unit coverage must prove a11y names use projected labels, not raw secrets.')

console.log('teaching presentation redaction gate ok')
