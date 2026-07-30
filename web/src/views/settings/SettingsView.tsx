/**
 * Web Settings view (plan §7.1, §6.3, §9.4).
 *
 * Shows ONLY non-sensitive UI preferences (theme, language, UI density, font
 * scale) plus the "学习分析同步" opt-in (plan §9.4, default OFF) and a
 * "退出登录" action. Preferences are persisted web-locally via the settings
 * adapter (`window.teachingSystem.getSettings` / `updateSettings` ->
 * localStorage). All sensitive config (provider / API keys, MCP, workspace,
 * tools, remote control) is desktop-only and intentionally hidden here.
 *
 * Theme + font-scale are applied app-wide: this module is eagerly imported
 * through the route glob, so the boot-time `applyPrefsToDocument` call runs
 * before first paint; the effect re-applies on every change. Full dark-mode
 * theming of the shell is a future enhancement (App.tsx is read-only); for
 * now `color-scheme` + `data-theme` + root font-size drive native controls
 * and rem-based spacing.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthContext'
import {
  readAnalyticsSync,
  readWebUiPrefs,
  writeAnalyticsSync
} from '../../adapter/features/settings'
import type {
  LocalePreference,
  TeachingSettingsPatch,
  TeachingSettingsV1,
  ThemePreference,
  UiDensity
} from '@shared/teaching-types/settings'

/* ------------------------------------------------------------------ *
 * DOM application (web-local; no server).
 * ------------------------------------------------------------------ */

function resolveEffectiveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme === 'system') {
    const prefersDark =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    return prefersDark ? 'dark' : 'light'
  }
  return theme
}

function applyPrefsToDocument(prefs: { theme?: ThemePreference; uiFontScale?: number }): void {
  if (typeof document === 'undefined') return
  const theme = prefs.theme ?? 'system'
  const effective = resolveEffectiveTheme(theme)
  document.documentElement.style.colorScheme = effective
  document.documentElement.setAttribute('data-theme', effective)
  const scale = prefs.uiFontScale ?? 1
  document.documentElement.style.fontSize = `${Math.round(scale * 100)}%`
}

// Apply persisted prefs app-wide at boot (this module is eagerly imported via
// the route glob, so this runs before first paint). Best-effort.
applyPrefsToDocument(readWebUiPrefs())

/* ------------------------------------------------------------------ *
 * Presentational helpers (web-specific; Tailwind, matching the app shell).
 * ------------------------------------------------------------------ */

function Card({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      <div className="mt-4 divide-y divide-neutral-100">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-neutral-800">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (next: T) => void
  disabled?: boolean
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5"
      role="radiogroup"
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={
              'rounded-md px-3 py-1 text-sm font-medium transition ' +
              (active
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700') +
              (disabled ? ' cursor-not-allowed opacity-60' : '')
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ' +
        (checked ? 'bg-neutral-900' : 'bg-neutral-300')
      }
    >
      <span
        className={
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition ' +
          (checked ? 'translate-x-5' : 'translate-x-0.5')
        }
      />
    </button>
  )
}

const THEME_OPTIONS: readonly SegmentedOption<ThemePreference>[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const DENSITY_OPTIONS: readonly SegmentedOption<UiDensity>[] = [
  { value: 'comfortable', label: '舒适' },
  { value: 'compact', label: '紧凑' }
]

const LOCALE_OPTIONS: readonly SegmentedOption<LocalePreference>[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: 'English' }
]

/* ------------------------------------------------------------------ *
 * View
 * ------------------------------------------------------------------ */

export function SettingsView() {
  const { logout } = useAuth()
  const [settings, setSettings] = useState<TeachingSettingsV1 | null>(null)
  const [analyticsSync, setAnalyticsSyncState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load settings (web-local via the adapter -> localStorage).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await window.teachingSystem.getSettings()
        if (cancelled) return
        setSettings(loaded)
        setAnalyticsSyncState(readAnalyticsSync())
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载设置失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Re-apply theme + font scale whenever settings change.
  useEffect(() => {
    if (settings) applyPrefsToDocument(settings)
  }, [settings])

  const update = useCallback(async (patch: TeachingSettingsPatch) => {
    try {
      const next = await window.teachingSystem.updateSettings(patch)
      setSettings(next)
      applyPrefsToDocument(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存设置失败')
    }
  }, [])

  const toggleAnalyticsSync = useCallback((enabled: boolean) => {
    writeAnalyticsSync(enabled)
    setAnalyticsSyncState(enabled)
  }, [])

  const onLogout = useCallback(() => {
    void logout()
  }, [logout])

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
          正在加载设置…
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-neutral-500">
          界面偏好保存在本地浏览器；敏感配置（模型、密钥、工作区等）为桌面端能力，Web 端不支持。
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setLoading(true)
              void window.teachingSystem.getSettings().then((s) => {
                setSettings(s)
                setAnalyticsSyncState(readAnalyticsSync())
                setLoading(false)
              })
            }}
            className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            重试
          </button>
        </div>
      )}

      {settings && (
        <div className="flex flex-col gap-6">
          <Card title="外观" description="主题、密度与字号仅影响 Web 端显示。">
            <Row label="主题" hint="深色模式完整适配将在后续完善。">
              <Segmented
                value={settings.theme}
                options={THEME_OPTIONS}
                onChange={(theme) => void update({ theme })}
              />
            </Row>
            <Row label="界面密度">
              <Segmented
                value={settings.density}
                options={DENSITY_OPTIONS}
                onChange={(density) => void update({ density })}
              />
            </Row>
            <Row label="字号" hint={`${Math.round(settings.uiFontScale * 100)}%`}>
              <input
                type="range"
                min={0.8}
                max={1.2}
                step={0.05}
                value={settings.uiFontScale}
                onChange={(e) => void update({ uiFontScale: parseFloat(e.target.value) })}
                className="w-44 accent-neutral-900"
                aria-label="字号"
              />
            </Row>
          </Card>

          <Card title="语言">
            <Row label="界面语言">
              <Segmented
                value={settings.locale}
                options={LOCALE_OPTIONS}
                onChange={(locale) => void update({ locale })}
              />
            </Row>
          </Card>

          <Card
            title="隐私与同步"
            description="学习分析数据默认不上传；开启即表示你同意将派生摘要同步至服务端。"
          >
            <Row
              label="学习分析同步"
              hint="默认关闭。服务端目前对上传默认拦截，开启后将在具备按用户开关时生效。"
            >
              <Toggle
                checked={analyticsSync}
                onChange={toggleAnalyticsSync}
                label="学习分析同步"
              />
            </Row>
          </Card>

          <Card title="账户">
            <Row label="退出登录" hint="清除本地登录态并返回登录页。">
              <button
                type="button"
                onClick={onLogout}
                className="rounded-md border border-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
              >
                退出登录
              </button>
            </Row>
          </Card>
        </div>
      )}
    </main>
  )
}
