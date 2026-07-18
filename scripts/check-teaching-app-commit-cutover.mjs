import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const app = await readFile(resolve(root, 'src/renderer/src/App.tsx'), 'utf8')
const client = await readFile(resolve(root, 'src/renderer/src/teaching/learning-outcome-commit-client.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/learning-outcome-commit-client.unit.test.ts'), 'utf8')
const integration = await readFile(
  resolve(root, 'tests/integration/teaching-app-learning-outcome-commit.integration.test.ts'),
  'utf8'
)
const packageJson = await readFile(resolve(root, 'package.json'), 'utf8')

assert.match(app, /recordPreviewLessonInteractionAndMaybeCommit/, 'App must use production record+commit orchestration.')
assert.match(app, /createLearningOutcomeCommitClient/, 'App must own a production commit client.')
assert.match(app, /api\.commitLearningOutcome\(request\)/, 'App must call the formal TeachingSystemApi commit IPC.')
assert.match(app, /setLessonScope\(previewCommitScopeKey\)/, 'App must invalidate commit state when the lesson scope changes.')
assert.match(app, /client\.dispose\(\)/, 'App must dispose commit work on unmount.')
assert.match(app, /data-learning-outcome-commit/, 'App must surface honest learner-safe commit status.')
assert.doesNotMatch(app, /learning-records/, 'Renderer App must not write learning-records paths.')
assert.doesNotMatch(app, /mastery\s*[:=]/, 'Renderer App must not invent mastery facts.')

assert.match(client, /window\.teachingSystem|commitLearningOutcome/, 'Client must target the formal commit API surface.')
assert.match(client, /isCommitEligiblePreviewIntentKind/, 'Client must gate commits to evidence-bearing intents.')
assert.match(client, /outcome-seq-/, 'Client must mint stable sequence-scoped operationIds.')
assert.match(client, /already_committed/, 'Client must project already_committed honestly.')
assert.match(client, /reconciliation_required/, 'Client must project reconciliation_required honestly.')
assert.match(client, /api_reject/, 'Client must allow same-op retry after API reject.')
assert.doesNotMatch(client, /learning-records/, 'Client must not write learning-records.')
assert.doesNotMatch(client, /writeFile|mkdir|appendFile/, 'Client must not touch the filesystem.')

assert.match(unit, /needs_practice/, 'Unit tests must lock needs_practice.')
assert.match(unit, /recordSaved: true/, 'Unit tests must lock corrected recordSaved true.')
assert.match(unit, /already_committed/, 'Unit tests must lock same-op replay.')
assert.match(unit, /api_reject|ipc down/, 'Unit tests must lock API reject same-op retry.')
assert.match(unit, /stale results|lesson-b|session-new/, 'Unit tests must lock stale-result isolation.')
assert.match(integration, /TeachingWorkspaceService/, 'Integration must use the real workspace service sole writer.')
assert.match(integration, /countLearningRecords|learning-records/, 'Integration must assert canonical learning-record counts.')
assert.match(integration, /toBe\(0\)/, 'Integration must prove zero records after wrong evidence.')
assert.match(integration, /toBe\(1\)/, 'Integration must prove exactly one record after correction/replay.')
assert.match(packageJson, /"check:teaching-app-commit-cutover"\s*:\s*"node scripts\/check-teaching-app-commit-cutover\.mjs"/)

console.log('check-teaching-app-commit-cutover: ok')
