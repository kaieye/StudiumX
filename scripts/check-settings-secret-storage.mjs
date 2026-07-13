import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const tempParent = join(process.cwd(), '.studiumx')
await mkdir(tempParent, { recursive: true })
const tempRoot = await mkdtemp(join(tempParent, 'settings-secret-storage-check-'))
const outfile = join(tempRoot, 'settings-secret-storage.mjs')

try {
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: [join(process.cwd(), 'scripts', 'fixtures', 'settings-secret-storage.ts')],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent'
  })
  await import(pathToFileURL(outfile).href)

  const schema = await readFile('src/shared/teaching-settings-schema.ts', 'utf8')
  assert.doesNotMatch(schema, /safeStorage:v1:|encryptString|decryptString/)
  const mainSettings = await readFile('src/main/teaching-settings.ts', 'utf8')
  assert.match(mainSettings, /function encodeSettingsSecrets/)
  assert.match(mainSettings, /function decodeSettingsSecrets/)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
