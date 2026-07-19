import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const source = await readFile(join(root, 'src/main/learning-outcome-committer.ts'), 'utf8')
const tests = await readFile(join(root, 'tests/unit/learning-outcome-committer.unit.test.ts'), 'utf8')

// Authority-first reconcile / read-repair: canonical record before projection repair.
const canonicalRead = /const recordRead = await readCanonicalRecord/
assert.match(source, canonicalRead, 'Canonical record files must be considered before projection repair.')
assert.match(source, /async function legacyDiagnostics/, 'Legacy generated records must be diagnosed through a read-only path.')
assert.match(source, /async reconcile\(sessionId: string\)/, 'Read-repair path is exposed through reconcile.')

// Unit pins for legacy byte preservation and authority-first repair.
assert.match(tests, /readFile\(legacyPath, 'utf8'\)\)\.resolves\.toBe\(legacy\)/, 'Legacy test must assert byte preservation.')
assert.match(tests, /legacy_generated records as read-only diagnostics without upgrading their bytes/, 'Tests must preserve legacy bytes.')
assert.match(tests, /uses a durable record as repair authority after publication before projections exist/, 'Tests must cover authority-first repair from the durable record.')

// Positive / negative self-checks for the canonical read binding rewrite.
assert.match('const recordRead = await readCanonicalRecord(workspaceRoot, sessionId)', canonicalRead, 'Positive self-check must accept canonical record reads.')
assert.doesNotMatch('const record = await readCanonicalRecord(workspaceRoot, sessionId)', canonicalRead, 'Negative self-check must reject the stale binding name.')

console.log('learning record read-repair gate ok')
