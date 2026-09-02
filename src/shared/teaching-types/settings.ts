import {
  TEACHING_MODEL_PROVIDER_PRESETS_FROM_CATALOG
} from '../model-provider-catalog'

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'model'
  | 'generation'
  | 'tools'
  | 'search'
  | 'connectors'
  | 'mcp'
  | 'remote'
  | 'workspace'
  | 'memory'
  | 'notifications'
  | 'privacy'
  | 'doctor'
  | 'review'
  | 'account'
  | 'about'

export type ThemePreference = 'system' | 'light' | 'dark'
export type UiDensity = 'comfortable' | 'compact'
export type LocalePreference = 'zh-CN' | 'en-US'
export type ModelEndpointFormat = 'chat_completions' | 'responses' | 'messages' | 'custom_endpoint'
export type ModelReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type AppCloseAction = 'quit' | 'tray'
export const PET_APPEARANCE_IDS = ['boba', 'lulu-capybara', 'shinchan', 'usagi'] as const
export type PetAppearanceId = (typeof PET_APPEARANCE_IDS)[number]
export const DEFAULT_PET_APPEARANCE_ID: PetAppearanceId = 'lulu-capybara'
/** Canonical default display name for each pet; the pet's default name follows its appearance. */
export const PET_APPEARANCE_DISPLAY_NAMES: Record<PetAppearanceId, string> = {
  boba: 'Boba',
  'lulu-capybara': '噜噜',
  shinchan: 'Shinchan',
  usagi: 'Usagi'
}
export const MIN_PET_SIZE = 80
export const MAX_PET_SIZE = 224
export const DEFAULT_PET_SIZE = 112

const LEGACY_PET_APPEARANCE_IDS: Record<string, PetAppearanceId> = {
  robot: 'boba',
  cat: 'boba',
  owl: 'boba',
  sprout: 'boba',
  fox: 'boba',
  penguin: 'boba',
  classic: 'boba',
  mint: 'boba',
  sunset: 'boba',
  midnight: 'boba',
  berry: 'boba',
  mono: 'boba',
  lulu: 'lulu-capybara'
}

export function normalizePetAppearanceId(
  input: unknown,
  fallback: PetAppearanceId = DEFAULT_PET_APPEARANCE_ID
): PetAppearanceId {
  if (typeof input !== 'string') return fallback
  const normalized = input.trim().toLowerCase()
  if (PET_APPEARANCE_IDS.includes(normalized as PetAppearanceId)) return normalized as PetAppearanceId
  return LEGACY_PET_APPEARANCE_IDS[normalized] ?? fallback
}

export type WebSearchBackend =
  | 'auto'
  | 'firecrawl'
  | 'parallel'
  | 'tavily'
  | 'exa'
  | 'searxng'
  | 'brave'
  | 'ddgs'
  | 'duckduckgo'
  | 'xai'
export type ParallelSearchMode = 'agentic' | 'fast' | 'one-shot'
/** The single Agent permission mode exposed throughout the application. */
/**
 * Agent interactive approval lattice (Codex-aligned, ADR-0015):
 * - request_approval  ↔ Codex untrusted / UnlessTrusted（需批准）
 * - based_on_approval ↔ Codex on-request / OnRequest（按风险）
 * - full_access       ↔ Codex never / Never（本课放行；非 YOLO 标签）
 *
 * Orthogonal to AgentSandboxMode (what FS/network posture allows).
 */
export type AgentApprovalMode =
  | 'request_approval'
  | 'based_on_approval'
  | 'full_access'

import type { AgentSandboxMode, WindowsSandboxLevel } from './agent-sandbox'
export type { WindowsSandboxLevel } from './agent-sandbox'
export type { AgentSandboxMode } from './agent-sandbox'
export { AGENT_SANDBOX_MODES } from './agent-sandbox'

export const MODEL_ENDPOINT_FORMATS = [
  'chat_completions',
  'responses',
  'messages',
  'custom_endpoint'
] as const

export const MODEL_REASONING_EFFORTS = [
  'auto',
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const

export const WEB_SEARCH_BACKENDS = [
  'auto',
  'firecrawl',
  'parallel',
  'tavily',
  'exa',
  'searxng',
  'brave',
  'ddgs',
  'duckduckgo',
  'xai'
] as const

export const PARALLEL_SEARCH_MODES = [
  'agentic',
  'fast',
  'one-shot'
] as const

export const AGENT_APPROVAL_MODES = [
  'request_approval',
  'based_on_approval',
  'full_access'
] as const

export type TeachingModelProviderPreset = {
  id: string
  name: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  models: string[]
  docsUrl: string
  apiKeyUrl: string
}

export const TEACHING_MODEL_PROVIDER_PRESETS = TEACHING_MODEL_PROVIDER_PRESETS_FROM_CATALOG

/** Ordered custom HTTP headers for provider requests (ADR-0006; security boundary: SECURITY.md). */
export type TeachingProviderCustomHeader = {
  name: string
  value: string
}

export type TeachingModelProviderProfile = TeachingModelProviderPreset & {
  apiKey: string
  /**
   * User-configured headers merged after format auth headers.
   * Reserved keys (Authorization, x-api-key, User-Agent, …) are stripped at normalize
   * and again at request build time.
   */
  customHeaders?: TeachingProviderCustomHeader[]
}

export type PetNotificationPreferences = {
  actionableOnly: boolean
  showRunning: boolean
  showReview: boolean
  showWaving: boolean
  sources: {
    agent: boolean
    lessonGeneration: boolean
    lessonReview: boolean
    onboarding: boolean
  }
  quietUntil: number | null
}

// The type name `TeachingSettingsV1` is retained to avoid a wide rename churn;
// the persisted schema marker is now `3` (v3 raised the maxOutputTokens default
// from 4096 to 12800 for new and upgraded installs).
export type TeachingSettingsV1 = {
  version: 3
  locale: LocalePreference
  theme: ThemePreference
  uiFontScale: number
  density: UiDensity
  provider: {
    activeProviderId: string
    providers: TeachingModelProviderProfile[]
    proxy: {
      enabled: boolean
      url: string
    }
  }
  generator: {
    providerId: string
    model: string
    endpointFormat: ModelEndpointFormat
    temperature: number
    maxOutputTokens: number
    lessonDurationMinutes: number
    includeRetrievalPractice: boolean
    generateReference: boolean
    structuredOutput: boolean
    streaming: boolean
    reasoningEffort: ModelReasoningEffort
    requestTimeoutMs: number
  }
  workspace: {
    defaultRoot: string
    confirmBeforeGenerating: boolean
    autoOpenGeneratedLesson: boolean
    showAllCourseFiles: boolean
    lessonStyleId: string
  }
  worktree: {
    rootPath: string
  }
  memory: {
    enabled: boolean
    maxInjected: number
  }
  /**
   * Optional user-owned per-run resource budget (ADR-0010). Disabled by
   * default; when enabled it applies only to newly started runs.
   */
  resourceBudget: {
    enabled: boolean
    providerTransportAttempts: number
    toolOperationAttempts: number
    durationMinutes: number
    totalTokens: number
  }
  tools: {
    /**
     * Legacy persisted/DTO compatibility field. It is always normalized to true;
     * application-level tool availability is no longer a configurable setting.
     */
    enabled: boolean
    workspaceRead: boolean
    approvalMode: AgentApprovalMode
    /**
     * Workspace command / shell tools (Codex-style agent shell).
     * Application-level tool availability is always on; this independent setting
     * defaults to true and explicit false disables shell registration.
     */
    workspaceShell: boolean
    /**
     * Codex SandboxMode dual-axis (ADR-0015):
     * read_only | workspace_write | full_access
     * Orthogonal to approvalMode. UI never labels full_access as YOLO.
     */
    sandboxMode: AgentSandboxMode
    /**
     * Codex WindowsSandboxLevel (config_types.rs).
     * Only meaningful on Windows; ignored elsewhere.
     */
    windowsSandboxLevel: WindowsSandboxLevel
    webSearch: boolean
    webFetch: boolean
  }
  webSearch: {
    backend: WebSearchBackend
    fallbackEnabled: boolean
    maxResults: number
    searxngUrl: string
    braveApiKey: string
    firecrawlApiKey: string
    firecrawlApiUrl: string
    tavilyApiKey: string
    exaApiKey: string
    parallelApiKey: string
    parallelSearchMode: ParallelSearchMode
    xaiApiKey: string
    xaiModel: string
  }
  notifications: {
    enabled: boolean
    lessonGenerated: boolean
    workspaceImported: boolean
    errors: boolean
  }
  pet: {
    enabled: boolean
    displayName: string
    showStatusBubble: boolean
    appearance: PetAppearanceId
    size: number
    notificationPreferences: PetNotificationPreferences
  }
  privacy: {
    maskApiKeys: boolean
    allowExternalLinks: boolean
  }
  appBehavior: {
    openAtLogin: boolean
    startMinimized: boolean
    closeAction: AppCloseAction
    closeToTray: boolean
  }
  log: {
    enabled: boolean
    retentionDays: number
  }
  /**
   * Mobile web remote control (security boundary: SECURITY.md). Default off.
   * `passHash` is secret-storage protected; never put in public status DTOs.
   */
  webRemoteControl: {
    enabled: boolean
    bindMode: 'loopback' | 'lan'
    port: number
    relayMode: 'lan' | 'external'
    externalRelayWsUrl: string
    externalMobileBaseUrl: string
    deviceSid: string
    passHash: string
  }
}

export type TeachingSettingsPatch = Partial<
  Omit<
    TeachingSettingsV1,
    | 'provider'
    | 'generator'
    | 'workspace'
    | 'worktree'
    | 'memory'
    | 'resourceBudget'
    | 'tools'
    | 'notifications'
    | 'pet'
    | 'privacy'
    | 'appBehavior'
    | 'log'
    | 'webRemoteControl'
  >
> & {
  provider?: Partial<Omit<TeachingSettingsV1['provider'], 'proxy'>> & {
    proxy?: Partial<TeachingSettingsV1['provider']['proxy']>
  }
  generator?: Partial<TeachingSettingsV1['generator']>
  workspace?: Partial<TeachingSettingsV1['workspace']>
  worktree?: Partial<TeachingSettingsV1['worktree']>
  memory?: Partial<TeachingSettingsV1['memory']>
  resourceBudget?: Partial<TeachingSettingsV1['resourceBudget']>
  /** Legacy `tools.enabled` patches are accepted for compatibility but normalized to true. */
  tools?: Partial<TeachingSettingsV1['tools']>
  webSearch?: Partial<TeachingSettingsV1['webSearch']>
  notifications?: Partial<TeachingSettingsV1['notifications']>
  pet?: Partial<Omit<TeachingSettingsV1['pet'], 'notificationPreferences'>> & {
    notificationPreferences?: Partial<Omit<PetNotificationPreferences, 'sources'>> & {
      sources?: Partial<PetNotificationPreferences['sources']>
    }
  }
  privacy?: Partial<TeachingSettingsV1['privacy']>
  appBehavior?: Partial<TeachingSettingsV1['appBehavior']>
  log?: Partial<TeachingSettingsV1['log']>
  webRemoteControl?: Partial<TeachingSettingsV1['webRemoteControl']>
}
