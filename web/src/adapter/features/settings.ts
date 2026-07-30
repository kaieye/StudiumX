/**
 * Web adapter for Settings (plan §7.1, §6.3, §9.4).
 *
 * Implements `getSettings` / `updateSettings` against **web-local
 * localStorage** (NOT the server) for NON-SENSITIVE UI preferences only:
 * `locale`, `theme`, `uiFontScale`, `density`. Sensitive sections of
 * `TeachingSettingsV1` (provider / API keys, generator, workspace, tools,
 * web-search keys, MCP, remote control, …) are intentionally NOT supported
 * on Web (plan §7.2, AGENTS.md red lines): they are returned at safe
 * defaults (empty API keys, disabled) and any patch targeting them is
 * silently dropped.
 *
 * The "学习分析同步" opt-in (plan §9.4 / Server §5.4 red line: analytics
 * upload default OFF) is a web-local boolean preference exposed via
 * `readAnalyticsSync` / `writeAnalyticsSync`. The Web app never auto-uploads
 * derived analytics summaries; this flag records the user's consent and may
 * gate future manual uploads or a server-side per-user opt-in.
 *
 * Auth tokens (`studiumx.accessToken` / `studiumx.refreshToken`) are NEVER
 * touched here; all storage is under a separate `studiumx.web.*` namespace.
 */

import type { TeachingSystemApi } from '@shared/teaching-types/system-api'
import type {
  LocalePreference,
  TeachingSettingsPatch,
  TeachingSettingsV1,
  ThemePreference,
  UiDensity
} from '@shared/teaching-types/settings'
import {
  createTeachingSettingsDefaults,
  normalizeTeachingSettings
} from '@shared/teaching-settings-schema'

/** localStorage key for the non-sensitive UI-prefs blob (web-local). */
const UI_PREFS_KEY = 'studiumx.web.settings'
/** localStorage key for the analytics-sync opt-in (web-local, default OFF). */
const ANALYTICS_SYNC_KEY = 'studiumx.web.analyticsSync'

/** The non-sensitive UI prefs persisted on Web (a subset of TeachingSettingsV1). */
export interface WebUiPrefs {
  locale?: LocalePreference
  theme?: ThemePreference
  uiFontScale?: number
  density?: UiDensity
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

/**
 * Read only the 4 non-sensitive UI prefs from localStorage. Each field is
 * validated here so a tampered blob can never carry an unexpected value
 * forward; `normalizeTeachingSettings` validates again as a backstop.
 */
function readUiPrefs(): WebUiPrefs {
  if (!storageAvailable()) return {}
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const record = parsed as Record<string, unknown>
    const prefs: WebUiPrefs = {}
    if (record.locale === 'zh-CN' || record.locale === 'en-US') prefs.locale = record.locale
    if (record.theme === 'system' || record.theme === 'light' || record.theme === 'dark') {
      prefs.theme = record.theme
    }
    if (typeof record.uiFontScale === 'number' && Number.isFinite(record.uiFontScale)) {
      prefs.uiFontScale = record.uiFontScale
    }
    if (record.density === 'comfortable' || record.density === 'compact') {
      prefs.density = record.density
    }
    return prefs
  } catch {
    return {}
  }
}

function writeUiPrefs(prefs: WebUiPrefs): void {
  if (!storageAvailable()) return
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* quota / private mode: best-effort, ignore */
  }
}

/**
 * Build a full `TeachingSettingsV1` whose non-sensitive UI prefs come from
 * localStorage and whose sensitive sections are safe defaults. Only the 4
 * UI fields can override the defaults (so a tampered blob can never inject a
 * provider / API key); `normalizeTeachingSettings` then validates every field
 * with per-field fallback to defaults.
 */
function buildSettings(): TeachingSettingsV1 {
  const prefs = readUiPrefs()
  const base = createTeachingSettingsDefaults('')
  const candidate: TeachingSettingsV1 = {
    ...base,
    locale: prefs.locale ?? base.locale,
    theme: prefs.theme ?? base.theme,
    uiFontScale: prefs.uiFontScale ?? base.uiFontScale,
    density: prefs.density ?? base.density
  }
  return normalizeTeachingSettings(candidate, '')
}

/** Extract only the non-sensitive UI prefs from a patch (sensitive fields dropped). */
function extractUiPrefs(patch: TeachingSettingsPatch): WebUiPrefs {
  const prefs: WebUiPrefs = {}
  if (patch.locale !== undefined) prefs.locale = patch.locale
  if (patch.theme !== undefined) prefs.theme = patch.theme
  if (patch.uiFontScale !== undefined) prefs.uiFontScale = patch.uiFontScale
  if (patch.density !== undefined) prefs.density = patch.density
  return prefs
}

export const feature: Partial<TeachingSystemApi> = {
  /**
   * Returns the full settings document. Non-sensitive UI prefs come from web
   * localStorage; sensitive sections are safe defaults (not supported on Web).
   * No server call (plan §7.1: 设置 = Web localStorage).
   */
  async getSettings(): Promise<TeachingSettingsV1> {
    return buildSettings()
  },

  /**
   * Persists only the non-sensitive UI prefs in `patch` to web localStorage
   * and returns the rebuilt full document. Patches targeting sensitive
   * sections (provider / keys, generator, workspace, tools, MCP, …) are
   * intentionally ignored (not supported on Web). No server call.
   */
  async updateSettings(patch: TeachingSettingsPatch): Promise<TeachingSettingsV1> {
    const next: WebUiPrefs = { ...readUiPrefs(), ...extractUiPrefs(patch) }
    writeUiPrefs(next)
    return buildSettings()
  }
}

/* ------------------------------------------------------------------ *
 * Web-local helpers (NOT part of TeachingSystemApi).
 * ------------------------------------------------------------------ */

/**
 * Synchronous snapshot of the persisted non-sensitive UI prefs, for views
 * that need to apply preferences before the first async `getSettings()`
 * resolves (e.g. apply theme / font-scale at boot). Always web-local.
 */
export function readWebUiPrefs(): WebUiPrefs {
  return readUiPrefs()
}

/**
 * Analytics-sync opt-in (plan §9.4). Web-local boolean, default OFF. The Web
 * app never auto-uploads derived summaries; this records the user's consent
 * and may gate future manual uploads or a server-side per-user opt-in.
 */
export function readAnalyticsSync(): boolean {
  if (!storageAvailable()) return false
  try {
    return localStorage.getItem(ANALYTICS_SYNC_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the analytics-sync opt-in (web-local). */
export function writeAnalyticsSync(enabled: boolean): void {
  if (!storageAvailable()) return
  try {
    localStorage.setItem(ANALYTICS_SYNC_KEY, enabled ? '1' : '0')
  } catch {
    /* best-effort */
  }
}
