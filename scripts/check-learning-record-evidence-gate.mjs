import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const source = await readFile(join(root, 'src/main/learning-outcome-committer.ts'), 'utf8')
const tests = await readFile(join(root, 'tests/integration/learning-outcome-commit.integration.test.ts'), 'utf8')

assert.match(source, /evaluation\.artifact\.status !== 'verified' \|\| evidenceEventIds\.length === 0/, 'A Learning record must require verified artifact evidence and stable evidence IDs.')
assert.match(source, /return kind === 'established' \|\| kind === 'misconception_corrected'/, 'Only evaluator-approved successful kinds may publish records.')
assert.match(source, /if \(settlement\.marker\.kind === 'not_evidenced'\) return insufficientEvidenceResult\(\)/, 'Not-evidenced evaluation must return the typed insufficient-evidence result after recordless settlement.')
assert.match(source, /if \(existing\.marker\?\.operationId === operationId && existing\.state === 'settled'\) \{[\s\S]*existing\.marker\.kind === 'not_evidenced'[\s\S]*return insufficientEvidenceResult\(\)/, 'Not-evidenced replay must preserve the learner-safe insufficient-evidence result.')
assert.match(tests, /operationId: 'outcome-no-evidence-0', kind: 'not_evidenced', record: null/, 'Integration coverage must prove not-evidenced writes only a recordless settlement marker.')
assert.match(source, /if \(!writesLearningRecord\(settlement\.marker\.kind\)\)/, 'Recordless settled outcomes must take the no-record path.')
assert.match(tests, /status: 'committed', outcome: \{ kind: 'needs_practice' \}, recordSaved: false/, 'Integration coverage must prove needs_practice does not publish a record.')
console.log('learning record evidence gate ok')
