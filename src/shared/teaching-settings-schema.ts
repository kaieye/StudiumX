import {
  DEFAULT_PET_APPEARANCE_ID,
  DEFAULT_PET_SIZE,
  MAX_PET_SIZE,
  MIN_PET_SIZE,
  PET_APPEARANCE_DISPLAY_NAMES,
  MODEL_ENDPOINT_FORMATS,
  MODEL_REASONING_EFFORTS,
  PARALLEL_SEARCH_MODES,
  TEACHING_MODEL_PROVIDER_PRESETS,
  WEB_SEARCH_BACKENDS,
  AGENT_APPROVAL_MODES,
  AGENT_SANDBOX_MODES,
  normalizePetAppearanceId,
  type ModelEndpointFormat,
  type ModelReasoningEffort,
  type ParallelSearchMode,
  type TeachingModelProviderProfile,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type WebSearchBackend,
  type AgentApprovalMode,
  type AgentSandboxMode,
  type WindowsSandboxLevel
} from './teaching-types'
import { DEFAULT_LESSON_STYLE_ID, normalizeLessonStyleId } from './lesson-styles'
import { normalizeProviderCustomHeaders } from './provider-custom-headers'

const DEFAULT_UI_FONT_SCALE = 1
const MIN_UI_FONT_SCALE = 0.8
const MAX_UI_FONT_SCALE = 1.2

// Pet display names that read as "the default" rather than a user customization:
// any built-in pet name plus the legacy pre-0.0.6 default. When the stored name is
// one of these and doesn't match the selected pet, the selected pet's name wins so
// the pet name always follows the chosen appearance.
const LEGACY_PET_DEFAULT_DISPLAY_NAMES = new Set(['小搭档'])
const BUILT_IN_PET_DISPLAY_NAMES = new Set(Object.values(PET_APPEARANCE_DISPLAY_NAMES))

function isBuiltInPetDisplayName(value: string): boolean {
  return BUILT_IN_PET_DISPLAY_NAMES.has(value) || LEGACY_PET_DEFAULT_DISPLAY_NAMES.has(value)
}

/**
 * Provider presets replaced by newer catalog entries. When a persisted provider's
 * model list consists entirely of these superseded ids (i.e. it was seeded from an
 * older catalog and never customized by pulling / reordering), re-seed it from the
 * current preset so catalog model renames propagate to existing installs. Lists that
 * mix superseded and current models — or that only add non-catalog upstream models —
 * are treated as user customizations and left untouched.
 */
const SUPERSEDED_MODEL_PRESETS: Record<string, string[]> = {
  glm: ['glm-4.5', 'glm-4.5-air', 'glm-4-flash']
}

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
    version: 2,
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
    // Disabled by default: this is an explicit user budget, not a hidden
    // general-purpose run fuse. Values are only applied after opt-in.
    resourceBudget: {
      enabled: false,
      providerTransportAttempts: 20,
      toolOperationAttempts: 40,
      durationMinutes: 30,
      totalTokens: 200_000
    },
    tools: {
      // New/default settings invoke tools, while effect approvals, workspace trust,
      // sandbox policy, and path fences remain independently enforced.
      enabled: true,
      workspaceRead: true,
      approvalMode: 'request_approval',
      // Mainstream agent: shell is available unless explicitly disabled.
      workspaceShell: true,
      sandboxMode: 'workspace_write',
      windowsSandboxLevel: 'restricted_token',
      webSearch: true,
      webFetch: false
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
      // The pet companion is opt-in: it stays hidden unless the user enables it.
      enabled: false,
      displayName: PET_APPEARANCE_DISPLAY_NAMES[DEFAULT_PET_APPEARANCE_ID],
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
      closeAction: 'tray',
      closeToTray: true
    },
    log: {
      enabled: true,
      retentionDays: 14
    },
    webRemoteControl: {
      enabled: false,
      bindMode: 'loopback',
      port: 0,
      relayMode: 'lan',
      externalRelayWsUrl: '',
      externalMobileBaseUrl: '',
      deviceSid: '',
      passHash: ''
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
    resourceBudget: {
      ...current.resourceBudget,
      ...(patch.resourceBudget ?? {})
    },
    tools: {
      ...current.tools,
      ...(patch.tools ?? {})
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
    },
    webRemoteControl: {
      ...current.webRemoteControl,
      ...(patch.webRemoteControl ?? {})
    }
  }
}

/**
 * Converts malformed or legacy data to the stable v1 settings document.  Callers own their
 * adapter-specific concerns (filesystem creation, migration writes, and secret encryption).
 */
export function normalizeTeachingSettings(input: unknown, fallbackDefaultRoot: string): TeachingSettingsV1 {
  const record = isRecord(input) ? input : {}
  // `version` is a passive schema marker; v<2 records predate the tray-default
  // behavior and are migrated to close-to-tray on load.
  const incomingVersion = typeof record.version === 'number' ? record.version : 0
  const isLegacyRecord = incomingVersion < 2
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
  const generatorModelsReSeeded = wasProviderModelsReSeeded(providerInput.providers, generatorProvider.id)
  const model =
    generatorModel && (!generatorModelsReSeeded || generatorProvider.models.includes(generatorModel))
      ? generatorModel
      : generatorProvider.models[0] ?? generatorModel
  const workspaceInput = recordOf(record.workspace)
  const worktreeInput = recordOf(record.worktree)
  const memoryInput = recordOf(record.memory)
  const resourceBudgetInput = recordOf(record.resourceBudget)
  const toolsInput = recordOf(record.tools)
  const webSearchInput = recordOf(record.webSearch)
  const notificationsInput = recordOf(record.notifications)
  const petInput = recordOf(record.pet)
  const petNotificationPreferencesInput = recordOf(petInput.notificationPreferences)
  const petNotificationSourcesInput = recordOf(petNotificationPreferencesInput.sources)
  const petAppearance = normalizePetAppearanceId(petInput.appearance, defaults.pet.appearance)
  const petDisplayNameInput = normalizeString(petInput.displayName).slice(0, 24)
  // A name that is empty or still a built-in/legacy default follows the selected pet.
  const petDisplayName = petDisplayNameInput && !isBuiltInPetDisplayName(petDisplayNameInput)
    ? petDisplayNameInput
    : PET_APPEARANCE_DISPLAY_NAMES[petAppearance]
  const privacyInput = recordOf(record.privacy)
  const appBehaviorInput = recordOf(record.appBehavior)
  // Legacy (<v2) documents always migrate to the tray default regardless of any
  // stored `closeAction`; v2+ records honor the user's explicit choice.
  const normalizedCloseAction: 'quit' | 'tray' = isLegacyRecord
    ? 'tray'
    : appBehaviorInput.closeAction === 'tray'
      ? 'tray'
      : 'quit'
  const logInput = recordOf(record.log)
  const proxyInput = recordOf(providerInput.proxy)

  return {
    version: 2,
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
      defaultRoot: migrateLegacyProductWorkspaceRoot(
        normalizeString(workspaceInput.defaultRoot) || fallbackDefaultRoot,
        fallbackDefaultRoot
      ),
      confirmBeforeGenerating: workspaceInput.confirmBeforeGenerating === true,
      autoOpenGeneratedLesson: workspaceInput.autoOpenGeneratedLesson === true,
      showAllCourseFiles: workspaceInput.showAllCourseFiles === true,
      lessonStyleId: normalizeLessonStyleId(workspaceInput.lessonStyleId)
    },
    worktree: {
      rootPath: migrateLegacyProductWorkspaceRoot(
        normalizeString(worktreeInput.rootPath) || defaultWorktreeRoot(fallbackDefaultRoot),
        defaultWorktreeRoot(fallbackDefaultRoot)
      )
    },
    memory: {
      enabled: memoryInput.enabled !== false,
      maxInjected: Math.round(clampNumber(memoryInput.maxInjected, 1, 12, defaults.memory.maxInjected))
    },
    resourceBudget: {
      enabled: resourceBudgetInput.enabled === true,
      providerTransportAttempts: Math.round(clampNumber(
        resourceBudgetInput.providerTransportAttempts, 1, 10_000, defaults.resourceBudget.providerTransportAttempts
      )),
      toolOperationAttempts: Math.round(clampNumber(
        resourceBudgetInput.toolOperationAttempts, 1, 10_000, defaults.resourceBudget.toolOperationAttempts
      )),
      durationMinutes: Math.round(clampNumber(
        resourceBudgetInput.durationMinutes, 1, 1_440, defaults.resourceBudget.durationMinutes
      )),
      totalTokens: Math.round(clampNumber(
        resourceBudgetInput.totalTokens, 1_000, 100_000_000, defaults.resourceBudget.totalTokens
      ))
    },
    tools: {
      // Legacy `tools.enabled` values are deliberately ignored. Tool availability is
      // application-wide; individual tool execution remains guarded separately.
      enabled: true,
      workspaceRead: toolsInput.workspaceRead !== false,
      approvalMode: normalizeAgentApprovalMode(
        toolsInput.approvalMode ?? legacyApprovalMode(toolsInput.workspaceWritePermission),
        defaults.tools.approvalMode
      ),
      // Opt-out: missing key → true (mainstream agent shell). Explicit false disables.
      workspaceShell: toolsInput.workspaceShell !== false,
      sandboxMode: normalizeAgentSandboxMode(toolsInput.sandboxMode, defaults.tools.sandboxMode),
      windowsSandboxLevel: normalizeWindowsSandboxLevel(
        toolsInput.windowsSandboxLevel,
        defaults.tools.windowsSandboxLevel
      ),
      webSearch: toolsInput.webSearch !== false,
      webFetch: toolsInput.webFetch === true
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
      // Opt-in: only an explicit `true` enables the pet; missing/anything else stays off.
      enabled: petInput.enabled === true,
      displayName: petDisplayName,
      showStatusBubble: petInput.showStatusBubble !== false,
      appearance: petAppearance,
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
      closeAction: normalizedCloseAction,
      closeToTray: normalizedCloseAction === 'tray'
    },
    log: {
      enabled: logInput.enabled !== false,
      retentionDays: Math.round(clampNumber(logInput.retentionDays, 1, 90, defaults.log.retentionDays))
    },
    webRemoteControl: normalizeWebRemoteControlSettings(record.webRemoteControl, defaults.webRemoteControl)
  }
}

function normalizeWebRemoteControlSettings(
  input: unknown,
  defaults: TeachingSettingsV1['webRemoteControl']
): TeachingSettingsV1['webRemoteControl'] {
  const record = isRecord(input) ? input : {}
  const bindMode = record.bindMode === 'lan' ? 'lan' : 'loopback'
  const relayMode = record.relayMode === 'external' ? 'external' : 'lan'
  const portRaw = Math.round(clampNumber(record.port, 0, 65535, defaults.port))
  return {
    enabled: record.enabled === true,
    bindMode,
    port: portRaw,
    relayMode,
    externalRelayWsUrl: normalizeString(record.externalRelayWsUrl),
    externalMobileBaseUrl: normalizeString(record.externalMobileBaseUrl),
    deviceSid: normalizeString(record.deviceSid),
    passHash: normalizeString(record.passHash)
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
  const customHeaders = normalizeProviderCustomHeaders(input.customHeaders)
  let models = normalizeModels(input.models, base.models)
  const superseded = SUPERSEDED_MODEL_PRESETS[id]
  if (superseded && models.length > 0 && models.every((model) => superseded.includes(model))) {
    models = [...base.models]
  }
  return {
    ...base,
    name: normalizeString(input.name) || base.name,
    apiKey: normalizeString(input.apiKey),
    baseUrl: normalizeString(input.baseUrl) || base.baseUrl,
    endpointFormat: normalizeEndpointFormat(input.endpointFormat, base.endpointFormat),
    models,
    docsUrl: isCustomProvider ? '' : normalizeString(input.docsUrl) || base.docsUrl,
    apiKeyUrl: isCustomProvider ? '' : normalizeString(input.apiKeyUrl) || base.apiKeyUrl,
    ...(customHeaders.length > 0 ? { customHeaders } : {})
  }
}

/**
 * True when the persisted provider's model list was entirely superseded and was
 * normalized to the current catalog preset. In that migration case the selected
 * generator model is still walked forward to the re-seeded default instead of
 * being preserved as a free-form entry.
 */
function wasProviderModelsReSeeded(input: unknown, providerId: string): boolean {
  if (!Array.isArray(input)) return false
  const superseded = SUPERSEDED_MODEL_PRESETS[providerId]
  if (!superseded) return false
  const rawProvider = input.find((item) => isRecord(item) && normalizeProviderId(item.id) === providerId)
  if (!rawProvider) return false
  const models = normalizeModels(rawProvider.models, [])
  return models.length > 0 && models.every((model) => superseded.includes(model))
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

function normalizeWindowsSandboxLevel(
  input: unknown,
  fallback: WindowsSandboxLevel
): WindowsSandboxLevel {
  if (typeof input !== 'string') return fallback
  const key = input.trim().toLocaleLowerCase().replace(/-/g, '_')
  if (key === 'disabled') return 'disabled'
  if (key === 'elevated') return 'elevated'
  if (key === 'restricted_token' || key === 'restrictedtoken') return 'restricted_token'
  return fallback
}

function normalizeAgentSandboxMode(
  input: unknown,
  fallback: AgentSandboxMode
): AgentSandboxMode {
  if (typeof input !== 'string') return fallback
  const raw = input.trim()
  const snake = raw.toLocaleLowerCase().replace(/-/g, '_')
  if (AGENT_SANDBOX_MODES.includes(snake as AgentSandboxMode)) {
    return snake as AgentSandboxMode
  }
  // Codex wire names
  if (raw === 'read-only') return 'read_only'
  if (raw === 'workspace-write') return 'workspace_write'
  if (raw === 'danger-full-access') return 'full_access'
  return fallback
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



/**
 * Rewrite leftover TeachOS product-folder names to StudiumX when the stored path
 * still uses the product default (Documents/TeachOS Workspaces or its .worktrees child).
 * Custom user paths that merely contain the legacy token are left untouched.
 */
function migrateLegacyProductWorkspaceRoot(path: string, fallbackRoot: string): string {
  if (!path) return fallbackRoot
  const normalized = path.replace(/\\/g, '/')
  const rewritten = normalized
    .replace(/(^|\/)TeachOS Workspaces(\/|$)/gi, (_match, prefix: string, suffix: string) => `${prefix}StudiumX Workspaces${suffix}`)
    .replace(/(^|\/)Teach OS Workspaces(\/|$)/gi, (_match, prefix: string, suffix: string) => `${prefix}StudiumX Workspaces${suffix}`)
  if (rewritten === normalized) return path
  if (path.includes('\\') && !path.includes('/')) {
    return rewritten.replace(/\//g, '\\')
  }
  return rewritten
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

function recordOf(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {}
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
