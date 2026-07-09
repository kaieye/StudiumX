import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DEFAULT_LESSON_STYLE_ID, normalizeLessonStyleId } from '../shared/lesson-styles'
import {
  MODEL_ENDPOINT_FORMATS,
  MODEL_REASONING_EFFORTS,
  PARALLEL_SEARCH_MODES,
  TEACHING_MODEL_PROVIDER_PRESETS,
  WEB_SEARCH_BACKENDS,
  type ModelEndpointFormat,
  type ModelReasoningEffort,
  type ParallelSearchMode,
  type TeachingModelProviderProfile,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type WebSearchBackend
} from '../shared/teaching-types'

const SETTINGS_FILE_NAME = 'studiumx-settings.json'
const LEGACY_SETTINGS_FILE_NAME = 'teachos-settings.json'
const DEFAULT_UI_FONT_SCALE = 1
const MIN_UI_FONT_SCALE = 0.8
const MAX_UI_FONT_SCALE = 1.2

export class TeachingSettingsService {
  private readonly settingsPath: string
  private readonly legacySettingsPath: string
  private readonly fallbackDefaultRoot: string
  private cache: TeachingSettingsV1 | null = null

  constructor(options: { userDataPath: string; defaultRoot: string }) {
    this.settingsPath = join(options.userDataPath, SETTINGS_FILE_NAME)
    this.legacySettingsPath = join(options.userDataPath, LEGACY_SETTINGS_FILE_NAME)
    this.fallbackDefaultRoot = options.defaultRoot
  }

  async load(): Promise<TeachingSettingsV1> {
    if (this.cache) return this.cache

    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.settingsPath, 'utf8'))
    } catch (error) {
      if (isErrno(error) && error.code === 'ENOENT') {
        const legacySettings = await this.loadLegacySettings()
        if (legacySettings) {
          this.cache = await this.save(normalizeSettings(legacySettings, this.fallbackDefaultRoot))
          return this.cache
        }
        this.cache = await this.ensureSettings(defaultSettings(this.fallbackDefaultRoot))
        return this.cache
      }
      if (error instanceof SyntaxError) {
        this.cache = await this.replaceInvalidSettings('invalid JSON')
        return this.cache
      }
      throw error
    }

    if (!isRecord(parsed)) {
      this.cache = await this.replaceInvalidSettings('top-level value is not an object')
      return this.cache
    }

    this.cache = await this.ensureSettings(normalizeSettings(parsed, this.fallbackDefaultRoot))
    return this.cache
  }

  async save(settings: TeachingSettingsV1): Promise<TeachingSettingsV1> {
    const normalized = await this.ensureSettings(normalizeSettings(settings, this.fallbackDefaultRoot))
    this.cache = normalized
    await mkdir(dirname(this.settingsPath), { recursive: true })
    await atomicWriteFile(this.settingsPath, `${JSON.stringify(normalized, null, 2)}\n`)
    return normalized
  }

  async patch(patch: TeachingSettingsPatch): Promise<TeachingSettingsV1> {
    const current = await this.load()
    return this.save(mergeSettings(current, patch))
  }

  async defaultWorkspaceRoot(): Promise<string> {
    return (await this.load()).workspace.defaultRoot
  }

  private async ensureSettings(settings: TeachingSettingsV1): Promise<TeachingSettingsV1> {
    await mkdir(settings.workspace.defaultRoot, { recursive: true })
    return settings
  }

  private async replaceInvalidSettings(reason: string): Promise<TeachingSettingsV1> {
    const backupPath = `${this.settingsPath}.invalid-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    try {
      const exists = await stat(this.settingsPath).then((info) => info.isFile()).catch(() => false)
      if (exists) await rename(this.settingsPath, backupPath)
      console.warn(`[StudiumX] Invalid settings were replaced with defaults: ${reason}. Backup: ${backupPath}`)
    } catch {
      console.warn(`[StudiumX] Invalid settings were replaced with defaults: ${reason}. Backup could not be written.`)
    }
    return this.save(defaultSettings(this.fallbackDefaultRoot))
  }

  private async loadLegacySettings(): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.legacySettingsPath, 'utf8'))
    } catch (error) {
      if (isErrno(error) && error.code === 'ENOENT') return null
      if (error instanceof SyntaxError) return null
      throw error
    }
  }
}

export function defaultSettings(defaultRoot: string): TeachingSettingsV1 {
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
      generateLearningRecord: true,
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
      rootPath: join(defaultRoot, '.worktrees')
    },
    memory: {
      enabled: true,
      maxInjected: 4
    },
    tools: {
      enabled: false,
      workspaceRead: true,
      webSearch: true,
      webFetch: false,
      maxIterations: 0
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

export function mergeSettings(current: TeachingSettingsV1, patch: TeachingSettingsPatch): TeachingSettingsV1 {
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

export function normalizeSettings(input: unknown, fallbackDefaultRoot: string): TeachingSettingsV1 {
  const record = isRecord(input) ? input : {}
  const defaults = defaultSettings(fallbackDefaultRoot)
  const providerInput = isRecord(record.provider) ? record.provider : {}
  const normalizedProviders = normalizeProviders(providerInput.providers, defaults.provider.providers)
  const activeProviderId = normalizeProviderId(providerInput.activeProviderId)
  const activeProvider =
    normalizedProviders.find((provider) => provider.id === activeProviderId) ??
    normalizedProviders.find((provider) => provider.id === defaults.provider.activeProviderId) ??
    normalizedProviders[0]!
  const generatorInput = isRecord(record.generator) ? record.generator : {}
  const generatorProviderId = normalizeProviderId(generatorInput.providerId) || activeProvider.id
  const generatorProvider =
    normalizedProviders.find((provider) => provider.id === generatorProviderId) ?? activeProvider
  const generatorModel = normalizeString(generatorInput.model)
  const model =
    generatorModel && generatorProvider.models.includes(generatorModel)
      ? generatorModel
      : generatorProvider.models[0] ?? generatorModel
  const workspaceInput = isRecord(record.workspace) ? record.workspace : {}
  const worktreeInput = isRecord(record.worktree) ? record.worktree : {}
  const memoryInput = isRecord(record.memory) ? record.memory : {}
  const toolsInput = isRecord(record.tools) ? record.tools : {}
  const webSearchInput = isRecord(record.webSearch) ? record.webSearch : {}
  const notificationsInput = isRecord(record.notifications) ? record.notifications : {}
  const privacyInput = isRecord(record.privacy) ? record.privacy : {}
  const appBehaviorInput = isRecord(record.appBehavior) ? record.appBehavior : {}
  const logInput = isRecord(record.log) ? record.log : {}

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
        enabled: providerInput.proxy && isRecord(providerInput.proxy)
          ? providerInput.proxy.enabled === true
          : defaults.provider.proxy.enabled,
        url: providerInput.proxy && isRecord(providerInput.proxy)
          ? normalizeString(providerInput.proxy.url)
          : defaults.provider.proxy.url
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
      generateLearningRecord: generatorInput.generateLearningRecord !== false,
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
      rootPath: normalizeString(worktreeInput.rootPath) || join(fallbackDefaultRoot, '.worktrees')
    },
    memory: {
      enabled: memoryInput.enabled !== false,
      maxInjected: Math.round(clampNumber(memoryInput.maxInjected, 1, 12, defaults.memory.maxInjected))
    },
    tools: {
      enabled: toolsInput.enabled === true,
      workspaceRead: toolsInput.workspaceRead !== false,
      webSearch: toolsInput.webSearch !== false,
      webFetch: toolsInput.webFetch === true,
      maxIterations: Math.round(clampNumber(toolsInput.maxIterations, 0, 60, defaults.tools.maxIterations))
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

function clampNumber(input: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100))
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, path)
}
