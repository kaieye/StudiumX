/**
 * Read-only capability snapshot derived from existing skill / provider /
 * search / permission modules. This is intentionally not a second registry:
 * readiness always re-reads the live sources, with an optional short TTL cache
 * so planner/context consumers can cheaply filter for `available` items.
 */
import type { AgentChatMode, SkillSummary, TeachingSettingsV1 } from '../shared/teaching-types'
import {
  resolveTeachingCapabilityPolicy,
  type TeachingCapabilityPolicy,
  type TeachingCapabilityPolicyId
} from './ai/agent-capability-policy'
import { resolveActiveProvider } from './ai/provider-adapter'
import { buildToolContext } from './ai/tools/registry'
import type { ToolPolicyDocument } from './ai/tools/tool-policy'
import {
  loadAndMergeToolPolicyDocumentsFromWorkspace,
  toolPolicyDocumentOption
} from './ai/tools/tool-policy-fs'
import {
  availableProviders,
  resolveConfiguredProvider,
  searchProviders
} from './ai/tools/web-search/providers'
import type { SearchProvider } from './ai/tools/web-search/types'

export type CapabilityStatus =
  | 'available'
  | 'disabled'
  | 'unconfigured'
  | 'denied'
  | 'degraded'

export type CapabilityKind =
  | 'model_provider'
  | 'web_search'
  | 'web_fetch'
  | 'workspace_tools'
  | 'skill'
  | 'delegation'
  | 'lesson'
  | 'tools_master'

export type CapabilityItem = Readonly<{
  id: string
  kind: CapabilityKind
  name: string
  status: CapabilityStatus
  reason: string
  /** Prompt/planner consumers should only include items with this flag set. */
  promptEligible: boolean
  details?: Readonly<Record<string, string | number | boolean | null | undefined>>
}>

export type CapabilityFreshness = Readonly<{
  capturedAt: string
  /** Absolute expiry time for this snapshot under the active TTL. */
  expiresAt: string
  ttlMs: number
  stale: boolean
}>

export type CapabilitySnapshot = Readonly<{
  generatedAt: string
  freshness: CapabilityFreshness
  policyId: TeachingCapabilityPolicyId
  items: readonly CapabilityItem[]
  available: readonly CapabilityItem[]
}>

export type TeachingCapabilityCatalogRequest = Readonly<{
  settings: TeachingSettingsV1
  mode?: AgentChatMode
  hasTeachingWorkspace?: boolean
  workspaceToolAccessGranted?: boolean
  hasLessonGenerator?: boolean
  workspaceRoot?: string | null
  /**
   * Optional preloaded workspace tool-policy (ADR-0101 / option B).
   * Pass a document after async FS load at the composition edge; omit or pass
   * null for default-equivalent (no field on ToolContext). Sync `snapshot`
   * never reads disk — product callers use {@link loadToolPolicyForCapabilityCatalog}.
   */
  toolPolicyDocument?: ToolPolicyDocument | null
  /** Installed/built-in skill summaries already loaded from SkillLibraryService. */
  skills?: readonly SkillSummary[]
  skillLoadError?: string
  /** Optional clock for tests. */
  now?: () => number
  /** Override default freshness TTL (ms). */
  ttlMs?: number
}>

export type TeachingCapabilityCatalogOptions = Readonly<{
  defaultTtlMs?: number
  now?: () => number
}>

export const DEFAULT_CAPABILITY_SNAPSHOT_TTL_MS = 5_000

type CacheEntry = {
  key: string
  expiresAt: number
  snapshot: CapabilitySnapshot
}

/**
 * Thin adapter over existing registries. Callers pass skill summaries from
 * SkillLibraryService; search/provider readiness is re-derived from the live
 * settings-backed provider catalog on every uncached snapshot.
 */
export class TeachingCapabilityCatalog {
  private readonly defaultTtlMs: number
  private readonly now: () => number
  private cache: CacheEntry | null = null

  constructor(options: TeachingCapabilityCatalogOptions = {}) {
    this.defaultTtlMs = Math.max(0, options.defaultTtlMs ?? DEFAULT_CAPABILITY_SNAPSHOT_TTL_MS)
    this.now = options.now ?? Date.now
  }

  snapshot(request: TeachingCapabilityCatalogRequest): CapabilitySnapshot {
    const nowMs = (request.now ?? this.now)()
    const ttlMs = Math.max(0, request.ttlMs ?? this.defaultTtlMs)

    try {
      const cacheKey = buildCacheKey(request)
      if (this.cache && this.cache.key === cacheKey && this.cache.expiresAt > nowMs) {
        return {
          ...this.cache.snapshot,
          freshness: {
            ...this.cache.snapshot.freshness,
            stale: false
          }
        }
      }

      const snapshot = buildSnapshot(request, nowMs, ttlMs)
      this.cache = {
        key: cacheKey,
        expiresAt: nowMs + ttlMs,
        snapshot
      }
      return snapshot
    } catch (error) {
      // Failures must degrade gracefully: planner/context can still run with
      // an empty available set instead of throwing into the teaching turn.
      return degradedSnapshot(request, nowMs, ttlMs, error)
    }
  }

  /** Drop the in-memory readiness cache (settings/skills changed). */
  invalidate(): void {
    this.cache = null
  }
}

export function createTeachingCapabilityCatalog(
  options: TeachingCapabilityCatalogOptions = {}
): TeachingCapabilityCatalog {
  return new TeachingCapabilityCatalog(options)
}

/** Convenience pure function for one-shot callers that do not need TTL cache. */
export function snapshotTeachingCapabilities(
  request: TeachingCapabilityCatalogRequest
): CapabilitySnapshot {
  return createTeachingCapabilityCatalog({ defaultTtlMs: 0, now: request.now }).snapshot(request)
}

/**
 * Async edge helper: load optional workspace tool-policy when `workspaceRoot`
 * is a non-empty string (ADR-0101). Empty/missing root → null, no FS read.
 * Composition roots may pass the result as `request.toolPolicyDocument` into
 * sync {@link snapshotTeachingCapabilities} / `catalog.snapshot`.
 */
export async function loadToolPolicyForCapabilityCatalog(
  workspaceRoot: string | null | undefined
): Promise<ToolPolicyDocument | null> {
  const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : ''
  if (!root) return null
  // ADR-0117: multi-path (primary + course overlay) shares conversation loader.
  return loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot: root })
}

/** Planner/context helper: only prompt-eligible available capabilities. */
export function selectPromptEligibleCapabilities(
  snapshot: CapabilitySnapshot
): readonly CapabilityItem[] {
  return snapshot.available.filter((item) => item.promptEligible)
}

function buildSnapshot(
  request: TeachingCapabilityCatalogRequest,
  nowMs: number,
  ttlMs: number
): CapabilitySnapshot {
  const settings = request.settings
  const mode = request.mode ?? 'teaching'
  const hasTeachingWorkspace = request.hasTeachingWorkspace === true
  const workspaceToolAccessGranted = request.workspaceToolAccessGranted === true
  const hasLessonGenerator = request.hasLessonGenerator === true

  const policy = resolveTeachingCapabilityPolicy({
    mode,
    toolsEnabled: true,
    hasTeachingWorkspace,
    workspaceToolAccessGranted,
    hasLessonGenerator
  })

  const items: CapabilityItem[] = [
    describeToolsMaster(settings),
    describeModelProvider(settings),
    describeWebSearch(settings, policy, request.workspaceRoot, request.toolPolicyDocument),
    describeWebFetch(settings, policy),
    describeWorkspaceTools(settings, policy, hasTeachingWorkspace, workspaceToolAccessGranted),
    describeDelegation(policy),
    describeLesson(policy, hasLessonGenerator, hasTeachingWorkspace),
    ...describeSkills(request.skills, request.skillLoadError, policy)
  ]

  const available = items.filter((item) => item.status === 'available' && item.promptEligible)
  const generatedAt = new Date(nowMs).toISOString()

  return {
    generatedAt,
    freshness: {
      capturedAt: generatedAt,
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
      ttlMs,
      stale: false
    },
    policyId: policy.id,
    items,
    available
  }
}

function degradedSnapshot(
  request: TeachingCapabilityCatalogRequest,
  nowMs: number,
  ttlMs: number,
  error: unknown
): CapabilitySnapshot {
  const reason = error instanceof Error ? error.message : 'capability snapshot failed'
  const generatedAt = new Date(nowMs).toISOString()
  const item = capabilityItem({
    id: 'catalog',
    kind: 'tools_master',
    name: 'Teaching capability catalog',
    status: 'degraded',
    reason: safeReason(reason),
    promptEligible: false
  })
  return {
    generatedAt,
    freshness: {
      capturedAt: generatedAt,
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
      ttlMs,
      stale: true
    },
    policyId: request.mode === 'temporary' ? 'temporary_chat' : 'teaching_readonly',
    items: [item],
    available: []
  }
}

function describeToolsMaster(_settings: TeachingSettingsV1): CapabilityItem {
  return capabilityItem({
    id: 'tools',
    kind: 'tools_master',
    name: 'Agent tools',
    status: 'available',
    reason: 'application-level tool availability is enabled',
    promptEligible: true
  })
}

function describeModelProvider(settings: TeachingSettingsV1): CapabilityItem {
  const provider = resolveActiveProvider(settings)
  if (!provider) {
    return capabilityItem({
      id: 'model_provider',
      kind: 'model_provider',
      name: 'Model provider',
      status: 'unconfigured',
      reason: 'no active model provider is configured',
      promptEligible: false
    })
  }
  if (!provider.apiKey.trim()) {
    return capabilityItem({
      id: `model_provider:${provider.id}`,
      kind: 'model_provider',
      name: provider.name,
      status: 'unconfigured',
      reason: 'active model provider has no API key',
      promptEligible: false,
      details: { providerId: provider.id }
    })
  }
  if (!provider.baseUrl.trim()) {
    return capabilityItem({
      id: `model_provider:${provider.id}`,
      kind: 'model_provider',
      name: provider.name,
      status: 'unconfigured',
      reason: 'active model provider has no base URL',
      promptEligible: false,
      details: { providerId: provider.id }
    })
  }
  return capabilityItem({
    id: `model_provider:${provider.id}`,
    kind: 'model_provider',
    name: provider.name,
    status: 'available',
    reason: 'active model provider is configured',
    promptEligible: true,
    details: {
      providerId: provider.id,
      model: settings.generator.model,
      endpointFormat: provider.endpointFormat
    }
  })
}

function describeWebSearch(
  settings: TeachingSettingsV1,
  policy: TeachingCapabilityPolicy,
  workspaceRoot: string | null | undefined,
  toolPolicyDocument?: ToolPolicyDocument | null
): CapabilityItem {
  if (!settings.tools.webSearch) {
    return capabilityItem({
      id: 'web_search',
      kind: 'web_search',
      name: 'Web search',
      status: 'disabled',
      reason: 'tools.webSearch is false',
      promptEligible: false
    })
  }
  if (!policy.allowsTool('web_search')) {
    return capabilityItem({
      id: 'web_search',
      kind: 'web_search',
      name: 'Web search',
      status: 'denied',
      reason: `capability policy ${policy.id} denies web_search`,
      promptEligible: false
    })
  }

  const context = buildToolContext(settings, {
    workspaceRoot,
    ...toolPolicyDocumentOption(toolPolicyDocument ?? null)
  })
  const configured = resolveConfiguredProvider(context)

  if (configured.requestedBackend) {
    if (!configured.normalizedName) {
      return capabilityItem({
        id: 'web_search',
        kind: 'web_search',
        name: 'Web search',
        status: 'degraded',
        reason: `unknown search backend: ${configured.requestedBackend}`,
        promptEligible: false,
        details: { backend: configured.requestedBackend }
      })
    }
    const provider = configured.provider ?? searchProviders.find((item) => item.name === configured.normalizedName)
    if (!provider) {
      return capabilityItem({
        id: 'web_search',
        kind: 'web_search',
        name: 'Web search',
        status: 'degraded',
        reason: `search backend is not registered: ${configured.normalizedName}`,
        promptEligible: false,
        details: { backend: configured.normalizedName }
      })
    }
    if (!provider.isAvailable(context)) {
      return capabilityItem({
        id: `web_search:${provider.name}`,
        kind: 'web_search',
        name: provider.label,
        status: 'unconfigured',
        reason: provider.unavailableReason(context) || `${provider.label} is not configured`,
        promptEligible: false,
        details: { backend: provider.name }
      })
    }
    return capabilityItem({
      id: `web_search:${provider.name}`,
      kind: 'web_search',
      name: provider.label,
      status: 'available',
      reason: `${provider.label} is configured`,
      promptEligible: true,
      details: { backend: provider.name }
    })
  }

  const providers = availableProviders(context)
  const labels = providers.map((provider: SearchProvider) => provider.label).join(', ')
  return capabilityItem({
    id: 'web_search',
    kind: 'web_search',
    name: 'Web search',
    status: 'available',
    reason: labels ? `auto mode candidates: ${labels}` : 'auto mode with built-in fallback',
    promptEligible: true,
    details: {
      backend: 'auto',
      candidates: providers.map((provider) => provider.name).join(',')
    }
  })
}

function describeWebFetch(
  settings: TeachingSettingsV1,
  policy: TeachingCapabilityPolicy
): CapabilityItem {
  if (!settings.tools.webFetch) {
    return capabilityItem({
      id: 'web_fetch',
      kind: 'web_fetch',
      name: 'Web fetch',
      status: 'disabled',
      reason: 'tools.webFetch is false',
      promptEligible: false
    })
  }
  if (!policy.allowsTool('web_fetch')) {
    return capabilityItem({
      id: 'web_fetch',
      kind: 'web_fetch',
      name: 'Web fetch',
      status: 'denied',
      reason: `capability policy ${policy.id} denies web_fetch`,
      promptEligible: false
    })
  }
  return capabilityItem({
    id: 'web_fetch',
    kind: 'web_fetch',
    name: 'Web fetch',
    status: 'available',
    reason: 'web_fetch is enabled by settings and policy',
    promptEligible: true
  })
}

function describeWorkspaceTools(
  settings: TeachingSettingsV1,
  policy: TeachingCapabilityPolicy,
  hasTeachingWorkspace: boolean,
  workspaceToolAccessGranted: boolean
): CapabilityItem {
  if (!settings.tools.workspaceRead) {
    return capabilityItem({
      id: 'workspace_tools',
      kind: 'workspace_tools',
      name: 'Workspace tools',
      status: 'disabled',
      reason: 'tools.workspaceRead is false',
      promptEligible: false
    })
  }
  if (!hasTeachingWorkspace) {
    return capabilityItem({
      id: 'workspace_tools',
      kind: 'workspace_tools',
      name: 'Workspace tools',
      status: 'unconfigured',
      reason: 'no teaching workspace is selected',
      promptEligible: false
    })
  }
  if (!workspaceToolAccessGranted) {
    return capabilityItem({
      id: 'workspace_tools',
      kind: 'workspace_tools',
      name: 'Workspace tools',
      status: 'denied',
      reason: 'workspace tool access is not granted',
      promptEligible: false
    })
  }
  if (!policy.workspaceToolsEnabled) {
    return capabilityItem({
      id: 'workspace_tools',
      kind: 'workspace_tools',
      name: 'Workspace tools',
      status: 'denied',
      reason: `capability policy ${policy.id} denies workspace tools`,
      promptEligible: false
    })
  }
  const shellEnabled = settings.tools.workspaceShell !== false
  return capabilityItem({
    id: 'workspace_tools',
    kind: 'workspace_tools',
    name: 'Workspace tools',
    status: 'available',
    reason: shellEnabled
      ? 'trusted teaching workspace tools are enabled; includes run_workspace_command/shell when workspaceShell is on'
      : 'trusted teaching workspace tools are enabled; workspaceShell is off so shell tools are not claimed',
    promptEligible: true,
    details: {
      workspaceShell: shellEnabled,
      ...(shellEnabled
        ? {
            shellTools: 'run_workspace_command,shell'
          }
        : {
            shellTools: 'disabled'
          })
    }
  })
}

function describeDelegation(policy: TeachingCapabilityPolicy): CapabilityItem {
  if (!policy.delegationEnabled) {
    return capabilityItem({
      id: 'delegation',
      kind: 'delegation',
      name: 'Delegation tools',
      status: policy.id === 'temporary_chat' ? 'denied' : 'disabled',
      reason: `capability policy ${policy.id} does not enable delegation`,
      promptEligible: false
    })
  }
  return capabilityItem({
    id: 'delegation',
    kind: 'delegation',
    name: 'Delegation tools',
    status: 'available',
    reason: `capability policy ${policy.id} enables delegation`,
    promptEligible: true
  })
}

function describeLesson(
  policy: TeachingCapabilityPolicy,
  hasLessonGenerator: boolean,
  hasTeachingWorkspace: boolean
): CapabilityItem {
  if (!hasTeachingWorkspace) {
    return capabilityItem({
      id: 'lesson',
      kind: 'lesson',
      name: 'Lesson generation',
      status: 'unconfigured',
      reason: 'no teaching workspace is selected',
      promptEligible: false
    })
  }
  if (!hasLessonGenerator) {
    return capabilityItem({
      id: 'lesson',
      kind: 'lesson',
      name: 'Lesson generation',
      status: 'unconfigured',
      reason: 'lesson generator is not available',
      promptEligible: false
    })
  }
  if (!policy.lessonToolEnabled) {
    return capabilityItem({
      id: 'lesson',
      kind: 'lesson',
      name: 'Lesson generation',
      status: 'denied',
      reason: `capability policy ${policy.id} denies generate_lesson`,
      promptEligible: false
    })
  }
  return capabilityItem({
    id: 'lesson',
    kind: 'lesson',
    name: 'Lesson generation',
    status: 'available',
    reason: 'lesson generation is enabled by policy and generator readiness',
    promptEligible: true
  })
}

function describeSkills(
  skills: readonly SkillSummary[] | undefined,
  skillLoadError: string | undefined,
  policy: TeachingCapabilityPolicy
): CapabilityItem[] {
  if (skillLoadError) {
    return [
      capabilityItem({
        id: 'skills',
        kind: 'skill',
        name: 'Skill library',
        status: 'degraded',
        reason: safeReason(skillLoadError),
        promptEligible: false
      })
    ]
  }

  if (!skills) {
    return [
      capabilityItem({
        id: 'skills',
        kind: 'skill',
        name: 'Skill library',
        status: 'unconfigured',
        reason: 'skill summaries were not provided to the catalog',
        promptEligible: false
      })
    ]
  }

  if (!policy.allowsTool('read_skill_resource')) {
    return skills.map((skill) =>
      capabilityItem({
        id: `skill:${skill.id}`,
        kind: 'skill',
        name: skill.name,
        status: 'denied',
        reason: `capability policy ${policy.id} denies read_skill_resource`,
        promptEligible: false,
        details: {
          skillId: skill.id,
          installed: skill.installed,
          source: skill.source
        }
      })
    )
  }

  return skills.map((skill) => {
    if (skill.source === 'builtin' && !skill.installed) {
      // Built-ins remain discoverable from the library but are not prompt-ready
      // until installed into the personal skill root.
      return capabilityItem({
        id: `skill:${skill.id}`,
        kind: 'skill',
        name: skill.name,
        status: 'unconfigured',
        reason: 'built-in skill is not installed',
        promptEligible: false,
        details: {
          skillId: skill.id,
          installed: false,
          source: skill.source
        }
      })
    }
    if (!skill.installed && skill.source === 'personal') {
      return capabilityItem({
        id: `skill:${skill.id}`,
        kind: 'skill',
        name: skill.name,
        status: 'degraded',
        reason: 'personal skill is not marked installed',
        promptEligible: false,
        details: {
          skillId: skill.id,
          installed: false,
          source: skill.source
        }
      })
    }
    return capabilityItem({
      id: `skill:${skill.id}`,
      kind: 'skill',
      name: skill.name,
      status: 'available',
      reason: skill.installed ? 'skill is installed and policy allows skill resources' : 'skill is available',
      promptEligible: true,
      details: {
        skillId: skill.id,
        installed: skill.installed,
        source: skill.source,
        command: skill.command
      }
    })
  })
}

function capabilityItem(input: {
  id: string
  kind: CapabilityKind
  name: string
  status: CapabilityStatus
  reason: string
  promptEligible: boolean
  details?: Readonly<Record<string, string | number | boolean | null | undefined>>
}): CapabilityItem {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    status: input.status,
    reason: input.reason,
    // Disabled / unconfigured / denied / degraded never enter prompt inputs.
    promptEligible: input.promptEligible && input.status === 'available',
    ...(input.details ? { details: input.details } : {})
  }
}

function safeReason(reason: string): string {
  return reason.replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown capability failure'
}

function buildCacheKey(request: TeachingCapabilityCatalogRequest): string {
  // Settings objects may be large; key only the fields that affect readiness.
  const settings = request.settings
  const skillIds = (request.skills ?? [])
    .map((skill) => `${skill.id}:${skill.installed ? 1 : 0}:${skill.source}`)
    .sort()
    .join('|')
  return JSON.stringify({
    mode: request.mode ?? 'teaching',
    hasTeachingWorkspace: request.hasTeachingWorkspace === true,
    workspaceToolAccessGranted: request.workspaceToolAccessGranted === true,
    hasLessonGenerator: request.hasLessonGenerator === true,
    workspaceRoot: request.workspaceRoot ?? null,
    toolPolicyDocument: request.toolPolicyDocument ?? null,
    skillLoadError: request.skillLoadError ?? null,
    skillIds,
    tools: settings.tools,
    webSearch: {
      backend: settings.webSearch.backend,
      fallbackEnabled: settings.webSearch.fallbackEnabled,
      searxngUrl: Boolean(settings.webSearch.searxngUrl),
      braveApiKey: Boolean(settings.webSearch.braveApiKey),
      firecrawlApiKey: Boolean(settings.webSearch.firecrawlApiKey),
      firecrawlApiUrl: Boolean(settings.webSearch.firecrawlApiUrl),
      tavilyApiKey: Boolean(settings.webSearch.tavilyApiKey),
      exaApiKey: Boolean(settings.webSearch.exaApiKey),
      parallelApiKey: Boolean(settings.webSearch.parallelApiKey),
      xaiApiKey: Boolean(settings.webSearch.xaiApiKey)
    },
    provider: {
      activeProviderId: settings.provider.activeProviderId,
      generatorProviderId: settings.generator.providerId,
      generatorModel: settings.generator.model,
      providers: settings.provider.providers.map((provider) => ({
        id: provider.id,
        // Presence-only (ADR-0148): never hash or embed the key material.
        hasApiKey: provider.apiKey.trim().length > 0,
        hasBaseUrl: provider.baseUrl.trim().length > 0,
        endpointFormat: provider.endpointFormat
      }))
    }
  })
}
