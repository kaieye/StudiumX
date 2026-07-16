import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/next-teaching-step-planner.ts'), 'utf8')
const shared = await readFile(resolve(root, 'src/shared/teaching-types/next-teaching-step.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/next-teaching-step-planner.unit.test.ts'), 'utf8')
const integration = await readFile(resolve(root, 'tests/integration/next-teaching-step-planner.integration.test.ts'), 'utf8')

assert.match(source, /export interface NextTeachingStepPlanner[\s\S]*plan\(facts: NextTeachingStepFacts\)/, 'Planner must expose one typed planning operation.')
assert.match(source, /export function createNextTeachingStepPlanner\(\)/, 'Planner must keep a factory seam.')
assert.match(source, /export function planNextTeachingStep\(facts: NextTeachingStepFacts\)/, 'Planner must retain a pure function seam.')
assert.match(source, /facts\.latestSession\.readOnly \|\| facts\.latestSession\.source === 'legacy_lesson'/, 'Legacy/read-only sessions must stay conservative.')
assert.match(source, /kind === 'needs_practice'[\s\S]*'contrast_and_retry', 'needs_practice'/, 'Needs-practice facts must map to a safe retry.')
assert.match(source, /kind === 'misconception_corrected'[\s\S]*'continue_next_session', 'misconception_corrected_with_next_goal'/, 'Corrected misconceptions with a next goal must continue.')
assert.match(source, /facts\.resources\.readiness !== 'ready'[\s\S]*'wait_for_resources', 'resources_not_ready'/, 'Unavailable resources must prevent unsupported continuation.')
assert.ok(
  source.indexOf("facts.resources.readiness !== 'ready'") < source.indexOf("kind === 'needs_practice'"),
  'Resource readiness must downgrade before the needs-practice retry decision.'
)
assert.match(source, /function stableIds\([\s\S]*new Set\(ids\)[\s\S]*sort/, 'Provenance ordering must be canonical.')

for (const action of ['contrast_and_retry', 'continue_next_session', 'request_goal_clarification', 'wait_for_resources']) {
  assert.match(shared, new RegExp(`'${action}'`), `Shared contract must expose ${action}.`)
}
for (const reason of [
  'needs_practice', 'misconception_corrected_with_next_goal', 'legacy_read_only', 'no_next_goal',
  'insufficient_evidence', 'outcome_review_required', 'outcome_unknown_schema', 'outcome_unavailable', 'resources_not_ready'
]) {
  assert.match(shared, new RegExp(`'${reason}'`), `Shared contract must expose ${reason}.`)
}
assert.match(shared, /type NextTeachingStepSafeInputSummary[\s\S]*provenance:/, 'Decision contract must project a safe provenance summary.')
assert.doesNotMatch(source, /\bMath\.random\b|\bDate\b/, 'Planner must not use random or clock state.')
assert.doesNotMatch(source, /node:fs|node:fs\/promises|writeFile|appendFile|mkdir|rename|unlink|rm\(/, 'Planner must not access or write the filesystem.')
assert.doesNotMatch(source, /from\s+['"][^'"]*(?:provider|model)[^'"]*['"]/, 'Planner must not import a provider or model.')
assert.doesNotMatch(`${source}\n${shared}`, /learnerAnswer|rawEvidenceText|assessmentPayload|providerResponse|selectedOptionIds/, 'Planner contracts must not project raw learner, evidence, assessment, or provider data.')

assert.match(unit, /returns exact stable JSON for repeated semantically identical facts/, 'Unit coverage must retain deterministic JSON behavior.')
assert.match(unit, /allow-lists only safe identifiers, kinds, counts, and provenance/, 'Unit coverage must retain redaction behavior.')
assert.match(unit, /does not mutate deeply frozen facts/, 'Unit coverage must retain immutable-input behavior.')
assert.match(unit, /keeps legacy\/read-only sessions to a read-only-safe clarification recommendation/, 'Unit coverage must retain legacy safety.')
assert.match(integration, /needs-practice outcome to retry, then a correction to continuation, and degrades when resources are unavailable/, 'Integration coverage must retain all durable policy transitions.')
assert.match(integration, /committer\.reconcile\(/, 'Integration must adapt actual durable settlement facts.')

console.log('next teaching step planner gate ok')
