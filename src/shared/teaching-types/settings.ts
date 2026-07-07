export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'model'
  | 'generation'
  | 'tools'
  | 'search'
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

export type TeachingModelProviderPreset = {
  id: string
  name: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  models: string[]
  docsUrl: string
  apiKeyUrl: string
}

export const TEACHING_MODEL_PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    endpointFormat: 'chat_completions',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    docsUrl: 'https://api-docs.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys'
  },
  {
    id: 'glm',
    name: 'GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    endpointFormat: 'chat_completions',
    models: ['glm-4.5', 'glm-4.5-air', 'glm-4-flash'],
    docsUrl: 'https://docs.bigmodel.cn',
    apiKeyUrl: 'https://www.bigmodel.cn/usercenter/proj-mgmt/apikeys'
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    endpointFormat: 'chat_completions',
    models: ['mimo-v2.5-pro-ultraspeed', 'mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-omni'],
    docsUrl: 'https://platform.xiaomimimo.com/#/docs',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys'
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    endpointFormat: 'messages',
    models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
    docsUrl: 'https://platform.minimax.io/docs/api-reference/text-anthropic-api',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    endpointFormat: 'messages',
    models: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    docsUrl: 'https://platform.claude.com/docs',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'custom',
    name: 'OpenAI Compatible',
    baseUrl: '',
    endpointFormat: 'chat_completions',
    models: [],
    docsUrl: '',
    apiKeyUrl: ''
  }
] satisfies TeachingModelProviderPreset[]

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
    generateLearningRecord: boolean
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
    webSearch: boolean
    webFetch: boolean
    maxIterations: number
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
  Omit<TeachingSettingsV1, 'provider' | 'generator' | 'workspace' | 'worktree' | 'memory' | 'tools' | 'notifications' | 'privacy' | 'appBehavior' | 'log'>
> & {
  provider?: Partial<Omit<TeachingSettingsV1['provider'], 'proxy'>> & {
    proxy?: Partial<TeachingSettingsV1['provider']['proxy']>
  }
  generator?: Partial<TeachingSettingsV1['generator']>
  workspace?: Partial<TeachingSettingsV1['workspace']>
  worktree?: Partial<TeachingSettingsV1['worktree']>
  memory?: Partial<TeachingSettingsV1['memory']>
  tools?: Partial<TeachingSettingsV1['tools']>
  webSearch?: Partial<TeachingSettingsV1['webSearch']>
  notifications?: Partial<TeachingSettingsV1['notifications']>
  privacy?: Partial<TeachingSettingsV1['privacy']>
  appBehavior?: Partial<TeachingSettingsV1['appBehavior']>
  log?: Partial<TeachingSettingsV1['log']>
}
