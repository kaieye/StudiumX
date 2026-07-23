/**
 * MCP config bulk import / export / migration report + McpSync wire (ADR-0136).
 * Pure shared helpers — no Node FS, no Electron, no network.
 *
 * Import always produces drafts + a secret-free report. Canonical write happens
 * only after the user confirms via the existing CAS updateConfig path.
 */

import { resolveFilesystemInjectionDefaults } from './filesystem-mcp-defaults'
import {
  MCP_CONFIG_SCHEMA_VERSION,
  MCP_SECRET_CONFIGURED_PLACEHOLDER,
  type McpInjectionIdentity,
  type McpTransportKind,
  type McpWorkspaceRootInjection,
  type UserMcpConfigPublicV1,
  type UserMcpServerOAuthConfigV1,
  type UserMcpServerPublicV1
} from './types'

export const MCP_EXPORT_KIND = 'studiumx_mcp_export' as const
export const MCP_SYNC_CONTRACT_VERSION = 1 as const

export type McpImportSourceShape =
  | 'studiumx_user_mcp_v1'
  | 'claude_cursor_mcpServers'
  | 'mcp_servers_nested'
  | 'unsupported'

export type McpImportRiskFlag =
  | 'secret_present'
  | 'command_execution'
  | 'remote_url'
  | 'id_conflict'
  | 'invalid_partial'

export type McpImportServerDraft = Readonly<{
  /** Stable selection key for the preview UI. */
  draftKey: string
  /** Original map key or durable id from the source document. */
  sourceKey: string
  /** Id that will be written if selected (may differ after conflict rename). */
  proposedId: string
  label: string
  enabled: boolean
  transport: McpTransportKind
  command: string | null
  args: readonly string[]
  cwd: string | null
  /** Non-secret env pairs; secret-shaped keys may still carry user-pasted values until confirm. */
  env: Readonly<Record<string, string>>
  url: string | null
  headers: Readonly<Record<string, string>>
  timeoutMs: number | null
  oauth: UserMcpServerOAuthConfigV1 | null
  /**
   * ADR-0141: filesystem-class defaults to granted when omitted; explicit off preserved.
   * Optional so older callers remain type-compatible.
   */
  workspaceRootInjection?: McpWorkspaceRootInjection
  injectionIdentity?: McpInjectionIdentity | null
  risks: readonly McpImportRiskFlag[]
  /** Existing server id that collides with the preferred source id. */
  conflictExistingId: string | null
  /** Default selection for the preview checkbox. */
  selectedByDefault: boolean
  /** Human-readable skip / parse note without secret values. */
  note: string | null
}>

export type McpMigrationConflict = Readonly<{
  sourceKey: string
  proposedId: string
  existingId: string
}>

export type McpMigrationReport = Readonly<{
  sourceShape: McpImportSourceShape
  parsedCount: number
  skippedCount: number
  conflictCount: number
  warningCount: number
  selectedCount?: number
  importedCount?: number
  warnings: readonly string[]
  conflicts: readonly McpMigrationConflict[]
  /** Import never mutates the user's source files on disk. */
  preservedOriginalFiles: true
}>

export type McpImportPreview = Readonly<{
  ok: true
  sourceShape: Exclude<McpImportSourceShape, 'unsupported'>
  drafts: readonly McpImportServerDraft[]
  report: McpMigrationReport
}>

export type McpImportFailure = Readonly<{
  ok: false
  sourceShape: 'unsupported'
  reason: string
  report: McpMigrationReport
}>

export type McpImportResult = McpImportPreview | McpImportFailure

/** Redacted export document (re-importable as studiumx_user_mcp_v1-compatible). */
export type McpConfigExportDocumentV1 = Readonly<{
  schemaVersion: typeof MCP_CONFIG_SCHEMA_VERSION
  enabled: boolean
  servers: readonly McpExportServerV1[]
  export: Readonly<{
    kind: typeof MCP_EXPORT_KIND
    contractVersion: typeof MCP_SYNC_CONTRACT_VERSION
    exportedAt: string
    secretsRedacted: true
  }>
}>

export type McpExportServerV1 = Readonly<{
  id: string
  label: string
  enabled: boolean
  scope: 'user' | 'workspace'
  workspaceRoot: string | null
  transport: McpTransportKind
  command: string | null
  args: readonly string[]
  cwd: string | null
  envPlain: Readonly<Record<string, string>>
  /** Keys known to hold secrets; values never exported. */
  envSecretKeys: readonly string[]
  url: string | null
  headersPlain: Readonly<Record<string, string>>
  headersSecretKeys: readonly string[]
  timeoutMs: number | null
  toolEffectOverrides: Readonly<Record<string, string>>
  oauth: UserMcpServerOAuthConfigV1 | null
  workspaceRootInjection?: McpWorkspaceRootInjection
  injectionIdentity?: McpInjectionIdentity | null
  createdAt: string
  updatedAt: string
}>

/** Future-ready McpSync envelope — no network client in this phase. */
export type McpSyncEnvelopeKind = 'mcp_sync_export' | 'mcp_sync_offer' | 'mcp_sync_conflict'

export type McpSyncServerV1 = Readonly<{
  id: string
  label: string
  enabled: boolean
  transport: McpTransportKind
  command: string | null
  args: readonly string[]
  cwd: string | null
  url: string | null
  timeoutMs: number | null
  oauth: UserMcpServerOAuthConfigV1 | null
  envSecretKeys: readonly string[]
  headersSecretKeys: readonly string[]
}>

export type McpSyncPayloadV1 = Readonly<{
  enabled: boolean
  servers: readonly McpSyncServerV1[]
}>

export type McpSyncConflictV1 = Readonly<{
  serverId: string
  reason: 'id_collision' | 'fingerprint_mismatch' | 'schema_unsupported'
}>

export type McpSyncEnvelopeV1 = Readonly<{
  contractVersion: typeof MCP_SYNC_CONTRACT_VERSION
  kind: McpSyncEnvelopeKind
  exportedAt: string
  payload: McpSyncPayloadV1
  conflicts?: readonly McpSyncConflictV1[]
}>

const SECRET_KEY_RE = /api[_-]?key|token|secret|password|authorization/i
const MCP_SERVER_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/
const MAX_WARNINGS = 40

export type ParseMcpImportOptions = Readonly<{
  /** Ids already present in canonical / public config. */
  existingIds?: ReadonlySet<string> | readonly string[]
  /** ISO timestamp used for draft keys when not otherwise available. */
  now?: string
}>

/**
 * Parse external MCP JSON into a selectable import preview.
 * Never writes config; never connects.
 */
export function parseMcpImportDocument(
  input: unknown,
  options: ParseMcpImportOptions = {}
): McpImportResult {
  const existing = toIdSet(options.existingIds)
  const now = options.now ?? new Date().toISOString()
  const emptyReport = (shape: McpImportSourceShape): McpMigrationReport => ({
    sourceShape: shape,
    parsedCount: 0,
    skippedCount: 0,
    conflictCount: 0,
    warningCount: 0,
    warnings: [],
    conflicts: [],
    preservedOriginalFiles: true
  })

  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      sourceShape: 'unsupported',
      reason: 'import document must be a JSON object',
      report: emptyReport('unsupported')
    }
  }

  const root = input as Record<string, unknown>
  const detected = detectImportShape(root)
  if (detected === 'unsupported') {
    return {
      ok: false,
      sourceShape: 'unsupported',
      reason: 'unsupported MCP import shape (expected mcpServers, mcp.servers, or UserMcpConfigV1)',
      report: emptyReport('unsupported')
    }
  }

  const entries = collectSourceEntries(root, detected)
  const drafts: McpImportServerDraft[] = []
  const warnings: string[] = []
  const conflicts: McpMigrationConflict[] = []
  let skippedCount = 0
  const reserved = new Set(existing)

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const parsed = parseSourceServer(entry.key, entry.value, index)
    if (!parsed.ok) {
      skippedCount += 1
      pushWarning(warnings, parsed.reason)
      continue
    }

    const preferredId = parsed.preferredId
    let proposedId = preferredId
    let conflictExistingId: string | null = null
    const risks = [...parsed.risks]

    if (reserved.has(preferredId)) {
      conflictExistingId = preferredId
      proposedId = uniqueServerId(preferredId, reserved)
      risks.push('id_conflict')
      conflicts.push({
        sourceKey: entry.key,
        proposedId,
        existingId: preferredId
      })
    }

    reserved.add(proposedId)
    const injectionDefaults = resolveFilesystemInjectionDefaults({
      transport: parsed.transport,
      command: parsed.command,
      args: parsed.args,
      workspaceRootInjection: parsed.workspaceRootInjection,
      injectionIdentity: parsed.injectionIdentity,
      allowFilesystemDefault: true
    })
    drafts.push({
      draftKey: `import-${index}-${proposedId}`,
      sourceKey: entry.key,
      proposedId,
      label: parsed.label,
      enabled: parsed.enabled,
      transport: parsed.transport,
      command: parsed.command,
      args: parsed.args,
      cwd: parsed.cwd,
      env: parsed.env,
      url: parsed.url,
      headers: parsed.headers,
      timeoutMs: parsed.timeoutMs,
      oauth: parsed.oauth,
      workspaceRootInjection: injectionDefaults.workspaceRootInjection,
      injectionIdentity: injectionDefaults.injectionIdentity,
      risks,
      conflictExistingId,
      selectedByDefault: conflictExistingId == null && !risks.includes('invalid_partial'),
      note: conflictExistingId
        ? `id "${preferredId}" already exists; proposed "${proposedId}"`
        : null
    })
  }

  // Touch `now` so callers can pin determinism without unused-option lint noise.
  void now

  const report: McpMigrationReport = {
    sourceShape: detected,
    parsedCount: drafts.length,
    skippedCount,
    conflictCount: conflicts.length,
    warningCount: warnings.length,
    warnings,
    conflicts,
    preservedOriginalFiles: true
  }

  return {
    ok: true,
    sourceShape: detected,
    drafts,
    report
  }
}

/**
 * Parse a JSON text blob. Returns unsupported on JSON syntax errors.
 */
export function parseMcpImportText(
  text: string,
  options: ParseMcpImportOptions = {}
): McpImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      sourceShape: 'unsupported',
      reason: 'import text is not valid JSON',
      report: {
        sourceShape: 'unsupported',
        parsedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        warningCount: 1,
        warnings: ['json_parse_error'],
        conflicts: [],
        preservedOriginalFiles: true
      }
    }
  }
  return parseMcpImportDocument(parsed, options)
}

/**
 * Apply user selection to a preview: only selected drafts, optional re-ids already in draft.
 */
export function selectMcpImportDrafts(
  preview: McpImportPreview,
  selectedDraftKeys: ReadonlySet<string> | readonly string[]
): {
  selected: readonly McpImportServerDraft[]
  report: McpMigrationReport
} {
  const keys = selectedDraftKeys instanceof Set ? selectedDraftKeys : new Set(selectedDraftKeys)
  const selected = preview.drafts.filter((draft) => keys.has(draft.draftKey))
  return {
    selected,
    report: {
      ...preview.report,
      selectedCount: selected.length,
      importedCount: selected.length
    }
  }
}

/**
 * Build a redacted export document from public config. Never includes OAuth tokens
 * (tokens are not part of public config) or secret values.
 */
export function exportPublicMcpConfig(
  config: UserMcpConfigPublicV1,
  options: { exportedAt?: string } = {}
): McpConfigExportDocumentV1 {
  const exportedAt = options.exportedAt ?? new Date().toISOString()
  return {
    schemaVersion: MCP_CONFIG_SCHEMA_VERSION,
    enabled: config.enabled,
    servers: config.servers.map(exportPublicServer),
    export: {
      kind: MCP_EXPORT_KIND,
      contractVersion: MCP_SYNC_CONTRACT_VERSION,
      exportedAt,
      secretsRedacted: true
    }
  }
}

export function exportPublicMcpConfigJson(
  config: UserMcpConfigPublicV1,
  options: { exportedAt?: string; pretty?: boolean } = {}
): string {
  const doc = exportPublicMcpConfig(config, options)
  return JSON.stringify(doc, null, options.pretty === false ? undefined : 2)
}

/**
 * Claude/Cursor-compatible map export (redacted). Useful for paste into other tools.
 */
export function exportPublicMcpServersMap(
  config: UserMcpConfigPublicV1
): Readonly<{ mcpServers: Readonly<Record<string, Record<string, unknown>>> }> {
  const mcpServers: Record<string, Record<string, unknown>> = {}
  for (const server of config.servers) {
    const entry: Record<string, unknown> = {
      type: server.transport === 'http' ? 'streamableHttp' : server.transport
    }
    if (server.timeoutMs != null) entry.timeoutMs = server.timeoutMs
    if (server.transport === 'stdio') {
      entry.command = server.command
      entry.args = [...server.args]
      if (server.cwd) entry.cwd = server.cwd
      const env = redactStringRecord(server.envPlain, server.envSecretConfigured)
      if (Object.keys(env).length > 0) entry.env = env
    } else {
      entry.url = server.url
      const headers = redactStringRecord(server.headersPlain, server.headersSecretConfigured)
      if (Object.keys(headers).length > 0) entry.headers = headers
      if (server.oauth) entry.oauth = server.oauth
    }
    mcpServers[server.id] = entry
  }
  return { mcpServers }
}

/** Wrap a redacted public config as a future McpSync envelope. */
export function toMcpSyncEnvelope(
  config: UserMcpConfigPublicV1,
  options: { kind?: McpSyncEnvelopeKind; exportedAt?: string } = {}
): McpSyncEnvelopeV1 {
  return {
    contractVersion: MCP_SYNC_CONTRACT_VERSION,
    kind: options.kind ?? 'mcp_sync_export',
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    payload: {
      enabled: config.enabled,
      servers: config.servers.map((server) => ({
        id: server.id,
        label: server.label,
        enabled: server.enabled,
        transport: server.transport,
        command: server.command,
        args: server.args,
        cwd: server.cwd,
        url: server.url,
        timeoutMs: server.timeoutMs,
        oauth: server.oauth,
        envSecretKeys: Object.entries(server.envSecretConfigured)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .sort(),
        headersSecretKeys: Object.entries(server.headersSecretConfigured)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .sort()
      }))
    }
  }
}

export function assertExportIsSecretFree(document: McpConfigExportDocumentV1): {
  ok: true
} | { ok: false; reason: string } {
  const serialized = JSON.stringify(document)
  // OAuth tokens and common bearer forms must never appear in export text.
  if (/Bearer\s+[A-Za-z0-9._\-]+/i.test(serialized)) {
    return { ok: false, reason: 'export contains bearer-like token material' }
  }
  if (/"access_token"\s*:/i.test(serialized) || /"refresh_token"\s*:/i.test(serialized)) {
    return { ok: false, reason: 'export contains oauth token field names with values' }
  }
  for (const server of document.servers) {
    for (const [key, value] of Object.entries(server.envPlain)) {
      if (SECRET_KEY_RE.test(key) && value && value !== MCP_SECRET_CONFIGURED_PLACEHOLDER) {
        return { ok: false, reason: `envPlain secret key leaked: ${key}` }
      }
    }
    for (const [key, value] of Object.entries(server.headersPlain)) {
      if (SECRET_KEY_RE.test(key) && value && value !== MCP_SECRET_CONFIGURED_PLACEHOLDER) {
        return { ok: false, reason: `headersPlain secret key leaked: ${key}` }
      }
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function detectImportShape(root: Record<string, unknown>): McpImportSourceShape {
  if (
    root.schemaVersion === MCP_CONFIG_SCHEMA_VERSION &&
    Array.isArray(root.servers)
  ) {
    return 'studiumx_user_mcp_v1'
  }
  if (isRecord(root.mcpServers)) {
    return 'claude_cursor_mcpServers'
  }
  if (isRecord(root.mcp) && (isRecord((root.mcp as Record<string, unknown>).servers) ||
      Array.isArray((root.mcp as Record<string, unknown>).servers))) {
    return 'mcp_servers_nested'
  }
  // Bare map of servers (single-level) when every value looks like a server config.
  if (looksLikeServerMap(root)) {
    return 'claude_cursor_mcpServers'
  }
  return 'unsupported'
}

function collectSourceEntries(
  root: Record<string, unknown>,
  shape: Exclude<McpImportSourceShape, 'unsupported'>
): Array<{ key: string; value: unknown }> {
  if (shape === 'studiumx_user_mcp_v1') {
    const servers = root.servers as unknown[]
    return servers.map((value, index) => {
      const id =
        isRecord(value) && typeof value.id === 'string' && value.id.trim()
          ? value.id.trim()
          : `server-${index + 1}`
      return { key: id, value }
    })
  }
  if (shape === 'mcp_servers_nested') {
    const mcp = root.mcp as Record<string, unknown>
    const servers = mcp.servers
    if (Array.isArray(servers)) {
      return servers.map((value, index) => {
        const id =
          isRecord(value) && typeof value.id === 'string' && value.id.trim()
            ? value.id.trim()
            : typeof (isRecord(value) ? value.name : null) === 'string'
              ? String((value as { name: string }).name)
              : `server-${index + 1}`
        return { key: id, value }
      })
    }
    return Object.entries(servers as Record<string, unknown>).map(([key, value]) => ({
      key,
      value
    }))
  }
  // claude_cursor_mcpServers or bare map
  const map = isRecord(root.mcpServers) ? (root.mcpServers as Record<string, unknown>) : root
  // Strip non-server top-level noise when bare map
  return Object.entries(map)
    .filter(([key, value]) => {
      if (key === 'mcpServers' || key === 'mcp' || key === 'schemaVersion' || key === 'enabled') {
        return false
      }
      if (key === 'export' || key === 'fingerprint') return false
      return isRecord(value)
    })
    .map(([key, value]) => ({ key, value }))
}

function parseSourceServer(
  sourceKey: string,
  value: unknown,
  index: number
):
  | {
      ok: true
      preferredId: string
      label: string
      enabled: boolean
      transport: McpTransportKind
      command: string | null
      args: readonly string[]
      cwd: string | null
      env: Record<string, string>
      url: string | null
      headers: Record<string, string>
      timeoutMs: number | null
      oauth: UserMcpServerOAuthConfigV1 | null
      /** Raw document value: 'off' | 'granted' | null when omitted. */
      workspaceRootInjection: McpWorkspaceRootInjection | null
      injectionIdentity: McpInjectionIdentity | null
      risks: McpImportRiskFlag[]
    }
  | { ok: false; reason: string } {
  if (!isRecord(value)) {
    return { ok: false, reason: `entry "${sourceKey}" is not an object` }
  }

  const risks: McpImportRiskFlag[] = []

  // StudiumX durable/public server object
  const isStudiumxServer =
    typeof value.id === 'string' ||
    value.envPlain != null ||
    value.envSecretRefs != null ||
    value.headersPlain != null ||
    value.headersSecretRefs != null ||
    value.envSecretConfigured != null

  const rawTransport = value.type ?? value.transport ?? (value.url ? 'streamableHttp' : 'stdio')
  const transport = normalizeTransport(rawTransport)
  if (!transport) {
    return {
      ok: false,
      reason: `entry "${sourceKey}" has unsupported transport`
    }
  }

  let command: string | null = null
  let args: string[] = []
  let cwd: string | null = null
  let env: Record<string, string> = {}
  let url: string | null = null
  let headers: Record<string, string> = {}

  if (transport === 'stdio') {
    if (typeof value.command !== 'string' || !value.command.trim()) {
      return { ok: false, reason: `entry "${sourceKey}" missing stdio command` }
    }
    command = value.command.trim()
    risks.push('command_execution')
    if (value.args != null) {
      if (!isStringArray(value.args)) {
        return { ok: false, reason: `entry "${sourceKey}" args must be string[]` }
      }
      args = [...value.args]
    }
    if (typeof value.cwd === 'string' && value.cwd.trim()) cwd = value.cwd.trim()
    const envSource =
      isRecord(value.env) ? value.env : isRecord(value.envPlain) ? value.envPlain : null
    if (envSource) {
      if (!isStringRecord(envSource)) {
        return { ok: false, reason: `entry "${sourceKey}" env must be string map` }
      }
      env = { ...envSource }
    }
    // Secret refs configured only → risk without values
    if (isRecord(value.envSecretRefs) || isRecord(value.envSecretConfigured)) {
      risks.push('secret_present')
    }
  } else {
    if (typeof value.url !== 'string' || !value.url.trim()) {
      return { ok: false, reason: `entry "${sourceKey}" missing url` }
    }
    url = value.url.trim()
    risks.push('remote_url')
    const headerSource = isRecord(value.headers)
      ? value.headers
      : isRecord(value.headersPlain)
        ? value.headersPlain
        : null
    if (headerSource) {
      if (!isStringRecord(headerSource)) {
        return { ok: false, reason: `entry "${sourceKey}" headers must be string map` }
      }
      headers = { ...headerSource }
    }
    if (isRecord(value.headersSecretRefs) || isRecord(value.headersSecretConfigured)) {
      risks.push('secret_present')
    }
  }

  if (recordHasSecretKeys(env) || recordHasSecretKeys(headers)) {
    if (!risks.includes('secret_present')) risks.push('secret_present')
  }
  // Strip obvious secret *values* from risk notes path — values stay in draft for confirm-time secretChanges
  // but we never put them into the migration report.

  let timeoutMs: number | null = null
  const rawTimeout = value.timeoutMs ?? value.timeout
  if (rawTimeout != null) {
    if (typeof rawTimeout !== 'number' || !Number.isInteger(rawTimeout) || rawTimeout <= 0) {
      return { ok: false, reason: `entry "${sourceKey}" timeout invalid` }
    }
    timeoutMs = rawTimeout
  }

  const oauth = parseImportOAuth(value.oauth, transport)
  if (oauth === 'invalid') {
    return { ok: false, reason: `entry "${sourceKey}" oauth invalid or contains secrets` }
  }

  const label =
    typeof value.label === 'string' && value.label.trim()
      ? value.label.trim()
      : sourceKey.trim() || `Server ${index + 1}`

  const preferredId = resolvePreferredId(value, sourceKey, label, isStudiumxServer)
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : true

  let workspaceRootInjection: McpWorkspaceRootInjection | null = null
  if (value.workspaceRootInjection === 'off' || value.workspaceRootInjection === 'granted') {
    workspaceRootInjection = value.workspaceRootInjection
  }
  let injectionIdentity: McpInjectionIdentity | null = null
  if (value.injectionIdentity === 'filesystem_mcp' || value.injectionIdentity === 'generic') {
    injectionIdentity = value.injectionIdentity
  }

  return {
    ok: true,
    preferredId,
    label,
    enabled,
    transport,
    command,
    args,
    cwd,
    env,
    url,
    headers,
    timeoutMs,
    oauth,
    workspaceRootInjection,
    injectionIdentity,
    risks
  }
}

function resolvePreferredId(
  value: Record<string, unknown>,
  sourceKey: string,
  label: string,
  isStudiumxServer: boolean
): string {
  if (isStudiumxServer && typeof value.id === 'string' && MCP_SERVER_ID_RE.test(value.id)) {
    return value.id
  }
  if (MCP_SERVER_ID_RE.test(sourceKey)) return sourceKey
  return slugifyServerId(label || sourceKey)
}

function parseImportOAuth(
  value: unknown,
  transport: McpTransportKind
): UserMcpServerOAuthConfigV1 | null | 'invalid' {
  if (value == null) return null
  if (transport === 'stdio') return null
  if (!isRecord(value)) return 'invalid'
  // Reject secret-bearing oauth shapes.
  for (const banned of [
    'clientSecret',
    'client_secret',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'token',
    'code',
    'pkceVerifier',
    'code_verifier'
  ]) {
    if (banned in value) return 'invalid'
  }
  if (typeof value.authorizationEndpoint !== 'string' || !value.authorizationEndpoint.trim()) {
    return 'invalid'
  }
  if (typeof value.tokenEndpoint !== 'string' || !value.tokenEndpoint.trim()) {
    return 'invalid'
  }
  if (typeof value.clientId !== 'string' || !value.clientId.trim()) return 'invalid'
  let scopes: string[] = []
  if (typeof value.scopes === 'string') {
    scopes = value.scopes
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
  } else if (Array.isArray(value.scopes)) {
    for (const item of value.scopes) {
      if (typeof item !== 'string' || !item.trim()) return 'invalid'
      scopes.push(item.trim())
    }
  } else if (value.scopes != null) {
    return 'invalid'
  }
  let resource: string | null = null
  if (typeof value.resource === 'string' && value.resource.trim()) resource = value.resource.trim()
  else if (value.resource != null && value.resource !== '') return 'invalid'
  return {
    authorizationEndpoint: value.authorizationEndpoint.trim(),
    tokenEndpoint: value.tokenEndpoint.trim(),
    clientId: value.clientId.trim(),
    scopes,
    resource
  }
}

function exportPublicServer(server: UserMcpServerPublicV1): McpExportServerV1 {
  const envSecretKeys = Object.entries(server.envSecretConfigured)
    .filter(([, active]) => active)
    .map(([key]) => key)
    .sort()
  const headersSecretKeys = Object.entries(server.headersSecretConfigured)
    .filter(([, active]) => active)
    .map(([key]) => key)
    .sort()
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
    envPlain: redactStringRecord(server.envPlain, server.envSecretConfigured),
    envSecretKeys,
    url: server.url,
    headersPlain: redactStringRecord(server.headersPlain, server.headersSecretConfigured),
    headersSecretKeys,
    timeoutMs: server.timeoutMs,
    toolEffectOverrides: { ...server.toolEffectOverrides },
    oauth: server.oauth,
    workspaceRootInjection: server.workspaceRootInjection,
    injectionIdentity: server.injectionIdentity,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt
  }
}

function redactStringRecord(
  plain: Readonly<Record<string, string>>,
  secretConfigured: Readonly<Record<string, boolean>>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(plain)) {
    if (secretConfigured[key] || SECRET_KEY_RE.test(key)) {
      // Omit secret values entirely from plain export map.
      continue
    }
    out[key] = value
  }
  // Placeholders for known secret keys so re-import can flag secret_present without values.
  for (const [key, active] of Object.entries(secretConfigured)) {
    if (active) out[key] = MCP_SECRET_CONFIGURED_PLACEHOLDER
  }
  return out
}

function normalizeTransport(value: unknown): McpTransportKind | null {
  if (value === 'streamableHttp' || value === 'http') return 'http'
  if (value === 'stdio' || value === 'sse') return value
  return null
}

function recordHasSecretKeys(record: Readonly<Record<string, string>>): boolean {
  return Object.keys(record).some((key) => SECRET_KEY_RE.test(key))
}

function slugifyServerId(label: string): string {
  const ascii = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  const prefixed = /^[a-z]/.test(ascii) ? ascii : `mcp-${ascii || 'server'}`
  const bounded = prefixed.slice(0, 64).replace(/[-_]+$/g, '')
  return MCP_SERVER_ID_RE.test(bounded) ? bounded : 'mcp-server'
}

function uniqueServerId(base: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(base)) return base
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const tail = `-${suffix}`
    const candidate = `${base.slice(0, 64 - tail.length)}${tail}`
    if (!existingIds.has(candidate)) return candidate
  }
  return `mcp-${Date.now().toString(36)}`.slice(0, 64)
}

function toIdSet(
  ids: ReadonlySet<string> | readonly string[] | undefined
): Set<string> {
  if (!ids) return new Set()
  return ids instanceof Set ? new Set(ids) : new Set(ids)
}

function pushWarning(warnings: string[], message: string): void {
  if (warnings.length >= MAX_WARNINGS) return
  warnings.push(message.slice(0, 200))
}

function looksLikeServerMap(root: Record<string, unknown>): boolean {
  const entries = Object.entries(root).filter(
    ([key]) =>
      key !== 'schemaVersion' &&
      key !== 'enabled' &&
      key !== 'fingerprint' &&
      key !== 'export'
  )
  if (entries.length === 0) return false
  return entries.every(
    ([, value]) => isRecord(value) && looksLikeServerConfig(value as Record<string, unknown>)
  )
}

function looksLikeServerConfig(value: Record<string, unknown>): boolean {
  return ['type', 'transport', 'command', 'url', 'args', 'env', 'headers'].some(
    (key) => key in value
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
