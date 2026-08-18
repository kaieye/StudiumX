/**
 * CLI source layer + host multi-source smoke (ADR-0013, no official catalog).
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadMcpSourceLayers,
  resolveEffectiveMcpConfig,
  STUDIUMX_MCP_CLI_JSON_ENV,
  STUDIUMX_MCP_CONFIG_JSON_ENV
} from '../../src/main/mcp/source-loaders'
import { McpHost } from '../../src/main/mcp/host'
import type { UserMcpConfigV1, UserMcpServerV1 } from '../../src/shared/mcp/types'

function server(
  id: string,
  overrides: Partial<UserMcpServerV1> = {}
): UserMcpServerV1 {
  return {
    id,
    label: id,
    enabled: true,
    scope: 'user',
    workspaceRoot: null,
    transport: 'stdio',
    command: 'echo',
    args: [id],
    cwd: null,
    envSecretRefs: {},
    envPlain: {},
    url: null,
    headersSecretRefs: {},
    headersPlain: {},
    timeoutMs: null,
    toolEffectOverrides: {},
    oauth: null,
    workspaceRootInjection: 'off',
    injectionIdentity: null,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    ...overrides
  }
}

describe('CLI MCP source layer (ADR-0013)', () => {
  it('loads STUDIUMX_MCP_CLI_JSON as highest-precedence cli layer', async () => {
    const loaded = await loadMcpSourceLayers({
      env: {
        [STUDIUMX_MCP_CLI_JSON_ENV]: JSON.stringify({
          mcpServers: {
            from_cli: { command: 'cli-bin', args: [] }
          }
        }),
        [STUDIUMX_MCP_CONFIG_JSON_ENV]: JSON.stringify({
          mcpServers: {
            from_env: { command: 'env-bin', args: [] },
            from_cli: { command: 'env-wins-if-no-cli', args: [] }
          }
        })
      }
    })
    const kinds = loaded.layers.map((l) => l.origin.kind)
    expect(kinds).toContain('cli')
    expect(kinds).toContain('environment')
    const cli = loaded.layers.find((l) => l.origin.kind === 'cli')
    expect(cli?.servers.some((s) => s.id === 'from_cli')).toBe(true)
  })

  it('explicit empty cliServers suppresses env CLI JSON for that resolve', async () => {
    const loaded = await loadMcpSourceLayers({
      cliServers: [],
      env: {
        [STUDIUMX_MCP_CLI_JSON_ENV]: JSON.stringify({
          mcpServers: { hidden: { command: 'x', args: [] } }
        })
      }
    })
    expect(loaded.layers.some((l) => l.origin.kind === 'cli')).toBe(false)
  })

  it('cli layer wins over user on id collision', async () => {
    const userConfig: UserMcpConfigV1 = {
      schemaVersion: 1,
      enabled: true,
      autoConnect: false,
      servers: [server('shared', { label: 'from-user', command: 'user-cmd' })]
    }
    const view = await resolveEffectiveMcpConfig(userConfig, {
      cliServers: [server('shared', { label: 'from-cli', command: 'cli-cmd' })],
      // This test isolates the user/CLI precedence contract. System defaults
      // are exercised by host-level coverage below.
      systemServers: []
    })
    expect(view.effectiveServers).toHaveLength(1)
    expect(view.effectiveServers[0]!.server.command).toBe('cli-cmd')
    expect(view.effectiveServers[0]!.source.kind).toBe('cli')
    expect(view.shadowed.some((s) => s.source.kind === 'user')).toBe(true)
  })

  it('workspace file layer merges under user/cli', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-ws-src-'))
    try {
      await writeFile(
        join(root, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            ws_only: { command: 'ws', args: [] },
            shared: { command: 'ws-shared', args: [] }
          }
        }),
        'utf8'
      )
      const userConfig: UserMcpConfigV1 = {
        schemaVersion: 1,
        enabled: true,
        servers: [server('shared', { command: 'user-shared' })]
      }
      const view = await resolveEffectiveMcpConfig(userConfig, {
        workspaceRoot: root,
        // Keep this focused on workspace-versus-user precedence rather than
        // the independently tested built-in system layer.
        systemServers: []
      })
      const ids = view.effectiveServers.map((e) => e.server.id).sort()
      expect(ids).toEqual(['shared', 'ws_only'])
      expect(view.effectiveServers.find((e) => e.server.id === 'shared')!.server.command).toBe(
        'user-shared'
      )
      expect(view.shadowed.some((s) => s.server.command === 'ws-shared')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('McpHost CLI session override', () => {
  it('setCliServers injects highest layer then clear restores env path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-host-cli-'))
    try {
      const host = new McpHost({
        userDataPath: dir,
        bootstrapPluginMcp: false,
        cliServers: [server('boot_cli', { command: 'boot' })]
      })
      const userConfig: UserMcpConfigV1 = {
        schemaVersion: 1,
        enabled: true,
        autoConnect: false,
        servers: [server('user1')]
      }
      vi.spyOn(host.configStore, 'load').mockResolvedValue(userConfig)
      vi.spyOn(host.sessionManager, 'applyConfig').mockResolvedValue()

      const view = await host.applyEffectiveConfig()
      expect(view.effectiveServers.map((e) => e.server.id).sort()).toEqual(['boot_cli', 'context-docs', 'user1'])

      await host.setCliServers([server('runtime_cli')])
      const v2 = host.getLastEffectiveView()
      expect(v2?.effectiveServers.some((e) => e.server.id === 'runtime_cli')).toBe(true)
      expect(v2?.effectiveServers.some((e) => e.server.id === 'boot_cli')).toBe(false)

      await host.setCliServers(null)
      // Without an env CLI, the user layer and built-in system layer remain.
      const v3 = host.getLastEffectiveView()
      expect(v3?.effectiveServers.map((e) => e.server.id).sort()).toEqual(['context-docs', 'user1'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
