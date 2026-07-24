/**
 * Pure MCP settings ops reduction (worth-learning §3.3 / Phase B).
 *
 * Updates are applied by server id (upsert / remove / patch) so concurrent
 * Settings writers do not clobber unrelated servers via whole-document replace.
 * No I/O, no secrets materialization — durable UserMcpConfigV1 in/out only.
 */

import {
  fingerprintUserMcpConfig,
  parseUserMcpConfig
} from './config-schema'
import { MCP_SERVER_ID_RE } from './tool-name'
import {
  MCP_CONFIG_SCHEMA_VERSION,
  type UserMcpConfigV1,
  type UserMcpServerV1
} from './types'

/** Max ops per apply batch (fail-closed bound). */
export const MCP_OPS_MAX_BATCH = 64 as const

/**
 * Id-level settings operations. Root flags are document-level; server ops
 * never replace the whole `servers` array from a stale snapshot.
 */
export type McpSettingsOp =
  | Readonly<{ op: 'setEnabled'; enabled: boolean }>
  | Readonly<{ op: 'setAutoConnect'; autoConnect: boolean }>
  | Readonly<{ op: 'setHonorRemoteReadOnlyHint'; honorRemoteReadOnlyHint: boolean }>
  | Readonly<{ op: 'upsertServer'; server: UserMcpServerV1 }>
  | Readonly<{ op: 'removeServer'; id: string }>
  | Readonly<{
      op: 'patchServer'
      id: string
      /** Partial durable server fields; `id` / `createdAt` cannot be changed. */
      patch: Readonly<Partial<Omit<UserMcpServerV1, 'id' | 'createdAt'>>>
    }>

export type ApplyMcpOpsResult =
  | Readonly<{ ok: true; config: UserMcpConfigV1 }>
  | Readonly<{ ok: false; reason: string }>

/**
 * Apply an ordered list of id-level ops to a base durable config.
 * Merge is concurrent-safe relative to the base: servers not mentioned by
 * upsert/remove/patch are preserved. Ops apply left-to-right; last write wins
 * for the same server id. Final document is re-validated and re-fingerprinted.
 */
export function applyMcpOps(
  base: UserMcpConfigV1,
  ops: readonly McpSettingsOp[]
): ApplyMcpOpsResult {
  if (!Array.isArray(ops)) {
    return { ok: false, reason: 'ops must be an array' }
  }
  if (ops.length > MCP_OPS_MAX_BATCH) {
    return { ok: false, reason: `ops batch exceeds max of ${MCP_OPS_MAX_BATCH}` }
  }

  let enabled = base.enabled
  let autoConnect: boolean | undefined = base.autoConnect
  let honorRemoteReadOnlyHint: boolean | undefined = base.honorRemoteReadOnlyHint
  const byId = new Map<string, UserMcpServerV1>()
  const order: string[] = []

  for (const server of base.servers) {
    byId.set(server.id, server)
    order.push(server.id)
  }

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i]
    if (!isRecord(op) || typeof (op as McpSettingsOp).op !== 'string') {
      return { ok: false, reason: `ops[${i}] must be an object with op` }
    }
    const kind = (op as McpSettingsOp).op

    switch (kind) {
      case 'setEnabled': {
        if (typeof (op as { enabled?: unknown }).enabled !== 'boolean') {
          return { ok: false, reason: `ops[${i}].enabled must be boolean` }
        }
        enabled = (op as { enabled: boolean }).enabled
        break
      }
      case 'setAutoConnect': {
        if (typeof (op as { autoConnect?: unknown }).autoConnect !== 'boolean') {
          return { ok: false, reason: `ops[${i}].autoConnect must be boolean` }
        }
        autoConnect = (op as { autoConnect: boolean }).autoConnect
        break
      }
      case 'setHonorRemoteReadOnlyHint': {
        if (
          typeof (op as { honorRemoteReadOnlyHint?: unknown }).honorRemoteReadOnlyHint !==
          'boolean'
        ) {
          return { ok: false, reason: `ops[${i}].honorRemoteReadOnlyHint must be boolean` }
        }
        honorRemoteReadOnlyHint = (
          op as { honorRemoteReadOnlyHint: boolean }
        ).honorRemoteReadOnlyHint
        break
      }
      case 'upsertServer': {
        const server = (op as { server?: unknown }).server
        const validated = validateServer(server, i)
        if (!validated.ok) return validated
        if (!byId.has(validated.server.id)) {
          order.push(validated.server.id)
        }
        byId.set(validated.server.id, validated.server)
        break
      }
      case 'removeServer': {
        const id = (op as { id?: unknown }).id
        if (typeof id !== 'string' || !MCP_SERVER_ID_RE.test(id)) {
          return {
            ok: false,
            reason: `ops[${i}].id must match ^[a-z][a-z0-9_-]{0,63}$`
          }
        }
        if (!byId.has(id)) {
          return { ok: false, reason: `ops[${i}] removeServer: unknown id "${id}"` }
        }
        byId.delete(id)
        const idx = order.indexOf(id)
        if (idx >= 0) order.splice(idx, 1)
        break
      }
      case 'patchServer': {
        const id = (op as { id?: unknown }).id
        if (typeof id !== 'string' || !MCP_SERVER_ID_RE.test(id)) {
          return {
            ok: false,
            reason: `ops[${i}].id must match ^[a-z][a-z0-9_-]{0,63}$`
          }
        }
        const existing = byId.get(id)
        if (!existing) {
          return { ok: false, reason: `ops[${i}] patchServer: unknown id "${id}"` }
        }
        const patch = (op as { patch?: unknown }).patch
        if (!isRecord(patch)) {
          return { ok: false, reason: `ops[${i}].patch must be an object` }
        }
        if ('id' in patch || 'createdAt' in patch) {
          return {
            ok: false,
            reason: `ops[${i}].patch cannot change id or createdAt`
          }
        }
        const merged: UserMcpServerV1 = {
          ...existing,
          ...(patch as Partial<UserMcpServerV1>),
          id: existing.id,
          createdAt: existing.createdAt
        }
        const validated = validateServer(merged, i)
        if (!validated.ok) return validated
        byId.set(id, validated.server)
        break
      }
      default:
        return { ok: false, reason: `ops[${i}] unknown op "${String(kind)}"` }
    }
  }

  const servers = order
    .filter((id) => byId.has(id))
    .map((id) => byId.get(id)!)

  const document: Record<string, unknown> = {
    schemaVersion: MCP_CONFIG_SCHEMA_VERSION,
    enabled,
    servers
  }
  if (autoConnect !== undefined) document.autoConnect = autoConnect
  if (honorRemoteReadOnlyHint !== undefined) {
    document.honorRemoteReadOnlyHint = honorRemoteReadOnlyHint
  }

  const parsed = parseUserMcpConfig(document)
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason }
  }

  const { fingerprint: _ignored, ...rest } = parsed.config
  const fingerprint = fingerprintUserMcpConfig(rest)
  return { ok: true, config: { ...rest, fingerprint } }
}

/**
 * Type guard for an unknown ops payload (IPC / host entry).
 * Does not deeply validate server bodies — use {@link applyMcpOps}.
 */
export function isMcpSettingsOpList(value: unknown): value is readonly McpSettingsOp[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.op === 'string')
}

function validateServer(
  server: unknown,
  opIndex: number
): { ok: true; server: UserMcpServerV1 } | { ok: false; reason: string } {
  const parsed = parseUserMcpConfig({
    schemaVersion: MCP_CONFIG_SCHEMA_VERSION,
    enabled: true,
    servers: [server]
  })
  if (!parsed.ok) {
    return { ok: false, reason: `ops[${opIndex}] invalid server: ${parsed.reason}` }
  }
  const only = parsed.config.servers[0]
  if (!only) {
    return { ok: false, reason: `ops[${opIndex}] server missing after parse` }
  }
  return { ok: true, server: only }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
