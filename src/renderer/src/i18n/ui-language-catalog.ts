import type { LocalePreference } from '../../../shared/teaching-types'

export type UiLanguageId = LocalePreference
export type UiLanguageLabelKey = 'general.language.zh' | 'general.language.en'
export type UiLanguageLabelTranslator = (key: UiLanguageLabelKey) => string

export type UiLanguageDefinition = Readonly<{
  id: UiLanguageId
  labelKey: UiLanguageLabelKey
}>

export type UiLanguageOption = Readonly<{
  value: UiLanguageId
  label: string
}>

/**
 * Ordered UI-language metadata and its resolution policy.
 *
 * Callers supply a persisted/runtime value plus, when rendering, the active
 * translation function. This keeps locale IDs, defaults, ordering, and label
 * key selection in one place while i18next initialization and JSON imports
 * remain adapters outside this module.
 */
export class UiLanguageCatalog {
  private readonly languagesById: ReadonlyMap<UiLanguageId, UiLanguageDefinition>

  readonly languages: readonly UiLanguageDefinition[]
  readonly ids: readonly UiLanguageId[]
  readonly defaultId: UiLanguageId
  readonly fallbackId: UiLanguageId

  constructor(
    languages: readonly UiLanguageDefinition[],
    defaultId: UiLanguageId,
    fallbackId: UiLanguageId
  ) {
    if (languages.length === 0) {
      throw new Error('UI language catalog requires at least one definition.')
    }

    const languagesById = new Map<UiLanguageId, UiLanguageDefinition>()
    for (const language of languages) {
      if (typeof language.id !== 'string' || language.id.length === 0) {
        throw new Error('UI language catalog contains an invalid id.')
      }
      if (typeof language.labelKey !== 'string' || language.labelKey.length === 0) {
        throw new Error(`UI language catalog language "${language.id}" requires a label key.`)
      }
      if (languagesById.has(language.id)) {
        throw new Error(`UI language catalog contains duplicate id "${language.id}".`)
      }
      languagesById.set(language.id, language)
    }

    if (!languagesById.has(defaultId)) {
      throw new Error(`UI language catalog default id "${defaultId}" is not registered.`)
    }
    if (!languagesById.has(fallbackId)) {
      throw new Error(`UI language catalog fallback id "${fallbackId}" is not registered.`)
    }

    this.languages = languages
    this.ids = languages.map((language) => language.id)
    this.defaultId = defaultId
    this.fallbackId = fallbackId
    this.languagesById = languagesById
  }

  isLanguageId(value: unknown): value is UiLanguageId {
    return typeof value === 'string' && this.languagesById.has(value as UiLanguageId)
  }

  resolve(value: unknown): UiLanguageId {
    return this.isLanguageId(value) ? value : this.defaultId
  }

  label(value: unknown, translate: UiLanguageLabelTranslator): string {
    return translate(this.languagesById.get(this.resolve(value))!.labelKey)
  }

  options(translate: UiLanguageLabelTranslator): readonly UiLanguageOption[] {
    return this.languages.map((language) => ({
      value: language.id,
      label: translate(language.labelKey)
    }))
  }
}

const orderedUiLanguages = [
  { id: 'zh-CN', labelKey: 'general.language.zh' },
  { id: 'en-US', labelKey: 'general.language.en' }
] as const satisfies readonly UiLanguageDefinition[]

export const uiLanguageCatalog = new UiLanguageCatalog(orderedUiLanguages, 'zh-CN', 'en-US')
