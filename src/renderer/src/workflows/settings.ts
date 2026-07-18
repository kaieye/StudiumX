import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  Bot,
  BrainCircuit,
  FolderOpen,
  GitBranch,
  Info,
  Lock,
  Palette,
  Plug,
  Search,
  Settings,
  SlidersHorizontal,
  Wrench
} from 'lucide-react'
import i18n from '../i18n'
import {
  createTeachingSettingsDefaults,
  normalizeTeachingSettings
} from '../../../shared/teaching-settings-schema'
import {
  modelReasoningEffortsForProviderModel
} from '../../../shared/model-provider-catalog'
import {
  PARALLEL_SEARCH_MODES,
  WEB_SEARCH_BACKENDS,
  AGENT_APPROVAL_MODES,
  type ModelReasoningEffort,
  type SettingsSection,
  type TeachingModelProviderProfile,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type WebSearchBackend,
  type AgentApprovalMode
} from '../../../shared/teaching-types'
import {
  modelListProbeSupportedForFormat,
  toolsSupportedForFormat
} from '../../../shared/provider-format'

export const emptySettings = createTeachingSettingsDefaults('')

/** Renderer compatibility wrapper over the shared schema. */
export function normalizeRendererSettings(input: TeachingSettingsPatch | TeachingSettingsV1 | null | undefined): TeachingSettingsV1 {
  return normalizeTeachingSettings(input, '')
}

export const settingsNavItems = [
  { id: 'general', icon: Settings },
  { id: 'appearance', icon: Palette },
  { id: 'model', icon: Bot },
  { id: 'generation', icon: SlidersHorizontal },
  { id: 'tools', icon: Wrench },
  { id: 'search', icon: Search },
  { id: 'connectors', icon: Plug },
  { id: 'workspace', icon: FolderOpen },
  { id: 'worktree', icon: GitBranch },
  { id: 'memory', icon: BrainCircuit },
  { id: 'notifications', icon: Bell },
  { id: 'privacy', icon: Lock },
  { id: 'about', icon: Info }
] satisfies Array<{ id: SettingsSection; icon: LucideIcon }>

export const webSearchBackendOptions = WEB_SEARCH_BACKENDS
  .filter((backend) => backend !== 'duckduckgo')
  .map((backend) => ({ value: backend, label: webSearchBackendLabel(backend) }))

export const parallelSearchModeOptions = PARALLEL_SEARCH_MODES.map((mode) => ({
  value: mode,
  label: mode
}))

export const agentApprovalModeOptions = AGENT_APPROVAL_MODES.map((mode) => ({
  value: mode,
  label: agentApprovalModeLabel(mode)
}))

export const modelSettingsProviderIds = ['deepseek', 'glm', 'custom'] as const

export function webSearchBackendLabel(backend: WebSearchBackend): string {
  switch (backend) {
    case 'auto':
      return 'Auto'
    case 'firecrawl':
      return 'Firecrawl'
    case 'parallel':
      return 'Parallel'
    case 'tavily':
      return 'Tavily'
    case 'exa':
      return 'Exa'
    case 'searxng':
      return 'SearXNG'
    case 'brave':
      return 'Brave Search'
    case 'ddgs':
    case 'duckduckgo':
      return 'DDGS / DuckDuckGo'
    case 'xai':
      return 'xAI Grok'
  }
}

export function agentApprovalModeLabel(mode: AgentApprovalMode): string {
  switch (mode) {
    case 'request_approval':
      return '请求批准'
    case 'based_on_approval':
      return '基于审批'
    case 'full_access':
      return '完全访问权限'
  }
}

export const DARK_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'
type ResolvedTheme = 'light' | 'dark'

export function activeModelProvider(settings: TeachingSettingsV1): TeachingModelProviderProfile {
  const provider =
    settings.provider.providers.find((item) => item.id === settings.generator.providerId) ??
    settings.provider.providers.find((item) => item.id === settings.provider.activeProviderId) ??
    settings.provider.providers[0]
  return provider
}

export function runtimeProviderLabel(settings: TeachingSettingsV1): string {
  const provider = activeModelProvider(settings)
  const model = settings.generator.model || i18n.t('common.auto')
  return `${provider?.name ?? i18n.t('common.modelProvider')} · ${model}`
}

export function toolsSupportedForSettings(settings: TeachingSettingsV1): boolean {
  return toolsSupportedForFormat(settings.generator.endpointFormat)
}

export function modelListProbeSupportedForProvider(provider: TeachingModelProviderProfile): boolean {
  return modelListProbeSupportedForFormat(provider.endpointFormat)
}

function providerHost(provider: TeachingModelProviderProfile): string {
  try {
    return new URL(provider.baseUrl).hostname.toLowerCase()
  } catch {
    return provider.baseUrl.toLowerCase()
  }
}

function isDeepSeekReasoningProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  const host = providerHost(provider)
  return provider.id === 'deepseek' || host.includes('deepseek.com') || /^deepseek[-_.]/i.test(model)
}

function isClaudeReasoningProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  return provider.id === 'anthropic' || /^claude-(opus|sonnet|haiku|fable|mythos)/i.test(model)
}

function isMiniMaxOpenAiProvider(provider: TeachingModelProviderProfile): boolean {
  const host = providerHost(provider)
  return host.includes('minimaxi.com') && !provider.baseUrl.toLowerCase().includes('/anthropic')
}

function supportsOpenAiReasoningEffort(provider: TeachingModelProviderProfile, model: string): boolean {
  const host = providerHost(provider)
  return (
    provider.id === 'custom' ||
    provider.id === 'xiaomi' ||
    host.includes('openai.com') ||
    host.includes('xiaomimimo.com') ||
    /^mimo[-_.]/i.test(model) ||
    /^o\d/i.test(model) ||
    /^gpt-5/i.test(model)
  )
}

export function reasoningEffortOptionsForSettings(settings: TeachingSettingsV1): ModelReasoningEffort[] {
  const provider = activeModelProvider(settings)
  const model = settings.generator.model
  const catalogOptions = modelReasoningEffortsForProviderModel({
    providerId: provider.id,
    providerBaseUrl: provider.baseUrl,
    modelId: model
  })
  if (catalogOptions) return catalogOptions
  if (isDeepSeekReasoningProvider(provider, model)) return ['auto', 'high', 'max']
  if (isClaudeReasoningProvider(provider, model)) return ['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max']
  if (isMiniMaxOpenAiProvider(provider)) return ['auto', 'off', 'high']
  if (supportsOpenAiReasoningEffort(provider, model)) return ['auto', 'off', 'low', 'medium', 'high']
  return ['auto']
}

export function selectedReasoningEffort(settings: TeachingSettingsV1): ModelReasoningEffort {
  const value = settings.generator.reasoningEffort ?? 'auto'
  return reasoningEffortOptionsForSettings(settings).includes(value) ? value : 'auto'
}

export function reasoningEffortLabel(effort: ModelReasoningEffort): string {
  return i18n.t(`reasoning.effort.${effort}`)
}

export function reasoningEffortDescription(effort: ModelReasoningEffort): string {
  return i18n.t(`reasoning.description.${effort}`)
}

function systemThemePreference(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia(DARK_THEME_MEDIA_QUERY).matches ? 'dark' : 'light'
}

function resolveThemePreference(theme: TeachingSettingsV1['theme']): ResolvedTheme {
  return theme === 'system' ? systemThemePreference() : theme
}

export function applySettingsSideEffects(settings: TeachingSettingsV1): void {
  const root = document.documentElement
  const resolvedTheme = resolveThemePreference(settings.theme)
  root.dataset.theme = settings.theme
  root.dataset.resolvedTheme = resolvedTheme
  root.dataset.density = settings.density
  root.style.fontSize = `${settings.uiFontScale * 100}%`
  root.style.colorScheme = resolvedTheme
  void i18n.changeLanguage(settings.locale)
}
