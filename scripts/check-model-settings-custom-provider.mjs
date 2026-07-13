import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-model-settings-check-'))
const outfile = join(tempRoot, 'teaching-settings-schema.mjs')

try {
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: [join(process.cwd(), 'src', 'shared', 'teaching-settings-schema.ts')],
    bundle: true,
    format: 'esm',
    outfile,
    platform: 'node',
    logLevel: 'silent'
  })
  const { normalizeTeachingSettings } = await import(pathToFileURL(outfile).href)
  const settings = normalizeTeachingSettings({
    provider: {
      activeProviderId: 'custom',
      providers: [{
        id: 'custom',
        name: '  My custom provider ',
        apiKey: 'provider-secret',
        baseUrl: ' https://models.example.test/v1 ',
        endpointFormat: 'responses',
        models: [' model-a ', 'model-a', 'model-b'],
        docsUrl: 'https://must-not-be-used.test/docs',
        apiKeyUrl: 'https://must-not-be-used.test/key'
      }]
    },
    generator: { providerId: 'custom', model: 'model-b' }
  }, 'C:/StudiumX/workspaces')
  const custom = settings.provider.providers.find((provider) => provider.id === 'custom')

  assert.deepEqual(custom, {
    id: 'custom',
    name: 'My custom provider',
    apiKey: 'provider-secret',
    baseUrl: 'https://models.example.test/v1',
    endpointFormat: 'responses',
    models: ['model-a', 'model-b'],
    docsUrl: '',
    apiKeyUrl: ''
  })
  assert.equal(settings.generator.providerId, 'custom')
  assert.equal(settings.generator.model, 'model-b')
  assert.equal(settings.generator.endpointFormat, 'responses')

  const modelProviderSection = await readFile('src/renderer/src/views/settings/sections/ModelProviderSettingsSection.tsx', 'utf8')
  const modelRowIndex = modelProviderSection.indexOf("label={t('model.models.label')}")
  assert.notEqual(modelRowIndex, -1)
  const modelRowChunk = modelProviderSection.slice(modelRowIndex, modelRowIndex + 1200)
  assert.match(modelRowChunk, /isCustomModelProvider \?/)
  assert.match(modelRowChunk, /<SettingsTextInput/)
  assert.match(modelRowChunk, /<SettingsSelect/)
  assert.match(modelProviderSection, /isCustomModelProvider \|\| !activeModelSettingsProvider\.docsUrl/)
  assert.match(modelProviderSection, /isCustomModelProvider \|\| !activeModelSettingsProvider\.apiKeyUrl/)

  const zh = JSON.parse(await readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8'))
  const en = JSON.parse(await readFile('src/renderer/src/i18n/locales/en-US.json', 'utf8'))
  assert.equal(zh.settingsSection.tools.label, '工具')
  assert.equal(en.settingsSection.tools.label, 'Tools')

  console.log('custom provider model settings ok')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
