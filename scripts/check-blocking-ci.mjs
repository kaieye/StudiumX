import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const workflow = await readFile(resolve(root, '.github/workflows/blocking-ci.yml'), 'utf8')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const gateway = await readFile(resolve(root, 'src/main/teaching-ipc-gateway.ts'), 'utf8')
const index = await readFile(resolve(root, 'src/main/index.ts'), 'utf8')
const host = await readFile(resolve(root, 'src/main/teaching-turn-coordinator-host.ts'), 'utf8')

assert.match(workflow, /name:\s*Blocking CI/, 'blocking-ci workflow name required')
assert.match(workflow, /pnpm run typecheck/, 'typecheck must be blocking')
assert.match(workflow, /check:security/, 'security gate must be blocking')
assert.match(workflow, /check:provider-privacy/, 'provider privacy gate must be blocking')
assert.match(workflow, /check:teaching-evidence/, 'P0 teaching evidence gate must be blocking')
assert.match(workflow, /teaching-turn-coordinator/, 'coordinator unit coverage must be referenced')
assert.match(workflow, /Do not upload unredacted|redact/i, 'failure artifact redaction note required')

for (const script of ['typecheck', 'check:security', 'check:provider-privacy', 'check:teaching-evidence', 'check:teaching-ipc-contract']) {
  assert.equal(typeof pkg.scripts?.[script], 'string', 'package script missing: ' + script)
}

assert.match(host, /export function createTeachingTurnCoordinatorHost/, 'host factory required')
assert.match(host, /commitLearningOutcome\(/, 'host commit path required')
assert.match(gateway, /turnCoordinatorHost/, 'gateway must accept coordinator host')
assert.match(gateway, /turnCoordinatorHost\.commitLearningOutcome/, 'gateway must route commits through host when present')
assert.match(index, /createTeachingTurnCoordinatorHost/, 'production composition must create host')
assert.match(index, /turnCoordinatorHost/, 'production registration must pass host')

console.log('blocking ci + coordinator host wiring gate ok')
