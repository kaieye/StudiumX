import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const tempParent = join(process.cwd(), '.teachos')
await mkdir(tempParent, { recursive: true })
const tempRoot = await mkdtemp(join(tempParent, 'concept-overview-check-'))
const outfile = join(tempRoot, 'concept-overview-lesson.mjs')

try {
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: [join(process.cwd(), 'scripts', 'fixtures', 'concept-overview-lesson.ts')],
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
