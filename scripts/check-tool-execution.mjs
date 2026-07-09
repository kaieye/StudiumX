import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const tempRoot = await mkdtemp(join(tmpdir(), 'tool-execution-check-'))
const outfile = join(tempRoot, 'tool-execution.mjs')

try {
  await build({
    entryPoints: [join(process.cwd(), 'scripts', 'fixtures', 'tool-execution.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
