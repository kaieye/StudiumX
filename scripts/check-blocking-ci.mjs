import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const workflow = await readFile(resolve(root, '.github/workflows/blocking-ci.yml'), 'utf8')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const gateway = await readFile(resolve(root, 'src/main/teaching-ipc-gateway.ts'), 'utf8')
const index = await readFile(resolve(root, 'src/main/index.ts'), 'utf8')
const host = await readFile(resolve(root, 'src/main/teaching-turn-coordinator-host.ts'), 'utf8')
const ciResults = await readFile(resolve(root, 'scripts/check-ci-results.mjs'), 'utf8')
const cleanWorktree = await readFile(resolve(root, 'scripts/check-clean-worktree.mjs'), 'utf8')
const formatSubset = await readFile(resolve(root, 'scripts/check-format-subset.mjs'), 'utf8')

assert.match(workflow, /name:\s*Blocking CI/, 'blocking-ci workflow name required')
assert.match(workflow, /pnpm run typecheck/, 'typecheck must be blocking')
assert.match(workflow, /check:security/, 'security gate must be blocking')
assert.match(workflow, /check:provider-privacy/, 'provider privacy gate must be blocking')
assert.match(workflow, /check:teaching-evidence/, 'P0 teaching evidence gate must be blocking')
assert.match(workflow, /teaching-turn-coordinator/, 'coordinator unit coverage must be referenced')
assert.match(workflow, /Do not upload unredacted|redact/i, 'failure artifact redaction note required')

// Fan-in job: skip=fail required aggregator (repository CI policy)
assert.match(workflow, /blocking-required:/, 'fan-in job blocking-required required')
assert.match(workflow, /if:\s*always\(\)/, 'fan-in must use if: always() so skip/cancel still runs')
assert.match(
  workflow,
  /needs:\s*\[typecheck,\s*security-privacy,\s*teaching-evidence-p0\]/,
  'fan-in must need the three domain jobs',
)
assert.match(workflow, /check-ci-results\.mjs/, 'fan-in must run check-ci-results')
assert.match(workflow, /NEEDS_JSON:\s*\$\{\{\s*toJSON\(needs\)\s*\}\}/, 'fan-in must pass needs as NEEDS_JSON')
assert.match(workflow, /check-clean-worktree\.mjs/, 'fan-in must run clean-worktree porcelain')
assert.match(workflow, /check-format-subset\.mjs/, 'fan-in must run format subset')
assert.match(workflow, /skip=fail|skip\/cancel/i, 'workflow must document skip=fail semantics')
assert.match(
  workflow,
  /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/,
  'Actions checkout must remain SHA-pinned (repository CI policy)',
)
assert.match(
  workflow,
  /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
  'Actions setup-node must remain SHA-pinned (repository CI policy)',
)
assert.match(workflow, /node-version:\s*'22\.x'/, 'Node 22.x required')

// Domain jobs must remain parallel (not collapsed into a single mega job)
assert.match(workflow, /^\s*typecheck:/m, 'typecheck job must remain')
assert.match(workflow, /^\s*security-privacy:/m, 'security-privacy job must remain')
assert.match(workflow, /^\s*teaching-evidence-p0:/m, 'teaching-evidence-p0 job must remain')

for (const script of [
  'typecheck',
  'check:security',
  'check:provider-privacy',
  'check:teaching-evidence',
  'check:teaching-ipc-contract',
  'check:blocking-ci',
  'check:ci-results',
  'check:clean-worktree',
  'check:format',
]) {
  assert.equal(typeof pkg.scripts?.[script], 'string', 'package script missing: ' + script)
}

assert.match(pkg.scripts['check:ci-results'], /check-ci-results\.mjs/, 'check:ci-results must invoke aggregator')
assert.match(pkg.scripts['check:clean-worktree'], /check-clean-worktree\.mjs/, 'check:clean-worktree wiring')
assert.match(pkg.scripts['check:format'], /check-format-subset\.mjs/, 'check:format wiring')

assert.match(ciResults, /skip=fail|result !== 'success'|resultStr !== 'success'/, 'ci-results must encode skip=fail')
assert.match(ciResults, /REQUIRED_JOBS|typecheck/, 'ci-results must list required jobs')
assert.match(ciResults, /--self-test/, 'ci-results must support --self-test')
assert.match(cleanWorktree, /git status --porcelain|status', '--porcelain'/, 'clean-worktree must use porcelain')
assert.match(formatSubset, /FORMAT_SUBSET_ALLOWLIST|full prettier TBD|prettier TBD/i, 'format subset must be honest about scope')

assert.match(host, /export function createTeachingTurnCoordinatorHost/, 'host factory required')
assert.match(host, /commitLearningOutcome\(/, 'host commit path required')
assert.match(gateway, /turnCoordinatorHost/, 'gateway must accept coordinator host')
assert.match(gateway, /turnCoordinatorHost\.commitLearningOutcome/, 'gateway must route commits through host when present')
assert.match(index, /createTeachingTurnCoordinatorHost/, 'production composition must create host')
assert.match(index, /turnCoordinatorHost/, 'production registration must pass host')

console.log('blocking ci + coordinator host + fan-in/worktree/format gates ok')
