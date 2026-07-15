import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const source = await readFile(join(root, 'src/main/learning-outcome-committer.ts'), 'utf8')
const tests = await readFile(join(root, 'tests/unit/learning-outcome-committer.unit.test.ts'), 'utf8')

assert.match(source, /after_stage_flush[\s\S]*after_record_publish[\s\S]*after_outcome_publish[\s\S]*after_settlement_marker/, 'Durability fault boundaries must remain explicit.')
assert.match(source, /async reconcile\(sessionId: string\)/, 'Committer must expose recovery reconciliation.')
assert.match(source, /await cleanupStages\(/, 'Reconciliation must clean abandoned stage files.')
assert.match(tests, /read-repairs a record published before its outcome marker/, 'Tests must cover the post-publish crash window.')
console.log('learning outcome recovery gate ok')
