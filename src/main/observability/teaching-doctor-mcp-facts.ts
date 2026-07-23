/**
 * Fail-soft TeachingDoctor MCP facts collector (ADR-0128 Phase E + ADR-0133/0135/0137/0140).
 *
 * Emits aggregate-only, secret-free MCP status for doctor evidence.
 * Never includes env secrets, headers, tokens, raw command tokens beyond redacted
 * labels, generation/retry metadata, or tool names/schemas.
 *
 * Optional per-server inventory aggregates and authorizationState are secret-free
 * lifecycle categories only (ADR-0133 / ADR-0135). Optional multi-source aggregates
 * and marketplace emergency flag are counts/booleans only (ADR-0137 / ADR-0140).
 *
 * Non-claims:
 * - no auto-repair (autoConnectEnabled is status only)
 * - no marketplace catalog payloads
 * - no free-form renderer facts
 */

import type {
  TeachingDoctorFacts,
  TeachingDoctorMcpFacts,
  TeachingDoctorMcpServerFacts
} from '../../shared/teaching-types/teaching-doctor'
import type { TeachingDoctorFactsCollector } from './teaching-doctor-facts-assemble'
import type { UserMcpConfigV1, McpRuntimeServerView } from '../../shared/mcp/types'
import { redactMcpCommandLine } from '../mcp/redact'

export const TEACHING_DOCTOR_MCP_CONFIG_PATH_LABEL = 'userData/mcp/config.v1.json'

/** Optional host aggregates — counts/flags only, never paths or secrets. */
export type TeachingDoctorMcpHostAggregates = Readonly<{
  effectiveSourceCount?: number
  sourceWarningCount?: number
  marketplaceEmergencyDisabled?: boolean
}>

export type TeachingDoctorMcpFactsSource = {
  /** Load durable MCP config (may throw — fail-soft). */
  loadConfig(): Promise<UserMcpConfigV1 | null>
  /** Current process runtime view (no secrets). */
  listRuntime(): readonly McpRuntimeServerView[]
  /** Optional multi-source / marketplace aggregates from host. */
  getHostAggregates?(): TeachingDoctorMcpHostAggregates | null
}

export type CreateTeachingDoctorMcpFactsCollectorOptions = {
  configPathLabel?: string
}

export function createTeachingDoctorMcpFactsCollector(
  source: TeachingDoctorMcpFactsSource,
  options?: CreateTeachingDoctorMcpFactsCollectorOptions
): TeachingDoctorFactsCollector {
  const configPath =
    typeof options?.configPathLabel === 'string' && options.configPathLabel.trim()
      ? options.configPathLabel.trim().slice(0, 256)
      : TEACHING_DOCTOR_MCP_CONFIG_PATH_LABEL

  return {
    id: 'mcp-status',
    async collect(): Promise<Partial<TeachingDoctorFacts>> {
      try {
        const config = await source.loadConfig()
        const runtime = source.listRuntime() ?? []
        let aggregates: TeachingDoctorMcpHostAggregates | null = null
        try {
          aggregates = source.getHostAggregates?.() ?? null
        } catch {
          aggregates = null
        }
        return { mcp: mapMcpFacts(config, runtime, configPath, aggregates) }
      } catch {
        return {
          mcp: {
            implementationPresent: true,
            rootEnabled: false,
            autoConnectEnabled: false,
            serverCount: 0,
            enabledServerCount: 0,
            connectedServerCount: 0,
            errorServerCount: 0,
            servers: [],
            configPathLabel: configPath
          }
        }
      }
    }
  }
}

export function mapMcpFacts(
  config: UserMcpConfigV1 | null | undefined,
  runtime: readonly McpRuntimeServerView[],
  configPathLabel: string = TEACHING_DOCTOR_MCP_CONFIG_PATH_LABEL,
  hostAggregates?: TeachingDoctorMcpHostAggregates | null
): TeachingDoctorMcpFacts {
  if (!config) {
    return {
      implementationPresent: true,
      rootEnabled: false,
      autoConnectEnabled: false,
      serverCount: 0,
      enabledServerCount: 0,
      connectedServerCount: 0,
      errorServerCount: 0,
      servers: [],
      configPathLabel,
      ...projectHostAggregates(hostAggregates)
    }
  }

  const runtimeById = new Map(runtime.map((item) => [item.id, item]))
  const servers: TeachingDoctorMcpServerFacts[] = config.servers.slice(0, 32).map((server) => {
    const rt = runtimeById.get(server.id)
    const redacted = redactMcpCommandLine(server.command, server.args)
    const commandLabel = redacted.command
      ? `${redacted.command}${redacted.args.length ? ' …' : ''}`.slice(0, 120)
      : null
    const inventory = doctorInventory(rt)
    const authorizationState = doctorAuthorizationState(rt)
    return {
      id: server.id.slice(0, 64),
      enabled: server.enabled === true,
      transport: server.transport,
      state: rt?.state ?? (server.enabled && config.enabled ? 'idle' : 'disabled'),
      // Prefer admitted inventory count for the legacy toolCount slot.
      // Never copy cursors, timestamps, retry metadata, error text, generations,
      // tool names, schemas, tokens, or secret refs.
      toolCount: doctorToolCount(rt),
      errorCode: rt?.errorCode ?? null,
      commandLabel,
      ...(inventory ? { inventory } : {}),
      ...(authorizationState ? { authorizationState } : {})
    }
  })

  const enabledServerCount = servers.filter((s) => s.enabled).length
  const connectedServerCount = servers.filter((s) => s.state === 'connected').length
  // Phase A distinguishes a failed attempt and a lost transport from the
  // legacy `error` spelling. All three are non-healthy states for the existing
  // aggregate error counter; the exact state remains visible per server.
  const errorServerCount = servers.filter((s) => isDoctorErrorState(s.state)).length

  return {
    implementationPresent: true,
    rootEnabled: config.enabled === true,
    autoConnectEnabled: config.enabled === true && config.autoConnect !== false,
    serverCount: config.servers.length,
    enabledServerCount,
    connectedServerCount,
    errorServerCount,
    servers,
    configPathLabel,
    ...projectHostAggregates(hostAggregates)
  }
}

function projectHostAggregates(
  aggregates: TeachingDoctorMcpHostAggregates | null | undefined
): Partial<TeachingDoctorMcpFacts> {
  if (!aggregates) return {}
  const out: Partial<TeachingDoctorMcpFacts> = {}
  const sources = nonNegativeIntegerOrNull(aggregates.effectiveSourceCount)
  if (sources != null) out.effectiveSourceCount = sources
  const warnings = nonNegativeIntegerOrNull(aggregates.sourceWarningCount)
  if (warnings != null) out.sourceWarningCount = warnings
  if (typeof aggregates.marketplaceEmergencyDisabled === 'boolean') {
    out.marketplaceEmergencyDisabled = aggregates.marketplaceEmergencyDisabled
  }
  return out
}

/**
 * Preserve the Doctor contract's single secret-free tool count while accepting
 * Phase A's inventory summary. Prefer `registeredToolCount` when legacy count
 * is absent: it reflects tools admitted after local safety checks.
 */
function doctorToolCount(runtime: McpRuntimeServerView | undefined): number | null {
  const registered = nonNegativeIntegerOrNull(runtime?.inventory?.registeredToolCount)
  if (registered != null) return registered
  return nonNegativeIntegerOrNull(runtime?.toolCount)
}

/** Aggregate inventory only — no tool names, schemas, cursors, or generations. */
function doctorInventory(
  runtime: McpRuntimeServerView | undefined
): TeachingDoctorMcpServerFacts['inventory'] {
  const inv = runtime?.inventory
  if (!inv) return null
  const discoveredToolCount = nonNegativeIntegerOrNull(inv.discoveredToolCount)
  const registeredToolCount = nonNegativeIntegerOrNull(inv.registeredToolCount)
  const rejectedToolCount = nonNegativeIntegerOrNull(inv.rejectedToolCount)
  if (
    discoveredToolCount == null ||
    registeredToolCount == null ||
    rejectedToolCount == null
  ) {
    return null
  }
  return {
    discoveredToolCount,
    registeredToolCount,
    rejectedToolCount,
    stale: inv.stale === true
  }
}

const OAUTH_PUBLIC_STATES = new Set([
  'authorization_required',
  'authorizing',
  'authorized',
  'authorization_failed'
])

/** Secret-free OAuth category only — never token/url/code/error text. */
function doctorAuthorizationState(
  runtime: McpRuntimeServerView | undefined
): string | null {
  const state = runtime?.authorization?.state
  if (typeof state !== 'string' || !OAUTH_PUBLIC_STATES.has(state)) return null
  return state
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null
  return value
}

function isDoctorErrorState(state: string): boolean {
  return state === 'error' || state === 'failed' || state === 'disconnected'
}
