import {
  MCP_SECRET_CONFIGURED_PLACEHOLDER,
  MCP_SECRET_REF_KEEP,
  MCP_SECRET_REF_PENDING,
  type McpRuntimeServerView,
  type McpSecretInputChanges,
  type McpServerScope,
  type McpTransportKind,
  type UserMcpConfigPublicV1,
  type UserMcpServerPublicV1
} from '../../../../../shared/mcp/types'

export type DraftMcpServer = {
  /** Internal durable id. The editor derives this from Name for new servers. */
  id: string
  label: string
  enabled: boolean
  scope: McpServerScope
  workspaceRoot: string
  transport: McpTransportKind
  command: string
  argsText: string
  cwd: string
  envText: string
  url: string
  headersText: string
  timeoutText: string
  envSecretConfigured: Readonly<Record<string, boolean>>
  headersSecretConfigured: Readonly<Record<string, boolean>>
  createdAt: string
  updatedAt: string
  toolEffectOverrides: UserMcpServerPublicV1['toolEffectOverrides']
}

export type DraftMcpServerValidationError =
  | 'labelRequired'
  | 'workspaceUnavailable'
  | 'commandRequired'
  | 'cwdAbsolute'
  | 'urlRequired'
  | 'urlInvalid'
  | 'timeoutInvalid'
  | 'envInvalid'
  | 'headersInvalid'

export type DraftMcpJsonError =
  | 'jsonInvalid'
  | 'jsonObjectRequired'
  | 'jsonSingleServer'
  | 'jsonTransportInvalid'
  | 'jsonCommandInvalid'
  | 'jsonUrlInvalid'
  | 'jsonArgsInvalid'
  | 'jsonEnvInvalid'
  | 'jsonHeadersInvalid'
  | 'jsonTimeoutInvalid'

export type DraftMcpConfigUpdate = Readonly<{
  config: Record<string, unknown>
  secretChanges?: McpSecretInputChanges
}>

const SECRET_KEY_RE = /api[_-]?key|token|secret|password|authorization/i
const MCP_SERVER_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/

export function nowIso(): string {
  return new Date().toISOString()
}

export function publicMcpServerToDraft(server: UserMcpServerPublicV1): DraftMcpServer {
  return {
    id: server.id,
    label: server.label,
    enabled: server.enabled,
    scope: server.scope,
    workspaceRoot: server.workspaceRoot ?? '',
    transport: server.transport,
    command: server.command ?? '',
    argsText: server.args.join(' '),
    cwd: server.cwd ?? '',
    envText: stringifyStringRecord(
      withConfiguredSecretPlaceholders(server.envPlain, server.envSecretConfigured)
    ),
    url: server.url ?? '',
    headersText: stringifyStringRecord(
      withConfiguredSecretPlaceholders(server.headersPlain, server.headersSecretConfigured)
    ),
    timeoutText: server.timeoutMs == null ? '' : String(server.timeoutMs),
    envSecretConfigured: server.envSecretConfigured,
    headersSecretConfigured: server.headersSecretConfigured,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
    toolEffectOverrides: server.toolEffectOverrides
  }
}

export function publicMcpConfigToDrafts(config: UserMcpConfigPublicV1): DraftMcpServer[] {
  return config.servers.map(publicMcpServerToDraft)
}

export function createDraftMcpServer(existingIds: ReadonlySet<string>): DraftMcpServer {
  const stamp = nowIso()
  return {
    id: uniqueServerId('my-server', existingIds),
    label: '',
    enabled: true,
    scope: 'user',
    workspaceRoot: '',
    transport: 'stdio',
    command: '',
    argsText: '',
    cwd: '',
    envText: '{}',
    url: '',
    headersText: '{}',
    timeoutText: '',
    envSecretConfigured: {},
    headersSecretConfigured: {},
    createdAt: stamp,
    updatedAt: stamp,
    toolEffectOverrides: {}
  }
}

export function normalizeDraftMcpServer(
  server: DraftMcpServer,
  existingIds: ReadonlySet<string>,
  originalId?: string
): DraftMcpServer {
  const label = server.label.trim()
  const unavailableIds = new Set(existingIds)
  if (originalId) unavailableIds.delete(originalId)
  const id = originalId ?? uniqueServerId(slugifyServerId(label), unavailableIds)
  return {
    ...server,
    id,
    label,
    workspaceRoot: server.scope === 'workspace' ? server.workspaceRoot.trim() : '',
    command: server.command.trim(),
    argsText: server.argsText.trim(),
    cwd: server.cwd.trim(),
    url: server.url.trim(),
    timeoutText: server.timeoutText.trim(),
    updatedAt: nowIso()
  }
}

export function validateDraftMcpServer(
  server: DraftMcpServer
): DraftMcpServerValidationError | null {
  if (!server.label.trim()) return 'labelRequired'
  if (server.scope === 'workspace' && !server.workspaceRoot.trim()) return 'workspaceUnavailable'
  if (server.transport === 'stdio') {
    if (!server.command.trim()) return 'commandRequired'
    if (server.cwd.trim() && !isAbsolutePath(server.cwd.trim())) return 'cwdAbsolute'
    if (!parseStringRecordText(server.envText).ok) return 'envInvalid'
  } else {
    if (!server.url.trim()) return 'urlRequired'
    if (!isHttpUrl(server.url.trim())) return 'urlInvalid'
    if (!parseStringRecordText(server.headersText).ok) return 'headersInvalid'
  }
  if (server.timeoutText.trim() && parseTimeout(server.timeoutText) == null) {
    return 'timeoutInvalid'
  }
  return null
}

export function draftMcpServersToConfigUpdate(
  enabled: boolean,
  servers: readonly DraftMcpServer[]
): DraftMcpConfigUpdate {
  const secretChanges: Record<string, { env?: Record<string, string>; headers?: Record<string, string> }> = {}
  const documentServers = servers.map((server) => {
    const env = projectRecordSecrets(
      server.id,
      'env',
      server.transport === 'stdio' ? requireStringRecordText(server.envText, 'env') : {},
      server.envSecretConfigured,
      secretChanges
    )
    const headers = projectRecordSecrets(
      server.id,
      'headers',
      server.transport === 'stdio' ? {} : requireStringRecordText(server.headersText, 'headers'),
      server.headersSecretConfigured,
      secretChanges
    )
    return {
      id: server.id,
      label: server.label,
      enabled: server.enabled,
      scope: server.scope,
      workspaceRoot: server.scope === 'workspace' ? server.workspaceRoot : null,
      transport: server.transport,
      command: server.transport === 'stdio' ? server.command : null,
      args: server.transport === 'stdio' ? splitArguments(server.argsText) : [],
      cwd: server.transport === 'stdio' && server.cwd ? server.cwd : null,
      envSecretRefs: env.secretRefs,
      envPlain: env.plain,
      url: server.transport === 'stdio' ? null : server.url,
      headersSecretRefs: headers.secretRefs,
      headersPlain: headers.plain,
      timeoutMs: server.timeoutText ? Number(server.timeoutText) : null,
      toolEffectOverrides: server.toolEffectOverrides ?? {},
      createdAt: server.createdAt,
      updatedAt: server.updatedAt
    }
  })
  return {
    config: { schemaVersion: 1, enabled, servers: documentServers },
    ...(Object.keys(secretChanges).length > 0 ? { secretChanges } : {})
  }
}

export function draftMcpServerToJson(server: DraftMcpServer): string {
  const config: Record<string, unknown> = {
    type: server.transport === 'http' ? 'streamableHttp' : server.transport
  }
  if (server.timeoutText.trim()) config.timeoutMs = Number(server.timeoutText)
  if (server.transport === 'stdio') {
    config.command = server.command
    config.args = splitArguments(server.argsText)
    if (server.cwd.trim()) config.cwd = server.cwd.trim()
    const env = parseStringRecordText(server.envText)
    if (env.ok && Object.keys(env.value).length > 0) config.env = env.value
  } else {
    config.url = server.url
    const headers = parseStringRecordText(server.headersText)
    if (headers.ok && Object.keys(headers.value).length > 0) config.headers = headers.value
  }
  return JSON.stringify({ [server.label.trim() || server.id || 'my-server']: config }, null, 2)
}

export function jsonToDraftMcpServer(
  text: string,
  current: DraftMcpServer
): { ok: true; draft: DraftMcpServer } | { ok: false; error: DraftMcpJsonError } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'jsonInvalid' }
  }
  if (!isRecord(parsed)) return { ok: false, error: 'jsonObjectRequired' }

  const unwrapped = isRecord(parsed.mcpServers) ? parsed.mcpServers : parsed
  let name = current.label
  let rawConfig: Record<string, unknown>
  if (looksLikeServerConfig(unwrapped)) {
    rawConfig = unwrapped
  } else {
    const entries = Object.entries(unwrapped)
    if (entries.length !== 1 || !isRecord(entries[0]?.[1])) {
      return { ok: false, error: 'jsonSingleServer' }
    }
    name = entries[0]![0]
    rawConfig = entries[0]![1] as Record<string, unknown>
  }

  const rawTransport = rawConfig.type ?? rawConfig.transport ?? (rawConfig.url ? 'streamableHttp' : 'stdio')
  const transport: McpTransportKind =
    rawTransport === 'streamableHttp' || rawTransport === 'http'
      ? 'http'
      : rawTransport === 'stdio' || rawTransport === 'sse'
        ? rawTransport
        : 'stdio'
  if (!['stdio', 'streamableHttp', 'http', 'sse'].includes(String(rawTransport))) {
    return { ok: false, error: 'jsonTransportInvalid' }
  }

  if (rawConfig.args != null && !isStringArray(rawConfig.args)) {
    return { ok: false, error: 'jsonArgsInvalid' }
  }
  if (rawConfig.env != null && !isStringRecord(rawConfig.env)) {
    return { ok: false, error: 'jsonEnvInvalid' }
  }
  if (rawConfig.headers != null && !isStringRecord(rawConfig.headers)) {
    return { ok: false, error: 'jsonHeadersInvalid' }
  }
  if (
    rawConfig.timeoutMs != null &&
    (typeof rawConfig.timeoutMs !== 'number' || !Number.isInteger(rawConfig.timeoutMs) || rawConfig.timeoutMs <= 0)
  ) {
    return { ok: false, error: 'jsonTimeoutInvalid' }
  }
  if (transport === 'stdio' && rawConfig.command != null && typeof rawConfig.command !== 'string') {
    return { ok: false, error: 'jsonCommandInvalid' }
  }
  if (transport !== 'stdio' && rawConfig.url != null && typeof rawConfig.url !== 'string') {
    return { ok: false, error: 'jsonUrlInvalid' }
  }

  return {
    ok: true,
    draft: {
      ...current,
      label: name,
      transport,
      command: typeof rawConfig.command === 'string' ? rawConfig.command : '',
      argsText: Array.isArray(rawConfig.args) ? rawConfig.args.join(' ') : '',
      cwd: typeof rawConfig.cwd === 'string' ? rawConfig.cwd : '',
      envText: stringifyStringRecord(isStringRecord(rawConfig.env) ? rawConfig.env : {}),
      url: typeof rawConfig.url === 'string' ? rawConfig.url : '',
      headersText: stringifyStringRecord(
        isStringRecord(rawConfig.headers) ? rawConfig.headers : {}
      ),
      timeoutText: typeof rawConfig.timeoutMs === 'number' ? String(rawConfig.timeoutMs) : ''
    }
  }
}

export function mcpServerCommandSummary(server: UserMcpServerPublicV1): string {
  if (server.transport !== 'stdio') return server.url?.trim() || '—'
  const command = server.command?.trim() || '—'
  return [command, ...server.args].join(' ')
}

export function mcpServerMatchesSearch(
  server: UserMcpServerPublicV1,
  runtime: McpRuntimeServerView | undefined,
  query: string
): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  return [
    server.id,
    server.label,
    server.transport,
    server.scope,
    server.workspaceRoot ?? '',
    server.command ?? '',
    ...server.args,
    server.cwd ?? '',
    server.url ?? '',
    runtime?.state ?? '',
    runtime?.errorCode ?? '',
    runtime?.lastErrorMessage ?? ''
  ]
    .join('\n')
    .toLocaleLowerCase()
    .includes(normalized)
}

export function configuredMcpSecretCount(server: UserMcpServerPublicV1): number {
  return (
    Object.values(server.envSecretConfigured).filter(Boolean).length +
    Object.values(server.headersSecretConfigured).filter(Boolean).length
  )
}

export function serverMatchesActiveWorkspace(
  server: UserMcpServerPublicV1,
  workspaceRoot: string | null
): boolean {
  if (server.scope === 'user') return true
  return Boolean(workspaceRoot && server.workspaceRoot === workspaceRoot)
}

function projectRecordSecrets(
  serverId: string,
  kind: 'env' | 'headers',
  values: Record<string, string>,
  configured: Readonly<Record<string, boolean>>,
  secretChanges: Record<string, { env?: Record<string, string>; headers?: Record<string, string> }>
): { plain: Record<string, string>; secretRefs: Record<string, string> } {
  const plain: Record<string, string> = {}
  const secretRefs: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    const wasSecret = configured[key] === true
    const shouldRemainSecret = wasSecret || SECRET_KEY_RE.test(key)
    if (!shouldRemainSecret) {
      plain[key] = value
      continue
    }
    if (value === MCP_SECRET_CONFIGURED_PLACEHOLDER && wasSecret) {
      secretRefs[key] = MCP_SECRET_REF_KEEP
      continue
    }
    secretRefs[key] = MCP_SECRET_REF_PENDING
    const serverChanges = (secretChanges[serverId] ??= {})
    const bucket = (serverChanges[kind] ??= {})
    bucket[key] = value
  }
  return { plain, secretRefs }
}

function splitArguments(text: string): string[] {
  return text.trim() ? text.trim().split(/\s+/) : []
}

function stringifyStringRecord(value: Readonly<Record<string, string>>): string {
  return JSON.stringify(value, null, 2)
}

function withConfiguredSecretPlaceholders(
  plain: Readonly<Record<string, string>>,
  configured: Readonly<Record<string, boolean>>
): Record<string, string> {
  const result = { ...plain }
  for (const [key, active] of Object.entries(configured)) {
    if (active) result[key] = MCP_SECRET_CONFIGURED_PLACEHOLDER
  }
  return result
}

function parseStringRecordText(
  text: string
): { ok: true; value: Record<string, string> } | { ok: false; value: Record<string, never> } {
  try {
    const value: unknown = JSON.parse(text.trim() || '{}')
    return isStringRecord(value) ? { ok: true, value } : { ok: false, value: {} }
  } catch {
    return { ok: false, value: {} }
  }
}

function requireStringRecordText(text: string, field: 'env' | 'headers'): Record<string, string> {
  const parsed = parseStringRecordText(text)
  if (!parsed.ok) {
    throw new Error(`MCP ${field} must be a JSON object whose values are strings.`)
  }
  return parsed.value
}

function parseTimeout(text: string): number | null {
  const value = Number(text.trim())
  return Number.isInteger(value) && value > 0 ? value : null
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

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
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

function looksLikeServerConfig(value: Record<string, unknown>): boolean {
  return ['type', 'transport', 'command', 'url', 'args', 'env', 'headers'].some((key) => key in value)
}
