/**
 * Filesystem bootstrap for plugin-declared MCP servers (ADR-0013).
 *
 * There is no runtime Extension install/uninstall pipeline yet (ADR-0014 is
 * types-only). This module fail-soft scans known local roots for declarative
 * manifests that include `mcpServers` and registers them into PluginMcpRegistry.
 *
 * Roots (in order, missing dirs ignored):
 * - options.scanRoots (explicit)
 * - resources/builtin-mcp-plugins (bundled; trust = trusted)
 * - ~/.studiumx/plugins and <userData>/plugins (local; verified → auto-trusted)
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { PluginMcpTrustState } from '../../shared/mcp/plugin-types'
import type { PluginMcpRegistry } from './plugin-mcp-registry'

const MANIFEST_CANDIDATES = [
  'plugin.json',
  '.studiumx-plugin',
  'mcp-plugin.json',
  'package.json'
] as const

export type PluginMcpBootstrapOptions = Readonly<{
  registry: PluginMcpRegistry
  /** Extra directories to scan (each child dir may hold a plugin). */
  scanRoots?: readonly string[]
  userDataPath?: string | null
  userHome?: string | null
  /**
   * When true (default), local (non-builtin) plugins that parse OK are elevated
   * from verified → trusted so they can enter the Phase E plugin source layer
   * (ADR-0013 install→register policy for local filesystem plugins).
   */
  autoTrustLocal?: boolean
  /** Resolve builtin pack roots; default: process.resourcesPath / cwd resources. */
  resolveBuiltinRoots?: () => readonly string[]
}>

export type PluginMcpBootstrapHit = Readonly<{
  pluginId: string
  pluginRoot: string
  source: 'builtin' | 'local'
  trust: PluginMcpTrustState
  serverCount: number
  warnings: readonly string[]
  ok: boolean
  reason?: string
}>

export type PluginMcpBootstrapResult = Readonly<{
  scannedRoots: readonly string[]
  hits: readonly PluginMcpBootstrapHit[]
}>

/** Default builtin roots for packaged + dev layouts. */
export function defaultBuiltinMcpPluginRoots(): string[] {
  const roots: string[] = []
  const resourcesPath =
    typeof process !== 'undefined' && typeof process.resourcesPath === 'string'
      ? process.resourcesPath
      : null
  if (resourcesPath) {
    roots.push(join(resourcesPath, 'builtin-mcp-plugins'))
  }
  // Electron app path is unavailable outside app process — use cwd for tests/dev.
  roots.push(join(process.cwd(), 'resources', 'builtin-mcp-plugins'))
  return roots
}

/**
 * Discover plugin directories under a root (one level of children).
 * The root itself is also treated as a plugin dir if it has a manifest.
 */
export async function listPluginCandidateDirs(root: string): Promise<string[]> {
  const out: string[] = []
  try {
    const st = await stat(root)
    if (!st.isDirectory()) return out
  } catch {
    return out
  }

  // Root may itself be a single-plugin package.
  if (await findManifestPath(root)) {
    out.push(root)
  }

  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const child = join(root, entry.name)
      if (await findManifestPath(child)) {
        out.push(child)
      }
    }
  } catch {
    // fail-soft
  }
  return out
}

async function findManifestPath(dir: string): Promise<string | null> {
  for (const name of MANIFEST_CANDIDATES) {
    const path = join(dir, name)
    try {
      const st = await stat(path)
      if (st.isFile()) return path
    } catch {
      // continue
    }
  }
  return null
}

/**
 * Normalize various on-disk shapes into a PluginMcpManifestFragmentV1-like object.
 * Supports:
 * - ADR-0013 fragment: { pluginId, mcpServers }
 * - ExtensionManifest with top-level mcpServers
 * - package.json studiumx.mcpServers or mcpServers
 * - Extension contributions of kind mcpServers pointing at a relative JSON file
 */
export async function loadPluginMcpFragmentFromDir(
  pluginRoot: string
): Promise<
  | { ok: true; fragment: Record<string, unknown>; pluginId: string }
  | { ok: false; reason: string }
> {
  const manifestPath = await findManifestPath(pluginRoot)
  if (!manifestPath) return { ok: false, reason: 'manifest_missing' }

  let raw: unknown
  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  } catch {
    return { ok: false, reason: 'manifest_unreadable' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'manifest_not_object' }
  }
  const record = raw as Record<string, unknown>

  const pluginId =
    (typeof record.pluginId === 'string' && record.pluginId.trim()) ||
    (typeof record.id === 'string' && record.id.trim()) ||
    (typeof record.name === 'string' && record.name.trim()) ||
    null
  if (!pluginId) return { ok: false, reason: 'plugin_id_required' }

  let mcpServers = pickMcpServersArray(record)

  // package.json nesting
  if (!mcpServers && record.studiumx && typeof record.studiumx === 'object' && !Array.isArray(record.studiumx)) {
    mcpServers = pickMcpServersArray(record.studiumx as Record<string, unknown>)
  }

  // ExtensionManifest contribution path
  if (!mcpServers && Array.isArray(record.contributions)) {
    for (const c of record.contributions) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) continue
      const contrib = c as Record<string, unknown>
      if (contrib.kind !== 'mcpServers') continue
      if (typeof contrib.path !== 'string' || !contrib.path.trim()) continue
      // Reject path escape; keep relative under pluginRoot.
      const rel = contrib.path.trim().replace(/\\/g, '/')
      if (rel.startsWith('/') || rel.includes('..')) {
        return { ok: false, reason: 'contribution_path_escape' }
      }
      const contribPath = join(pluginRoot, ...rel.split('/').filter(Boolean))
      try {
        const nested = JSON.parse(await readFile(contribPath, 'utf8')) as unknown
        if (Array.isArray(nested)) {
          mcpServers = nested
        } else if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          mcpServers = pickMcpServersArray(nested as Record<string, unknown>) ?? null
        }
      } catch {
        return { ok: false, reason: 'contribution_unreadable' }
      }
      break
    }
  }

  if (!mcpServers) {
    return { ok: false, reason: 'mcp_servers_absent' }
  }

  return {
    ok: true,
    pluginId,
    fragment: {
      pluginId,
      pluginVersion:
        typeof record.pluginVersion === 'string'
          ? record.pluginVersion
          : typeof record.version === 'string'
            ? record.version
            : undefined,
      mcpServers
    }
  }
}

function pickMcpServersArray(record: Record<string, unknown>): unknown[] | null {
  if (!Array.isArray(record.mcpServers)) return null
  return record.mcpServers
}

/**
 * Scan roots and register into the given registry. Fail-soft per plugin.
 */
export async function bootstrapPluginMcpFromFilesystem(
  options: PluginMcpBootstrapOptions
): Promise<PluginMcpBootstrapResult> {
  const autoTrustLocal = options.autoTrustLocal !== false
  const home = options.userHome ?? homedir()
  const builtinRoots = options.resolveBuiltinRoots?.() ?? defaultBuiltinMcpPluginRoots()
  const localRoots: string[] = []
  if (home) {
    localRoots.push(join(home, '.studiumx', 'plugins'))
  }
  if (options.userDataPath) {
    localRoots.push(join(options.userDataPath, 'plugins'))
  }

  const scanRoots = uniquePaths([
    ...(options.scanRoots ?? []),
    ...builtinRoots,
    ...localRoots
  ])

  const hits: PluginMcpBootstrapHit[] = []
  const builtinSet = new Set(uniquePaths([...builtinRoots]))

  for (const root of scanRoots) {
    const candidates = await listPluginCandidateDirs(root)
    for (const pluginRoot of candidates) {
      const loaded = await loadPluginMcpFragmentFromDir(pluginRoot)
      if (!loaded.ok) {
        // Skip silent absence; only record hard failures when a manifest existed but failed.
        if (loaded.reason !== 'mcp_servers_absent' && loaded.reason !== 'manifest_missing') {
          hits.push({
            pluginId: 'unknown',
            pluginRoot,
            source: isUnderAny(pluginRoot, builtinSet) ? 'builtin' : 'local',
            trust: 'declared',
            serverCount: 0,
            warnings: [],
            ok: false,
            reason: loaded.reason
          })
        }
        continue
      }

      const isBuiltin =
        isUnderAny(pluginRoot, builtinSet) || isUnderAny(root, builtinSet)
      const source: 'builtin' | 'local' = isBuiltin ? 'builtin' : 'local'
      // Builtin packs ship with the app → trusted. Local packs: verified, then auto-trust.
      const initialTrust: PluginMcpTrustState = isBuiltin ? 'trusted' : 'verified'

      const result = options.registry.register(loaded.fragment, {
        trust: initialTrust,
        templateContext: {
          pluginRoot,
          userHome: home || undefined
        }
      })

      if (!result.ok) {
        hits.push({
          pluginId: loaded.pluginId,
          pluginRoot,
          source,
          trust: initialTrust,
          serverCount: 0,
          warnings: result.warnings,
          ok: false,
          reason: result.reason
        })
        continue
      }

      let finalTrust: PluginMcpTrustState = initialTrust
      if (!isBuiltin && autoTrustLocal) {
        for (const server of result.servers) {
          options.registry.setTrust(server.namespacedId, 'trusted')
        }
        finalTrust = 'trusted'
      }

      hits.push({
        pluginId: loaded.pluginId,
        pluginRoot,
        source,
        trust: finalTrust,
        serverCount: result.servers.length,
        warnings: result.warnings,
        ok: true
      })
    }
  }

  return { scannedRoots: scanRoots, hits }
}

/**
 * Unregister a plugin from the registry (product uninstall hook surface).
 * Safe no-op when the plugin was never registered.
 */
export async function unregisterBootstrappedPlugin(
  registry: PluginMcpRegistry,
  pluginId: string
): Promise<readonly string[]> {
  return registry.unregisterPlugin(pluginId)
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const key = p.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function isUnderAny(path: string, roots: Set<string>): boolean {
  const norm = path.replace(/\\/g, '/')
  for (const root of roots) {
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
    if (norm === r || norm.startsWith(`${r}/`)) return true
  }
  return false
}
