import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const teachingTypes = await readFile('src/shared/teaching-types.ts', 'utf8')
assert.match(teachingTypes, /id: 'custom'/)
assert.match(teachingTypes, /baseUrl: ''/)
assert.match(teachingTypes, /models: \[\]/)
assert.match(teachingTypes, /docsUrl: ''/)
assert.match(teachingTypes, /apiKeyUrl: ''/)

const teachingSettings = await readFile('src/main/teaching-settings.ts', 'utf8')
assert.match(teachingSettings, /const isCustomProvider = id === 'custom'/)
assert.match(teachingSettings, /docsUrl: isCustomProvider \? '' : normalizeString\(input\.docsUrl\) \|\| base\.docsUrl/)
assert.match(teachingSettings, /apiKeyUrl: isCustomProvider \? '' : normalizeString\(input\.apiKeyUrl\) \|\| base\.apiKeyUrl/)

const app = await readFile('src/renderer/src/App.tsx', 'utf8')
const modelRowIndex = app.indexOf("label={t('model.models.label')}")

assert.notEqual(modelRowIndex, -1)

const modelRowChunk = app.slice(modelRowIndex, modelRowIndex + 1200)
assert.match(modelRowChunk, /isCustomModelProvider \?/)
assert.match(modelRowChunk, /<SettingsTextInput/)
assert.match(modelRowChunk, /<SettingsSelect/)
assert.match(app, /isCustomModelProvider \|\| !activeModelSettingsProvider\.docsUrl/)
assert.match(app, /isCustomModelProvider \|\| !activeModelSettingsProvider\.apiKeyUrl/)

const zh = JSON.parse(await readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8'))
const en = JSON.parse(await readFile('src/renderer/src/i18n/locales/en-US.json', 'utf8'))

assert.equal(zh.settingsSection.tools.label, '工具')
assert.equal(en.settingsSection.tools.label, 'Tools')

console.log('custom provider model settings ok')
