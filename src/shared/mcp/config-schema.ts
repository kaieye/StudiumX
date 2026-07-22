/**
 * UserMcpConfigV1 parse / normalize (ADR-0128 §3).
 * Pure fail-closed validation — no FS.
 */

import { createHash } from 'node:crypto'

import { validateToolEffectOverrides } from './effect-map'
import { MCP_SERVER_ID_RE } from './tool-name'
import {
  MCP_CONFIG_SCHEMA_VERSION,
  MCP_SECRET_REF_KEEP,
  MCP_SECRET_REF_PENDING,
  type McpTransportKind,
  type UserMcpConfigV1,
  type UserMcpServerPublicV1,
  type UserMcpServerV1,
  type UserMcpConfigPublicV1
} from './types'

const SECRET_KEY_RE = /api[_-]?key|token|secret|password|authorization/i

export type ParseMcpConfigResult =
  | { ok: true; config: UserMcpConfigV1 }
  | { ok: false; reason: string }

export function defaultUserMcpConfig(): UserMcpConfigV1 {
  return {
    schemaVersion: MCP_CONFIG_SCHEMA_VERSION,
    enabled: false,
    servers: [],
    fingerprint: fingerprintUserMcpConfig({
      schemaVersion: MCP_CONFIG_SCHEMA_VERSION,
      enabled: false,
      servers: []
    })
  }
}

/**
 * Deterministic CAS fingerprint over secret-free normalized shape.
 * Does not include secret values (only ref ids and plain keys).
 */
export function fingerprintUserMcpConfig(config: Omit<UserMcpConfigV1, 'fingerprint'>): string {
  const payload = {
    schemaVersion: config.schemaVersion,
    enabled: config.enabled,
    servers: config.servers.map((s) => ({
      id: s.id,
      label: s.label,
      enabled: s.enabled,
      scope: s.scope,
      workspaceRoot: s.workspaceRoot,
      transport: s.transport,
      command: s.command,
      args: s.args,
      cwd: s.cwd,
      envSecretRefs: sortRecord(s.envSecretRefs),
      envPlain: sortRecord(s.envPlain),
      url: s.url,
      headersSecretRefs: sortRecord(s.headersSecretRefs),
      headersPlain: sortRecord(s.headersPlain),
      timeoutMs: s.timeoutMs,
      toolEffectOverrides: sortRecord(s.toolEffectOverrides),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }))
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function parseUserMcpConfig(input: unknown): ParseMcpConfigResult {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'config must be an object' }
  }
  const raw = input as Record<string, unknown>

  if (raw.schemaVersion !== MCP_CONFIG_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unsupported schemaVersion (expected ${MCP_CONFIG_SCHEMA_VERSION})`
    }
  }

  if (typeof raw.enabled !== 'boolean') {
    return { ok: false, reason: 'enabled must be boolean' }
  }

  if (!Array.isArray(raw.servers)) {
    return { ok: false, reason: 'servers must be an array' }
  }

  const seenIds = new Set<string>()
  const servers: UserMcpServerV1[] = []

  for (let i = 0; i < raw.servers.length; i += 1) {
    const parsed = parseServer(raw.servers[i], i)
    if (!parsed.ok) return parsed
    if (seenIds.has(parsed.server.id)) {
      return { ok: false, reason: `duplicate server id: ${parsed.server.id}` }
    }
    seenIds.add(parsed.server.id)
    servers.push(parsed.server)
  }

  const base: Omit<UserMcpConfigV1, 'fingerprint'> = {
    schemaVersion: MCP_CONFIG_SCHEMA_VERSION,
    enabled: raw.enabled,
    servers
  }

  const computed = fingerprintUserMcpConfig(base)
  const fingerprint =
    typeof raw.fingerprint === 'string' && raw.fingerprint.trim()
      ? raw.fingerprint.trim()
      : computed

  return {
    ok: true,
    config: { ...base, fingerprint }
  }
}

/**
 * Type guard for durable-file validate (canonical / .bak).
 * Rejects unknown schemaVersion without migrating.
 */
export function isUserMcpConfigDocument(value: unknown): value is UserMcpConfigV1 {
  const parsed = parseUserMcpConfig(value)
  if (!parsed.ok) return false
  return parsed.config.servers.every((server) =>
    [...Object.values(server.envSecretRefs), ...Object.values(server.headersSecretRefs)].every(
      (refId) => refId !== MCP_SECRET_REF_KEEP && refId !== MCP_SECRET_REF_PENDING
    )
  )
}

export function toPublicMcpConfig(config: UserMcpConfigV1): UserMcpConfigPublicV1 {
  return {
    schemaVersion: config.schemaVersion,
    enabled: config.enabled,
    fingerprint: config.fingerprint ?? fingerprintUserMcpConfig(config),
    servers: config.servers.map(toPublicServer)
  }
}

export function toPublicServer(server: UserMcpServerV1): UserMcpServerPublicV1 {
  const envSecretConfigured: Record<string, boolean> = {}
  for (const key of Object.keys(server.envSecretRefs)) {
    envSecretConfigured[key] = Boolean(server.envSecretRefs[key])
  }
  const headersSecretConfigured: Record<string, boolean> = {}
  for (const key of Object.keys(server.headersSecretRefs)) {
    headersSecretConfigured[key] = Boolean(server.headersSecretRefs[key])
  }
  return {
    id: server.id,
    label: server.label,
    enabled: server.enabled,
    scope: server.scope,
    workspaceRoot: server.workspaceRoot,
    transport: server.transport,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    envSecretConfigured,
    envPlain: sortRecord(server.envPlain),
    envPlainKeys: Object.keys(server.envPlain).sort(),
    url: server.url,
    headersSecretConfigured,
    headersPlain: sortRecord(server.headersPlain),
    timeoutMs: server.timeoutMs,
    toolEffectOverrides: server.toolEffectOverrides,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt
  }
}

function parseServer(
  input: unknown,
  index: number
): { ok: true; server: UserMcpServerV1 } | { ok: false; reason: string } {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: `servers[${index}] must be an object` }
  }
  const raw = input as Record<string, unknown>

  if (typeof raw.id !== 'string' || !MCP_SERVER_ID_RE.test(raw.id)) {
    return {
      ok: false,
      reason: `servers[${index}].id must match ^[a-z][a-z0-9_-]{0,63}$`
    }
  }

  if (typeof raw.label !== 'string' || !raw.label.trim()) {
    return { ok: false, reason: `servers[${index}].label must be a non-empty string` }
  }

  if (typeof raw.enabled !== 'boolean') {
    return { ok: false, reason: `servers[${index}].enabled must be boolean` }
  }

  const scope = raw.scope == null ? 'user' : raw.scope
  if (scope !== 'user' && scope !== 'workspace') {
    return {
      ok: false,
      reason: `servers[${index}].scope must be user or workspace`
    }
  }

  const workspaceRoot = parseOptionalAbsolutePath(
    raw.workspaceRoot,
    `servers[${index}].workspaceRoot`
  )
  if (!workspaceRoot.ok) return workspaceRoot
  if (scope === 'workspace' && !workspaceRoot.value) {
    return {
      ok: false,
      reason: `servers[${index}].workspaceRoot is required for workspace scope`
    }
  }

  const transport = raw.transport === 'streamableHttp' ? 'http' : raw.transport
  if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') {
    return {
      ok: false,
      reason: `servers[${index}].transport must be stdio, http, or sse`
    }
  }

  let command: string | null = null
  if (transport === 'stdio') {
    if (typeof raw.command !== 'string' || !raw.command.trim()) {
      return {
        ok: false,
        reason: `servers[${index}].command is required for stdio transport`
      }
    }
    command = raw.command.trim()
  } else if (raw.command != null && typeof raw.command !== 'string') {
    return { ok: false, reason: `servers[${index}].command must be string or null` }
  }

  const args = parseStringArray(raw.args, `servers[${index}].args`)
  if (!args.ok) return args

  const cwd = parseOptionalAbsolutePath(raw.cwd, `servers[${index}].cwd`)
  if (!cwd.ok) return cwd

  const envPlain = parseStringRecord(raw.envPlain, `servers[${index}].envPlain`)
  if (!envPlain.ok) return envPlain
  for (const key of Object.keys(envPlain.value)) {
    if (SECRET_KEY_RE.test(key)) {
      return {
        ok: false,
        reason: `servers[${index}].envPlain key "${key}" looks secret; use envSecretRefs`
      }
    }
  }

  const envSecretRefs = parseStringRecord(
    raw.envSecretRefs,
    `servers[${index}].envSecretRefs`
  )
  if (!envSecretRefs.ok) return envSecretRefs

  const headersSecretRefs = parseStringRecord(
    raw.headersSecretRefs,
    `servers[${index}].headersSecretRefs`
  )
  if (!headersSecretRefs.ok) return headersSecretRefs

  const headersPlain = parseStringRecord(raw.headersPlain, `servers[${index}].headersPlain`)
  if (!headersPlain.ok) return headersPlain
  for (const key of Object.keys(headersPlain.value)) {
    if (SECRET_KEY_RE.test(key)) {
      return {
        ok: false,
        reason: `servers[${index}].headersPlain key "${key}" looks secret; use headersSecretRefs`
      }
    }
  }

  let url: string | null = null
  if (transport === 'http' || transport === 'sse') {
    const parsedUrl = parseMcpUrl(raw.url, `servers[${index}].url`)
    if (!parsedUrl.ok) return parsedUrl
    url = parsedUrl.value
  } else if (raw.url != null && typeof raw.url !== 'string') {
    return { ok: false, reason: `servers[${index}].url must be string or null` }
  }

  const timeoutMs = parseOptionalTimeout(raw.timeoutMs, `servers[${index}].timeoutMs`)
  if (!timeoutMs.ok) return timeoutMs

  const overrides = validateToolEffectOverrides(raw.toolEffectOverrides ?? {})
  if (!overrides.ok) {
    return { ok: false, reason: `servers[${index}].${overrides.reason}` }
  }

  const createdAt = parseIso(raw.createdAt, `servers[${index}].createdAt`)
  if (!createdAt.ok) return createdAt
  const updatedAt = parseIso(raw.updatedAt, `servers[${index}].updatedAt`)
  if (!updatedAt.ok) return updatedAt

  const server: UserMcpServerV1 = {
    id: raw.id,
    label: raw.label.trim(),
    enabled: raw.enabled,
    scope,
    workspaceRoot: scope === 'workspace' ? workspaceRoot.value : null,
    transport: transport as McpTransportKind,
    command,
    args: transport === 'stdio' ? args.value : [],
    cwd: transport === 'stdio' ? cwd.value : null,
    envSecretRefs: transport === 'stdio' ? envSecretRefs.value : {},
    envPlain: transport === 'stdio' ? envPlain.value : {},
    url,
    headersSecretRefs: transport === 'stdio' ? {} : headersSecretRefs.value,
    headersPlain: transport === 'stdio' ? {} : headersPlain.value,
    timeoutMs: timeoutMs.value,
    toolEffectOverrides: overrides.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value
  }

  return { ok: true, server }
}

function parseStringArray(
  value: unknown,
  path: string
): { ok: true; value: string[] } | { ok: false; reason: string } {
  if (value == null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, reason: `${path} must be a string array` }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      return { ok: false, reason: `${path} must contain only strings` }
    }
    out.push(item)
  }
  return { ok: true, value: out }
}

function parseStringRecord(
  value: unknown,
  path: string
): { ok: true; value: Record<string, string> } | { ok: false; reason: string } {
  if (value == null) return { ok: true, value: {} }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: `${path} must be an object` }
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k.trim()) {
      return { ok: false, reason: `${path} keys must be non-empty strings` }
    }
    if (typeof v !== 'string') {
      return { ok: false, reason: `${path}.${k} must be a string` }
    }
    out[k] = v
  }
  return { ok: true, value: out }
}

function parseOptionalAbsolutePath(
  value: unknown,
  path: string
): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (value == null) return { ok: true, value: null }
  if (typeof value !== 'string') {
    return { ok: false, reason: `${path} must be string or null` }
  }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  // Absolute paths only: never silently expand workspace-relative cwd or scope roots.
  const isWinAbs = /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')
  const isPosixAbs = trimmed.startsWith('/')
  if (!isWinAbs && !isPosixAbs) {
    return {
      ok: false,
      reason: `${path} must be absolute or null (workspace-relative cwd forbidden)`
    }
  }
  return { ok: true, value: trimmed }
}

function parseMcpUrl(
  value: unknown,
  path: string
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, reason: `${path} is required for HTTP/SSE transport` }
  }
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: `${path} must use http or https` }
    }
    return { ok: true, value: parsed.toString() }
  } catch {
    return { ok: false, reason: `${path} must be a valid URL` }
  }
}

function parseOptionalTimeout(
  value: unknown,
  path: string
): { ok: true; value: number | null } | { ok: false; reason: string } {
  if (value == null || value === '') return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { ok: false, reason: `${path} must be a positive integer or null` }
  }
  return { ok: true, value }
}

function parseIso(
  value: unknown,
  path: string
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, reason: `${path} must be an ISO timestamp string` }
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) {
    return { ok: false, reason: `${path} is not a valid date` }
  }
  return { ok: true, value: value.trim() }
}

function sortRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const key of Object.keys(record).sort()) {
    out[key] = record[key] as T
  }
  return out
}

/** Whether root+server enable gates allow connection attempts. */
export function isServerConnectable(config: UserMcpConfigV1, serverId: string): boolean {
  if (!config.enabled) return false
  const server = config.servers.find((s) => s.id === serverId)
  return Boolean(server?.enabled)
}
