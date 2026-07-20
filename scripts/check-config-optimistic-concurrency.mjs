import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/config-optimistic-writer.ts'), 'utf8')
const shared = await readFile(resolve(root, 'src/shared/teaching-types/config-optimistic-write.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/config-optimistic-writer.unit.test.ts'), 'utf8')
const barrel = await readFile(resolve(root, 'src/shared/teaching-types.ts'), 'utf8')

assert.match(source, /export function compareAndProjectConfigWrite/, 'Must expose pure compareAndProjectConfigWrite CAS core.')
assert.match(source, /export function projectConfigWriteRequest/, 'Must expose projectConfigWriteRequest convenience.')
assert.match(source, /export async function writeConfigOptimistic/, 'Must expose thin ConfigOptimisticStore adapter.')
assert.match(source, /fingerprintTeachingConfig/, 'CAS must use fingerprintTeachingConfig for secret-free digests.')
assert.match(source, /resolveTeachingConfig/, 'CAS must re-resolve via resolveTeachingConfig after apply.')
assert.match(source, /isTeachingConfigSecretPath/, 'CAS must detect secret paths via isTeachingConfigSecretPath.')
assert.match(source, /fingerprint_mismatch/, 'Conflict path must use fingerprint_mismatch code.')
assert.match(source, /secret_path_rejected/, 'Secret rejection must use secret_path_rejected code.')

assert.match(shared, /type ConfigWriteRequest[\s\S]*expectedFingerprint:[\s\S]*next:/, 'Shared contract must declare ConfigWriteRequest.')
assert.match(shared, /ok: true[\s\S]*fingerprint:/, 'Success result must carry fingerprint.')
assert.match(shared, /ConfigWriteConflictCode = 'fingerprint_mismatch'|code: 'fingerprint_mismatch'/, 'Conflict contract must declare fingerprint_mismatch.')
assert.match(shared, /type ConfigWriteConflict[\s\S]*currentFingerprint:/, 'Conflict result must expose currentFingerprint.')
assert.match(shared, /code: ConfigWriteInvalidCode/, 'Invalid contract must declare invalid codes.')
assert.match(shared, /secret_path_rejected/, 'Invalid codes must include secret_path_rejected.')
assert.match(shared, /type ConfigOptimisticStore[\s\S]*read\(\)[\s\S]*writeAtomic/, 'Store adapter interface must declare read + writeAtomic.')
assert.match(shared, /layer\?: 'user' \| 'workspace'|ConfigWriteLayer/, 'Request must support user/workspace layer.')
assert.match(barrel, /config-optimistic-write/, 'Shared teaching-types barrel must re-export config-optimistic-write.')

// Pure core: no filesystem writers or random state.
assert.doesNotMatch(
  source,
  /writeFile|appendFile|rename\(|unlink\(|rm\(|mkdir\(|replaceWithBackup|durableReplace|node:fs/,
  'Pure CAS core must not perform filesystem I/O.'
)
assert.doesNotMatch(source, /Math\.random\b/, 'CAS must not use random state.')

// Unit contract coverage
assert.match(unit, /happy path: matching fingerprint applies overlay/, 'Unit coverage must retain happy path.')
assert.match(unit, /mismatch: expectedFingerprint/, 'Unit coverage must retain fingerprint mismatch.')
assert.match(unit, /rejects secret path patches/, 'Unit coverage must retain secret rejection.')
assert.match(unit, /fingerprint changes after a successful write/, 'Unit coverage must retain fingerprint change after write.')

// Runtime unit gate via local vitest entry.
const vitestEntry = [
  resolve(root, 'node_modules/vitest/vitest.mjs'),
  resolve(root, 'node_modules/vitest/dist/cli.js')
].find((path) => existsSync(path))
assert.ok(vitestEntry, 'Local vitest entry must exist.')

const unitResult = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--project', 'unit', 'tests/unit/config-optimistic-writer.unit.test.ts'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }
)
assert.equal(unitResult.status, 0, unitResult.stdout + unitResult.stderr)

console.log('config optimistic concurrency gate ok')
