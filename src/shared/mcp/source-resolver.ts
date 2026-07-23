/**
 * Pure multi-source MCP config merge (ADR-0137 Phase E).
 * No filesystem / env access — layers are provided by main loaders or tests.
 */

import {
  MCP_CONFIG_SOURCE_PRECEDENCE,
  type McpConfigSourceLayer,
  type McpEffectiveConfigViewV1,
  type McpEffectiveServerV1,
  type McpShadowedServerV1,
  type McpUserGateFields
} from './source-types'
import type { UserMcpConfigV1, UserMcpServerV1 } from './types'

export type ResolveMcpSourcesInput = Readonly<{
  /** Layers in any order; merge uses origin.kind precedence. */
  layers: readonly McpConfigSourceLayer[]
  /**
   * Root MCP switch + autoConnect come only from the user gate
   * (durable userData config). Lower sources cannot force root on.
   */
  userGate: McpUserGateFields
  /** Optional extra warnings (e.g. missing workspace file). */
  warnings?: readonly string[]
}>

/**
 * Merge layered server maps into an effective list + shadowed entries.
 *
 * Rules (ADR-0137):
 * 1. Same server id: highest precedence source (lowest rank number) wins the full record.
 * 2. Losers become shadowed with reason `id_collision` (full record retained for UI).
 * 3. Within equal kind, first layer in input order wins (stable).
 * 4. Root `enabled` / `autoConnect` come only from `userGate` (never from workspace/plugin).
 */
export function resolveMcpConfigSources(
  input: ResolveMcpSourcesInput
): McpEffectiveConfigViewV1 {
  const warnings = [...(input.warnings ?? [])]
  const layers = [...input.layers].sort((a, b) => {
    const ra = MCP_CONFIG_SOURCE_PRECEDENCE[a.origin.kind]
    const rb = MCP_CONFIG_SOURCE_PRECEDENCE[b.origin.kind]
    if (ra !== rb) return ra - rb
    return 0
  })

  const winners = new Map<string, McpEffectiveServerV1>()
  const shadowed: McpShadowedServerV1[] = []

  // Process high → low so first claim of an id is the winner.
  for (const layer of layers) {
    const seenInLayer = new Set<string>()
    for (const server of layer.servers) {
      if (seenInLayer.has(server.id)) {
        warnings.push(
          `duplicate server id "${server.id}" within source ${layer.origin.kind}:${layer.origin.label}; skipped extra`
        )
        continue
      }
      seenInLayer.add(server.id)

      const existing = winners.get(server.id)
      if (!existing) {
        winners.set(server.id, { server, source: layer.origin })
        continue
      }
      // Existing winner has higher or equal precedence (processed earlier).
      shadowed.push({
        server,
        source: layer.origin,
        shadowedByServerId: existing.server.id,
        shadowedBySource: existing.source,
        reason: 'id_collision'
      })
    }
  }

  // Stable order: by source precedence then id.
  const effectiveServers = [...winners.values()].sort((a, b) => {
    const ra = MCP_CONFIG_SOURCE_PRECEDENCE[a.source.kind]
    const rb = MCP_CONFIG_SOURCE_PRECEDENCE[b.source.kind]
    if (ra !== rb) return ra - rb
    return a.server.id.localeCompare(b.server.id)
  })

  return {
    enabled: input.userGate.enabled,
    autoConnect: input.userGate.autoConnect,
    effectiveServers,
    shadowed,
    warnings
  }
}

/** Build a single user layer from durable UserMcpConfigV1. */
export function userLayerFromConfig(config: UserMcpConfigV1): McpConfigSourceLayer {
  return {
    origin: { kind: 'user', label: 'userData/mcp/config.v1.json' },
    servers: config.servers
  }
}

/**
 * Root gates from durable user config (ADR-0141).
 * autoConnect uses effective rule: enabled && autoConnect !== false
 * so omitted autoConnect counts as on when MCP root is enabled.
 */
export function userGateFromConfig(config: UserMcpConfigV1): McpUserGateFields {
  return {
    enabled: config.enabled,
    autoConnect: config.enabled && config.autoConnect !== false
  }
}

/**
 * Resolve when only user config is present — behavior identical to pre-Phase-E
 * session materialization (same server list, same root flags).
 */
export function resolveUserOnlyConfig(config: UserMcpConfigV1): McpEffectiveConfigViewV1 {
  return resolveMcpConfigSources({
    layers: [userLayerFromConfig(config)],
    userGate: userGateFromConfig(config)
  })
}

/**
 * Servers eligible for auto-connect discovery (not tools/call).
 *
 * Requires:
 * - userGate.enabled
 * - userGate.autoConnect
 * - server.enabled
 * - optional OAuth: when server.oauth is set, caller must pass isOAuthReady(serverId)
 *   true; if not provided, OAuth-configured servers are skipped (blocking).
 */
export type AutoConnectEligibilityOptions = Readonly<{
  isOAuthReady?: (server: UserMcpServerV1) => boolean
  maxConcurrent?: number
  workspaceRoot?: string | null
}>

export function autoConnectEligibleServers(
  view: McpEffectiveConfigViewV1,
  options: AutoConnectEligibilityOptions = {}
): readonly McpEffectiveServerV1[] {
  if (!view.enabled || !view.autoConnect) return []

  const max = options.maxConcurrent ?? DEFAULT_MAX_AUTO_CONNECT
  const out: McpEffectiveServerV1[] = []

  for (const entry of view.effectiveServers) {
    if (out.length >= max) break
    if (!entry.server.enabled) continue
    if (!serverMatchesWorkspaceScope(entry.server, options.workspaceRoot)) continue
    if (entry.server.oauth && entry.server.transport !== 'stdio') {
      const ready = options.isOAuthReady?.(entry.server) === true
      if (!ready) continue
    }
    out.push(entry)
  }
  return out
}

/** Default hard cap for concurrent auto-connect discovery (ADR-0137). */
export const DEFAULT_MAX_AUTO_CONNECT = 4

function serverMatchesWorkspaceScope(
  server: UserMcpServerV1,
  workspaceRoot?: string | null
): boolean {
  if (server.scope !== 'workspace') return true
  if (!workspaceRoot || !server.workspaceRoot) return false
  return normalizePath(server.workspaceRoot) === normalizePath(workspaceRoot)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}
