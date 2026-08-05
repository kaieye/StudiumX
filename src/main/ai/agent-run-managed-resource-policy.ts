/**
 * Host-owned deployment resource policy extracted from the optional managed
 * configuration document (ADR-0092 / ADR-0171).
 *
 * This is deliberately a narrow, secret-free projection. The document is read
 * only from the main-process managed root (normally Electron userData), never
 * from the renderer, workspace, prompt, or start payload. Missing or malformed
 * data creates no policy rather than inventing an implicit low run limit.
 */

import type { AgentRunResourceLimit, AgentRunResourceLimitSet } from '../../shared/teaching-types'
import {
  loadManagedConfigDocumentFromRoot,
  type LoadManagedConfigDocumentInput
} from '../teaching-managed-config-fs'

const RESOURCE_METERS = new Set<AgentRunResourceLimit['meter']>([
  'logical_requests',
  'provider_transport_attempts',
  'tool_operation_attempts',
  'duration_ms',
  'total_tokens'
])

const RESOURCE_SCOPES = new Set<AgentRunResourceLimit['scope']>([
  'task',
  'run',
  'workspace',
  'tenant',
  'deployment'
])

const MAX_AUDIT_ID_LENGTH = 160

/**
 * Managed document shape (all other managed teaching-config fields remain
 * independent):
 *
 * {
 *   "resourceGovernance": {
 *     "deploymentPolicy": {
 *       "limits": [{ "meter": "total_tokens", "limit": 100000, "scope": "tenant" }]
 *     }
 *   }
 * }
 */
export type ManagedDeploymentResourcePolicyDocument = Readonly<{
  resourceGovernance?: Readonly<{
    deploymentPolicy?: unknown
  }>
}>

/**
 * Load and project deployment/organization limits at run start. The returned
 * value is suitable only for `loadDeploymentPolicy` at the main-process
 * composition root; it is not an IPC or settings DTO.
 */
export async function loadManagedDeploymentResourcePolicyFromRoot(
  input: LoadManagedConfigDocumentInput
): Promise<AgentRunResourceLimitSet | undefined> {
  return extractManagedDeploymentResourcePolicy(await loadManagedConfigDocumentFromRoot(input))
}

/**
 * Pure, defensive projection for unit tests and managed-config composition.
 * Unknown fields (including any accidental secret-like values) are never
 * preserved. Invalid limit entries are dropped, and an all-invalid policy is
 * omitted entirely.
 */
export function extractManagedDeploymentResourcePolicy(
  document: unknown
): AgentRunResourceLimitSet | undefined {
  if (!isPlainObject(document)) return undefined
  const governance = document.resourceGovernance
  if (!isPlainObject(governance)) return undefined
  const policy = governance.deploymentPolicy
  if (!isPlainObject(policy) || !Array.isArray(policy.limits)) return undefined

  const limits = policy.limits.flatMap((entry) => {
    const normalized = normalizeManagedLimit(entry)
    return normalized ? [Object.freeze(normalized)] : []
  })
  return limits.length > 0 ? Object.freeze({ limits: Object.freeze(limits) }) : undefined
}

function normalizeManagedLimit(value: unknown): AgentRunResourceLimit | undefined {
  if (!isPlainObject(value)) return undefined
  const meter = value.meter
  const scope = value.scope
  const limit = value.limit
  if (
    typeof meter !== 'string' || !RESOURCE_METERS.has(meter as AgentRunResourceLimit['meter']) ||
    typeof scope !== 'string' || !RESOURCE_SCOPES.has(scope as AgentRunResourceLimit['scope']) ||
    typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0
  ) return undefined

  const auditId = normalizeAuditId(value.auditId)
  return {
    meter: meter as AgentRunResourceLimit['meter'],
    scope: scope as AgentRunResourceLimit['scope'],
    limit,
    ...(auditId ? { auditId } : {})
  }
}

function normalizeAuditId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, MAX_AUDIT_ID_LENGTH)
  return trimmed || undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

