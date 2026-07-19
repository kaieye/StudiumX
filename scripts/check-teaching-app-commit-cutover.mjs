import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const app = await readFile(resolve(root, 'src/renderer/src/App.tsx'), 'utf8')
const client = await readFile(resolve(root, 'src/renderer/src/teaching/learning-outcome-commit-client.ts'), 'utf8')
const banner = await readFile(
  resolve(root, 'src/renderer/src/teaching/learning-outcome-commit-status-banner.tsx'),
  'utf8'
)
const unit = await readFile(resolve(root, 'tests/unit/learning-outcome-commit-client.unit.test.ts'), 'utf8')
const bannerUnit = await readFile(
  resolve(root, 'tests/unit/learning-outcome-commit-status-banner.unit.test.tsx'),
  'utf8'
)
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
assert.match(app, /LearningOutcomeCommitStatusBanner/, 'App must render the shared learner-safe commit banner.')
assert.match(app, /retryLearningOutcomeCommit|client\.retry\(\)/, 'App must wire production same-operationId retry.')
assert.match(app, /isPreviewCommitScopeCurrent/, 'App must compare live scope refs against record-start tokens.')
assert.match(app, /previewCommitScopeKeyRef/, 'App must keep current scope on a ref (no stale closure).')
assert.match(app, /learningOutcomeMountedRef/, 'App must guard status updates after unmount.')
assert.match(app, /data-reading-surface/, 'HTML and Markdown previews must share the banner container surface.')
assert.doesNotMatch(app, /learning-records/, 'Renderer App must not write learning-records paths.')
assert.doesNotMatch(app, /mastery\s*[:=]/, 'Renderer App must not invent mastery facts.')

assert.match(client, /window\.teachingSystem|commitLearningOutcome/, 'Client must target the formal commit API surface.')
assert.match(client, /isCommitEligiblePreviewIntentKind/, 'Client must gate commits to evidence-bearing intents.')
assert.match(client, /outcome-seq-/, 'Client must mint stable sequence-scoped operationIds.')
assert.match(client, /already_committed/, 'Client must project already_committed honestly.')
assert.match(client, /reconciliation_required/, 'Client must project reconciliation_required honestly.')
assert.match(client, /api_reject/, 'Client must allow same-op retry after API reject.')
assert.match(client, /isPreviewCommitScopeCurrent/, 'Client module must export scope currentness helper.')
assert.match(client, /learnerSafeCommitStatusSeverity/, 'Client module must export severity without dead branches.')
assert.match(client, /without notifying React|unmounted/, 'dispose must not notify React after unmount.')
assert.doesNotMatch(client, /learning-records/, 'Client must not write learning-records.')
assert.doesNotMatch(client, /writeFile|mkdir|appendFile/, 'Client must not touch the filesystem.')

assert.match(banner, /LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME/, 'Banner must expose a stable accessible retry name.')
assert.match(banner, /aria-label=\{LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME\}/, 'Retry control must have an accessible name.')
assert.match(banner, /onRetry/, 'Banner must call production onRetry wiring.')
assert.match(banner, /disabled=\{isBusy/, 'Retry control must disable while loading.')
assert.match(banner, /data-severity=\{severity\}/, 'Banner must use mapped severity (no dead branch).')

assert.match(unit, /needs_practice/, 'Unit tests must lock needs_practice.')
assert.match(unit, /recordSaved: true/, 'Unit tests must lock corrected recordSaved true.')
assert.match(unit, /already_committed/, 'Unit tests must lock same-op replay.')
assert.match(unit, /api_reject|ipc down/, 'Unit tests must lock API reject same-op retry.')
assert.match(unit, /stale results|lesson-b|session-new/, 'Unit tests must lock stale-result isolation.')
assert.match(unit, /delayed record does not commit after scope leaves isCurrent/, 'Unit tests must cover delayed record + scope switch behavior.')
assert.match(unit, /toHaveBeenCalledTimes\(0\)/, 'Stale record behavior must assert commit was not called.')
assert.match(unit, /dispose invalidates work without notifying React/, 'Unit tests must cover dispose without setState notify.')
assert.match(unit, /onStatusChange\)\.not\.toHaveBeenCalled/, 'Dispose coverage must assert no status notify after dispose.')

assert.match(bannerUnit, /重试同一提交|LEARNING_OUTCOME_COMMIT_RETRY_BUTTON_NAME/, 'Banner unit tests must lock accessible retry name.')
assert.match(bannerUnit, /data-reading-surface=\"markdown\"/, 'Banner unit tests must cover Markdown surface visibility.')
assert.match(bannerUnit, /getByRole\('button'/, 'Banner unit tests must exercise the retry button role.')
assert.match(bannerUnit, /toBeDisabled|aria-busy/, 'Banner unit tests must cover loading/disabled retry state.')
assert.match(bannerUnit, /keyboard|\{Enter\}/, 'Banner unit tests must cover keyboard activation.')

assert.match(integration, /TeachingWorkspaceService/, 'Integration must use the real workspace service sole writer.')
assert.match(integration, /publishLessonArtifacts|FIXED_ASSESSMENT_PLAN/, 'Integration must seed a fixed assessment fixture.')
assert.doesNotMatch(integration, /generateLesson\s*\(/, 'Integration must not depend on provider generateLesson.')
assert.match(integration, /countLearningRecords|learning-records/, 'Integration must assert canonical learning-record counts.')
assert.match(integration, /toBe\(0\)/, 'Integration must prove zero records after wrong evidence.')
assert.match(integration, /toBe\(1\)/, 'Integration must prove exactly one record after correction/replay.')
assert.match(integration, /same-operationId retry|client\.retry\(\)/, 'Integration must cover same-op retry without new evidence.')
assert.match(packageJson, /"check:teaching-app-commit-cutover"\s*:\s*"node scripts\/check-teaching-app-commit-cutover\.mjs"/)

console.log('check-teaching-app-commit-cutover: ok')
