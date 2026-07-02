export type WorkspaceView = 'overview' | 'lessons' | 'agent' | 'resources' | 'review' | 'settings'

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'model'
  | 'generation'
  | 'tools'
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

export type QuizType = 'single' | 'multi' | 'truefalse' | 'fill'
export type TeachingMemoryScope = 'user' | 'workspace' | 'project'
export type AgentChatMode = 'temporary' | 'teaching'

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

export type WorkspaceFileNode = {
  name: string
  kind: 'directory' | 'file'
  relativePath: string
  absolutePath: string
  children?: WorkspaceFileNode[]
  truncated?: boolean
  pinned?: boolean
}

export type AgentConversationSummary = {
  id: string
  workspaceId?: string
  title: string
  createdAt: string
  updatedAt: string
  relativePath: string
  absolutePath: string
  messageCount: number
  pinned?: boolean
}

export type LessonSummary = {
  id: string
  title: string
  objective: string
  prompt: string
  createdAt: string
  durationMinutes: number
  courseId: string
  courseName: string
  courseRelativePath: string
  courseAbsolutePath: string
  sessionId: string
  sessionName: string
  sessionRelativePath: string
  sessionAbsolutePath: string
  relativePath: string
  absolutePath: string
  pinned?: boolean
}

export type TeachingSessionSummary = {
  id: string
  name: string
  relativePath: string
  absolutePath: string
  lesson: LessonSummary
}

export type TeachingCourseSummary = {
  id: string
  name: string
  relativePath: string
  absolutePath: string
  lessonCount: number
  sessionCount: number
  sessions: TeachingSessionSummary[]
  conversations: AgentConversationSummary[]
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
  pinned?: boolean
  missionTitle: string
  missionExcerpt: string
  courses: TeachingCourseSummary[]
  fileTree: WorkspaceFileNode[]
  conversations: AgentConversationSummary[]
  resources: ResourceSummary[]
  records: LearningRecordSummary[]
  lessons: LessonSummary[]
  referenceCount: number
  assetsReady: boolean
  git: TeachingGitWorkspaceInfo | null
}

export type TeachingGitWorkspaceInfo = {
  repositoryRoot: string
  primaryWorktreePath: string
  currentBranch: string | null
  isWorktree: boolean
}

export type TeachingGitWorktreeRow = {
  path: string
  branch: string | null
  head: string
  isPrimary: boolean
  isManaged: boolean
  createdAt: string | null
}

export type TeachingGitWorktreesResult =
  | {
      ok: true
      repositoryRoot: string
      primaryWorktreePath: string
      worktreeRoot: string
      worktrees: TeachingGitWorktreeRow[]
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type RemoveTeachingGitWorktreePayload = {
  workspaceRoot: string
  worktreePath: string
}

export type TeachingGitBranchRow = {
  name: string
  current: boolean
  /**
   * Absolute path of another worktree that already has this branch checked
   * out. Git only allows a branch to live in one worktree at a time, so when
   * this is set an in-place `git switch` would fail. Unset when the branch is
   * free to be checked out in the current workspace.
   */
  worktreePath?: string
  /** True when {@link worktreePath} is the repository's primary (main) worktree. */
  worktreePrimary?: boolean
}

export type TeachingGitBranchesResult =
  | {
      ok: true
      repositoryRoot: string
      /** Absolute path of the repository's primary (main) worktree. */
      primaryRepositoryRoot: string
      currentBranch: string | null
      branches: TeachingGitBranchRow[]
      dirtyCount: number
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type GitBranchPayload = {
  workspaceRoot: string
  branch: string
}

export type TeachingMemoryRecord = {
  id: string
  content: string
  scope: TeachingMemoryScope
  workspace?: string
  project?: string
  sourceLessonId?: string
  tags: string[]
  confidence: number
  createdAt: string
  updatedAt: string
  disabledAt?: string
  deletedAt?: string
}

export type TeachingMemoryDiagnostics = {
  enabled: boolean
  rootDir: string
  activeCount: number
  tombstoneCount: number
  lastInjectedIds: string[]
}

export type CreateTeachingMemoryPayload = {
  content: string
  scope: TeachingMemoryScope
  tags?: string[]
  confidence?: number
  workspaceRoot?: string
}

export type UpdateTeachingMemoryPayload = {
  content?: string
  tags?: string[]
  confidence?: number
  disabled?: boolean
  workspaceRoot?: string
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
  temporaryConversations: AgentConversationSummary[]
  previewHtml: string
  previewUrl: string
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
  courseName?: string
  messages?: AgentChatMessage[]
}

export type TeachingWorkflowStage = 'clarifying' | 'ready'

export type TeachingClarificationResult = {
  stage: TeachingWorkflowStage
  assistantMessage: string
  summary: string
  learnerProfile: string[]
  learningGoals: string[]
  openQuestions: string[]
  lessonPrompt: string
  missingSignals: Array<'topic' | 'background' | 'goal' | 'constraints' | 'firstAction'>
}

export type TeachingMemoryCaptureResult = {
  action: 'created' | 'requested_consent' | 'approved' | 'rejected' | 'none'
  candidateContent?: string
  memoryId?: string
}

export type UpdateMissionPayload = {
  workspaceId: string
  prompt: string
}

export type ReadLessonPayload = {
  workspaceId: string
  lessonPath: string
}

export type ReadLessonResult = {
  html: string
  url: string
}

export type ImportWorkspaceResult = {
  canceled: boolean
  state: TeachingAppState | null
}

export type GenerateLessonResult =
  | {
      kind: 'lesson'
      state: TeachingAppState
      lesson: LessonSummary
      source: 'ai' | 'fallback'
      reason?: string
    }
  | {
      kind: 'clarification'
      state: TeachingAppState
      clarification: TeachingClarificationResult
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
  | { streamId: string; kind: 'lesson'; state: TeachingAppState; lesson: LessonSummary; source: 'ai' | 'fallback'; reason?: string }
  | { streamId: string; kind: 'clarification'; state: TeachingAppState; clarification: TeachingClarificationResult }
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

// ---- Agent tool-calling chat ----

export type AgentChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type AgentChatToolCall = {
  id: string
  name: string
  arguments: string
}

export type AgentChatMessage = {
  role: AgentChatRole
  content: string | null
  toolCalls?: AgentChatToolCall[]
  toolCallId?: string
}

export type AgentChatToolCallView = {
  id: string
  name: string
  arguments: string
  result?: string
  isError?: boolean
}

export type AgentChatProcessEvent = {
  id: string
  kind: 'status' | 'tool_call' | 'tool_result'
  title: string
  detail?: string
  status?: AgentLoopStatus
  toolCallId?: string
  toolName?: string
  isError?: boolean
  createdAt: string
}

export type AgentChatTurn = {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: AgentChatToolCallView[]
  processEvents?: AgentChatProcessEvent[]
  createdAt: string
}

export type AgentLoopStatus =
  | 'thinking'
  | 'tool_running'
  | 'tool_done'
  | 'answering'
  | 'done'
  | 'canceled'
  | 'error'

export type AgentChatStreamPayload = {
  streamId?: string
  workspaceId?: string
  mode?: AgentChatMode
  messages: AgentChatMessage[]
  userInput: string
}

export type AgentChatStreamChunk = {
  streamId: string
  delta: string
}

export type AgentChatStreamStatus = {
  streamId: string
  status: AgentLoopStatus
  message?: string
}

export type AgentChatStreamToolEvent = {
  streamId: string
  toolCall: { id: string; name: string; arguments: string }
  result?: string
  isError?: boolean
}

export type AgentChatStreamDone =
  | {
      streamId: string
      turns: AgentChatTurn[]
      finalText: string
      iterations: number
      toolsSupported: boolean
      degradedReason?: string
      teachingAssessment?: TeachingClarificationResult
      memoryCapture?: TeachingMemoryCaptureResult
    }
  | { streamId: string; canceled: true }
  | { streamId: string; error: true; message: string }

/** The non-streamId portion of {@link AgentChatStreamDone}, as a clean
 *  discriminated union (avoids Omit-over-union narrowing quirks). */
export type AgentChatStreamResult =
  | {
      turns: AgentChatTurn[]
      finalText: string
      iterations: number
      toolsSupported: boolean
      degradedReason?: string
      teachingAssessment?: TeachingClarificationResult
      memoryCapture?: TeachingMemoryCaptureResult
    }
  | { canceled: true }
  | { error: true; message: string }

export type AgentConversationRecord = AgentConversationSummary & {
  turns: AgentChatTurn[]
}

export type SaveAgentConversationPayload = {
  workspaceId: string
  mode?: AgentChatMode
  conversationId?: string | null
  selectedLessonPath?: string | null
  selectedCourseRelativePath?: string | null
  courseName?: string
  turns: AgentChatTurn[]
}

export type SaveAgentConversationResult = {
  state: TeachingAppState
  conversation: AgentConversationSummary
}

export type ReadAgentConversationPayload = {
  workspaceId: string
  conversationId: string
}

export type WorkspaceItemKind = 'conversation' | 'file' | 'directory'
export type WorkspaceItemRemoveMode = 'list' | 'disk'

export type WorkspaceItemMetaPayload = {
  workspaceId: string
  relativePath: string
  /** null 清除该标志，省略则不变。 */
  pinned?: boolean | null
  archived?: boolean | null
}

export type WorkspaceItemRemovePayload = {
  workspaceId: string
  relativePath: string
  kind: WorkspaceItemKind
  mode?: WorkspaceItemRemoveMode
}

export type WorkspaceRemovePayload = {
  workspaceId: string
  mode?: WorkspaceItemRemoveMode
}

export type TeachingSystemApi = {
  platform: NodeJS.Platform
  getState: () => Promise<TeachingAppState>
  getSettings: () => Promise<TeachingSettingsV1>
  updateSettings: (patch: TeachingSettingsPatch) => Promise<TeachingSettingsV1>
  selectWorkspace: (workspaceId: string) => Promise<TeachingAppState>
  createWorkspace: (payload: CreateWorkspacePayload) => Promise<TeachingAppState>
  importWorkspace: () => Promise<ImportWorkspaceResult>
  importWorkspacePath: (rootPath: string) => Promise<TeachingAppState>
  pickDirectory: (defaultPath?: string) => Promise<PickDirectoryResult>
  openImportLocation: (path?: string) => Promise<OpenPathResult>
  updateMission: (payload: UpdateMissionPayload) => Promise<TeachingAppState>
  generateLesson: (payload: GenerateLessonPayload) => Promise<GenerateLessonResult>
  readLesson: (payload: ReadLessonPayload) => Promise<ReadLessonResult>
  openPath: (path: string) => Promise<OpenPathResult>
  openExternal: (url: string) => Promise<OpenPathResult>
  showNotification: (payload: NotificationPayload) => Promise<void>
  controlWindow: (action: WindowControlAction) => Promise<void>
  probeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  listUpstreamModels: (payload: ProbeProviderPayload) => Promise<ListUpstreamModelsResult>
  generateLessonStream: (
    payload: GenerateLessonStreamPayload,
    onChunk: (chunk: LessonStreamChunk) => void,
    onStatus: (status: LessonStreamStatus) => void
  ) => Promise<LessonStreamDone>
  onLessonStreamChunk: (handler: (chunk: LessonStreamChunk) => void) => () => void
  onLessonStreamStatus: (handler: (status: LessonStreamStatus) => void) => () => void
  agentChatStream: (
    payload: AgentChatStreamPayload,
    onChunk: (chunk: AgentChatStreamChunk) => void,
    onStatus: (status: AgentChatStreamStatus) => void,
    onTool: (event: AgentChatStreamToolEvent) => void
  ) => Promise<AgentChatStreamDone>
  cancelAgentChatStream: (streamId: string) => Promise<{ canceled: boolean }>
  onAgentChatChunk: (handler: (chunk: AgentChatStreamChunk) => void) => () => void
  onAgentChatStatus: (handler: (status: AgentChatStreamStatus) => void) => () => void
  onAgentChatTool: (handler: (event: AgentChatStreamToolEvent) => void) => () => void
  saveAgentConversation: (payload: SaveAgentConversationPayload) => Promise<SaveAgentConversationResult>
  readAgentConversation: (payload: ReadAgentConversationPayload) => Promise<AgentConversationRecord>
  setWorkspaceItemMeta: (payload: WorkspaceItemMetaPayload) => Promise<TeachingAppState>
  removeWorkspaceItem: (payload: WorkspaceItemRemovePayload) => Promise<TeachingAppState>
  removeWorkspace: (payload: WorkspaceRemovePayload) => Promise<TeachingAppState>
  listReviewCards: (workspaceId: string) => Promise<ListReviewCardsResult>
  recordProgress: (payload: RecordProgressPayload) => Promise<GetProgressResult>
  getProgress: (workspaceId: string) => Promise<GetProgressResult>
  listGitWorktrees: (workspaceRoot: string) => Promise<TeachingGitWorktreesResult>
  removeGitWorktree: (payload: RemoveTeachingGitWorktreePayload) => Promise<OpenPathResult>
  listGitBranches: (workspaceRoot: string) => Promise<TeachingGitBranchesResult>
  switchGitBranch: (payload: GitBranchPayload) => Promise<TeachingGitBranchesResult>
  createGitBranch: (payload: GitBranchPayload) => Promise<TeachingGitBranchesResult>
  listMemory: (workspaceRoot?: string) => Promise<TeachingMemoryRecord[]>
  getMemoryDiagnostics: () => Promise<TeachingMemoryDiagnostics>
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
  updateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
  deleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  openLogFile: () => Promise<OpenPathResult>
  openAppDataDir: () => Promise<OpenPathResult>
}
