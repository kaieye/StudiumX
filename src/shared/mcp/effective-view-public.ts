/**
 * Secret-free multi-source effective MCP view for Settings / IPC (ADR-0013).
 * Never copies env secrets, headers, tokens, args, or command lines.
 */

import type { McpConfigSourceKind, McpEffectiveConfigViewV1 } from './source-types'
import type { McpRuntimeServerState, McpRuntimeServerView, McpTransportKind } from './types'

/** Winner server row for UI provenance (no command/url/env). */
export type McpEffectiveServerPublicV1 = Readonly<{
  id: string
  label: string
  sourceKind: McpConfigSourceKind
  sourceLabel: string
  enabled: boolean
  transport: McpTransportKind
  /** Present when a runtime view exists for this id. */
  state?: McpRuntimeServerState
}>

/** Shadowed (lower-precedence) server note — id + provenance only. */
export type McpShadowedServerPublicV1 = Readonly<{
  id: string
  sourceKind: McpConfigSourceKind
  sourceLabel: string
  shadowedBy: Readonly<{
    id: string
    sourceKind: McpConfigSourceKind
    sourceLabel: string
  }>
}>

/** Renderer/Doctor-safe projection of McpEffectiveConfigViewV1 (+ optional runtime). */
export type McpEffectiveViewPublicV1 = Readonly<{
  enabled: boolean
  autoConnect: boolean
  effectiveServers: readonly McpEffectiveServerPublicV1[]
  shadowed: readonly McpShadowedServerPublicV1[]
  warnings: readonly string[]
}>

export type McpGetEffectiveViewResult = Readonly<{
  ok: true
  view: McpEffectiveViewPublicV1
}>

const EMPTY_VIEW: McpEffectiveViewPublicV1 = Object.freeze({
  enabled: false,
  autoConnect: false,
  effectiveServers: Object.freeze([]),
  shadowed: Object.freeze([]),
  warnings: Object.freeze([])
})

/** Empty secret-free projection when host has no resolved multi-source view yet. */
export function emptyMcpEffectiveViewPublic(): McpEffectiveViewPublicV1 {
  return EMPTY_VIEW
}

/**
 * Project internal effective view (+ optional runtime states) to a secret-free public shape.
 * Drops full server records (command, args, url, env, headers, oauth tokens).
 */
export function projectMcpEffectiveViewPublic(
  view: McpEffectiveConfigViewV1 | null | undefined,
  runtime: readonly McpRuntimeServerView[] = []
): McpEffectiveViewPublicV1 {
  if (!view) return emptyMcpEffectiveViewPublic()

  const runtimeById = new Map(runtime.map((entry) => [entry.id, entry]))

  const effectiveServers: McpEffectiveServerPublicV1[] = view.effectiveServers.map((entry) => {
    const server = entry.server
    const rt = runtimeById.get(server.id)
    const projected: McpEffectiveServerPublicV1 = {
      id: server.id,
      label: typeof server.label === 'string' && server.label.trim() ? server.label.trim() : server.id,
      sourceKind: entry.source.kind,
      sourceLabel: sanitizeSourceLabel(entry.source.label),
      enabled: server.enabled === true,
      transport: server.transport,
      ...(rt?.state ? { state: rt.state } : {})
    }
    return projected
  })

  const shadowed: McpShadowedServerPublicV1[] = view.shadowed.map((entry) => ({
    id: entry.server.id,
    sourceKind: entry.source.kind,
    sourceLabel: sanitizeSourceLabel(entry.source.label),
    shadowedBy: {
      id: entry.shadowedByServerId,
      sourceKind: entry.shadowedBySource.kind,
      sourceLabel: sanitizeSourceLabel(entry.shadowedBySource.label)
    }
  }))

  const warnings = view.warnings
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 256))
    .slice(0, 32)

  return {
    enabled: view.enabled === true,
    autoConnect: view.autoConnect === true,
    effectiveServers,
    shadowed,
    warnings
  }
}

/** Bound non-secret origin labels (paths / env names) for UI. */
function sanitizeSourceLabel(label: unknown): string {
  if (typeof label !== 'string') return ''
  return label.trim().slice(0, 256)
}
