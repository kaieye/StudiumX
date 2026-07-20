import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')

const shared = await readFile(resolve(root, 'src/shared/teaching-types/context-projection-report.ts'), 'utf8')
const builder = await readFile(resolve(root, 'src/main/ai/context-projection-report.ts'), 'utf8')
const assembler = await readFile(resolve(root, 'src/main/teaching-context-assembler.ts'), 'utf8')
const projector = await readFile(resolve(root, 'src/main/ai/request-context-projection.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/context-projection-report.unit.test.ts'), 'utf8')

assert.match(shared, /export type ContextProjectionReport/, 'Shared contract must export ContextProjectionReport.')
assert.match(shared, /included:/, 'Report must include included items.')
assert.match(shared, /omitted:/, 'Report must include omitted items.')
assert.match(shared, /truncation:/, 'Report must include truncation.')
assert.match(shared, /budget:/, 'Report must include budget.')
assert.match(shared, /provenance:/, 'Report must include provenance.')
assert.match(shared, /fingerprint:/, 'Report must include fingerprint.')

assert.match(builder, /export function buildTeachingContextProjectionReport/, 'Teaching report builder seam required.')
assert.match(builder, /export function buildRequestContextProjectionReport/, 'Request report builder seam required.')
assert.match(builder, /export function fingerprintProjectionReport/, 'Fingerprint helper required.')
assert.match(builder, /assertProjectionReportRedacted/, 'Redaction assertion required.')
assert.match(builder, /createHash\('sha256'\)/, 'Fingerprint must use sha256.')

assert.match(assembler, /projectionReport:\s*buildTeachingContextProjectionReport/, 'Assembler must emit projectionReport.')
assert.match(assembler, /projectionReport:\s*ContextProjectionReport/, 'Assembly type must carry projectionReport.')

assert.match(projector, /report:\s*ContextProjectionReport/, 'Request projection must carry report.')
assert.match(projector, /buildRequestContextProjectionReport/, 'Projector must build report.')

assert.doesNotMatch(
  `${shared}\n${builder}`,
  /\b(?:learnerAnswer|rawEvidenceText|assessmentPayload|providerResponse|selectedOptionIds)\s*:/,
  'Projection report contracts must not declare raw learner/provider payload fields.'
)

assert.match(unit, /same fingerprint for identical teaching facts/, 'Unit coverage must retain fingerprint determinism.')
assert.match(unit, /never records raw resource text/, 'Unit coverage must retain redaction behavior.')
assert.match(unit, /over-budget omissions as diagnosable reasons/, 'Unit coverage must retain budget diagnosis.')

// Runtime: fingerprint determinism + redaction on both builders.
const tempParent = join(root, '.studiumx')
await mkdir(tempParent, { recursive: true })
const tempRoot = await mkdtemp(join(tempParent, 'context-projection-report-check-'))
const outfile = join(tempRoot, 'context-projection-report.mjs')

try {
  await build({
    absWorkingDir: root,
    entryPoints: [join(root, 'scripts', 'fixtures', 'context-projection-report.ts')],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent'
  })
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

console.log('context projection report gate ok')

