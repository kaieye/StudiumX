/**
 * Host-level multi-source + effect policy smoke (ADR-0137/0141).
 * No real network; pure config/effect path.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { McpHost } from '../../src/main/mcp/host'
import { resolveMcpToolEffect } from '../../src/shared/mcp/effect-map'
import { effectiveAutoConnect } from '../../src/shared/mcp/config-schema'
import type { UserMcpConfigV1, UserMcpServerV1 } from '../../src/shared/mcp/types'

function stdioServer(id: string): UserMcpServerV1 {
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
    updatedAt: '2026-07-23T00:00:00.000Z'
  }
}

describe('MCP host product close-out (no official catalog)', () => {
  it('effectiveAutoConnect follows enabled when autoConnect omitted', () => {
    expect(effectiveAutoConnect({ schemaVersion: 1, enabled: true, servers: [] })).toBe(true)
    expect(
      effectiveAutoConnect({ schemaVersion: 1, enabled: true, autoConnect: false, servers: [] })
    ).toBe(false)
    expect(effectiveAutoConnect({ schemaVersion: 1, enabled: false, servers: [] })).toBe(false)
  })

  it('honorRemoteReadOnlyHint maps readOnly tools without skipping overrides', () => {
    expect(
      resolveMcpToolEffect('list', {}, { honorRemoteReadOnlyHint: true, annotations: { readOnlyHint: true } })
    ).toBe('read')
    expect(
      resolveMcpToolEffect(
        'list',
        { list: 'privileged' },
        { honorRemoteReadOnlyHint: true, annotations: { readOnlyHint: true } }
      )
    ).toBe('privileged')
    expect(
      resolveMcpToolEffect(
        'rm',
        {},
        {
          honorRemoteReadOnlyHint: true,
          annotations: { readOnlyHint: true, destructiveHint: true }
        }
      )
    ).toBe('privileged')
  })

  it('prepareForWorkspace applies effective config without requiring catalog', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-host-close-'))
    try {
      const host = new McpHost({
        userDataPath: dir,
        bootstrapPluginMcp: false
      })
      const config: UserMcpConfigV1 = {
        schemaVersion: 1,
        enabled: true,
        // omit autoConnect → effective true
        servers: [stdioServer('local-a')]
      }
      vi.spyOn(host.configStore, 'load').mockResolvedValue(config)
      vi.spyOn(host.sessionManager, 'applyConfig').mockResolvedValue()
      const testServer = vi.fn().mockResolvedValue({
        ok: true,
        serverId: 'local-a',
        tools: []
      })
      ;(host.sessionManager as unknown as { testServer: typeof testServer }).testServer = testServer

      const view = await host.prepareForWorkspace(null)
      expect(view.enabled).toBe(true)
      expect(view.autoConnect).toBe(true)
      // discovery-only auto connect attempted
      expect(testServer).toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
