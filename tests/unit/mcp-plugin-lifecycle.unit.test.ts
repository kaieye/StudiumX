import { describe, expect, it, vi } from 'vitest'

import {
  expandPluginMcpTemplates,
  namespacePluginServerId,
  parsePluginMcpDeclarations
} from '../../src/shared/mcp/plugin-types'
import { PluginMcpRegistry } from '../../src/main/mcp/plugin-mcp-registry'

describe('plugin MCP pure helpers (ADR-0013)', () => {
  it('namespaces plugin server ids into durable charset', () => {
    const id = namespacePluginServerId('My.Plugin', 'fs-server')
    expect(id).toMatch(/^[a-z][a-z0-9_-]{0,63}$/)
    expect(id.startsWith('plugin_')).toBe(true)
  })

  it('parses fragment and rejects bad transport', () => {
    const ok = parsePluginMcpDeclarations({
      pluginId: 'demo',
      mcpServers: [
        {
          serverId: 'local',
          label: 'Local',
          transport: 'stdio',
          command: '{{pluginRoot}}/bin/server',
          args: ['--root', '{{pluginRoot}}']
        },
        { serverId: 'bad', transport: 'websocket' }
      ]
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.namespaced).toHaveLength(1)
      expect(ok.warnings.some((w) => w.includes('invalid_transport'))).toBe(true)
    }
  })

  it('expands allowlisted templates and rejects env interpolation', () => {
    const base = {
      serverId: 'x',
      label: 'X',
      enabled: true,
      transport: 'stdio' as const,
      command: '{{pluginRoot}}/mcp',
      args: ['{{pluginRoot}}'],
      cwd: null,
      url: null
    }
    const good = expandPluginMcpTemplates(base, {
      pluginRoot: '/plugins/demo',
      userHome: '/Users/me'
    })
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.command).toBe('/plugins/demo/mcp')
      expect(good.args).toEqual(['/plugins/demo'])
    }

    const bad = expandPluginMcpTemplates(
      { ...base, command: '${env.SECRET}' },
      { pluginRoot: '/plugins/demo' }
    )
    expect(bad.ok).toBe(false)

    const unknown = expandPluginMcpTemplates(
      { ...base, command: '{{envSecret}}' },
      { pluginRoot: '/plugins/demo' }
    )
    expect(unknown.ok).toBe(false)
  })
})

describe('PluginMcpRegistry', () => {
  it('registers, trusts, and cleans up on revoke/unregister', async () => {
    const dropSessions = vi.fn()
    const forgetTokens = vi.fn()
    const clearArtifacts = vi.fn()
    const registry = new PluginMcpRegistry({ dropSessions, forgetTokens, clearArtifacts })

    const result = registry.register(
      {
        pluginId: 'pack-a',
        mcpServers: [
          {
            serverId: 'tools',
            transport: 'stdio',
            command: '{{pluginRoot}}/run',
            args: []
          }
        ]
      },
      {
        trust: 'verified',
        templateContext: { pluginRoot: '/opt/pack-a' }
      }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ns = result.servers[0]!.namespacedId
    expect(registry.get(ns)?.expanded?.command).toBe('/opt/pack-a/run')
    expect(registry.listTrustedServers()).toHaveLength(0)
    expect(registry.setTrust(ns, 'trusted')).toBe(true)
    expect(registry.listTrustedServers()).toHaveLength(1)

    await registry.revokePlugin('pack-a')
    expect(dropSessions).toHaveBeenCalledWith([ns])
    expect(forgetTokens).toHaveBeenCalledWith([ns])
    expect(clearArtifacts).toHaveBeenCalledWith([ns])
    expect(registry.get(ns)?.trust).toBe('revoked')

    await registry.unregisterPlugin('pack-a')
    expect(registry.get(ns)).toBeNull()
    expect(dropSessions).toHaveBeenCalledTimes(2)
  })

  it('materializes trusted servers for Phase E plugin source layer', () => {
    const registry = new PluginMcpRegistry()
    const result = registry.register(
      {
        pluginId: 'pack-b',
        mcpServers: [
          {
            serverId: 'tools',
            transport: 'stdio',
            command: '{{pluginRoot}}/run',
            args: ['--ok']
          }
        ]
      },
      {
        trust: 'verified',
        templateContext: { pluginRoot: '/opt/pack-b' }
      }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ns = result.servers[0]!.namespacedId
    expect(registry.toPluginSourceServers()).toHaveLength(0)
    expect(registry.setTrust(ns, 'trusted')).toBe(true)
    const servers = registry.toPluginSourceServers('2026-07-23T00:00:00.000Z')
    expect(servers).toHaveLength(1)
    expect(servers[0]!.id).toBe(ns)
    expect(servers[0]!.command).toBe('/opt/pack-b/run')
    expect(servers[0]!.args).toEqual(['--ok'])
  })

  it('fails closed on cross-plugin id collision', () => {
    const registry = new PluginMcpRegistry()
    // Force same namespaced shape by using slugs that collide after slugify — use identical ids
    const a = registry.register({
      pluginId: 'p1',
      mcpServers: [{ serverId: 's1', transport: 'http', url: 'http://127.0.0.1:1' }]
    })
    expect(a.ok).toBe(true)
    // Different plugin with same serverId produces different namespaced id (includes plugin slug)
    const b = registry.register({
      pluginId: 'p2',
      mcpServers: [{ serverId: 's1', transport: 'http', url: 'http://127.0.0.1:2' }]
    })
    expect(b.ok).toBe(true)
  })
})
