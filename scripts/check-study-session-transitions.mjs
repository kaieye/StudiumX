import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = await mkdtemp(join(tmpdir(), 'study-session-transitions-check-'))
const outfile = join(tempRoot, 'study-session-transitions.mjs')

try {
  await build({
    entryPoints: [join(process.cwd(), 'scripts', 'fixtures', 'study-session-transitions.ts')],
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
