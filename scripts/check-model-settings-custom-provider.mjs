import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const modelProviderCatalog = await readFile('src/shared/model-provider-catalog.ts', 'utf8')
assert.match(modelProviderCatalog, /id: 'custom'/)
assert.match(modelProviderCatalog, /baseUrl: ''/)
assert.match(modelProviderCatalog, /models: \[\]/)
assert.match(modelProviderCatalog, /docsUrl: ''/)
assert.match(modelProviderCatalog, /apiKeyUrl: ''/)

const teachingSettingsTypes = await readFile('src/shared/teaching-types/settings.ts', 'utf8')
assert.match(teachingSettingsTypes, /TEACHING_MODEL_PROVIDER_PRESETS = TEACHING_MODEL_PROVIDER_PRESETS_FROM_CATALOG/)

const teachingSettings = await readFile('src/main/teaching-settings.ts', 'utf8')
assert.match(teachingSettings, /const isCustomProvider = id === 'custom'/)
assert.match(teachingSettings, /docsUrl: isCustomProvider \? '' : normalizeString\(input\.docsUrl\) \|\| base\.docsUrl/)
assert.match(teachingSettings, /apiKeyUrl: isCustomProvider \? '' : normalizeString\(input\.apiKeyUrl\) \|\| base\.apiKeyUrl/)

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
