import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const source = await readFile(join(root, 'src/main/learning-outcome-committer.ts'), 'utf8')
const shared = await readFile(join(root, 'src/shared/teaching-types/learning-outcome.ts'), 'utf8')
const unit = await readFile(join(root, 'tests/unit/learning-outcome-committer.unit.test.ts'), 'utf8')
const integration = await readFile(join(root, 'tests/integration/learning-outcome-commit.integration.test.ts'), 'utf8')

// Public surface and durable settlement seams (writer-lock / ordered publish).
assert.match(source, /interface LearningOutcomeCommitter[\s\S]*evaluate[\s\S]*commit[\s\S]*reconcile/, 'Committer must keep evaluate, commit, and reconcile public.')
assert.match(source, /this\.evaluateDecision\(/, 'Committer must delegate read-side evaluation through the stable evaluator seam.')
const settlementCompletion = /await scope\.complete\(/
assert.match(source, settlementCompletion, 'Successful record settlement must publish through the writer-lock Session ledger seam.')
assert.match(source, /await publishImmutable\(/, 'Record publication must go through the immutable staged-publish helper.')
assert.match(source, /await link\(stagePath, recordPath\)/, 'Learning records must be atomically published from a flushed stage file.')
assert.doesNotMatch(source, /disposition:\s*['"](?:committed|already_committed)['"]/, 'Committer results must use the stable status discriminant, not the legacy disposition field.')
assert.match(source, /if \(existing\.state === 'review_required'\) return conflictResult\(\)/, 'Marker/record conflicts must reach commit as a structured conflict result.')
assert.match(source, /return retryableFailure\(writeAttempted \? 'reconciliation_required' : 'temporarily_unavailable'\)/, 'Unknown write windows must become structured retryable results.')

// Shared learner-safe contract discriminants.
assert.match(shared, /status: 'committed'/, 'Shared contract must represent a fresh commit.')
assert.match(shared, /status: 'already_committed'/, 'Shared contract must represent idempotent replay.')
assert.match(shared, /status: 'insufficient_evidence'[\s\S]*reason: 'not_evidenced'/, 'Shared contract must distinguish insufficient evidence.')
assert.match(shared, /status: 'conflict'[\s\S]*reason: 'review_required'/, 'Shared contract must distinguish review conflicts.')
assert.match(shared, /status: 'retryable_failure'[\s\S]*reconciliation_required[\s\S]*temporarily_unavailable/, 'Shared contract must distinguish retryable outcomes.')
assert.match(shared, /status: 'non_retryable_failure'[\s\S]*invalid_session[\s\S]*invalid_request[\s\S]*read_only[\s\S]*not_found/, 'Shared contract must distinguish non-retryable outcomes.')
assert.doesNotMatch(shared, /relativePath|contentSha256|evaluatorVersion|Error\.message/, 'Shared result contracts must not expose paths, hashes, evaluator internals, or raw errors.')

// Complementary unit/integration titles (behavior covered by executable tests; gate pins titles).
assert.match(unit, /makes the operation retry idempotent/, 'Unit coverage must retain operation-idempotency.')
assert.match(unit, /requires review instead of record-first repair when a marker conflicts with the canonical record/, 'Unit coverage must retain the marker/record conflict negative case.')
assert.match(unit, /uses a durable record as repair authority after publication before projections exist/, 'Unit coverage must retain structured retryable recovery after record publish.')
assert.match(unit, /status: 'retryable_failure',\s*reason: 'reconciliation_required'/, 'Unit coverage must assert reconciliation_required after an uncertain write window.')
assert.match(integration, /publishes exactly one evaluator-approved record/, 'Integration coverage must retain the evidence-to-record path.')

// Positive / negative self-checks for the settlement seam rewrite.
assert.match('await scope.complete(sessionId, encoded.ref)', settlementCompletion, 'Positive self-check must accept the current ledger completion seam.')
assert.doesNotMatch('await this.ledger.complete(sessionId, encoded.ref)', settlementCompletion, 'Negative self-check must reject the stale direct-ledger seam.')

console.log('learning outcome committer gate ok')
