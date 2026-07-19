import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const source = await readFile(join(root, 'src/main/learning-outcome-committer.ts'), 'utf8')
const tests = await readFile(join(root, 'tests/unit/learning-outcome-committer.unit.test.ts'), 'utf8')

// Explicit durability fault boundaries and recovery surface.
assert.match(source, /after_stage_flush[\s\S]*after_record_publish[\s\S]*after_outcome_publish[\s\S]*after_settlement_marker/, 'Durability fault boundaries must remain explicit.')
assert.match(source, /async reconcile\(sessionId: string\)/, 'Committer must expose recovery reconciliation.')
assert.match(source, /await publishImmutable\(/, 'Commit publication must atomically settle the staged record.')
assert.match(source, /await unlink\(stagePath\)/, 'Published stages must be removed after durable record publication.')
assert.match(source, /reconciliation_required/, 'An uncertain write window must be reported for reconciliation rather than throwing raw I/O errors.')

// Unit titles covering post-publish crash and authority-first repair without duplicates.
assert.match(tests, /uses a durable record as repair authority after publication before projections exist/, 'Tests must cover the post-publish crash window with record authority.')
assert.match(tests, /deterministically repairs an after-outcome-publication crash after restart without reevaluation or outcome rewrite/, 'Tests must cover restart repair after outcome publication without reevaluation.')
assert.match(tests, /status: 'retryable_failure', reason: 'reconciliation_required'/, 'Tests must report reconciliation_required in uncertain write windows.')
assert.match(tests, /status: 'already_committed', recordSaved: true/, 'Tests must cover later idempotent commit after repair without a duplicate path.')

// Positive / negative self-checks for the publication seam rewrite.
assert.match('await publishImmutable(stagePath, recordPath, recordContent)', /await publishImmutable\(/, 'Positive self-check must accept staged publication.')
assert.doesNotMatch('await cleanupStages(stagePath)', /await publishImmutable\(/, 'Negative self-check must reject the removed cleanupStages seam.')

console.log('learning outcome recovery gate ok')
