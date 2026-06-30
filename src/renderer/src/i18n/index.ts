import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

/**
 * Internationalization entry. Resources are bundled statically (no backend,
 * no Suspense). The active language is driven by `settings.locale`, which is
 * pushed into i18n via `i18n.changeLanguage()` from `applySettingsSideEffects`
 * in App.tsx — so loading, updating, and startup all stay in sync.
 *
 * Module-level code (e.g. `toUserError`, `runtimeProviderLabel`) imports this
 * default export and calls `i18n.t(key, vars)` directly; React components use
 * the `useTranslation()` hook so they re-render on language change.
 */
void i18n.use(initReactI18next).init({
  fallbackLng: 'en-US',
  supportedLngs: ['zh-CN', 'en-US'],
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS }
  },
  interpolation: { escapeValue: false },
  returnNull: false
})

export default i18n
