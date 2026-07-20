import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const harness = await readFile(resolve(root, 'tests/fixtures/teaching-learning-loop/harness.ts'), 'utf8')
const integration = await readFile(resolve(root, 'tests/integration/teaching-learning-loop.integration.test.ts'), 'utf8')
const e2e = await readFile(resolve(root, 'tests/e2e/teaching-learning-loop.e2e.spec.ts'), 'utf8')
const e2eLongitudinal = await readFile(resolve(root, 'tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts'), 'utf8')
const e2eCrash = await readFile(resolve(root, 'tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts'), 'utf8')
const packageJson = await readFile(resolve(root, 'package.json'), 'utf8')
const releaseAuditContract = await readFile(resolve(root, 'scripts/release-audit-contract.mjs'), 'utf8')

for (const id of [
  'session-golden-001',
  'evidence-golden-wrong-001',
  'evidence-golden-corrected-002',
  'source-golden-foundation',
  'source-golden-practice',
  'operation-golden-needs-practice-001',
  'operation-golden-correction-002'
]) {
  assert.match(harness, new RegExp(id), `Golden harness must pin ${id}.`)
  assert.match(integration, new RegExp(id), `Golden integration must pin ${id}.`)
}

assert.match(integration, /Crash A repairs exactly one published record/, 'Crash A must remain covered.')
assert.match(integration, /Crash B leaves no half-published outcome/, 'Crash B must remain covered.')
assert.match(integration, /before_catalog_reconcile/, 'Crash A must use the pre-catalog fault point.')
assert.match(integration, /after_stage_flush/, 'Crash B must use the post-stage fault point.')
assert.match(integration, /reconciliation_required/, 'Crash windows must assert reconciliation-required recovery.')
assert.match(integration, /already_committed/, 'Golden loop must prove commit idempotency.')
assert.match(integration, /consumeTeachingTurnAnnouncement/, 'Golden loop must prove announcement de-duplication.')
assert.match(harness, /\/correction\/i\.test\(context\.operationId\)/, 'Fault injection must gate on correction operations only.')
assert.match(harness, /restartWithoutFault:\s*\(\)\s*=>\s*createGoldenTeachingLoopHarness\(\{\s*root\s*\}\)/, 'Restart must reuse the same workspace root without faults.')
assert.match(harness, /teachingInvokeChannels\.commitLearningOutcome/, 'Commits must go through the real IPC channel.')
assert.match(harness, /createLessonInteractionRecorder/, 'Evidence must use the real interaction recorder.')
assert.match(harness, /learning-records/, 'Catalog must remain a filesystem projection over learning-records.')
assert.doesNotMatch(harness, /catalogWriter|writeLearningAssetCatalog/, 'Do not invent a separate catalog writer.')
assert.match(e2e, /AgentConversationReader/, 'E2E must mount the real AgentConversationReader.')
assert.match(e2e, /buildTeachingTurnPresentation/, 'E2E must use the real presentation projector.')
assert.match(e2e, /@a11y/, 'E2E must remain tagged for accessibility runs.')
assert.doesNotMatch(e2e, /\btest\.(skip|fix|only)\b/, 'Golden E2E must not be skipped or focused.')
assert.match(e2e, /toHaveAttribute\('aria-live', 'polite'\)/, 'E2E must assert polite live status.')
assert.match(e2e, /getByRole\('log'\)/, 'E2E must forbid role=log announcements.')
assert.match(e2e, /source-golden-foundation/, 'E2E must disclose the foundation source id.')
assert.match(e2e, /source-golden-practice/, 'E2E must disclose the practice source id.')
assert.match(e2e, /secret-token-not-rendered/, 'E2E must prove unsafe tokens stay redacted.')
assert.match(packageJson, /"check:teaching-learning-loop"\s*:\s*"node scripts\/check-teaching-learning-loop\.mjs"/, 'package.json must expose the R6 check script.')

// Plan §2.3: real longitudinal Electron Golden + crash/restart injection (not presentation-only).
assert.match(e2eLongitudinal, /commitLearningOutcome/, 'Longitudinal E2E must call commitLearningOutcome via preload/IPC.')
assert.match(e2eLongitudinal, /forceKillElectronRuntime/, 'Longitudinal E2E must terminate and restart the real Electron process.')
assert.match(e2eLongitudinal, /readLearningAssetCatalog/, 'Longitudinal E2E must assert catalog reconciliation.')
assert.match(e2eLongitudinal, /already_committed/, 'Longitudinal E2E must prove commit idempotency.')
assert.match(e2eLongitudinal, /misconception_corrected/, 'Longitudinal E2E must assert canonical corrected outcome.')
assert.match(e2eLongitudinal, /data-learning-outcome-commit/, 'Longitudinal E2E must assert learner-safe presentation.')
assert.doesNotMatch(e2eLongitudinal, /\btest\.(skip|fix|only)\b/, 'Longitudinal E2E must not be skipped or focused.')

assert.match(e2eCrash, /STUDIUMX_E2E_CRASH_POINT/, 'Crash-recovery E2E must arm STUDIUMX_E2E_CRASH_POINT.')
assert.match(e2eCrash, /after_stage_flush/, 'Crash-recovery E2E must cover after_stage_flush.')
assert.match(e2eCrash, /before_catalog_reconcile/, 'Crash-recovery E2E must cover before_catalog_reconcile.')
assert.match(e2eCrash, /commitLearningOutcome/, 'Crash-recovery E2E must replay via real preload IPC.')
assert.match(e2eCrash, /readLearningAssetCatalog/, 'Crash-recovery E2E must assert catalog length after repair.')
assert.match(e2eCrash, /forceKillElectronRuntime/, 'Crash-recovery E2E must restart the real Electron process.')
assert.doesNotMatch(e2eCrash, /\btest\.(skip|fix|only)\b/, 'Crash-recovery E2E must not be skipped or focused.')

assert.match(
  releaseAuditContract,
  /teaching-learning-loop-longitudinal\.e2e\.spec\.ts.*--project=electron-e2e.*--repeat-each=3/s,
  'Release audit must run longitudinal Electron e2e with --repeat-each=3.'
)
assert.match(
  releaseAuditContract,
  /teaching-learning-loop-crash-recovery\.e2e\.spec\.ts.*--project=electron-e2e.*--repeat-each=3/s,
  'Release audit must run crash-recovery Electron e2e with --repeat-each=3.'
)

for (const forbidden of [
  'src/main/learning-session-ledger.ts',
  'src/main/lesson-interaction-recorder.ts',
  'src/main/learning-outcome-evaluator.ts',
  'src/main/learning-outcome-committer.ts',
  'src/main/next-teaching-step-planner.ts',
  'src/main/teaching-context-assembler.ts',
  'src/main/resource-grounder.ts',
  'src/renderer/src/teaching-turn-presentation.ts'
]) {
  assert.doesNotMatch(
    integration + e2e + e2eLongitudinal + e2eCrash + harness,
    new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*rewrite', 'i'),
    `R6 package must not rewrite deep module ${forbidden}.`
  )
}

console.log('check-teaching-learning-loop: ok')
