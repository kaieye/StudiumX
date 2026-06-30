export type WorkspaceView = 'overview' | 'lessons' | 'resources' | 'review' | 'settings'

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'model'
  | 'generation'
  | 'workspace'
  | 'notifications'
  | 'privacy'
  | 'about'

export type ThemePreference = 'system' | 'light' | 'dark'
export type UiDensity = 'comfortable' | 'compact'
export type LocalePreference = 'zh-CN' | 'en-US'
export type ModelEndpointFormat = 'chat_completions' | 'responses' | 'messages' | 'custom_endpoint'

export type AppCloseAction = 'quit' | 'tray'

export type QuizType = 'single' | 'multi' | 'truefalse' | 'fill'

export const MODEL_ENDPOINT_FORMATS = [
  'chat_completions',
  'responses',
  'messages',
  'custom_endpoint'
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
    baseUrl: 'http://localhost:4000/v1',
    endpointFormat: 'chat_completions',
    models: ['gpt-4.1', 'gpt-4.1-mini'],
    docsUrl: 'https://platform.openai.com/docs',
    apiKeyUrl: 'https://platform.openai.com/api-keys'
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
    requestTimeoutMs: number
  }
  workspace: {
    defaultRoot: string
    confirmBeforeGenerating: boolean
    autoOpenGeneratedLesson: boolean
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
  Omit<TeachingSettingsV1, 'provider' | 'generator' | 'workspace' | 'notifications' | 'privacy' | 'appBehavior' | 'log'>
> & {
  provider?: Partial<Omit<TeachingSettingsV1['provider'], 'proxy'>> & {
    proxy?: Partial<TeachingSettingsV1['provider']['proxy']>
  }
  generator?: Partial<TeachingSettingsV1['generator']>
  workspace?: Partial<TeachingSettingsV1['workspace']>
  notifications?: Partial<TeachingSettingsV1['notifications']>
  privacy?: Partial<TeachingSettingsV1['privacy']>
  appBehavior?: Partial<TeachingSettingsV1['appBehavior']>
  log?: Partial<TeachingSettingsV1['log']>
}

export type PickDirectoryResult = {
  canceled: boolean
  path: string | null
}

export type NotificationPayload = {
  title: string
  body: string
}

export type WorkflowStepState = 'done' | 'active' | 'waiting' | 'error'

export type ResourceSummary = {
  title: string
  detail: string
  tag: string
}

export type LearningRecordSummary = {
  title: string
  date: string
  relativePath: string
  absolutePath: string
}

export type LessonSummary = {
  id: string
  title: string
  objective: string
  prompt: string
  createdAt: string
  durationMinutes: number
  relativePath: string
  absolutePath: string
}

export type TeachingWorkspaceSummary = {
  id: string
  name: string
  rootPath: string
  missionPath: string
  resourcesPath: string
  lessonsDir: string
  recordsDir: string
  referenceDir: string
  reviewsDir: string
  createdAt: string
  updatedAt: string
  missionTitle: string
  missionExcerpt: string
  resources: ResourceSummary[]
  records: LearningRecordSummary[]
  lessons: LessonSummary[]
  referenceCount: number
  assetsReady: boolean
}

export type TeachingRuntimeState = {
  status: 'idle' | 'working' | 'error'
  currentStep: string
  queuedTasks: number
  providerLabel: string
}

export type TeachingAppState = {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspace: TeachingWorkspaceSummary | null
  previewHtml: string
  selectedLessonPath: string | null
  runtime: TeachingRuntimeState
}

export type CreateWorkspacePayload = {
  name: string
  prompt: string
}

export type GenerateLessonPayload = {
  workspaceId: string
  prompt: string
}

export type UpdateMissionPayload = {
  workspaceId: string
  prompt: string
}

export type ReadLessonPayload = {
  workspaceId: string
  lessonPath: string
}

export type ImportWorkspaceResult = {
  canceled: boolean
  state: TeachingAppState | null
}

export type GenerateLessonResult = {
  state: TeachingAppState
  lesson: LessonSummary
  source: 'ai' | 'fallback'
  reason?: string
}

export type OpenPathResult = {
  ok: boolean
  message?: string
}

export type WindowControlAction = 'minimize' | 'toggle-maximize' | 'close'

// ---- Provider probe / upstream model list ----

export type ProbeProviderPayload = {
  baseUrl: string
  apiKey: string
  endpointFormat: ModelEndpointFormat
}

export type ProbeProviderResult =
  | { ok: true; latencyMs: number; modelIds: string[] }
  | { ok: false; message: string }

export type ListUpstreamModelsResult =
  | { ok: true; modelIds: string[] }
  | { ok: false; message: string }

// ---- Streaming lesson generation ----

export type LessonStreamStep = 'calling' | 'streaming' | 'validating' | 'rendering' | 'done' | 'error'

export type LessonStreamChunk = {
  streamId: string
  delta: string
}

export type LessonStreamStatus = {
  streamId: string
  step: LessonStreamStep
  message?: string
}

export type LessonStreamDone =
  | { streamId: string; state: TeachingAppState; lesson: LessonSummary; source: 'ai' | 'fallback'; reason?: string }
  | { streamId: string; error: true; message: string }

export type GenerateLessonStreamPayload = GenerateLessonPayload

// ---- Review cards + progress ----

export type ReviewCard = {
  lessonId: string
  lessonTitle: string
  front: string
  back: string
}

export type ListReviewCardsResult = {
  cards: ReviewCard[]
}

export type QuizResultEntry = {
  lessonId: string
  question: string
  correct: boolean
}

export type RecordProgressPayload = {
  workspaceId: string
  lessonId: string
  results: QuizResultEntry[]
}

export type ProgressSummary = {
  totalAnswered: number
  correct: number
  byLesson: Record<string, { answered: number; correct: number }>
}

export type GetProgressResult = {
  workspaceId: string
  progress: ProgressSummary
}

export type TeachingSystemApi = {
  platform: NodeJS.Platform
  getState: () => Promise<TeachingAppState>
  getSettings: () => Promise<TeachingSettingsV1>
  updateSettings: (patch: TeachingSettingsPatch) => Promise<TeachingSettingsV1>
  selectWorkspace: (workspaceId: string) => Promise<TeachingAppState>
  createWorkspace: (payload: CreateWorkspacePayload) => Promise<TeachingAppState>
  importWorkspace: () => Promise<ImportWorkspaceResult>
  pickDirectory: (defaultPath?: string) => Promise<PickDirectoryResult>
  updateMission: (payload: UpdateMissionPayload) => Promise<TeachingAppState>
  generateLesson: (payload: GenerateLessonPayload) => Promise<GenerateLessonResult>
  readLesson: (payload: ReadLessonPayload) => Promise<{ html: string }>
  openPath: (path: string) => Promise<OpenPathResult>
  openExternal: (url: string) => Promise<OpenPathResult>
  showNotification: (payload: NotificationPayload) => Promise<void>
  controlWindow: (action: WindowControlAction) => Promise<void>
  probeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  listUpstreamModels: (providerId: string) => Promise<ListUpstreamModelsResult>
  generateLessonStream: (
    payload: GenerateLessonStreamPayload,
    onChunk: (chunk: LessonStreamChunk) => void,
    onStatus: (status: LessonStreamStatus) => void
  ) => Promise<LessonStreamDone>
  onLessonStreamChunk: (handler: (chunk: LessonStreamChunk) => void) => () => void
  onLessonStreamStatus: (handler: (status: LessonStreamStatus) => void) => () => void
  listReviewCards: (workspaceId: string) => Promise<ListReviewCardsResult>
  recordProgress: (payload: RecordProgressPayload) => Promise<GetProgressResult>
  getProgress: (workspaceId: string) => Promise<GetProgressResult>
  openLogFile: () => Promise<OpenPathResult>
  openAppDataDir: () => Promise<OpenPathResult>
}
