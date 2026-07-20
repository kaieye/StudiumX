import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/tech-inspector.ts'), 'utf8')
const shared = await readFile(resolve(root, 'src/shared/teaching-types/tech-inspector.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/tech-inspector.unit.test.ts'), 'utf8')
const barrel = await readFile(resolve(root, 'src/shared/teaching-types.ts'), 'utf8')

assert.match(
  source,
  /export function inspectTeachingTech\(input: TechInspectorInput/,
  'Tech inspector must expose inspectTeachingTech(input).'
)
assert.match(shared, /export const TECH_INSPECTOR_SCHEMA_VERSION = 1/, 'Shared contract must pin schemaVersion = 1.')
assert.match(shared, /type TechInspectorMode[\s\S]*'learner_hidden'[\s\S]*'diagnostic'/, 'Mode must include learner_hidden and diagnostic.')
assert.match(
  shared,
  /type TechInspectorSectionId[\s\S]*'events'[\s\S]*'effects'[\s\S]*'projection_report'[\s\S]*'run_lifecycle'[\s\S]*'capability'/,
  'Section ids must cover events, effects, projection_report, run_lifecycle, capability.'
)
assert.match(shared, /type TechInspectorFinding[\s\S]*summary:/, 'Finding model must expose a redacted summary.')
assert.match(shared, /type TechInspectorReport[\s\S]*mode:[\s\S]*status:[\s\S]*sections:[\s\S]*fingerprint:/, 'Report must include mode, status, sections, fingerprint.')
assert.match(shared, /type TechInspectorInput[\s\S]*events\?:[\s\S]*effects\?:[\s\S]*projectionReport\?:/, 'Input must accept pre-normalized event/effect/projection views.')
assert.match(barrel, /tech-inspector/, 'Shared teaching-types barrel must re-export tech-inspector.')

// Default-hidden + diagnostic assembly behavior.
assert.match(source, /mode === 'learner_hidden'|mode: 'learner_hidden'/, 'Implementation must treat learner_hidden as default/hidden.')
assert.match(source, /status: 'hidden'/, 'Learner-hidden reports must use status hidden.')
assert.match(source, /sections: \[\]/, 'Learner-hidden reports must return empty sections.')
assert.match(source, /assembleEventsSection|id: 'events'|id === 'events'|const id: TechInspectorSectionId = 'events'/, 'Diagnostic mode must assemble events section.')
assert.match(source, /const id: TechInspectorSectionId = 'effects'/, 'Diagnostic mode must assemble effects section.')
assert.match(source, /const id: TechInspectorSectionId = 'projection_report'/, 'Diagnostic mode must assemble projection_report section.')
assert.match(source, /const id: TechInspectorSectionId = 'run_lifecycle'/, 'Diagnostic mode must assemble run_lifecycle section.')
assert.match(source, /const id: TechInspectorSectionId = 'capability'/, 'Diagnostic mode must assemble capability section.')
assert.match(source, /redactAgentSecretText/, 'Implementation must redact string fields via redactAgentSecretText.')
assert.match(source, /createHash\('sha256'\)/, 'Fingerprint must be secret-free sha256 digest.')

// Read-only pure assembler: no filesystem writes / random / auto-repair.
assert.doesNotMatch(
  source,
  /writeFile|appendFile|rename\(|unlink\(|rm\(|mkdir\(|replaceWithBackup|durableReplace/,
  'Tech inspector must stay read-only and must not write the filesystem.'
)
assert.doesNotMatch(source, /Math\.random\b/, 'Tech inspector must not use random state.')
assert.doesNotMatch(
  `${source}\n${shared}`,
  /learnerAnswer|rawEvidenceText|assessmentPayload|providerResponse|selectedOptionIds|apiKey\s*:/,
  'Tech inspector contracts must not project raw learner, assessment, provider, or secret payloads.'
)
assert.doesNotMatch(source, /autoRepair\s*:\s*true|autoRepairAllowed:\s*true/, 'Tech inspector must not enable auto-repair.')

// Unit contract coverage
assert.match(unit, /defaults to learner_hidden with empty sections and hidden status/, 'Unit coverage must retain learner_hidden default.')
assert.match(unit, /does not leak diagnostic details when mode is learner_hidden/, 'Unit coverage must retain hidden-mode non-leakage.')
assert.match(unit, /assembles all five diagnostic sections from pre-normalized views/, 'Unit coverage must retain diagnostic assembly.')
assert.match(unit, /redacts secret-shaped strings in summaries and evidence/, 'Unit coverage must retain redaction.')
assert.match(unit, /produces a stable fingerprint for semantically identical diagnostic inputs/, 'Unit coverage must retain fingerprint stability.')
assert.match(unit, /does not mutate deeply frozen input views/, 'Unit coverage must retain immutability.')

// Runtime unit gate via local vitest entry.
const vitestEntry = [
  resolve(root, 'node_modules/vitest/vitest.mjs'),
  resolve(root, 'node_modules/vitest/dist/cli.js')
].find((path) => existsSync(path))
assert.ok(vitestEntry, 'Local vitest entry must exist.')

const unitResult = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--project', 'unit', 'tests/unit/tech-inspector.unit.test.ts'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }
)
assert.equal(unitResult.status, 0, unitResult.stdout + unitResult.stderr)

console.log('tech inspector gate ok')
