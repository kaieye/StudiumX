import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const source = await readFile(join(root, 'src/main/learning-outcome-committer.ts'), 'utf8')
const unit = await readFile(join(root, 'tests/unit/learning-outcome-committer.unit.test.ts'), 'utf8')
const integration = await readFile(join(root, 'tests/integration/learning-outcome-commit.integration.test.ts'), 'utf8')

assert.match(source, /interface LearningOutcomeCommitter[\s\S]*evaluate[\s\S]*commit[\s\S]*reconcile/, 'Committer must keep evaluate, commit, and reconcile public.')
assert.match(source, /this\.evaluateDecision\(/, 'Committer must delegate read-side evaluation through the stable evaluator seam.')
assert.match(source, /await this\.ledger\.complete\(/, 'Successful settlement must publish through the existing Session ledger seam.')
assert.match(source, /await link\(stagePath, recordPath\)/, 'Learning records must be atomically published from a flushed stage file.')
assert.match(unit, /makes the operation retry idempotent/, 'Unit coverage must retain operation-idempotency.')
assert.match(integration, /publishes exactly one evaluator-approved record/, 'Integration coverage must retain the evidence-to-record path.')
console.log('learning outcome committer gate ok')
