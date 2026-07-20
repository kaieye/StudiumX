import { createHash } from 'node:crypto'

import {
  createTeachingSettingsDefaults,
  normalizeTeachingSettings
} from '../shared/teaching-settings-schema'
import {
  AGENT_APPROVAL_MODES,
  MODEL_ENDPOINT_FORMATS,
  MODEL_REASONING_EFFORTS,
  PARALLEL_SEARCH_MODES,
  WEB_SEARCH_BACKENDS
} from '../shared/teaching-types'
import type {
  AgentApprovalMode,
  ModelEndpointFormat,
  ModelReasoningEffort,
  ParallelSearchMode,
  TeachingSettingsV1,
  WebSearchBackend
} from '../shared/teaching-types'
import { isLessonStyleId, normalizeLessonStyleId } from '../shared/lesson-styles'

/**
 * Layered teaching-loop config resolver.
 *
 * Priority (low → high): default < user < workspace < session_override
 *
 * Thin adapter over existing teaching settings documents. Projects only
 * teaching-loop fields, performs no filesystem I/O, and never surfaces
 * secrets in the ordinary resolved snapshot.
 */

export const TEACHING_CONFIG_SCHEMA_VERSION = 1 as const

export type TeachingConfigSourceKind = 'default' | 'user' | 'workspace' | 'session_override'

export type TeachingConfigDiagnosticCode =
  | 'invalid_layer'
  | 'invalid_field'
  | 'secret_stripped'

export type TeachingConfigDiagnostic = {
  code: TeachingConfigDiagnosticCode
  severity: 'error' | 'warning'
  source: TeachingConfigSourceKind
  path?: string
  message: string
}

export type TeachingConfigFieldSource = {
  path: string
  source: TeachingConfigSourceKind
}

/** Secret-free teaching-loop configuration projected for runtime consumers. */
export type TeachingLoopConfigValue = {
  schemaVersion: typeof TEACHING_CONFIG_SCHEMA_VERSION
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
  tools: {
    enabled: boolean
    workspaceRead: boolean
    approvalMode: AgentApprovalMode
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
  memory: {
    enabled: boolean
    maxInjected: number
  }
  workspace: {
    defaultRoot: string
    confirmBeforeGenerating: boolean
    autoOpenGeneratedLesson: boolean
    showAllCourseFiles: boolean
    lessonStyleId: string
  }
  provider: {
    activeProviderId: string
    /** Public provider profiles only — apiKey is never projected. */
    providers: ReadonlyArray<{
      id: string
      name: string
      baseUrl: string
      endpointFormat: ModelEndpointFormat
      models: readonly string[]
    }>
    proxy: {
      enabled: boolean
    }
  }
  webSearch: {
    backend: WebSearchBackend
    fallbackEnabled: boolean
    maxResults: number
    searxngUrl: string
    firecrawlApiUrl: string
    parallelSearchMode: ParallelSearchMode
    xaiModel: string
  }
  privacy: {
    maskApiKeys: boolean
    allowExternalLinks: boolean
  }
}

export type ResolvedTeachingConfig = {
  value: TeachingLoopConfigValue
  sources: readonly TeachingConfigFieldSource[]
  diagnostics: readonly TeachingConfigDiagnostic[]
  /** Deterministic change token: `sha256:<hex>` of the secret-free value. */
  fingerprint: string
}

export type TeachingConfigScope = {
  /**
   * Fallback workspace root used when building defaults. Prefer the caller's
   * known defaultRoot; empty string is accepted for pure unit tests.
   */
  fallbackDefaultRoot: string
  /** User-level settings document (TeachingSettingsV1-shaped or unknown raw). */
  user?: unknown
  /** Workspace preference overlay (partial teaching-loop fields). */
  workspace?: unknown
  /** Highest-priority session override (partial teaching-loop fields). */
  sessionOverride?: unknown
}

export type TeachingConfigResolver = {
  resolve(scope: TeachingConfigScope): ResolvedTeachingConfig
}

const SOURCE_ORDER: readonly TeachingConfigSourceKind[] = [
  'default',
  'user',
  'workspace',
  'session_override'
] as const

const SECRET_PATHS = new Set([
  'provider.proxy.url',
  'webSearch.braveApiKey',
  'webSearch.firecrawlApiKey',
  'webSearch.tavilyApiKey',
  'webSearch.exaApiKey',
  'webSearch.parallelApiKey',
  'webSearch.xaiApiKey'
])

const SECRET_PROVIDER_API_KEY_PATH = /^provider\.providers\.\d+\.apiKey$/

type MutableLoopConfig = {
  generator: TeachingLoopConfigValue['generator']
  tools: TeachingLoopConfigValue['tools']
  memory: TeachingLoopConfigValue['memory']
  workspace: TeachingLoopConfigValue['workspace']
  provider: {
    activeProviderId: string
    providers: Array<{
      id: string
      name: string
      baseUrl: string
      endpointFormat: ModelEndpointFormat
      models: string[]
    }>
    proxy: { enabled: boolean }
  }
  webSearch: TeachingLoopConfigValue['webSearch']
  privacy: TeachingLoopConfigValue['privacy']
}

type FieldAssignment = {
  path: string
  source: TeachingConfigSourceKind
}

export function createTeachingConfigResolver(): TeachingConfigResolver {
  return { resolve: resolveTeachingConfig }
}

/**
 * Resolve layered teaching-loop configuration into an explainable snapshot.
 * Invalid layers/fields produce diagnostics and are skipped (no half-apply).
 */
export function resolveTeachingConfig(scope: TeachingConfigScope): ResolvedTeachingConfig {
  const diagnostics: TeachingConfigDiagnostic[] = []
  const assignments = new Map<string, FieldAssignment>()

  const defaults = projectTeachingLoopConfig(
    createTeachingSettingsDefaults(scope.fallbackDefaultRoot ?? '')
  )
  const value: MutableLoopConfig = cloneLoopConfig(defaults)
  recordFullSource(assignments, value, 'default')

  for (const source of SOURCE_ORDER) {
    if (source === 'default') continue
    const raw = layerInput(scope, source)
    if (raw === undefined) continue

    if (!isPlainObject(raw)) {
      diagnostics.push({
        code: 'invalid_layer',
        severity: 'error',
        source,
        message: `Layer "${source}" must be a plain object; layer was skipped.`
      })
      continue
    }

    diagnostics.push(...collectSecretDiagnostics(raw, source))
    const overlay = parseTeachingLoopOverlay(raw, source, diagnostics)
    if (!overlay) continue
    applyOverlay(value, overlay, source, assignments)
  }

  const resolvedValue: TeachingLoopConfigValue = {
    schemaVersion: TEACHING_CONFIG_SCHEMA_VERSION,
    generator: { ...value.generator },
    tools: {
      ...value.tools,
      runBudget: { ...value.tools.runBudget }
    },
    memory: { ...value.memory },
    workspace: { ...value.workspace },
    provider: {
      activeProviderId: value.provider.activeProviderId,
      providers: value.provider.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        endpointFormat: provider.endpointFormat,
        models: [...provider.models]
      })),
      proxy: { enabled: value.provider.proxy.enabled }
    },
    webSearch: { ...value.webSearch },
    privacy: { ...value.privacy }
  }

  assertNoSecrets(resolvedValue)

  const sources = [...assignments.values()].sort((a, b) => a.path.localeCompare(b.path))
  return {
    value: resolvedValue,
    sources,
    diagnostics: Object.freeze([...diagnostics]),
    fingerprint: fingerprintTeachingConfig(resolvedValue)
  }
}

/**
 * Adapter: project an already-loaded TeachingSettingsV1 document as the user layer.
 * Workspace / session overlays remain optional caller inputs.
 */
export function resolveTeachingConfigFromSettings(
  settings: TeachingSettingsV1,
  options: {
    fallbackDefaultRoot?: string
    workspace?: unknown
    sessionOverride?: unknown
  } = {}
): ResolvedTeachingConfig {
  return resolveTeachingConfig({
    fallbackDefaultRoot: options.fallbackDefaultRoot ?? settings.workspace.defaultRoot,
    user: settings,
    workspace: options.workspace,
    sessionOverride: options.sessionOverride
  })
}

/** Deterministic secret-free fingerprint used for change detection. */
export function fingerprintTeachingConfig(value: TeachingLoopConfigValue): string {
  const canonical = canonicalJson(value)
  const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return `sha256:${digest}`
}

/** True when a resolved snapshot path is considered a secret surface. */
export function isTeachingConfigSecretPath(path: string): boolean {
  return SECRET_PATHS.has(path) || SECRET_PROVIDER_API_KEY_PATH.test(path)
}

function layerInput(scope: TeachingConfigScope, source: TeachingConfigSourceKind): unknown {
  switch (source) {
    case 'user':
      return scope.user
    case 'workspace':
      return scope.workspace
    case 'session_override':
      return scope.sessionOverride
    case 'default':
      return undefined
  }
}

type ParsedOverlay = {
  generator?: Partial<TeachingLoopConfigValue['generator']>
  tools?: Partial<Omit<TeachingLoopConfigValue['tools'], 'runBudget'>> & {
    runBudget?: Partial<TeachingLoopConfigValue['tools']['runBudget']>
  }
  memory?: Partial<TeachingLoopConfigValue['memory']>
  workspace?: Partial<TeachingLoopConfigValue['workspace']>
  provider?: {
    activeProviderId?: string
    providers?: Array<{
      id: string
      name: string
      baseUrl: string
      endpointFormat: ModelEndpointFormat
      models: string[]
    }>
    proxy?: { enabled?: boolean }
  }
  webSearch?: Partial<TeachingLoopConfigValue['webSearch']>
  privacy?: Partial<TeachingLoopConfigValue['privacy']>
  fieldCount: number
}

/**
 * Strict field parsing for one overlay layer. Invalid fields are omitted and
 * recorded as diagnostics; the layer is never half-applied as a whole document
 * via tolerant normalization.
 */
function parseTeachingLoopOverlay(
  raw: Record<string, unknown>,
  source: TeachingConfigSourceKind,
  diagnostics: TeachingConfigDiagnostic[]
): ParsedOverlay | null {
  const overlay: ParsedOverlay = { fieldCount: 0 }

  if ('generator' in raw) {
    const section = requireObject(raw.generator, source, 'generator', diagnostics)
    if (section) {
      const generator: ParsedOverlay['generator'] = {}
      assignString(section, 'providerId', generator, 'providerId', source, 'generator.providerId', diagnostics, overlay)
      assignString(section, 'model', generator, 'model', source, 'generator.model', diagnostics, overlay)
      assignEnum(section, 'endpointFormat', generator, 'endpointFormat', MODEL_ENDPOINT_FORMATS, source, 'generator.endpointFormat', diagnostics, overlay)
      assignNumber(section, 'temperature', generator, 'temperature', 0, 2, source, 'generator.temperature', diagnostics, overlay)
      assignInteger(section, 'maxOutputTokens', generator, 'maxOutputTokens', 512, 32768, source, 'generator.maxOutputTokens', diagnostics, overlay)
      assignInteger(section, 'lessonDurationMinutes', generator, 'lessonDurationMinutes', 5, 60, source, 'generator.lessonDurationMinutes', diagnostics, overlay)
      assignBoolean(section, 'includeRetrievalPractice', generator, 'includeRetrievalPractice', source, 'generator.includeRetrievalPractice', diagnostics, overlay)
      assignBoolean(section, 'generateReference', generator, 'generateReference', source, 'generator.generateReference', diagnostics, overlay)
      assignBoolean(section, 'structuredOutput', generator, 'structuredOutput', source, 'generator.structuredOutput', diagnostics, overlay)
      assignBoolean(section, 'streaming', generator, 'streaming', source, 'generator.streaming', diagnostics, overlay)
      assignEnum(section, 'reasoningEffort', generator, 'reasoningEffort', MODEL_REASONING_EFFORTS, source, 'generator.reasoningEffort', diagnostics, overlay)
      assignInteger(section, 'requestTimeoutMs', generator, 'requestTimeoutMs', 5_000, 300_000, source, 'generator.requestTimeoutMs', diagnostics, overlay)
      if (Object.keys(generator).length > 0) overlay.generator = generator
    }
  }

  if ('tools' in raw) {
    const section = requireObject(raw.tools, source, 'tools', diagnostics)
    if (section) {
      const tools: NonNullable<ParsedOverlay['tools']> = {}
      assignBoolean(section, 'enabled', tools, 'enabled', source, 'tools.enabled', diagnostics, overlay)
      assignBoolean(section, 'workspaceRead', tools, 'workspaceRead', source, 'tools.workspaceRead', diagnostics, overlay)
      assignEnum(section, 'approvalMode', tools, 'approvalMode', AGENT_APPROVAL_MODES, source, 'tools.approvalMode', diagnostics, overlay)
      assignBoolean(section, 'webSearch', tools, 'webSearch', source, 'tools.webSearch', diagnostics, overlay)
      assignBoolean(section, 'webFetch', tools, 'webFetch', source, 'tools.webFetch', diagnostics, overlay)
      assignInteger(section, 'maxIterations', tools, 'maxIterations', 0, 64, source, 'tools.maxIterations', diagnostics, overlay)
      if ('runBudget' in section) {
        const budgetSection = requireObject(section.runBudget, source, 'tools.runBudget', diagnostics)
        if (budgetSection) {
          const runBudget: NonNullable<NonNullable<ParsedOverlay['tools']>['runBudget']> = {}
          assignInteger(budgetSection, 'maxDurationMs', runBudget, 'maxDurationMs', 5_000, 60 * 60_000, source, 'tools.runBudget.maxDurationMs', diagnostics, overlay)
          assignInteger(budgetSection, 'maxProviderCalls', runBudget, 'maxProviderCalls', 1, 500, source, 'tools.runBudget.maxProviderCalls', diagnostics, overlay)
          assignInteger(budgetSection, 'maxToolCalls', runBudget, 'maxToolCalls', 1, 1_000, source, 'tools.runBudget.maxToolCalls', diagnostics, overlay)
          assignInteger(budgetSection, 'maxTotalTokens', runBudget, 'maxTotalTokens', 1_000, 4_000_000, source, 'tools.runBudget.maxTotalTokens', diagnostics, overlay)
          assignNumber(budgetSection, 'warningThreshold', runBudget, 'warningThreshold', 0.5, 0.95, source, 'tools.runBudget.warningThreshold', diagnostics, overlay)
          if (Object.keys(runBudget).length > 0) tools.runBudget = runBudget
        }
      }
      if (Object.keys(tools).length > 0) overlay.tools = tools
    }
  }

  if ('memory' in raw) {
    const section = requireObject(raw.memory, source, 'memory', diagnostics)
    if (section) {
      const memory: ParsedOverlay['memory'] = {}
      assignBoolean(section, 'enabled', memory, 'enabled', source, 'memory.enabled', diagnostics, overlay)
      assignInteger(section, 'maxInjected', memory, 'maxInjected', 1, 12, source, 'memory.maxInjected', diagnostics, overlay)
      if (Object.keys(memory).length > 0) overlay.memory = memory
    }
  }

  if ('workspace' in raw) {
    const section = requireObject(raw.workspace, source, 'workspace', diagnostics)
    if (section) {
      const workspace: ParsedOverlay['workspace'] = {}
      assignString(section, 'defaultRoot', workspace, 'defaultRoot', source, 'workspace.defaultRoot', diagnostics, overlay)
      assignBoolean(section, 'confirmBeforeGenerating', workspace, 'confirmBeforeGenerating', source, 'workspace.confirmBeforeGenerating', diagnostics, overlay)
      assignBoolean(section, 'autoOpenGeneratedLesson', workspace, 'autoOpenGeneratedLesson', source, 'workspace.autoOpenGeneratedLesson', diagnostics, overlay)
      assignBoolean(section, 'showAllCourseFiles', workspace, 'showAllCourseFiles', source, 'workspace.showAllCourseFiles', diagnostics, overlay)
      if ('lessonStyleId' in section) {
        if (typeof section.lessonStyleId === 'string' && isLessonStyleId(section.lessonStyleId)) {
          workspace.lessonStyleId = section.lessonStyleId
          overlay.fieldCount += 1
        } else if (section.lessonStyleId !== undefined) {
          diagnostics.push({
            code: 'invalid_field',
            severity: 'error',
            source,
            path: 'workspace.lessonStyleId',
            message: `Invalid field "workspace.lessonStyleId" in layer "${source}"; field was skipped.`
          })
        }
      }
      if (Object.keys(workspace).length > 0) overlay.workspace = workspace
    }
  }

  if ('provider' in raw) {
    const section = requireObject(raw.provider, source, 'provider', diagnostics)
    if (section) {
      const provider: NonNullable<ParsedOverlay['provider']> = {}
      assignString(section, 'activeProviderId', provider, 'activeProviderId', source, 'provider.activeProviderId', diagnostics, overlay)
      if ('proxy' in section) {
        const proxySection = requireObject(section.proxy, source, 'provider.proxy', diagnostics)
        if (proxySection) {
          const proxy: { enabled?: boolean } = {}
          assignBoolean(proxySection, 'enabled', proxy, 'enabled', source, 'provider.proxy.enabled', diagnostics, overlay)
          if (Object.keys(proxy).length > 0) provider.proxy = proxy
        }
      }
      if ('providers' in section) {
        if (!Array.isArray(section.providers)) {
          diagnostics.push({
            code: 'invalid_field',
            severity: 'error',
            source,
            path: 'provider.providers',
            message: `Invalid field "provider.providers" in layer "${source}"; field was skipped.`
          })
        } else {
          const providers: NonNullable<NonNullable<ParsedOverlay['provider']>['providers']> = []
          for (const [index, item] of section.providers.entries()) {
            if (!isPlainObject(item)) {
              diagnostics.push({
                code: 'invalid_field',
                severity: 'error',
                source,
                path: `provider.providers.${index}`,
                message: `Invalid provider entry at index ${index} in layer "${source}"; entry was skipped.`
              })
              continue
            }
            const id = typeof item.id === 'string' ? item.id.trim() : ''
            if (!id) {
              diagnostics.push({
                code: 'invalid_field',
                severity: 'error',
                source,
                path: `provider.providers.${index}.id`,
                message: `Provider entry at index ${index} in layer "${source}" is missing a string id; entry was skipped.`
              })
              continue
            }
            const endpointFormat = typeof item.endpointFormat === 'string' &&
              (MODEL_ENDPOINT_FORMATS as readonly string[]).includes(item.endpointFormat)
              ? item.endpointFormat as ModelEndpointFormat
              : 'chat_completions'
            const models = Array.isArray(item.models)
              ? item.models.filter((model): model is string => typeof model === 'string').map((model) => model.trim()).filter(Boolean)
              : []
            providers.push({
              id,
              name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id,
              baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl.trim() : '',
              endpointFormat,
              models
            })
            overlay.fieldCount += 1
          }
          if (providers.length > 0) provider.providers = providers
        }
      }
      if (Object.keys(provider).length > 0) overlay.provider = provider
    }
  }

  if ('webSearch' in raw) {
    const section = requireObject(raw.webSearch, source, 'webSearch', diagnostics)
    if (section) {
      const webSearch: ParsedOverlay['webSearch'] = {}
      assignEnum(section, 'backend', webSearch, 'backend', WEB_SEARCH_BACKENDS, source, 'webSearch.backend', diagnostics, overlay)
      assignBoolean(section, 'fallbackEnabled', webSearch, 'fallbackEnabled', source, 'webSearch.fallbackEnabled', diagnostics, overlay)
      assignInteger(section, 'maxResults', webSearch, 'maxResults', 1, 20, source, 'webSearch.maxResults', diagnostics, overlay)
      assignString(section, 'searxngUrl', webSearch, 'searxngUrl', source, 'webSearch.searxngUrl', diagnostics, overlay)
      assignString(section, 'firecrawlApiUrl', webSearch, 'firecrawlApiUrl', source, 'webSearch.firecrawlApiUrl', diagnostics, overlay)
      assignEnum(section, 'parallelSearchMode', webSearch, 'parallelSearchMode', PARALLEL_SEARCH_MODES, source, 'webSearch.parallelSearchMode', diagnostics, overlay)
      assignString(section, 'xaiModel', webSearch, 'xaiModel', source, 'webSearch.xaiModel', diagnostics, overlay)
      if (Object.keys(webSearch).length > 0) overlay.webSearch = webSearch
    }
  }

  if ('privacy' in raw) {
    const section = requireObject(raw.privacy, source, 'privacy', diagnostics)
    if (section) {
      const privacy: ParsedOverlay['privacy'] = {}
      assignBoolean(section, 'maskApiKeys', privacy, 'maskApiKeys', source, 'privacy.maskApiKeys', diagnostics, overlay)
      assignBoolean(section, 'allowExternalLinks', privacy, 'allowExternalLinks', source, 'privacy.allowExternalLinks', diagnostics, overlay)
      if (Object.keys(privacy).length > 0) overlay.privacy = privacy
    }
  }

  if (overlay.fieldCount === 0 && diagnostics.some((item) => item.source === source && item.severity === 'error')) {
    return null
  }
  return overlay
}

function applyOverlay(
  value: MutableLoopConfig,
  overlay: ParsedOverlay,
  source: TeachingConfigSourceKind,
  assignments: Map<string, FieldAssignment>
): void {
  if (overlay.generator) {
    for (const [key, fieldValue] of Object.entries(overlay.generator)) {
      if (fieldValue === undefined) continue
      ;(value.generator as Record<string, unknown>)[key] = fieldValue
      setSource(assignments, `generator.${key}`, source)
    }
  }
  if (overlay.tools) {
    for (const [key, fieldValue] of Object.entries(overlay.tools)) {
      if (key === 'runBudget') continue
      if (fieldValue === undefined) continue
      ;(value.tools as Record<string, unknown>)[key] = fieldValue
      setSource(assignments, `tools.${key}`, source)
    }
    if (overlay.tools.runBudget) {
      for (const [key, fieldValue] of Object.entries(overlay.tools.runBudget)) {
        if (fieldValue === undefined) continue
        ;(value.tools.runBudget as Record<string, unknown>)[key] = fieldValue
        setSource(assignments, `tools.runBudget.${key}`, source)
      }
    }
  }
  if (overlay.memory) {
    for (const [key, fieldValue] of Object.entries(overlay.memory)) {
      if (fieldValue === undefined) continue
      ;(value.memory as Record<string, unknown>)[key] = fieldValue
      setSource(assignments, `memory.${key}`, source)
    }
  }
  if (overlay.workspace) {
    for (const [key, fieldValue] of Object.entries(overlay.workspace)) {
      if (fieldValue === undefined) continue
      ;(value.workspace as Record<string, unknown>)[key] = fieldValue
      setSource(assignments, `workspace.${key}`, source)
    }
  }
  if (overlay.provider) {
    if (overlay.provider.activeProviderId !== undefined) {
      value.provider.activeProviderId = overlay.provider.activeProviderId
      setSource(assignments, 'provider.activeProviderId', source)
    }
    if (overlay.provider.proxy?.enabled !== undefined) {
      value.provider.proxy.enabled = overlay.provider.proxy.enabled
      setSource(assignments, 'provider.proxy.enabled', source)
    }
    if (overlay.provider.providers) {
      value.provider.providers = overlay.provider.providers.map((provider) => ({
        ...provider,
        models: [...provider.models]
      }))
      setSource(assignments, 'provider.providers', source)
      for (const [index] of value.provider.providers.entries()) {
        setSource(assignments, `provider.providers.${index}.id`, source)
        setSource(assignments, `provider.providers.${index}.name`, source)
        setSource(assignments, `provider.providers.${index}.baseUrl`, source)
        setSource(assignments, `provider.providers.${index}.endpointFormat`, source)
        setSource(assignments, `provider.providers.${index}.models`, source)
      }
    }
  }
  if (overlay.webSearch) {
    for (const [key, fieldValue] of Object.entries(overlay.webSearch)) {
      if (fieldValue === undefined) continue
      ;(value.webSearch as Record<string, unknown>)[key] = fieldValue
      setSource(assignments, `webSearch.${key}`, source)
    }
  }
  if (overlay.privacy) {
    for (const [key, fieldValue] of Object.entries(overlay.privacy)) {
      if (fieldValue === undefined) continue
      ;(value.privacy as Record<string, unknown>)[key] = fieldValue
      setSource(assignments, `privacy.${key}`, source)
    }
  }
}

function projectTeachingLoopConfig(settings: TeachingSettingsV1): MutableLoopConfig {
  return {
    generator: { ...settings.generator },
    tools: {
      enabled: settings.tools.enabled,
      workspaceRead: settings.tools.workspaceRead,
      approvalMode: settings.tools.approvalMode,
      webSearch: settings.tools.webSearch,
      webFetch: settings.tools.webFetch,
      maxIterations: settings.tools.maxIterations,
      runBudget: { ...settings.tools.runBudget }
    },
    memory: { ...settings.memory },
    workspace: {
      defaultRoot: settings.workspace.defaultRoot,
      confirmBeforeGenerating: settings.workspace.confirmBeforeGenerating,
      autoOpenGeneratedLesson: settings.workspace.autoOpenGeneratedLesson,
      showAllCourseFiles: settings.workspace.showAllCourseFiles,
      lessonStyleId: normalizeLessonStyleId(settings.workspace.lessonStyleId)
    },
    provider: {
      activeProviderId: settings.provider.activeProviderId,
      providers: settings.provider.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        endpointFormat: provider.endpointFormat,
        models: [...provider.models]
      })),
      proxy: { enabled: settings.provider.proxy.enabled }
    },
    webSearch: {
      backend: settings.webSearch.backend,
      fallbackEnabled: settings.webSearch.fallbackEnabled,
      maxResults: settings.webSearch.maxResults,
      searxngUrl: settings.webSearch.searxngUrl,
      firecrawlApiUrl: settings.webSearch.firecrawlApiUrl,
      parallelSearchMode: settings.webSearch.parallelSearchMode,
      xaiModel: settings.webSearch.xaiModel
    },
    privacy: { ...settings.privacy }
  }
}

function cloneLoopConfig(value: MutableLoopConfig): MutableLoopConfig {
  return {
    generator: { ...value.generator },
    tools: {
      ...value.tools,
      runBudget: { ...value.tools.runBudget }
    },
    memory: { ...value.memory },
    workspace: { ...value.workspace },
    provider: {
      activeProviderId: value.provider.activeProviderId,
      providers: value.provider.providers.map((provider) => ({
        ...provider,
        models: [...provider.models]
      })),
      proxy: { ...value.provider.proxy }
    },
    webSearch: { ...value.webSearch },
    privacy: { ...value.privacy }
  }
}

function recordFullSource(
  assignments: Map<string, FieldAssignment>,
  value: MutableLoopConfig,
  source: TeachingConfigSourceKind
): void {
  for (const key of Object.keys(value.generator)) setSource(assignments, `generator.${key}`, source)
  for (const key of Object.keys(value.tools)) {
    if (key === 'runBudget') continue
    setSource(assignments, `tools.${key}`, source)
  }
  for (const key of Object.keys(value.tools.runBudget)) setSource(assignments, `tools.runBudget.${key}`, source)
  for (const key of Object.keys(value.memory)) setSource(assignments, `memory.${key}`, source)
  for (const key of Object.keys(value.workspace)) setSource(assignments, `workspace.${key}`, source)
  setSource(assignments, 'provider.activeProviderId', source)
  setSource(assignments, 'provider.proxy.enabled', source)
  setSource(assignments, 'provider.providers', source)
  for (const [index] of value.provider.providers.entries()) {
    setSource(assignments, `provider.providers.${index}.id`, source)
    setSource(assignments, `provider.providers.${index}.name`, source)
    setSource(assignments, `provider.providers.${index}.baseUrl`, source)
    setSource(assignments, `provider.providers.${index}.endpointFormat`, source)
    setSource(assignments, `provider.providers.${index}.models`, source)
  }
  for (const key of Object.keys(value.webSearch)) setSource(assignments, `webSearch.${key}`, source)
  for (const key of Object.keys(value.privacy)) setSource(assignments, `privacy.${key}`, source)
}

function setSource(
  assignments: Map<string, FieldAssignment>,
  path: string,
  source: TeachingConfigSourceKind
): void {
  assignments.set(path, { path, source })
}

function collectSecretDiagnostics(
  raw: Record<string, unknown>,
  source: TeachingConfigSourceKind
): TeachingConfigDiagnostic[] {
  const found: TeachingConfigDiagnostic[] = []
  walkSecrets(raw, '', (path) => {
    found.push({
      code: 'secret_stripped',
      severity: 'warning',
      source,
      path,
      message: `Secret field "${path}" from layer "${source}" was stripped from the resolved snapshot.`
    })
  })
  return found
}

function walkSecrets(
  value: unknown,
  path: string,
  onSecret: (path: string) => void
): void {
  if (!isPlainObject(value) && !Array.isArray(value)) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSecrets(item, path ? `${path}.${index}` : String(index), onSecret))
    return
  }
  for (const [key, nested] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key
    if (isTeachingConfigSecretPath(next)) {
      if (typeof nested === 'string' && nested.length > 0) onSecret(next)
      continue
    }
    walkSecrets(nested, next, onSecret)
  }
}

function assertNoSecrets(value: TeachingLoopConfigValue): void {
  const serialized = JSON.stringify(value)
  if (/"apiKey"\s*:/.test(serialized)) {
    throw new Error('Teaching config snapshot leaked an apiKey field.')
  }
  if (/"proxy"\s*:\s*\{[^}]*"url"\s*:/.test(serialized)) {
    throw new Error('Teaching config snapshot leaked a proxy URL secret.')
  }
  for (const key of [
    'braveApiKey',
    'firecrawlApiKey',
    'tavilyApiKey',
    'exaApiKey',
    'parallelApiKey',
    'xaiApiKey'
  ]) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`Teaching config snapshot leaked secret field ${key}.`)
    }
  }
}

function requireObject(
  input: unknown,
  source: TeachingConfigSourceKind,
  path: string,
  diagnostics: TeachingConfigDiagnostic[]
): Record<string, unknown> | null {
  if (!isPlainObject(input)) {
    diagnostics.push({
      code: 'invalid_field',
      severity: 'error',
      source,
      path,
      message: `Invalid field "${path}" in layer "${source}"; field was skipped.`
    })
    return null
  }
  return input
}

function assignString<T extends object>(
  section: Record<string, unknown>,
  key: string,
  target: T,
  targetKey: keyof T & string,
  source: TeachingConfigSourceKind,
  path: string,
  diagnostics: TeachingConfigDiagnostic[],
  overlay: ParsedOverlay
): void {
  if (!(key in section)) return
  const value = section[key]
  if (typeof value !== 'string') {
    diagnostics.push(invalidField(source, path))
    return
  }
  ;(target as Record<string, unknown>)[targetKey] = value.trim()
  overlay.fieldCount += 1
}

function assignBoolean<T extends object>(
  section: Record<string, unknown>,
  key: string,
  target: T,
  targetKey: keyof T & string,
  source: TeachingConfigSourceKind,
  path: string,
  diagnostics: TeachingConfigDiagnostic[],
  overlay: ParsedOverlay
): void {
  if (!(key in section)) return
  const value = section[key]
  if (typeof value !== 'boolean') {
    diagnostics.push(invalidField(source, path))
    return
  }
  ;(target as Record<string, unknown>)[targetKey] = value
  overlay.fieldCount += 1
}

function assignInteger<T extends object>(
  section: Record<string, unknown>,
  key: string,
  target: T,
  targetKey: keyof T & string,
  min: number,
  max: number,
  source: TeachingConfigSourceKind,
  path: string,
  diagnostics: TeachingConfigDiagnostic[],
  overlay: ParsedOverlay
): void {
  if (!(key in section)) return
  const value = section[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    diagnostics.push(invalidField(source, path))
    return
  }
  ;(target as Record<string, unknown>)[targetKey] = value
  overlay.fieldCount += 1
}

function assignNumber<T extends object>(
  section: Record<string, unknown>,
  key: string,
  target: T,
  targetKey: keyof T & string,
  min: number,
  max: number,
  source: TeachingConfigSourceKind,
  path: string,
  diagnostics: TeachingConfigDiagnostic[],
  overlay: ParsedOverlay
): void {
  if (!(key in section)) return
  const value = section[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    diagnostics.push(invalidField(source, path))
    return
  }
  ;(target as Record<string, unknown>)[targetKey] = value
  overlay.fieldCount += 1
}

function assignEnum<T extends object, E extends string>(
  section: Record<string, unknown>,
  key: string,
  target: T,
  targetKey: keyof T & string,
  allowed: readonly E[],
  source: TeachingConfigSourceKind,
  path: string,
  diagnostics: TeachingConfigDiagnostic[],
  overlay: ParsedOverlay
): void {
  if (!(key in section)) return
  const value = section[key]
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    diagnostics.push(invalidField(source, path))
    return
  }
  ;(target as Record<string, unknown>)[targetKey] = value
  overlay.fieldCount += 1
}

function invalidField(source: TeachingConfigSourceKind, path: string): TeachingConfigDiagnostic {
  return {
    code: 'invalid_field',
    severity: 'error',
    source,
    path,
    message: `Invalid field "${path}" in layer "${source}"; field was skipped.`
  }
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!isPlainObject(value)) return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalJson(value[key])
  }
  return sorted
}

/**
 * Compatibility helper: project unknown documents through the shared schema
 * before layering. Secrets are still stripped by resolveTeachingConfig.
 */
export function teachingConfigUserLayerFromUnknown(
  input: unknown,
  fallbackDefaultRoot: string
): TeachingSettingsV1 {
  return normalizeTeachingSettings(input, fallbackDefaultRoot)
}

