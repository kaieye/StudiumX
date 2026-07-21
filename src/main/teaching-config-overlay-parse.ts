/**
 * Pure teaching-loop overlay field parsing (S-03 peel / ADR-0090).
 *
 * Strict field parsing for one config overlay layer. Invalid fields are
 * omitted and recorded as diagnostics; the layer is never half-applied as a
 * whole document via tolerant normalization.
 *
 * This module is pure: no I/O, no resolver merge, no fingerprint. Layer order,
 * denylist product policy, and secret stripping remain in
 * teaching-config-resolver (ADR-0025 / ADR-0071 / ADR-0086).
 */

import {
  AGENT_APPROVAL_MODES,
  MODEL_ENDPOINT_FORMATS,
  MODEL_REASONING_EFFORTS,
  PARALLEL_SEARCH_MODES,
  WEB_SEARCH_BACKENDS
} from '../shared/teaching-types'
import type { ModelEndpointFormat } from '../shared/teaching-types'
import { isLessonStyleId } from '../shared/lesson-styles'
import {
  isDeniedForConfigLayer,
  isWorkspaceConfigDenylistLayer
} from './teaching-config-denylist'
import type {
  TeachingConfigDiagnostic,
  TeachingConfigSourceKind,
  TeachingLoopConfigValue
} from './teaching-config-resolver'

export type ParsedOverlay = {
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
export function parseTeachingLoopOverlay(
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
            const baseUrlPath = `provider.providers.${index}.baseUrl`
            let baseUrl = typeof item.baseUrl === 'string' ? item.baseUrl.trim() : ''
            if (isDeniedForConfigLayer(source, baseUrlPath) && 'baseUrl' in item) {
              diagnostics.push({
                code: 'workspace_denylist',
                severity: 'error',
                source,
                path: baseUrlPath,
                message: `Workspace/project config cannot set "${baseUrlPath}" (denylist); field was ignored.`
              })
              baseUrl = ''
            } else if (isWorkspaceConfigDenylistLayer(source)) {
              // Even without an explicit key, never project baseUrl from workspace.
              baseUrl = ''
            }
            providers.push({
              id,
              name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id,
              baseUrl,
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
