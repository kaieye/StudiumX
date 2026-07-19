import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const presentation = await readFile(resolve(root, 'src/renderer/src/teaching-turn-presentation.ts'), 'utf8')
const reader = await readFile(resolve(root, 'src/renderer/src/views/agent-conversation/AgentConversationReader.tsx'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/teaching-turn-presentation.unit.test.ts'), 'utf8')

for (const phase of ['confirm_goal', 'retrieval_practice', 'explanation_retry', 'save_continue']) {
  assert.match(presentation, new RegExp(`'${phase}'`), `Teaching presentation must retain ${phase}.`)
}
assert.match(presentation, /export function buildTeachingTurnPresentation\(snapshot: TeachingTurnSnapshot\)/, 'Projection must be one pure public seam.')
assert.match(presentation, /snapshot\.context\.readiness !== 'ready' \|\| snapshot\.nextStep\?\.action === 'wait_for_resources'/, 'Context/resource readiness must downgrade before presentation.')
assert.match(presentation, /outcome === 'needs_practice'[\s\S]*?return needsRetry\(\)/, 'Needs-practice must remain a retry.')
assert.match(presentation, /snapshot\.save\.canonicalStatus === 'catalog_reconciling'[\s\S]*?正在确认保存/, 'Catalog reconciliation must stay a confirming state.')
assert.match(presentation, /snapshot\.save\.canonicalStatus === 'record_saved'/, 'Only canonical saved status may enable continuation.')
assert.ok(
  presentation.indexOf("isContextOrResourceUnavailable(snapshot)") < presentation.indexOf("outcome === 'needs_practice'"),
  'Readiness downgrade must take precedence over outcome presentation.'
)
assert.match(presentation, /export function consumeTeachingTurnAnnouncement\(/, 'Replay/restart announcement de-duplication must have a pure seam.')
assert.doesNotMatch(presentation, /\b(?:writeFile|appendFile|mkdir|rename|unlink|rm|fetch)\b/, 'Renderer projection must not write records or call providers.')
assert.doesNotMatch(presentation, /\bMath\.random\b|new Date\(/, 'Projection must not use random or clock state.')
assert.match(presentation, /technicalDiagnostic:/, 'Projection must include the typed technical diagnostic adapter.')
assert.match(reader, /<details className="teaching-turn-panel__diagnostic">/, 'Technical diagnostic adapter must be collapsed.')
assert.match(reader, /aria-label=\{`技术诊断：\$\{diagnostic\.label\}`\}|aria-label=\{`技术诊断：\$\{presentation\.technicalDiagnostic\.label\}`\}/, 'Diagnostic summary must expose an accessible name.')
assert.match(reader, /role="status" aria-live="polite"/, 'Only the saved notice should use a restrained live region.')
assert.doesNotMatch(reader, /aria-live="assertive"/, 'Learner status must not use assertive live announcements.')
assert.match(unit, /projects each typed learner event into exactly one of the four learner phases/, 'Unit coverage must prove the four phases.')
assert.match(unit, /gates corrected success on canonical record confirmation/, 'Unit coverage must prove the durable save gate.')
assert.match(unit, /downgrades unavailable context or resources/, 'Unit coverage must prove resource downgrade.')
assert.match(unit, /is deterministic across replay/, 'Unit coverage must prove replay behavior.')
assert.match(unit, /supports keyboard focus, actions, source disclosure/, 'Unit coverage must prove keyboard/focus behavior.')
assert.match(unit, /diagnostic disclosure stays collapsed|collapsed-by-default technical diagnostic/, 'Unit coverage must prove collapsed diagnostic defaults.')

console.log('teaching turn presentation gate ok')
