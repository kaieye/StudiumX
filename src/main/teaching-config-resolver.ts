import { createHash } from 'node:crypto'

import {
  createTeachingSettingsDefaults,
  normalizeTeachingSettings
} from '../shared/teaching-settings-schema'
import type {
  AgentApprovalMode,
  ModelEndpointFormat,
  ModelReasoningEffort,
  ParallelSearchMode,
  TeachingSettingsV1,
  WebSearchBackend
} from '../shared/teaching-types'
import { normalizeLessonStyleId } from '../shared/lesson-styles'
import { isWorkspaceConfigDenylistLayer } from './teaching-config-denylist'
import {
  parseTeachingLoopOverlay
} from './teaching-config-overlay-parse'
import type { ParsedOverlay } from './teaching-config-overlay-parse'

export {
  WORKSPACE_CONFIG_DENYLIST_PATHS,
  WORKSPACE_CONFIG_DENYLIST_LAYERS,
  isWorkspaceConfigDenylistPath,
  isWorkspaceConfigDenylistLayer,
  isDeniedForConfigLayer
} from './teaching-config-denylist'
export type { WorkspaceConfigDenylistPath, WorkspaceConfigDenylistLayer } from './teaching-config-denylist'

/**
 * Layered teaching-loop config resolver.
 *
 * Priority (low → high): default < managed < user < workspace < session_override
 *
 * Thin adapter over existing teaching settings documents. Projects only
 * teaching-loop fields, performs no filesystem I/O, and never surfaces
 * secrets in the ordinary resolved snapshot.
 *
 * Managed (S-11 / ADR-0086): optional school/org secret-free overlay injected
 * by the caller after product defaults and before user preferences. No FS
 * loader in this module — host may inject later.
 *
 * Workspace/project denylist (S-04): untrusted workspace overlays cannot set
 * provider.providers.*.baseUrl; see teaching-config-denylist.ts / ADR-0071.
 * managed / user / session_override are not denylisted (trusted relative to
 * workspace endpoint policy). Secrets in any layer are still stripped.
 */

export const TEACHING_CONFIG_SCHEMA_VERSION = 1 as const

export type TeachingConfigSourceKind =
  | 'default'
  | 'managed'
  | 'user'
  | 'workspace'
  | 'session_override'

export type TeachingConfigDiagnosticCode =
  | 'invalid_layer'
  | 'invalid_field'
  | 'secret_stripped'
  | 'workspace_denylist'

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
  /**
   * Optional school/org managed overlay (secret-free intent; secrets still
   * stripped). Caller-injected — no product FS path mandated here.
   */
  managed?: unknown
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
  'managed',
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
 * Managed / workspace / session overlays remain optional caller inputs.
 */
export function resolveTeachingConfigFromSettings(
  settings: TeachingSettingsV1,
  options: {
    fallbackDefaultRoot?: string
    managed?: unknown
    workspace?: unknown
    sessionOverride?: unknown
  } = {}
): ResolvedTeachingConfig {
  return resolveTeachingConfig({
    fallbackDefaultRoot: options.fallbackDefaultRoot ?? settings.workspace.defaultRoot,
    managed: options.managed,
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
    case 'managed':
      return scope.managed
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
      const denyBaseUrl = isWorkspaceConfigDenylistLayer(source)
      const previousById = new Map(
        value.provider.providers.map((provider) => [provider.id, provider] as const)
      )
      value.provider.providers = overlay.provider.providers.map((provider) => {
        if (!denyBaseUrl) {
          return {
            ...provider,
            models: [...provider.models]
          }
        }
        const previous = previousById.get(provider.id)
        return {
          ...provider,
          // Preserve lower-layer baseUrl; workspace never owns endpoint redirect.
          baseUrl: previous?.baseUrl ?? '',
          models: [...provider.models]
        }
      })
      setSource(assignments, 'provider.providers', source)
      for (const [index] of value.provider.providers.entries()) {
        setSource(assignments, `provider.providers.${index}.id`, source)
        setSource(assignments, `provider.providers.${index}.name`, source)
        if (!denyBaseUrl) {
          setSource(assignments, `provider.providers.${index}.baseUrl`, source)
        }
        // When denylisted, leave existing provenance for baseUrl (default/user).
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
