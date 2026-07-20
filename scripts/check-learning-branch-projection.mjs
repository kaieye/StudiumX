import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/learning-branch-projection.ts'), 'utf8')
const shared = await readFile(resolve(root, 'src/shared/teaching-types/learning-branch-projection.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/learning-branch-projection.unit.test.ts'), 'utf8')
const barrel = await readFile(resolve(root, 'src/shared/teaching-types.ts'), 'utf8')

assert.match(
  source,
  /export function projectLearningBranch/,
  'Learning Branch Projection must expose pure projectLearningBranch().'
)
assert.match(
  source,
  /export function createLearningBranchProjector/,
  'Learning Branch Projection must keep a factory seam.'
)
assert.match(
  source,
  /export function fingerprintLearningBranchProjection/,
  'Learning Branch Projection must expose a deterministic fingerprint helper.'
)
assert.match(
  source,
  /planNextTeachingStep/,
  'Primary path must reuse the existing NextTeachingStepPlanner decision.'
)

assert.match(shared, /LEARNING_BRANCH_PROJECTION_SCHEMA_VERSION = 1/, 'schemaVersion must be 1.')
assert.match(shared, /type LearningBranchProjectionFacts/, 'Shared contract must declare facts input.')
assert.match(shared, /type LearningBranchNode/, 'Shared contract must declare branch nodes.')
assert.match(shared, /type LearningBranchProjection/, 'Shared contract must declare projection output.')
assert.match(shared, /kind: LearningBranchNodeKind/, 'Nodes must carry a kind.')
assert.match(
  shared,
  /'primary'[\s\S]*'retry'[\s\S]*'clarification'[\s\S]*'resource_wait'[\s\S]*'historical'/,
  'Node kinds must include primary, retry, clarification, resource_wait, historical.'
)
assert.match(shared, /primaryPath:/, 'Projection must include primaryPath.')
assert.match(shared, /alternatePaths:/, 'Projection must include alternatePaths.')
assert.match(shared, /fingerprint:/, 'Projection must include fingerprint.')
assert.match(shared, /historySessions\?/, 'Facts may include optional history session summaries.')
assert.match(barrel, /learning-branch-projection/, 'Shared teaching-types barrel must re-export learning-branch-projection.')

// Read-only: projector must not write the filesystem or invent durable writers.
assert.doesNotMatch(
  source,
  /writeFile|appendFile|rename\(|unlink\(|rm\(|mkdir\(|replaceWithBackup|durableReplace|LearningSessionLedger|LearningOutcomeCommitter/,
  'projectLearningBranch must stay read-only and must not write outcome/session/ledger.'
)
assert.doesNotMatch(source, /Math\.random\b/, 'Learning Branch Projection must not use random state.')
assert.doesNotMatch(
  `${source}\n${shared}`,
  /learnerAnswer|rawEvidenceText|assessmentPayload|providerResponse|selectedOptionIds|apiKey\s*:/,
  'Branch projection contracts must not project raw learner, assessment, provider, or secret payloads.'
)

// Unit contract coverage
assert.match(unit, /linear primary path that mirrors the planner/, 'Unit coverage must retain linear primary path.')
assert.match(unit, /alternate retry branch/, 'Unit coverage must retain alternate retry projection.')
assert.match(unit, /legacy read-only/, 'Unit coverage must retain legacy read-only projection.')
assert.match(unit, /fingerprint stable/, 'Unit coverage must retain fingerprint stability.')
assert.match(unit, /does not mutate deeply frozen facts/, 'Unit coverage must retain no-mutation guarantee.')

// Runtime unit gate via local vitest entry (avoid pnpm install side effects in CI-less shells).
const vitestEntry = [
  resolve(root, 'node_modules/vitest/vitest.mjs'),
  resolve(root, 'node_modules/vitest/dist/cli.js')
].find((path) => existsSync(path))
assert.ok(vitestEntry, 'Local vitest entry must exist.')

const unitResult = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--project', 'unit', 'tests/unit/learning-branch-projection.unit.test.ts'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }
)
assert.equal(unitResult.status, 0, unitResult.stdout + unitResult.stderr)

console.log('learning branch projection gate ok')
