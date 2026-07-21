import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/ai/tools/parallel-read-dispatcher.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/parallel-read-tools.unit.test.ts'), 'utf8')
const packageJson = await readFile(resolve(root, 'package.json'), 'utf8')

assert.match(
  source,
  /export async function dispatchReadToolsInParallel/,
  'Must export dispatchReadToolsInParallel.'
)
assert.match(
  source,
  /DEFAULT_PARALLEL_READ_CONCURRENCY\s*=\s*4/,
  'Default concurrency must be 4.'
)
assert.match(
  source,
  /MAX_PARALLEL_READ_CONCURRENCY\s*=\s*8/,
  'Max concurrency must be 8.'
)
assert.match(source, /parallel_read_only/, 'Non-read denial must use parallel_read_only code.')
assert.match(source, /classifyToolEffect/, 'Must classify tool effects before parallel run.')
assert.match(source, /effectClass !== 'read'/, 'Must gate on pure-read effect class.')
assert.doesNotMatch(source, /Math\.random\b/, 'Parallel read dispatcher must not use random state.')

// Conservative: never parallelize writes / privileged / external_write by default.
assert.doesNotMatch(
  source,
  /workspace_write.*Promise\.all|Promise\.all.*workspace_write/,
  'Must not Promise.all workspace_write paths.'
)

// Unit contracts
assert.match(unit, /maxInFlight/, 'Unit tests must measure in-flight concurrency.')
assert.match(unit, /parallel_read_only/, 'Unit tests must cover non-read denial code.')
assert.match(unit, /write_workspace_file/, 'Unit tests must deny workspace_write.')
assert.match(unit, /privileged/, 'Unit tests must deny privileged tools.')
assert.match(unit, /same-path pure reads/, 'Unit tests must allow concurrent same-path reads.')
assert.match(
  packageJson,
  /"check:parallel-read-tools"\s*:/,
  'package.json must expose check:parallel-read-tools.'
)

const vitestEntry = [
  resolve(root, 'node_modules/vitest/vitest.mjs'),
  resolve(root, 'node_modules/vitest/dist/cli.js')
].find((path) => existsSync(path))
assert.ok(vitestEntry, 'Local vitest entry must exist.')

const unitResult = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--project', 'unit', 'tests/unit/parallel-read-tools.unit.test.ts'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }
)
assert.equal(unitResult.status, 0, unitResult.stdout + unitResult.stderr)


const batch = await readFile(resolve(root, 'src/main/ai/tools/batch-dispatch.ts'), 'utf8')
const loop = await readFile(resolve(root, 'src/main/ai/agent-loop.ts'), 'utf8')
const batchUnit = await readFile(resolve(root, 'tests/unit/tool-batch-dispatch.unit.test.ts'), 'utf8')

assert.match(batch, /export async function executeToolBatch/, 'Must export executeToolBatch.')
assert.match(batch, /partitionToolCalls/, 'Must export partitionToolCalls.')
assert.match(batch, /dispatchReadToolsInParallel/, 'Hybrid batch must call dispatchReadToolsInParallel.')
assert.match(batch, /classifyToolEffect/, 'Hybrid batch must classify effects.')
assert.doesNotMatch(
  batch,
  /workspace_write[\s\S]{0,80}Promise\.all|Promise\.all[\s\S]{0,80}workspace_write/,
  'batch-dispatch must not Promise.all workspace_write.'
)
assert.match(loop, /executeToolBatch/, 'agent-loop must call executeToolBatch.')
assert.match(loop, /recoveryBatch/, 'recovery path must use hybrid batch helper.')
// A-02 length rejection must remain before runtime dispatch in both main and recovery paths.
// Skip the import line (first executeToolBatch occurrence) and require each call-site
// is preceded by a length gate earlier in the file section.
const lengthHits = [...loop.matchAll(/finishReason === 'length'/g)].map((m) => m.index ?? -1)
const batchHits = [...loop.matchAll(/executeToolBatch\(/g)].map((m) => m.index ?? -1)
assert.ok(lengthHits.length >= 2, 'A-02 length gates must exist for main and recovery paths.')
assert.ok(batchHits.length >= 2, 'executeToolBatch call-sites must exist for main and recovery.')
assert.ok(lengthHits[0] < batchHits[0], 'Main path: length rejection before executeToolBatch call.')
assert.ok(lengthHits[1] < batchHits[1], 'Recovery path: length rejection before executeToolBatch call.')
assert.match(batchUnit, /maxInFlight|maxReadInFlight/, 'Batch unit tests must measure concurrency.')
assert.match(batchUnit, /tool_calls_rejected_due_to_length/, 'Batch unit tests must keep A-02 coverage.')

const batchUnitResult = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--project', 'unit', 'tests/unit/tool-batch-dispatch.unit.test.ts'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }
)
assert.equal(batchUnitResult.status, 0, batchUnitResult.stdout + batchUnitResult.stderr)

console.log('parallel-read-tools gate ok')
