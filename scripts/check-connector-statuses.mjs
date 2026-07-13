import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const tempRoot = await mkdtemp(join(tmpdir(), 'connector-statuses-check-'))
const fixtureEntry = join(process.cwd(), 'scripts', 'fixtures', 'connector-statuses.ts')
const outfile = join(tempRoot, 'connector-statuses.cjs')

try {
  await build({
    entryPoints: [fixtureEntry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent'
  })
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
