import {
  DEFAULT_PET_APPEARANCE_ID,
  DEFAULT_PET_SIZE,
  MAX_PET_SIZE,
  MIN_PET_SIZE,
  MODEL_ENDPOINT_FORMATS,
  MODEL_REASONING_EFFORTS,
  PARALLEL_SEARCH_MODES,
  TEACHING_MODEL_PROVIDER_PRESETS,
  WEB_SEARCH_BACKENDS,
  AGENT_APPROVAL_MODES,
  normalizePetAppearanceId,
  type ModelEndpointFormat,
  type ModelReasoningEffort,
  type ParallelSearchMode,
  type TeachingModelProviderProfile,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type WebSearchBackend,
  type AgentApprovalMode
} from './teaching-types'
import { DEFAULT_LESSON_STYLE_ID, normalizeLessonStyleId } from './lesson-styles'

const DEFAULT_UI_FONT_SCALE = 1
const MIN_UI_FONT_SCALE = 0.8
const MAX_UI_FONT_SCALE = 1.2

export const DEFAULT_TEACHING_AGENT_RUN_BUDGET = {
  // Conversational teaching turns (research + nested child runs + lesson generation)
  // routinely exceed short chat budgets. Keep a hard safety ceiling, but default high
  // enough that normal course creation is not cut mid-turn.
  maxDurationMs: 20 * 60_000,
  maxProviderCalls: 64,
  maxToolCalls: 128,
  maxTotalTokens: 500_000,
  warningThreshold: 0.8
} as const satisfies TeachingSettingsV1['tools']['runBudget']

/**
 * Produces the complete v1 document used by both persistence and the renderer.
 * This module deliberately has no filesystem or safe-storage concerns.
 */
export function createTeachingSettingsDefaults(defaultRoot: string): TeachingSettingsV1 {
  const providers = TEACHING_MODEL_PROVIDER_PRESETS.map((preset) => ({
    ...preset,
    apiKey: ''
  }))
  const activeProvider = providers[0]!

  return {
    version: 1,
    locale: 'zh-CN',
    theme: 'system',
    uiFontScale: DEFAULT_UI_FONT_SCALE,
    density: 'comfortable',
    provider: {
      activeProviderId: activeProvider.id,
      providers,
      proxy: {
        enabled: false,
        url: ''
      }
    },
    generator: {
      providerId: activeProvider.id,
      model: activeProvider.models[1] ?? activeProvider.models[0] ?? '',
      endpointFormat: activeProvider.endpointFormat,
      temperature: 0.4,
      maxOutputTokens: 4096,
      lessonDurationMinutes: 15,
      includeRetrievalPractice: true,
      generateReference: true,
      structuredOutput: true,
      streaming: false,
      reasoningEffort: 'auto',
      requestTimeoutMs: 60_000
    },
    workspace: {
      defaultRoot,
      confirmBeforeGenerating: false,
      autoOpenGeneratedLesson: false,
      showAllCourseFiles: false,
      lessonStyleId: DEFAULT_LESSON_STYLE_ID
    },
    worktree: {
      rootPath: defaultWorktreeRoot(defaultRoot)
    },
    memory: {
      enabled: true,
      maxInjected: 4
    },
    tools: {
      enabled: false,
      workspaceRead: true,
      approvalMode: 'request_approval',
      webSearch: true,
      webFetch: false,
      maxIterations: 0,
      runBudget: { ...DEFAULT_TEACHING_AGENT_RUN_BUDGET }
    },
    webSearch: {
      backend: 'auto',
      fallbackEnabled: true,
      maxResults: 5,
      searxngUrl: '',
      braveApiKey: '',
      firecrawlApiKey: '',
      firecrawlApiUrl: '',
      tavilyApiKey: '',
      exaApiKey: '',
      parallelApiKey: '',
      parallelSearchMode: 'agentic',
      xaiApiKey: '',
      xaiModel: 'grok-4.3'
    },
    notifications: {
      enabled: true,
      lessonGenerated: true,
      workspaceImported: true,
      errors: true
    },
    pet: {
      enabled: true,
      displayName: 'Boba',
      showStatusBubble: true,
      appearance: DEFAULT_PET_APPEARANCE_ID,
      size: DEFAULT_PET_SIZE,
      notificationPreferences: {
        actionableOnly: false,
        showRunning: true,
        showReview: true,
        showWaving: true,
        sources: {
          agent: true,
          lessonGeneration: true,
          lessonReview: true,
          onboarding: true
        },
        quietUntil: null
      }
    },
    privacy: {
      maskApiKeys: true,
      allowExternalLinks: true
    },
    appBehavior: {
      openAtLogin: false,
      startMinimized: false,
      closeAction: 'quit',
      closeToTray: false
    },
    log: {
      enabled: true,
      retentionDays: 14
    }
  }
}

/** Deep-merges a renderer patch without coupling the pure schema to IPC or persistence. */
export function mergeTeachingSettings(
  current: TeachingSettingsV1,
  patch: TeachingSettingsPatch
): TeachingSettingsV1 {
  return {
    ...current,
    ...patch,
    provider: {
      ...current.provider,
      ...(patch.provider ?? {}),
      proxy: {
        ...current.provider.proxy,
        ...(patch.provider?.proxy ?? {})
      },
      providers: patch.provider?.providers ?? current.provider.providers
    },
    generator: {
      ...current.generator,
      ...(patch.generator ?? {})
    },
    workspace: {
      ...current.workspace,
      ...(patch.workspace ?? {})
    },
    worktree: {
      ...current.worktree,
      ...(patch.worktree ?? {})
    },
    memory: {
      ...current.memory,
      ...(patch.memory ?? {})
    },
    tools: {
      ...current.tools,
      ...(patch.tools ?? {}),
      runBudget: {
        ...current.tools.runBudget,
        ...(patch.tools?.runBudget ?? {})
      }
    },
    webSearch: {
      ...current.webSearch,
      ...(patch.webSearch ?? {})
    },
    notifications: {
      ...current.notifications,
      ...(patch.notifications ?? {})
    },
    pet: {
      ...current.pet,
      ...(patch.pet ?? {}),
      notificationPreferences: {
        ...current.pet.notificationPreferences,
        ...(patch.pet?.notificationPreferences ?? {}),
        sources: {
          ...current.pet.notificationPreferences.sources,
          ...(patch.pet?.notificationPreferences?.sources ?? {})
        }
      }
    },
    privacy: {
      ...current.privacy,
      ...(patch.privacy ?? {})
    },
    appBehavior: {
      ...current.appBehavior,
      ...(patch.appBehavior ?? {})
    },
    log: {
      ...current.log,
      ...(patch.log ?? {})
    }
  }
}

/**
 * Converts malformed or legacy data to the stable v1 settings document.  Callers own their
 * adapter-specific concerns (filesystem creation, migration writes, and secret encryption).
 */
export function normalizeTeachingSettings(input: unknown, fallbackDefaultRoot: string): TeachingSettingsV1 {
  const record = isRecord(input) ? input : {}
  const defaults = createTeachingSettingsDefaults(fallbackDefaultRoot)
  const providerInput = recordOf(record.provider)
  const normalizedProviders = normalizeProviders(providerInput.providers, defaults.provider.providers)
  const activeProviderId = normalizeProviderId(providerInput.activeProviderId)
  const activeProvider =
    normalizedProviders.find((provider) => provider.id === activeProviderId) ??
    normalizedProviders.find((provider) => provider.id === defaults.provider.activeProviderId) ??
    normalizedProviders[0]!
  const generatorInput = recordOf(record.generator)
  const generatorProviderId = normalizeProviderId(generatorInput.providerId) || activeProvider.id
  const generatorProvider = normalizedProviders.find((provider) => provider.id === generatorProviderId) ?? activeProvider
  const generatorModel = normalizeString(generatorInput.model)
  const model =
    generatorModel && generatorProvider.models.includes(generatorModel)
      ? generatorModel
      : generatorProvider.models[0] ?? generatorModel
  const workspaceInput = recordOf(record.workspace)
  const worktreeInput = recordOf(record.worktree)
  const memoryInput = recordOf(record.memory)
  const toolsInput = recordOf(record.tools)
  const runBudgetInput = recordOf(toolsInput.runBudget)
  const webSearchInput = recordOf(record.webSearch)
  const notificationsInput = recordOf(record.notifications)
  const petInput = recordOf(record.pet)
  const petNotificationPreferencesInput = recordOf(petInput.notificationPreferences)
  const petNotificationSourcesInput = recordOf(petNotificationPreferencesInput.sources)
  const privacyInput = recordOf(record.privacy)
  const appBehaviorInput = recordOf(record.appBehavior)
  const logInput = recordOf(record.log)
  const proxyInput = recordOf(providerInput.proxy)

  return {
    version: 1,
    locale: record.locale === 'en-US' ? 'en-US' : 'zh-CN',
    theme: record.theme === 'light' || record.theme === 'dark' || record.theme === 'system'
      ? record.theme
      : defaults.theme,
    uiFontScale: clampNumber(record.uiFontScale, MIN_UI_FONT_SCALE, MAX_UI_FONT_SCALE, DEFAULT_UI_FONT_SCALE),
    density: record.density === 'compact' ? 'compact' : 'comfortable',
    provider: {
      activeProviderId: activeProvider.id,
      providers: normalizedProviders,
      proxy: {
        enabled: proxyInput.enabled === true,
        url: normalizeString(proxyInput.url)
      }
    },
    generator: {
      providerId: generatorProvider.id,
      model,
      endpointFormat: normalizeEndpointFormat(generatorInput.endpointFormat, generatorProvider.endpointFormat),
      temperature: clampNumber(generatorInput.temperature, 0, 2, defaults.generator.temperature),
      maxOutputTokens: Math.round(clampNumber(generatorInput.maxOutputTokens, 512, 32768, defaults.generator.maxOutputTokens)),
      lessonDurationMinutes: Math.round(clampNumber(generatorInput.lessonDurationMinutes, 5, 60, defaults.generator.lessonDurationMinutes)),
      includeRetrievalPractice: generatorInput.includeRetrievalPractice !== false,
      generateReference: generatorInput.generateReference !== false,
      structuredOutput: generatorInput.structuredOutput !== false,
      streaming: generatorInput.streaming === true,
      reasoningEffort: normalizeReasoningEffort(generatorInput.reasoningEffort, defaults.generator.reasoningEffort),
      requestTimeoutMs: Math.round(clampNumber(generatorInput.requestTimeoutMs, 5_000, 300_000, defaults.generator.requestTimeoutMs))
    },
    workspace: {
      defaultRoot: normalizeString(workspaceInput.defaultRoot) || fallbackDefaultRoot,
      confirmBeforeGenerating: workspaceInput.confirmBeforeGenerating === true,
      autoOpenGeneratedLesson: workspaceInput.autoOpenGeneratedLesson === true,
      showAllCourseFiles: workspaceInput.showAllCourseFiles === true,
      lessonStyleId: normalizeLessonStyleId(workspaceInput.lessonStyleId)
    },
    worktree: {
      rootPath: normalizeString(worktreeInput.rootPath) || defaultWorktreeRoot(fallbackDefaultRoot)
    },
    memory: {
      enabled: memoryInput.enabled !== false,
      maxInjected: Math.round(clampNumber(memoryInput.maxInjected, 1, 12, defaults.memory.maxInjected))
    },
    tools: {
      enabled: toolsInput.enabled === true,
      workspaceRead: toolsInput.workspaceRead !== false,
      approvalMode: normalizeAgentApprovalMode(
        toolsInput.approvalMode ?? legacyApprovalMode(toolsInput.workspaceWritePermission),
        defaults.tools.approvalMode
      ),
      webSearch: toolsInput.webSearch !== false,
      webFetch: toolsInput.webFetch === true,
      maxIterations: Math.round(clampNumber(toolsInput.maxIterations, 0, 64, defaults.tools.maxIterations)),
      runBudget: normalizeTeachingAgentRunBudget(runBudgetInput)
    },
    webSearch: {
      backend: normalizeWebSearchBackend(webSearchInput.backend, defaults.webSearch.backend),
      fallbackEnabled: webSearchInput.fallbackEnabled !== false,
      maxResults: Math.round(clampNumber(webSearchInput.maxResults, 1, 20, defaults.webSearch.maxResults)),
      searxngUrl: normalizeString(webSearchInput.searxngUrl),
      braveApiKey: normalizeString(webSearchInput.braveApiKey),
      firecrawlApiKey: normalizeString(webSearchInput.firecrawlApiKey),
      firecrawlApiUrl: normalizeString(webSearchInput.firecrawlApiUrl),
      tavilyApiKey: normalizeString(webSearchInput.tavilyApiKey),
      exaApiKey: normalizeString(webSearchInput.exaApiKey),
      parallelApiKey: normalizeString(webSearchInput.parallelApiKey),
      parallelSearchMode: normalizeParallelSearchMode(webSearchInput.parallelSearchMode, defaults.webSearch.parallelSearchMode),
      xaiApiKey: normalizeString(webSearchInput.xaiApiKey),
      xaiModel: normalizeString(webSearchInput.xaiModel) || defaults.webSearch.xaiModel
    },
    notifications: {
      enabled: notificationsInput.enabled !== false,
      lessonGenerated: notificationsInput.lessonGenerated !== false,
      workspaceImported: notificationsInput.workspaceImported !== false,
      errors: notificationsInput.errors !== false
    },
    pet: {
      enabled: petInput.enabled !== false,
      displayName: normalizeString(petInput.displayName).slice(0, 24) || defaults.pet.displayName,
      showStatusBubble: petInput.showStatusBubble !== false,
      appearance: normalizePetAppearanceId(petInput.appearance, defaults.pet.appearance),
      size: Math.round(clampNumber(petInput.size, MIN_PET_SIZE, MAX_PET_SIZE, defaults.pet.size)),
      notificationPreferences: {
        actionableOnly: petNotificationPreferencesInput.actionableOnly === true,
        showRunning: petNotificationPreferencesInput.showRunning !== false,
        showReview: petNotificationPreferencesInput.showReview !== false,
        showWaving: petNotificationPreferencesInput.showWaving !== false,
        sources: {
          agent: petNotificationSourcesInput.agent !== false,
          lessonGeneration: petNotificationSourcesInput.lessonGeneration !== false,
          lessonReview: petNotificationSourcesInput.lessonReview !== false,
          onboarding: petNotificationSourcesInput.onboarding !== false
        },
        quietUntil: normalizeOptionalTimestamp(petNotificationPreferencesInput.quietUntil)
      }
    },
    privacy: {
      maskApiKeys: privacyInput.maskApiKeys !== false,
      allowExternalLinks: privacyInput.allowExternalLinks !== false
    },
    appBehavior: {
      openAtLogin: appBehaviorInput.openAtLogin === true,
      startMinimized: appBehaviorInput.startMinimized === true,
      closeAction: appBehaviorInput.closeAction === 'tray' ? 'tray' : 'quit',
      closeToTray: appBehaviorInput.closeToTray === true
    },
    log: {
      enabled: logInput.enabled !== false,
      retentionDays: Math.round(clampNumber(logInput.retentionDays, 1, 90, defaults.log.retentionDays))
    }
  }
}

function normalizeTeachingAgentRunBudget(
  input: Record<string, unknown>
): TeachingSettingsV1['tools']['runBudget'] {
  return {
    maxDurationMs: boundedInteger(input.maxDurationMs, 5_000, 60 * 60_000, DEFAULT_TEACHING_AGENT_RUN_BUDGET.maxDurationMs),
    maxProviderCalls: boundedInteger(input.maxProviderCalls, 1, 500, DEFAULT_TEACHING_AGENT_RUN_BUDGET.maxProviderCalls),
    maxToolCalls: boundedInteger(input.maxToolCalls, 1, 1_000, DEFAULT_TEACHING_AGENT_RUN_BUDGET.maxToolCalls),
    maxTotalTokens: boundedInteger(input.maxTotalTokens, 1_000, 4_000_000, DEFAULT_TEACHING_AGENT_RUN_BUDGET.maxTotalTokens),
    warningThreshold: boundedNumber(input.warningThreshold, 0.5, 0.95, DEFAULT_TEACHING_AGENT_RUN_BUDGET.warningThreshold)
  }
}

function normalizeProviders(input: unknown, fallback: TeachingModelProviderProfile[]): TeachingModelProviderProfile[] {
  const byId = new Map(fallback.map((provider) => [provider.id, { ...provider }]))
  if (Array.isArray(input)) {
    for (const item of input) {
      const provider = normalizeProviderProfile(item)
      if (!provider) continue
      byId.set(provider.id, {
        ...(byId.get(provider.id) ?? provider),
        ...provider,
        models: provider.models.length > 0 ? provider.models : byId.get(provider.id)?.models ?? []
      })
    }
  }
  return [...byId.values()]
}

function normalizeProviderProfile(input: unknown): TeachingModelProviderProfile | null {
  if (!isRecord(input)) return null
  const id = normalizeProviderId(input.id)
  if (!id) return null
  const isCustomProvider = id === 'custom'
  const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === id)
  const base: TeachingModelProviderProfile = {
    ...(preset ?? {
      id,
      name: id,
      baseUrl: '',
      endpointFormat: 'chat_completions' as ModelEndpointFormat,
      models: [],
      docsUrl: '',
      apiKeyUrl: ''
    }),
    apiKey: ''
  }
  return {
    ...base,
    name: normalizeString(input.name) || base.name,
    apiKey: normalizeString(input.apiKey),
    baseUrl: normalizeString(input.baseUrl) || base.baseUrl,
    endpointFormat: normalizeEndpointFormat(input.endpointFormat, base.endpointFormat),
    models: normalizeModels(input.models, base.models),
    docsUrl: isCustomProvider ? '' : normalizeString(input.docsUrl) || base.docsUrl,
    apiKeyUrl: isCustomProvider ? '' : normalizeString(input.apiKeyUrl) || base.apiKeyUrl
  }
}

function normalizeModels(input: unknown, fallback: string[]): string[] {
  if (!Array.isArray(input)) return [...fallback]
  const models = [...new Set(input.map(normalizeString).filter(Boolean))]
  return models.length > 0 ? models : [...fallback]
}

function normalizeEndpointFormat(input: unknown, fallback: ModelEndpointFormat): ModelEndpointFormat {
  return typeof input === 'string' && MODEL_ENDPOINT_FORMATS.includes(input as ModelEndpointFormat)
    ? input as ModelEndpointFormat
    : fallback
}

function normalizeReasoningEffort(input: unknown, fallback: ModelReasoningEffort): ModelReasoningEffort {
  return typeof input === 'string' && MODEL_REASONING_EFFORTS.includes(input as ModelReasoningEffort)
    ? input as ModelReasoningEffort
    : fallback
}

function normalizeWebSearchBackend(input: unknown, fallback: WebSearchBackend): WebSearchBackend {
  return typeof input === 'string' && WEB_SEARCH_BACKENDS.includes(input as WebSearchBackend)
    ? input as WebSearchBackend
    : fallback
}

function normalizeParallelSearchMode(input: unknown, fallback: ParallelSearchMode): ParallelSearchMode {
  return typeof input === 'string' && PARALLEL_SEARCH_MODES.includes(input as ParallelSearchMode)
    ? input as ParallelSearchMode
    : fallback
}

function normalizeAgentApprovalMode(
  input: unknown,
  fallback: AgentApprovalMode
): AgentApprovalMode {
  return typeof input === 'string' && AGENT_APPROVAL_MODES.includes(input as AgentApprovalMode)
    ? input as AgentApprovalMode
    : fallback
}

/** Migrate the prior write-only control without turning old settings into silent access. */
function legacyApprovalMode(input: unknown): AgentApprovalMode | undefined {
  switch (input) {
    case 'allow_for_conversation':
      return 'full_access'
    case 'ask_each_time':
    case 'read_only':
      return 'request_approval'
    default:
      return undefined
  }
}

function defaultWorktreeRoot(defaultRoot: string): string {
  if (!defaultRoot) return '.worktrees'
  const separator = defaultRoot.includes('\\') ? '\\' : '/'
  return `${defaultRoot.replace(/[\\/]+$/, '')}${separator}.worktrees`
}

function normalizeProviderId(input: unknown): string {
  return normalizeString(input)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function normalizeString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

function normalizeOptionalTimestamp(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input > 0
    ? Math.round(input)
    : null
}

function clampNumber(input: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100))
}

function boundedInteger(input: unknown, min: number, max: number, fallback: number): number {
  return typeof input === 'number' && Number.isInteger(input) && input >= min && input <= max ? input : fallback
}

function boundedNumber(input: unknown, min: number, max: number, fallback: number): number {
  return typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max ? input : fallback
}

function recordOf(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {}
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
