import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const source = await readFile(join(root, 'src/main/learning-outcome-committer.ts'), 'utf8')
const tests = await readFile(join(root, 'tests/unit/learning-outcome-committer.unit.test.ts'), 'utf8')

assert.match(source, /const record = await readCanonicalRecord/, 'Canonical record files must be considered before projection repair.')
assert.match(source, /async function legacyDiagnostics/, 'Legacy generated records must be diagnosed through a read-only path.')
assert.match(tests, /readFile\(legacyPath, 'utf8'\)\)\.resolves\.toBe\(legacy\)/, 'Legacy test must assert byte preservation.')
assert.match(tests, /legacy_generated records as read-only diagnostics without upgrading their bytes/, 'Tests must preserve legacy bytes.')
console.log('learning record read-repair gate ok')
