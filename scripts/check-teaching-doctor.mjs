import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/teaching-doctor.ts'), 'utf8')
const shared = await readFile(resolve(root, 'src/shared/teaching-types/teaching-doctor.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/teaching-doctor.unit.test.ts'), 'utf8')
const barrel = await readFile(resolve(root, 'src/shared/teaching-types.ts'), 'utf8')

assert.match(source, /export interface TeachingDoctor[\s\S]*run\(facts\?: TeachingDoctorFacts\): TeachingDoctorReport/, 'TeachingDoctor must expose run(): DoctorReport.')
assert.match(source, /export function createTeachingDoctor/, 'TeachingDoctor must keep a factory seam.')
assert.match(source, /export function runTeachingDoctor/, 'TeachingDoctor must retain a pure run function.')
assert.match(source, /export function exportTeachingDoctorReport/, 'TeachingDoctor must export a redacted report seam.')
assert.match(source, /workspaceOpenPolicy: 'read_only_allowed'/, 'Doctor failure must not block read-only workspace open.')
assert.match(source, /autoRepair: 'disabled'/, 'v1 must disable auto-repair on the report.')
assert.match(source, /autoRepairAllowed: false/, 'Repair recommendations must never auto-execute in v1.')

for (const checkId of [
  'p0_session_event_manifest_crash_window',
  'p0_outcome_publication_crash_window',
  'config_availability',
  'source_gap',
  'catalog_drift',
  'local_process_crash_marker'
]) {
  assert.match(shared, new RegExp(`'${checkId}'`), `Shared contract must declare checkId ${checkId}.`)
  assert.match(source, new RegExp(checkId), `Implementation must produce check ${checkId}.`)
}

assert.match(shared, /type TeachingDoctorCheckItem[\s\S]*checkId:[\s\S]*result:[\s\S]*evidence:[\s\S]*recommendedAction:[\s\S]*repair:/, 'Each item must carry checkId, result, evidence, recommended action, and repair.')
assert.match(shared, /type TeachingDoctorRepairKind[\s\S]*deterministic_projection_rebuild/, 'Repair kinds must include deterministic projection rebuild.')
assert.match(barrel, /teaching-doctor/, 'Shared teaching-types barrel must re-export teaching-doctor.')

// Read-only: doctor must not write the filesystem or invent auto-repair side effects.
assert.doesNotMatch(
  source,
  /writeFile|appendFile|rename\(|unlink\(|rm\(|mkdir\(|replaceWithBackup|durableReplace/,
  'TeachingDoctor.run must stay read-only and must not invoke repair writers.'
)
assert.doesNotMatch(source, /Math\.random\b/, 'TeachingDoctor must not use random state.')
assert.doesNotMatch(
  `${source}\n${shared}`,
  /learnerAnswer|rawEvidenceText|assessmentPayload|providerResponse|selectedOptionIds|apiKey\s*:/,
  'Doctor contracts must not project raw learner, assessment, provider, or secret payloads.'
)

// Unit contract coverage
assert.match(unit, /diagnoses the P0 session event\/manifest crash window/, 'Unit coverage must retain session crash-window diagnosis.')
assert.match(unit, /diagnoses the P0 outcome publication crash window/, 'Unit coverage must retain outcome crash-window diagnosis.')
assert.match(unit, /flags configuration unavailability/, 'Unit coverage must retain config unavailability.')
assert.match(unit, /reports source gaps/, 'Unit coverage must retain source-gap diagnosis.')
assert.match(unit, /reports catalog drift/, 'Unit coverage must retain catalog-drift diagnosis.')
assert.match(unit, /exports a redacted report that strips secret-shaped values/, 'Unit coverage must retain redaction export.')
assert.match(unit, /always allows read-only open even when overall status is fail/, 'Unit coverage must retain read-only open policy.')
assert.match(unit, /never auto-repairs/, 'Unit coverage must retain no auto-repair.')
assert.match(unit, /prior-process crash marker/, 'Unit coverage must retain local process crash marker finding.')

// Runtime unit gate via local vitest entry (avoid pnpm install side effects in CI-less shells).
const vitestEntry = [
  resolve(root, 'node_modules/vitest/vitest.mjs'),
  resolve(root, 'node_modules/vitest/dist/cli.js')
].find((path) => existsSync(path))
assert.ok(vitestEntry, 'Local vitest entry must exist.')

const unitResult = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--project', 'unit', 'tests/unit/teaching-doctor.unit.test.ts'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }
)
assert.equal(unitResult.status, 0, unitResult.stdout + unitResult.stderr)

console.log('teaching doctor gate ok')

