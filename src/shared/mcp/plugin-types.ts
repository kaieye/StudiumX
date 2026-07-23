/**
 * Plugin-provided MCP declaration types (ADR-0139 / Phase G).
 * Pure types + pure helpers — no Node FS / Electron.
 */

import type {
  McpTransportKind,
  UserMcpServerOAuthConfigV1,
  UserMcpServerV1
} from './types'

export const PLUGIN_MCP_TRUST_STATES = [
  'declared',
  'verified',
  'trusted',
  'revoked'
] as const

export type PluginMcpTrustState = (typeof PLUGIN_MCP_TRUST_STATES)[number]

/** Public-only plugin MCP server declaration (no secret plaintext). */
export type PluginMcpServerDeclarationV1 = Readonly<{
  /** Plugin-local server id (pre-namespace). */
  serverId: string
  label: string
  enabled: boolean
  transport: McpTransportKind
  command?: string | null
  args?: readonly string[]
  cwd?: string | null
  url?: string | null
  timeoutMs?: number | null
  oauth?: UserMcpServerOAuthConfigV1 | null
  /** Optional env key names that require user secrets (values never in manifest). */
  envSecretKeys?: readonly string[]
  headersSecretKeys?: readonly string[]
}>

export type PluginMcpManifestFragmentV1 = Readonly<{
  pluginId: string
  pluginVersion?: string
  mcpServers: readonly PluginMcpServerDeclarationV1[]
}>

export type PluginMcpTemplateContext = Readonly<{
  pluginRoot: string
  userHome?: string
}>

export type PluginMcpNamespacedServerV1 = Readonly<{
  /** Namespaced durable id for UserMcpServerV1.id candidates. */
  namespacedId: string
  pluginId: string
  serverId: string
  declaration: PluginMcpServerDeclarationV1
  trust: PluginMcpTrustState
  /** After safe template expansion; undefined until expand succeeds. */
  expanded?: Readonly<{
    command: string | null
    args: readonly string[]
    cwd: string | null
    url: string | null
  }>
  warnings: readonly string[]
}>

export type ParsePluginMcpResult =
  | {
      ok: true
      fragment: PluginMcpManifestFragmentV1
      namespaced: readonly PluginMcpNamespacedServerV1[]
      warnings: readonly string[]
    }
  | { ok: false; reason: string; warnings: readonly string[] }

const MCP_SERVER_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/
const ALLOWED_TEMPLATE = new Set(['pluginRoot', 'userHome'])
const TEMPLATE_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g
const FORBIDDEN_INTERP_RE = /\$\{|\$[A-Za-z_]|`/

/** Slugify then build namespaced server id (ADR-0139 §2). */
export function namespacePluginServerId(pluginId: string, serverId: string): string {
  const pluginSlug = slugifyIdPart(pluginId) || 'plugin'
  const serverSlug = slugifyIdPart(serverId) || 'server'
  let raw = `plugin_${pluginSlug}_${serverSlug}`.slice(0, 64)
  if (!MCP_SERVER_ID_RE.test(raw)) {
    raw = (`p${raw.replace(/[^a-z0-9_-]/g, '')}`).slice(0, 64)
  }
  if (!MCP_SERVER_ID_RE.test(raw)) {
    raw = `plugin_x_${Math.abs(hashString(`${pluginId}:${serverId}`)).toString(36)}`.slice(0, 64)
  }
  return raw
}

export function slugifyIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Expand allowlisted templates only. Rejects env-style or unknown placeholders.
 */
export function expandPluginMcpTemplates(
  declaration: PluginMcpServerDeclarationV1,
  ctx: PluginMcpTemplateContext
):
  | { ok: true; command: string | null; args: readonly string[]; cwd: string | null; url: string | null }
  | { ok: false; reason: string } {
  const expand = (input: string | null | undefined): { ok: true; value: string | null } | { ok: false; reason: string } => {
    if (input == null || input === '') return { ok: true, value: input ?? null }
    if (FORBIDDEN_INTERP_RE.test(input)) {
      return { ok: false, reason: 'forbidden_interpolation' }
    }
    let failed: string | null = null
    const value = input.replace(TEMPLATE_RE, (_m, name: string) => {
      if (!ALLOWED_TEMPLATE.has(name)) {
        failed = `unknown_template:${name}`
        return ''
      }
      if (name === 'pluginRoot') return ctx.pluginRoot
      if (name === 'userHome') {
        if (!ctx.userHome) {
          failed = 'userHome_unavailable'
          return ''
        }
        return ctx.userHome
      }
      failed = `unknown_template:${name}`
      return ''
    })
    if (failed) return { ok: false, reason: failed }
    // Residual {{ must not remain
    if (/\{\{/.test(value)) return { ok: false, reason: 'unexpanded_template' }
    return { ok: true, value }
  }

  const command = expand(declaration.command ?? null)
  if (!command.ok) return command
  const cwd = expand(declaration.cwd ?? null)
  if (!cwd.ok) return cwd
  const url = expand(declaration.url ?? null)
  if (!url.ok) return url
  const args: string[] = []
  for (const arg of declaration.args ?? []) {
    const next = expand(arg)
    if (!next.ok) return next
    if (next.value != null) args.push(next.value)
  }
  return {
    ok: true,
    command: command.value,
    args,
    cwd: cwd.value,
    url: url.value
  }
}

/** Fail-closed parse of a plugin manifest MCP fragment. */
export function parsePluginMcpDeclarations(value: unknown): ParsePluginMcpResult {
  const warnings: string[] = []
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'fragment_not_object', warnings }
  }
  const raw = value as Record<string, unknown>
  if (typeof raw.pluginId !== 'string' || !raw.pluginId.trim()) {
    return { ok: false, reason: 'plugin_id_required', warnings }
  }
  const pluginId = raw.pluginId.trim()
  if (!Array.isArray(raw.mcpServers)) {
    return { ok: false, reason: 'mcp_servers_required', warnings }
  }

  const servers: PluginMcpServerDeclarationV1[] = []
  const namespaced: PluginMcpNamespacedServerV1[] = []
  const seenLocal = new Set<string>()

  for (let i = 0; i < raw.mcpServers.length; i += 1) {
    const item = raw.mcpServers[i]
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      warnings.push(`mcpServers[${i}]: skipped_not_object`)
      continue
    }
    const s = item as Record<string, unknown>
    if (typeof s.serverId !== 'string' || !s.serverId.trim()) {
      warnings.push(`mcpServers[${i}]: missing_server_id`)
      continue
    }
    const serverId = s.serverId.trim()
    if (seenLocal.has(serverId)) {
      warnings.push(`mcpServers[${i}]: duplicate_server_id`)
      continue
    }
    seenLocal.add(serverId)

    const transport = s.transport
    if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') {
      warnings.push(`mcpServers[${i}]: invalid_transport`)
      continue
    }
    const label =
      typeof s.label === 'string' && s.label.trim() ? s.label.trim() : serverId
    const enabled = s.enabled !== false
    const declaration: PluginMcpServerDeclarationV1 = {
      serverId,
      label,
      enabled,
      transport,
      command: typeof s.command === 'string' ? s.command : null,
      args: Array.isArray(s.args)
        ? s.args.filter((a): a is string => typeof a === 'string')
        : [],
      cwd: typeof s.cwd === 'string' ? s.cwd : null,
      url: typeof s.url === 'string' ? s.url : null,
      timeoutMs:
        typeof s.timeoutMs === 'number' && Number.isFinite(s.timeoutMs) && s.timeoutMs > 0
          ? Math.floor(s.timeoutMs)
          : null,
      oauth: null,
      envSecretKeys: Array.isArray(s.envSecretKeys)
        ? s.envSecretKeys.filter((k): k is string => typeof k === 'string')
        : [],
      headersSecretKeys: Array.isArray(s.headersSecretKeys)
        ? s.headersSecretKeys.filter((k): k is string => typeof k === 'string')
        : []
    }
    servers.push(declaration)
    namespaced.push({
      namespacedId: namespacePluginServerId(pluginId, serverId),
      pluginId,
      serverId,
      declaration,
      trust: 'declared',
      warnings: []
    })
  }

  return {
    ok: true,
    fragment: {
      pluginId,
      pluginVersion: typeof raw.pluginVersion === 'string' ? raw.pluginVersion : undefined,
      mcpServers: servers
    },
    namespaced,
    warnings
  }
}

function hashString(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0
  }
  return h
}

/**
 * Project a trusted/expanded plugin server into a runtime `UserMcpServerV1`
 * suitable for Phase E plugin source layers. Secrets are never filled from
 * the manifest — only secret *key names* are remembered as empty refs.
 */
export function pluginNamespacedToUserMcpServer(
  entry: PluginMcpNamespacedServerV1,
  now: string
): UserMcpServerV1 | null {
  if (entry.trust !== 'trusted' && entry.trust !== 'verified') return null
  const d = entry.declaration
  const expanded = entry.expanded
  const command = expanded?.command ?? d.command ?? null
  const args = expanded?.args ?? d.args ?? []
  const cwd = expanded?.cwd ?? d.cwd ?? null
  const url = expanded?.url ?? d.url ?? null
  const envSecretRefs: Record<string, string> = {}
  for (const key of d.envSecretKeys ?? []) {
    if (typeof key === 'string' && key.trim()) envSecretRefs[key.trim()] = ''
  }
  const headersSecretRefs: Record<string, string> = {}
  for (const key of d.headersSecretKeys ?? []) {
    if (typeof key === 'string' && key.trim()) headersSecretRefs[key.trim()] = ''
  }
  return {
    id: entry.namespacedId,
    label: d.label,
    enabled: d.enabled,
    scope: 'user',
    workspaceRoot: null,
    transport: d.transport,
    command: d.transport === 'stdio' ? command : null,
    args: d.transport === 'stdio' ? [...args] : [],
    cwd: d.transport === 'stdio' ? cwd : null,
    envSecretRefs: d.transport === 'stdio' ? envSecretRefs : {},
    envPlain: {},
    url: d.transport === 'stdio' ? null : url,
    headersSecretRefs: d.transport === 'stdio' ? {} : headersSecretRefs,
    headersPlain: {},
    timeoutMs: d.timeoutMs ?? null,
    toolEffectOverrides: {},
    oauth: d.transport === 'stdio' ? null : d.oauth ?? null,
    workspaceRootInjection: 'off',
    injectionIdentity: null,
    createdAt: now,
    updatedAt: now
  }
}
