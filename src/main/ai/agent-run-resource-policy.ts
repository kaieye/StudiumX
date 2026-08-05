import type {
  AgentRunResourceGovernance,
  AgentRunResourceLimit,
  AgentRunResourceLimitSet,
  TeachingSettingsV1
} from '../../shared/teaching-types'

/**
 * Stable, non-secret facts available to host-owned resource policy resolution.
 * This deliberately contains no renderer-supplied limits, prompt text, provider
 * credentials, or approval grants.
 */
export type AgentRunResourcePolicyContext = Readonly<{
  runId: string
  workspaceId?: string
  conversationId?: string
  mode: 'teaching' | 'temporary'
}>

/**
 * Immutable run-start decision. It is a local policy snapshot, not teaching
 * evidence and never an assertion about a provider account quota or billing.
 */
export type AgentRunResourcePolicySnapshot = Readonly<{
  version: 1
  resolvedAt: string
  governance: AgentRunResourceGovernance
}>

/** Main-process seam: each source is loaded by its owner, never by IPC input. */
export type AgentRunResourcePolicyResolver = (
  context: AgentRunResourcePolicyContext
) => Promise<AgentRunResourcePolicySnapshot>

export type CreateAgentRunResourcePolicyResolverOptions = Readonly<{
  /** User-selected limits from a host-validated settings/start-action store. */
  loadUserBudget?: (context: AgentRunResourcePolicyContext) =>
    | AgentRunResourceLimitSet
    | undefined
    | Promise<AgentRunResourceLimitSet | undefined>
  /** Deployment/organization limits from main-process policy only. */
  loadDeploymentPolicy?: (context: AgentRunResourcePolicyContext) =>
    | AgentRunResourceLimitSet
    | undefined
    | Promise<AgentRunResourceLimitSet | undefined>
  /** Optional additional high emergency limits; the governor always adds its own baseline fuse. */
  emergencyFuse?: AgentRunResourceLimitSet
  now?: () => Date
}>

/**
 * Compose the three ADR-0171 sources at the host boundary. There is no merge
 * precedence that weakens a lower layer: the governor enforces every retained
 * limit and the first boundary is the terminal reason. Invalid entries are
 * dropped rather than turning malformed renderer/config data into authority.
 */
export function createAgentRunResourcePolicyResolver(
  options: CreateAgentRunResourcePolicyResolverOptions = {}
): AgentRunResourcePolicyResolver {
  const now = options.now ?? (() => new Date())
  return async (context) => snapshotAgentRunResourcePolicy({
    userBudget: await options.loadUserBudget?.(freezeContext(context)),
    deploymentPolicy: await options.loadDeploymentPolicy?.(freezeContext(context)),
    emergencyFuse: options.emergencyFuse,
    resolvedAt: now().toISOString()
  })
}

/** A no-config resolver still records an explicit run-start snapshot. */
export const resolveUnconstrainedAgentRunResourcePolicy: AgentRunResourcePolicyResolver = async () =>
  snapshotAgentRunResourcePolicy({ resolvedAt: new Date().toISOString() })

/**
 * Projects the persisted, user-owned explicit budget into the generic host
 * policy contract. The caller must load normalized settings in the main
 * process; this helper never reads IPC/start payload data.
 */
export function userAgentRunResourceBudgetFromSettings(
  settings: Pick<TeachingSettingsV1, 'resourceBudget'>
): AgentRunResourceLimitSet | undefined {
  const budget = settings.resourceBudget
  if (!budget.enabled) return undefined
  return {
    limits: [
      { meter: 'provider_transport_attempts', limit: budget.providerTransportAttempts, scope: 'run', auditId: 'user_budget.provider_transport_attempts' },
      { meter: 'tool_operation_attempts', limit: budget.toolOperationAttempts, scope: 'run', auditId: 'user_budget.tool_operation_attempts' },
      { meter: 'duration_ms', limit: budget.durationMinutes * 60_000, scope: 'run', auditId: 'user_budget.duration_minutes' },
      { meter: 'total_tokens', limit: budget.totalTokens, scope: 'run', auditId: 'user_budget.total_tokens' }
    ]
  }
}

export function snapshotAgentRunResourcePolicy(input: {
  userBudget?: AgentRunResourceLimitSet
  deploymentPolicy?: AgentRunResourceLimitSet
  emergencyFuse?: AgentRunResourceLimitSet
  resolvedAt: string
}): AgentRunResourcePolicySnapshot {
  const userBudget = cloneLimitSet(input.userBudget)
  const deploymentPolicy = cloneLimitSet(input.deploymentPolicy)
  const emergencyFuse = cloneLimitSet(input.emergencyFuse)
  const governance: AgentRunResourceGovernance = {
    ...(userBudget ? { userBudget } : {}),
    ...(deploymentPolicy ? { deploymentPolicy } : {}),
    ...(emergencyFuse ? { emergencyFuse } : {})
  }
  return Object.freeze({
    version: 1,
    resolvedAt: normalizeResolvedAt(input.resolvedAt),
    governance: Object.freeze(governance)
  })
}

function cloneLimitSet(input: AgentRunResourceLimitSet | undefined): AgentRunResourceLimitSet | undefined {
  if (!input || !Array.isArray(input.limits)) return undefined
  const limits = input.limits.flatMap((limit) => {
    const normalized = normalizeLimit(limit)
    return normalized ? [Object.freeze(normalized)] : []
  })
  return limits.length > 0 ? Object.freeze({ limits: Object.freeze(limits) }) : undefined
}

function normalizeLimit(limit: AgentRunResourceLimit): AgentRunResourceLimit | undefined {
  if (!limit || typeof limit !== 'object') return undefined
  const meter = limit.meter
  const scope = limit.scope
  const amount = Number.isSafeInteger(limit.limit) ? limit.limit : 0
  if (
    !['logical_requests', 'provider_transport_attempts', 'tool_operation_attempts', 'duration_ms', 'total_tokens'].includes(meter) ||
    !['task', 'run', 'workspace', 'tenant', 'deployment'].includes(scope) ||
    amount <= 0
  ) return undefined
  const auditId = typeof limit.auditId === 'string' && limit.auditId.trim()
    ? limit.auditId.trim().slice(0, 160)
    : undefined
  return { meter, scope, limit: amount, ...(auditId ? { auditId } : {}) }
}

function normalizeResolvedAt(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date(0).toISOString()
}

function freezeContext(context: AgentRunResourcePolicyContext): AgentRunResourcePolicyContext {
  return Object.freeze({ ...context })
}