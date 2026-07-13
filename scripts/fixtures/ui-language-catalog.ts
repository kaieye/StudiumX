import assert from 'node:assert/strict'

import i18n from '../../src/renderer/src/i18n'
import {
  UiLanguageCatalog,
  type UiLanguageDefinition,
  uiLanguageCatalog
} from '../../src/renderer/src/i18n/ui-language-catalog'

const translate = (key: 'general.language.zh' | 'general.language.en') =>
  key === 'general.language.zh' ? '中文' : 'English'

// The ordered catalog is the single source for i18next language configuration.
assert.deepEqual(uiLanguageCatalog.ids, ['zh-CN', 'en-US'])
assert.equal(uiLanguageCatalog.defaultId, 'zh-CN')
assert.equal(uiLanguageCatalog.fallbackId, 'en-US')
assert.deepEqual(
  i18n.options.supportedLngs?.slice(0, uiLanguageCatalog.ids.length),
  uiLanguageCatalog.ids
)
assert.equal(i18n.options.lng, uiLanguageCatalog.defaultId)
assert.deepEqual(i18n.options.fallbackLng, [uiLanguageCatalog.fallbackId])
assert.deepEqual(Object.keys(i18n.options.resources ?? {}), uiLanguageCatalog.ids)
assert.equal(i18n.getResource('zh-CN', 'translation', 'general.language.zh'), '中文')
assert.equal(i18n.getResource('en-US', 'translation', 'general.language.en'), 'English')

// Exact IDs resolve as-is; all unrecognized persisted/runtime values use the established default.
assert.equal(uiLanguageCatalog.isLanguageId('zh-CN'), true)
assert.equal(uiLanguageCatalog.isLanguageId('en-US'), true)
assert.equal(uiLanguageCatalog.isLanguageId('zh'), false)
assert.equal(uiLanguageCatalog.resolve('en-US'), 'en-US')
assert.equal(uiLanguageCatalog.resolve(' EN-US '), 'zh-CN')
assert.equal(uiLanguageCatalog.resolve(undefined), 'zh-CN')

// The catalog, not each caller, selects the localized label key and preserves catalog ordering.
assert.equal(uiLanguageCatalog.label('zh-CN', translate), '中文')
assert.equal(uiLanguageCatalog.label('unknown', translate), '中文')
assert.deepEqual(uiLanguageCatalog.options(translate), [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: 'English' }
])

const validLanguage: UiLanguageDefinition = {
  id: 'zh-CN',
  labelKey: 'general.language.zh'
}
assert.throws(
  () => new UiLanguageCatalog([], 'zh-CN', 'en-US'),
  /requires at least one definition/
)
assert.throws(
  () => new UiLanguageCatalog([validLanguage, validLanguage], 'zh-CN', 'en-US'),
  /duplicate id/
)
assert.throws(
  () => new UiLanguageCatalog([validLanguage], 'en-US', 'zh-CN'),
  /default id .* is not registered/
)
assert.throws(
  () => new UiLanguageCatalog([validLanguage], 'zh-CN', 'en-US'),
  /fallback id .* is not registered/
)
assert.throws(
  () => new UiLanguageCatalog([{ id: '', labelKey: 'general.language.zh' }] as never, 'zh-CN', 'zh-CN'),
  /invalid id/
)
assert.throws(
  () => new UiLanguageCatalog([{ id: 'zh-CN', labelKey: '' }] as never, 'zh-CN', 'zh-CN'),
  /requires a label key/
)

console.log('ui language catalog contract ok')
