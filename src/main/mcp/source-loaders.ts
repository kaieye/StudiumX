/**
 * Main-process MCP multi-source loaders (ADR-0013).
 * Read-only: never write workspace / env source files.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseMcpImportText, type McpImportServerDraft } from '../../shared/mcp/import-export'
import { resolveFilesystemInjectionDefaults } from '../../shared/mcp/filesystem-mcp-defaults'
import { SYSTEM_DEFAULT_MCP_SERVERS } from '../../shared/mcp/system-defaults'
import {
  resolveMcpConfigSources,
  userGateFromConfig,
  userLayerFromConfig
} from '../../shared/mcp/source-resolver'
import type {
  McpConfigSourceLayer,
  McpEffectiveConfigViewV1
} from '../../shared/mcp/source-types'
import type { UserMcpConfigV1, UserMcpServerV1 } from '../../shared/mcp/types'

const SECRET_KEY_RE = /api[_-]?key|token|secret|password|authorization/i

/** Env var holding optional full MCP JSON document (ADR-0013 environment layer). */
export const STUDIUMX_MCP_CONFIG_JSON_ENV = 'STUDIUMX_MCP_CONFIG_JSON' as const

/**
 * Env var for CLI / session-override MCP JSON (ADR-0013 cli layer, highest precedence).
 * Same shapes as import/export (`mcpServers` map, nested servers, or StudiumX document).
 * Never written by the app; process parent / launcher may inject for a single session.
 */
export const STUDIUMX_MCP_CLI_JSON_ENV = 'STUDIUMX_MCP_CLI_JSON' as const

export type LoadMcpSourceLayersOptions = Readonly<{
  workspaceRoot?: string | null
  /** Override process.env for tests. */
  env?: NodeJS.ProcessEnv
  /**
   * Optional CLI/session layer servers (caller-owned).
   * When omitted, loaders may still populate the cli layer from
   * {@link STUDIUMX_MCP_CLI_JSON_ENV} if set.
   */
  cliServers?: readonly UserMcpServerV1[]
  /** Optional plugin layer (empty in Phase E). */
  pluginServers?: readonly UserMcpServerV1[]
  /** Optional system defaults (empty in Phase E). */
  systemServers?: readonly UserMcpServerV1[]
  now?: string
}>

export type LoadedMcpSourceLayers = Readonly<{
  layers: readonly McpConfigSourceLayer[]
  warnings: readonly string[]
}>

/**
 * Load workspace files + env into layer arrays. Never writes.
 * Missing files are silent (no warning). Unreadable / invalid JSON → warning + empty servers for that origin.
 */
export async function loadMcpSourceLayers(
  options: LoadMcpSourceLayersOptions = {}
): Promise<LoadedMcpSourceLayers> {
  const warnings: string[] = []
  const layers: McpConfigSourceLayer[] = []
  const now = options.now ?? new Date().toISOString()
  const env = options.env ?? process.env

  // CLI / session override — highest precedence when present.
  if (options.cliServers !== undefined) {
    if (options.cliServers.length > 0) {
      layers.push({
        origin: { kind: 'cli', label: 'session' },
        servers: options.cliServers
      })
    }
  } else {
    const cliDoc = env[STUDIUMX_MCP_CLI_JSON_ENV]
    if (typeof cliDoc === 'string' && cliDoc.trim()) {
      const parsed = parseDocumentToServers(cliDoc, STUDIUMX_MCP_CLI_JSON_ENV, now, warnings)
      layers.push({
        origin: { kind: 'cli', label: STUDIUMX_MCP_CLI_JSON_ENV },
        servers: parsed
      })
    }
  }

  const envDoc = env[STUDIUMX_MCP_CONFIG_JSON_ENV]
  if (typeof envDoc === 'string' && envDoc.trim()) {
    const parsed = parseDocumentToServers(envDoc, STUDIUMX_MCP_CONFIG_JSON_ENV, now, warnings)
    layers.push({
      origin: { kind: 'environment', label: STUDIUMX_MCP_CONFIG_JSON_ENV },
      servers: parsed
    })
  }

  const root = options.workspaceRoot?.trim()
  if (root) {
    const workspacePaths: Array<{ relative: string; kind: 'file' | 'zcode' }> = [
      { relative: join('.agents', 'mcp.json'), kind: 'file' },
      { relative: 'mcp.json', kind: 'file' },
      { relative: 'zcode.json', kind: 'zcode' }
    ]

    for (const entry of workspacePaths) {
      const abs = join(root, entry.relative)
      const text = await readTextIfPresent(abs)
      if (text == null) continue
      if (text === '') {
        warnings.push(`workspace MCP file empty: ${entry.relative}`)
        continue
      }

      let servers: UserMcpServerV1[] = []
      if (entry.kind === 'zcode') {
        servers = parseZcodeMcpServers(text, entry.relative, now, warnings)
      } else {
        servers = parseDocumentToServers(text, entry.relative, now, warnings)
      }

      // Multiple workspace files form one logical "workspace" kind; later files
      // are lower within-kind only via input order after sort stability — merge
      // them as separate layers with same kind so first path wins on id collision.
      layers.push({
        origin: { kind: 'workspace', label: entry.relative },
        servers
      })
    }
  }

  if (options.pluginServers && options.pluginServers.length > 0) {
    layers.push({
      origin: { kind: 'plugin', label: 'plugin' },
      servers: options.pluginServers
    })
  }

  const systemServers = options.systemServers ?? SYSTEM_DEFAULT_MCP_SERVERS
  if (systemServers.length > 0) {
    layers.push({
      origin: { kind: 'system', label: 'system' },
      servers: systemServers
    })
  }

  return { layers, warnings }
}

/**
 * Build effective view: user durable config + optional external layers.
 */
export async function resolveEffectiveMcpConfig(
  userConfig: UserMcpConfigV1,
  options: LoadMcpSourceLayersOptions = {}
): Promise<McpEffectiveConfigViewV1> {
  const loaded = await loadMcpSourceLayers(options)
  return resolveMcpConfigSources({
    layers: [userLayerFromConfig(userConfig), ...loaded.layers],
    userGate: userGateFromConfig(userConfig),
    warnings: loaded.warnings
  })
}

async function readTextIfPresent(absolutePath: string): Promise<string | null> {
  try {
    return await readFile(absolutePath, 'utf8')
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : ''
    if (code === 'ENOENT') return null
    // Unreadable: surface as empty with warning via caller when we return special?
    // Treat as missing for fail-closed; callers can't distinguish — return empty string
    // only for real empty file; for other errors return '' and let parser warn.
    return ''
  }
}

function parseZcodeMcpServers(
  text: string,
  label: string,
  now: string,
  warnings: string[]
): UserMcpServerV1[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    warnings.push(`workspace MCP parse failed: ${label}`)
    return []
  }
  if (json == null || typeof json !== 'object' || Array.isArray(json)) {
    warnings.push(`workspace MCP invalid root: ${label}`)
    return []
  }
  const root = json as Record<string, unknown>
  if (root.mcpServers == null) {
    // Optional key absent — not an error.
    return []
  }
  // Re-wrap so import detector sees claude_cursor_mcpServers.
  return parseDocumentToServers(
    JSON.stringify({ mcpServers: root.mcpServers }),
    label,
    now,
    warnings
  )
}

function parseDocumentToServers(
  text: string,
  label: string,
  now: string,
  warnings: string[]
): UserMcpServerV1[] {
  const result = parseMcpImportText(text, { now })
  if (!result.ok) {
    warnings.push(`workspace/env MCP unsupported or invalid (${label}): ${result.reason}`)
    return []
  }
  for (const w of result.report.warnings) {
    warnings.push(`${label}: ${w}`)
  }
  return result.drafts.map((draft) => draftToRuntimeServer(draft, now, warnings, label))
}

/**
 * Convert import draft → runtime server for ephemeral layers.
 * Secret-looking keys are dropped (not stored as plain); unresolved secrets never leave main.
 */
export function draftToRuntimeServer(
  draft: McpImportServerDraft,
  now: string,
  warnings: string[] = [],
  label = 'source'
): UserMcpServerV1 {
  const envPlain: Record<string, string> = {}
  const headersPlain: Record<string, string> = {}

  for (const [key, value] of Object.entries(draft.env)) {
    if (SECRET_KEY_RE.test(key)) {
      warnings.push(`${label}: dropped secret-looking env key for server ${draft.proposedId}`)
      continue
    }
    envPlain[key] = value
  }
  for (const [key, value] of Object.entries(draft.headers)) {
    if (SECRET_KEY_RE.test(key)) {
      warnings.push(`${label}: dropped secret-looking header key for server ${draft.proposedId}`)
      continue
    }
    headersPlain[key] = value
  }

  const id = sanitizeServerId(draft.proposedId)

  const injection =
    draft.transport === 'stdio'
      ? resolveFilesystemInjectionDefaults({
          transport: draft.transport,
          command: draft.command,
          args: draft.args,
          workspaceRootInjection: draft.workspaceRootInjection,
          injectionIdentity: draft.injectionIdentity ?? null,
          allowFilesystemDefault: true
        })
      : { workspaceRootInjection: 'off' as const, injectionIdentity: null }

  return {
    id,
    label: draft.label,
    enabled: draft.enabled,
    scope: 'user',
    workspaceRoot: null,
    transport: draft.transport,
    command: draft.command,
    args: draft.args,
    cwd: draft.cwd,
    envSecretRefs: {},
    envPlain: draft.transport === 'stdio' ? envPlain : {},
    url: draft.url,
    headersSecretRefs: {},
    headersPlain: draft.transport === 'stdio' ? {} : headersPlain,
    timeoutMs: draft.timeoutMs,
    toolEffectOverrides: {},
    oauth: draft.oauth,
    workspaceRootInjection: injection.workspaceRootInjection,
    injectionIdentity: injection.injectionIdentity,
    createdAt: now,
    updatedAt: now
  }
}

function sanitizeServerId(raw: string): string {
  const lowered = raw.trim().toLowerCase()
  if (/^[a-z][a-z0-9_-]{0,63}$/.test(lowered)) return lowered
  const slug = lowered
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  if (/^[a-z][a-z0-9_-]{0,63}$/.test(slug)) return slug
  return `s-${slug.replace(/^[^a-z]+/, '').slice(0, 62) || 'server'}`
}
