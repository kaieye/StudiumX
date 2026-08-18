/**
 * Multi-source MCP config provenance types (ADR-0013).
 * Pure types only — no Node / Electron / FS.
 */

import type { UserMcpConfigV1, UserMcpServerV1 } from './types'

/** Configuration origin kinds, high → low precedence when ordering is needed. */
export type McpConfigSourceKind =
  | 'cli'
  | 'environment'
  | 'user'
  | 'workspace'
  | 'plugin'
  | 'system'

/** Stable precedence rank: lower number wins for the same server id. */
export const MCP_CONFIG_SOURCE_PRECEDENCE: Readonly<
  Record<McpConfigSourceKind, number>
> = {
  cli: 0,
  environment: 1,
  user: 2,
  workspace: 3,
  plugin: 4,
  system: 5
} as const

export const MCP_CONFIG_SOURCE_ORDER: readonly McpConfigSourceKind[] = [
  'cli',
  'environment',
  'user',
  'workspace',
  'plugin',
  'system'
] as const

/** Optional path / label for diagnostics (never secret-bearing). */
export type McpConfigSourceOrigin = Readonly<{
  kind: McpConfigSourceKind
  /** Workspace-relative or absolute path when kind is workspace; env var name for environment. */
  label: string
}>

/**
 * One layer of servers from a single source.
 * Servers within a layer must have unique ids; duplicates inside a layer are fail-closed at load.
 */
export type McpConfigSourceLayer = Readonly<{
  origin: McpConfigSourceOrigin
  servers: readonly UserMcpServerV1[]
}>

/** Effective (winner) server with provenance. */
export type McpEffectiveServerV1 = Readonly<{
  server: UserMcpServerV1
  source: McpConfigSourceOrigin
}>

/** Server definition present in a lower-priority layer, fully replaced by a higher source. */
export type McpShadowedServerV1 = Readonly<{
  server: UserMcpServerV1
  source: McpConfigSourceOrigin
  /** Winner server id (same id as server.id). */
  shadowedByServerId: string
  shadowedBySource: McpConfigSourceOrigin
  reason: 'id_collision'
}>

/**
 * Resolved multi-source view used by host/session materialization and Doctor.
 * Does not replace UserMcpConfigV1 durable storage — user layer remains canonical for writes.
 */
export type McpEffectiveConfigViewV1 = Readonly<{
  /** Root gate: true only when the user (or higher) layer sets enabled true. See ADR-0013. */
  enabled: boolean
  /**
   * Effective smart-connect gate from user config (ADR-0013):
   * enabled && autoConnect !== false (omit means on when root enabled).
   */
  autoConnect: boolean
  effectiveServers: readonly McpEffectiveServerV1[]
  shadowed: readonly McpShadowedServerV1[]
  /** Non-secret load/parse warnings (paths, shape ids). */
  warnings: readonly string[]
}>

/** User-layer fields that feed root/auto-connect gates (not merged from workspace). */
export type McpUserGateFields = Readonly<{
  enabled: boolean
  autoConnect: boolean
}>

/** Convenience: project effective servers into a UserMcpConfigV1-shaped document for session apply. */
export function effectiveViewToUserConfigShape(
  view: McpEffectiveConfigViewV1,
  fingerprint?: string
): UserMcpConfigV1 {
  const base: UserMcpConfigV1 = {
    schemaVersion: 1,
    enabled: view.enabled,
    autoConnect: view.autoConnect,
    servers: view.effectiveServers.map((entry) => entry.server),
    ...(fingerprint ? { fingerprint } : {})
  }
  return base
}
