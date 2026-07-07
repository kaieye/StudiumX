import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = await mkdtemp(join(tmpdir(), 'provider-format-adapters-check-'))
const outfile = join(tempRoot, 'provider-format-adapters.mjs')

try {
  await build({
    entryPoints: [join(process.cwd(), 'scripts', 'fixtures', 'provider-format-adapters.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  await import(outfile)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
