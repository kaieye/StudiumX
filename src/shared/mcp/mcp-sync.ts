/**
 * Pure McpSync envelope parse / conflict detection (ADR-0136 + ADR-0141).
 * No network — clients feed JSON text; user must confirm before CAS write.
 */

import {
  MCP_SYNC_CONTRACT_VERSION,
  type McpSyncConflictV1,
  type McpSyncEnvelopeV1,
  type McpSyncServerV1
} from './import-export'
import type { UserMcpConfigPublicV1, UserMcpServerPublicV1 } from './types'

export type McpSyncParseResult =
  | { ok: true; envelope: McpSyncEnvelopeV1 }
  | { ok: false; reason: string }

export type McpSyncMergePreview = Readonly<{
  envelope: McpSyncEnvelopeV1
  incomingIds: readonly string[]
  conflicts: readonly McpSyncConflictV1[]
  /** Drafts that can be imported via existing import pipeline (secret-free). */
  importableServers: readonly McpSyncServerV1[]
}>

export function parseMcpSyncEnvelopeText(text: string): McpSyncParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
  return parseMcpSyncEnvelope(json)
}

export function parseMcpSyncEnvelope(value: unknown): McpSyncParseResult {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'not_object' }
  }
  const raw = value as Record<string, unknown>
  if (raw.contractVersion !== MCP_SYNC_CONTRACT_VERSION) {
    return { ok: false, reason: 'unsupported_contract_version' }
  }
  if (
    raw.kind !== 'mcp_sync_export' &&
    raw.kind !== 'mcp_sync_offer' &&
    raw.kind !== 'mcp_sync_conflict'
  ) {
    return { ok: false, reason: 'invalid_kind' }
  }
  if (typeof raw.exportedAt !== 'string' || !raw.exportedAt.trim()) {
    return { ok: false, reason: 'exportedAt_required' }
  }
  if (raw.payload == null || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
    return { ok: false, reason: 'payload_required' }
  }
  const payload = raw.payload as Record<string, unknown>
  if (typeof payload.enabled !== 'boolean') {
    return { ok: false, reason: 'payload_enabled_required' }
  }
  if (!Array.isArray(payload.servers)) {
    return { ok: false, reason: 'payload_servers_required' }
  }
  const servers: McpSyncServerV1[] = []
  for (const item of payload.servers) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue
    const s = item as Record<string, unknown>
    if (typeof s.id !== 'string' || !s.id.trim()) continue
    if (typeof s.label !== 'string') continue
    if (s.transport !== 'stdio' && s.transport !== 'http' && s.transport !== 'sse') continue
    servers.push({
      id: s.id.trim(),
      label: s.label,
      enabled: s.enabled !== false,
      transport: s.transport,
      command: typeof s.command === 'string' ? s.command : null,
      args: Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === 'string') : [],
      cwd: typeof s.cwd === 'string' ? s.cwd : null,
      url: typeof s.url === 'string' ? s.url : null,
      timeoutMs:
        typeof s.timeoutMs === 'number' && Number.isFinite(s.timeoutMs) ? s.timeoutMs : null,
      oauth: null,
      envSecretKeys: Array.isArray(s.envSecretKeys)
        ? s.envSecretKeys.filter((k): k is string => typeof k === 'string')
        : [],
      headersSecretKeys: Array.isArray(s.headersSecretKeys)
        ? s.headersSecretKeys.filter((k): k is string => typeof k === 'string')
        : []
    })
  }

  const conflicts: McpSyncConflictV1[] = []
  if (Array.isArray(raw.conflicts)) {
    for (const c of raw.conflicts) {
      if (c == null || typeof c !== 'object' || Array.isArray(c)) continue
      const row = c as Record<string, unknown>
      if (typeof row.serverId !== 'string') continue
      if (
        row.reason !== 'id_collision' &&
        row.reason !== 'fingerprint_mismatch' &&
        row.reason !== 'schema_unsupported'
      ) {
        continue
      }
      conflicts.push({ serverId: row.serverId, reason: row.reason })
    }
  }

  return {
    ok: true,
    envelope: {
      contractVersion: MCP_SYNC_CONTRACT_VERSION,
      kind: raw.kind,
      exportedAt: raw.exportedAt.trim(),
      payload: { enabled: payload.enabled, servers },
      ...(conflicts.length > 0 ? { conflicts } : {})
    }
  }
}

/**
 * Build a merge preview against local public config.
 * Conflicts never auto-overwrite — caller must present to user.
 */
export function previewMcpSyncMerge(
  local: UserMcpConfigPublicV1,
  envelope: McpSyncEnvelopeV1
): McpSyncMergePreview {
  const localIds = new Set(local.servers.map((s) => s.id))
  const conflicts: McpSyncConflictV1[] = [...(envelope.conflicts ?? [])]
  const importable: McpSyncServerV1[] = []
  for (const server of envelope.payload.servers) {
    if (localIds.has(server.id)) {
      if (!conflicts.some((c) => c.serverId === server.id)) {
        conflicts.push({ serverId: server.id, reason: 'id_collision' })
      }
      continue
    }
    importable.push(server)
  }
  return {
    envelope,
    incomingIds: envelope.payload.servers.map((s) => s.id),
    conflicts,
    importableServers: importable
  }
}

/** Convert sync servers to a Claude-style mcpServers map for parseMcpImportText. */
export function mcpSyncServersToImportJson(servers: readonly McpSyncServerV1[]): string {
  const mcpServers: Record<string, Record<string, unknown>> = {}
  for (const server of servers) {
    const entry: Record<string, unknown> = {
      type: server.transport === 'http' ? 'streamableHttp' : server.transport
    }
    if (server.timeoutMs != null) entry.timeoutMs = server.timeoutMs
    if (server.transport === 'stdio') {
      if (server.command) entry.command = server.command
      entry.args = [...server.args]
      if (server.cwd) entry.cwd = server.cwd
    } else if (server.url) {
      entry.url = server.url
    }
    mcpServers[server.id] = entry
  }
  return JSON.stringify({ mcpServers }, null, 2)
}

export function localServerIds(config: UserMcpConfigPublicV1): ReadonlySet<string> {
  return new Set(config.servers.map((s: UserMcpServerPublicV1) => s.id))
}
