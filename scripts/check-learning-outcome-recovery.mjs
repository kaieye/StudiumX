import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const source = await readFile(join(root, 'src/main/learning-outcome-committer.ts'), 'utf8')
const tests = await readFile(join(root, 'tests/unit/learning-outcome-committer.unit.test.ts'), 'utf8')

assert.match(source, /after_stage_flush[\s\S]*after_record_publish[\s\S]*after_outcome_publish[\s\S]*after_settlement_marker/, 'Durability fault boundaries must remain explicit.')
assert.match(source, /async reconcile\(sessionId: string\)/, 'Committer must expose recovery reconciliation.')
assert.match(source, /await cleanupStages\(/, 'Reconciliation must clean abandoned stage files.')
assert.match(source, /reconciliation_required/, 'An uncertain write window must be reported for reconciliation rather than throwing raw I/O errors.')
assert.match(tests, /returns reconciliation_required in the post-publish fault window/, 'Tests must cover the post-publish crash window.')
assert.match(tests, /then read-repairs without a duplicate/, 'Tests must cover later reconciliation after a retryable result.')
console.log('learning outcome recovery gate ok')