import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const source = await readFile(join(root, 'src/main/learning-outcome-committer.ts'), 'utf8')
const shared = await readFile(join(root, 'src/shared/teaching-types/learning-outcome.ts'), 'utf8')
const unit = await readFile(join(root, 'tests/unit/learning-outcome-committer.unit.test.ts'), 'utf8')
const integration = await readFile(join(root, 'tests/integration/learning-outcome-commit.integration.test.ts'), 'utf8')

assert.match(source, /interface LearningOutcomeCommitter[\s\S]*evaluate[\s\S]*commit[\s\S]*reconcile/, 'Committer must keep evaluate, commit, and reconcile public.')
assert.match(source, /this\.evaluateDecision\(/, 'Committer must delegate read-side evaluation through the stable evaluator seam.')
assert.match(source, /await this\.ledger\.complete\(/, 'Successful record settlement must publish through the existing Session ledger seam.')
assert.match(source, /await link\(stagePath, recordPath\)/, 'Learning records must be atomically published from a flushed stage file.')
assert.doesNotMatch(source, /disposition:\s*['"](?:committed|already_committed)['"]/, 'Committer results must use the stable status discriminant, not the legacy disposition field.')
assert.match(source, /if \(existing\.state === 'review_required'\) return conflictResult\(\)/, 'Marker/record conflicts must reach commit as a structured conflict result.')
assert.match(source, /return retryableFailure\(writeAttempted \? 'reconciliation_required' : 'temporarily_unavailable'\)/, 'Unknown write windows must become structured retryable results.')
assert.match(shared, /status: 'committed'/, 'Shared contract must represent a fresh commit.')
assert.match(shared, /status: 'already_committed'/, 'Shared contract must represent idempotent replay.')
assert.match(shared, /status: 'insufficient_evidence'[\s\S]*reason: 'not_evidenced'/, 'Shared contract must distinguish insufficient evidence.')
assert.match(shared, /status: 'conflict'[\s\S]*reason: 'review_required'/, 'Shared contract must distinguish review conflicts.')
assert.match(shared, /status: 'retryable_failure'[\s\S]*reconciliation_required[\s\S]*temporarily_unavailable/, 'Shared contract must distinguish retryable outcomes.')
assert.match(shared, /status: 'non_retryable_failure'[\s\S]*invalid_session[\s\S]*invalid_request[\s\S]*read_only[\s\S]*not_found/, 'Shared contract must distinguish non-retryable outcomes.')
assert.doesNotMatch(shared, /relativePath|contentSha256|evaluatorVersion|Error\.message/, 'Shared result contracts must not expose paths, hashes, evaluator internals, or raw errors.')
assert.match(unit, /makes the operation retry idempotent/, 'Unit coverage must retain operation-idempotency.')
assert.match(unit, /returns conflict without completing or overwriting/, 'Unit coverage must retain the marker/record conflict negative case.')
assert.match(unit, /returns reconciliation_required in the post-publish fault window/, 'Unit coverage must retain structured retryable recovery.')
assert.match(integration, /publishes exactly one evaluator-approved record/, 'Integration coverage must retain the evidence-to-record path.')
console.log('learning outcome committer gate ok')