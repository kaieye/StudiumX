/**
 * In-memory plugin-provided MCP registry (ADR-0013).
 * Trust grant ≠ connect ≠ tool approval. No network install.
 */

import {
  expandPluginMcpTemplates,
  parsePluginMcpDeclarations,
  pluginNamespacedToUserMcpServer,
  type PluginMcpNamespacedServerV1,
  type PluginMcpTemplateContext,
  type PluginMcpTrustState
} from '../../shared/mcp/plugin-types'
import type { UserMcpServerV1 } from '../../shared/mcp/types'

export type PluginMcpCleanupHooks = Readonly<{
  dropSessions?: (serverIds: readonly string[]) => void | Promise<void>
  forgetTokens?: (serverIds: readonly string[]) => void | Promise<void>
  clearArtifacts?: (serverIds: readonly string[]) => void | Promise<void>
}>

export type PluginMcpRegisterResult =
  | { ok: true; servers: readonly PluginMcpNamespacedServerV1[]; warnings: readonly string[] }
  | { ok: false; reason: string; warnings: readonly string[] }

/**
 * Process-local registry of plugin MCP declarations.
 * Suitable as a Phase E `plugin` source layer feeder.
 */
export class PluginMcpRegistry {
  private readonly byPlugin = new Map<string, PluginMcpNamespacedServerV1[]>()
  private readonly byNamespacedId = new Map<string, PluginMcpNamespacedServerV1>()

  constructor(private readonly hooks: PluginMcpCleanupHooks = {}) {}

  /**
   * Parse and register a plugin manifest fragment.
   * Fails if any namespaced id collides with a different plugin's server.
   */
  register(
    fragment: unknown,
    options: { trust?: PluginMcpTrustState; templateContext?: PluginMcpTemplateContext } = {}
  ): PluginMcpRegisterResult {
    const parsed = parsePluginMcpDeclarations(fragment)
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason, warnings: parsed.warnings }
    }

    const trust = options.trust ?? 'declared'
    const warnings = [...parsed.warnings]
    const prepared: PluginMcpNamespacedServerV1[] = []

    for (const entry of parsed.namespaced) {
      const existing = this.byNamespacedId.get(entry.namespacedId)
      if (existing && existing.pluginId !== entry.pluginId) {
        return {
          ok: false,
          reason: `id_collision:${entry.namespacedId}`,
          warnings
        }
      }

      let next: PluginMcpNamespacedServerV1 = { ...entry, trust, warnings: [] }
      if (options.templateContext) {
        const expanded = expandPluginMcpTemplates(entry.declaration, options.templateContext)
        if (!expanded.ok) {
          warnings.push(`${entry.namespacedId}:${expanded.reason}`)
          next = { ...next, warnings: [expanded.reason] }
        } else {
          next = {
            ...next,
            expanded: {
              command: expanded.command,
              args: expanded.args,
              cwd: expanded.cwd,
              url: expanded.url
            }
          }
        }
      }
      prepared.push(next)
    }

    // Replace previous servers for this plugin
    const previous = this.byPlugin.get(parsed.fragment.pluginId) ?? []
    for (const prev of previous) {
      this.byNamespacedId.delete(prev.namespacedId)
    }
    this.byPlugin.set(parsed.fragment.pluginId, prepared)
    for (const server of prepared) {
      this.byNamespacedId.set(server.namespacedId, server)
    }

    return { ok: true, servers: prepared, warnings }
  }

  list(pluginId?: string): readonly PluginMcpNamespacedServerV1[] {
    if (pluginId) return Object.freeze([...(this.byPlugin.get(pluginId) ?? [])])
    return Object.freeze([...this.byNamespacedId.values()])
  }

  get(namespacedId: string): PluginMcpNamespacedServerV1 | null {
    return this.byNamespacedId.get(namespacedId) ?? null
  }

  setTrust(namespacedId: string, trust: PluginMcpTrustState): boolean {
    const current = this.byNamespacedId.get(namespacedId)
    if (!current) return false
    const updated = { ...current, trust }
    this.byNamespacedId.set(namespacedId, updated)
    const list = this.byPlugin.get(current.pluginId)
    if (list) {
      this.byPlugin.set(
        current.pluginId,
        list.map((s) => (s.namespacedId === namespacedId ? updated : s))
      )
    }
    return true
  }

  /** Mark all servers for a plugin revoked and run cleanup hooks. */
  async revokePlugin(pluginId: string): Promise<readonly string[]> {
    const servers = this.byPlugin.get(pluginId) ?? []
    const ids = servers.map((s) => s.namespacedId)
    for (const s of servers) {
      this.setTrust(s.namespacedId, 'revoked')
    }
    await this.hooks.dropSessions?.(ids)
    await this.hooks.forgetTokens?.(ids)
    await this.hooks.clearArtifacts?.(ids)
    return ids
  }

  /** Remove plugin entries entirely and run cleanup hooks. */
  async unregisterPlugin(pluginId: string): Promise<readonly string[]> {
    const servers = this.byPlugin.get(pluginId) ?? []
    const ids = servers.map((s) => s.namespacedId)
    for (const id of ids) this.byNamespacedId.delete(id)
    this.byPlugin.delete(pluginId)
    await this.hooks.dropSessions?.(ids)
    await this.hooks.forgetTokens?.(ids)
    await this.hooks.clearArtifacts?.(ids)
    return ids
  }

  /** Trusted-only namespaced entries for optional Phase E plugin source layer. */
  listTrustedServers(): readonly PluginMcpNamespacedServerV1[] {
    return Object.freeze(
      [...this.byNamespacedId.values()].filter((s) => s.trust === 'trusted')
    )
  }

  /**
   * Materialize trusted plugin servers as `UserMcpServerV1` for multi-source merge.
   * Only `trust === 'trusted'` entries are emitted (verified alone is not enough).
   */
  toPluginSourceServers(now?: string): readonly UserMcpServerV1[] {
    const stamp = now ?? new Date().toISOString()
    const out: UserMcpServerV1[] = []
    for (const entry of this.listTrustedServers()) {
      const server = pluginNamespacedToUserMcpServer(
        { ...entry, trust: 'trusted' },
        stamp
      )
      if (server) out.push(server)
    }
    return out
  }
}
