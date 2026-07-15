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
  | 'workspace'
  | 'worktree'
  | 'memory'
  | 'notifications'
  | 'privacy'
  | 'about'

export type ThemePreference = 'system' | 'light' | 'dark'
export type UiDensity = 'comfortable' | 'compact'
export type LocalePreference = 'zh-CN' | 'en-US'
export type ModelEndpointFormat = 'chat_completions' | 'responses' | 'messages' | 'custom_endpoint'
export type ModelReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type AppCloseAction = 'quit' | 'tray'
export const PET_APPEARANCE_IDS = ['boba', 'lulu-capybara', 'shinchan', 'usagi'] as const
export type PetAppearanceId = (typeof PET_APPEARANCE_IDS)[number]
export const DEFAULT_PET_APPEARANCE_ID: PetAppearanceId = 'boba'

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
export type WorkspaceWritePermissionPolicy =
  | 'allow_for_conversation'
  | 'ask_each_time'
  | 'read_only'

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

export const WORKSPACE_WRITE_PERMISSION_POLICIES = [
  'allow_for_conversation',
  'ask_each_time',
  'read_only'
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

export type TeachingModelProviderProfile = TeachingModelProviderPreset & {
  apiKey: string
}

export type TeachingSettingsV1 = {
  version: 1
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
  tools: {
    enabled: boolean
    workspaceRead: boolean
    workspaceWritePermission: WorkspaceWritePermissionPolicy
    webSearch: boolean
    webFetch: boolean
    maxIterations: number
    runBudget: {
      maxDurationMs: number
      maxProviderCalls: number
      maxToolCalls: number
      maxTotalTokens: number
      warningThreshold: number
    }
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
}

export type TeachingSettingsPatch = Partial<
  Omit<TeachingSettingsV1, 'provider' | 'generator' | 'workspace' | 'worktree' | 'memory' | 'tools' | 'notifications' | 'pet' | 'privacy' | 'appBehavior' | 'log'>
> & {
  provider?: Partial<Omit<TeachingSettingsV1['provider'], 'proxy'>> & {
    proxy?: Partial<TeachingSettingsV1['provider']['proxy']>
  }
  generator?: Partial<TeachingSettingsV1['generator']>
  workspace?: Partial<TeachingSettingsV1['workspace']>
  worktree?: Partial<TeachingSettingsV1['worktree']>
  memory?: Partial<TeachingSettingsV1['memory']>
  tools?: Partial<Omit<TeachingSettingsV1['tools'], 'runBudget'>> & {
    runBudget?: Partial<TeachingSettingsV1['tools']['runBudget']>
  }
  webSearch?: Partial<TeachingSettingsV1['webSearch']>
  notifications?: Partial<TeachingSettingsV1['notifications']>
  pet?: Partial<TeachingSettingsV1['pet']>
  privacy?: Partial<TeachingSettingsV1['privacy']>
  appBehavior?: Partial<TeachingSettingsV1['appBehavior']>
  log?: Partial<TeachingSettingsV1['log']>
}
