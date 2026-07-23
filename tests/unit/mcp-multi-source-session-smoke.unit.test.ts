/**
 * Fake-transport smoke: multi-source apply → discovery auto-connect → budgeted reconnect.
 * No network / no official catalog.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { McpSessionManager } from '../../src/main/mcp/session-manager'
import { createMemoryMcpSecretEnv } from '../../src/main/mcp/secret-env'
import { createFakeMcpTransport } from '../../src/main/mcp/transports/types'
import {
  resolveEffectiveMcpConfig
} from '../../src/main/mcp/source-loaders'
import { effectiveViewToUserConfigShape } from '../../src/shared/mcp/source-types'
import { MCP_BUDGETS, type UserMcpConfigV1, type UserMcpServerV1 } from '../../src/shared/mcp/types'

function server(id: string, command = 'echo'): UserMcpServerV1 {
  return {
    id,
    label: id,
    enabled: true,
    scope: 'user',
    workspaceRoot: null,
    transport: 'stdio',
    command,
    args: [],
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

describe('MCP multi-source + session smoke (no catalog)', () => {
  it('effective workspace+user config drives snapshot tools list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-smoke-ws-'))
    try {
      await writeFile(
        join(root, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            ws_tool: {
              command: 'ws',
              args: [],
              type: 'stdio'
            }
          }
        }),
        'utf8'
      )

      const userConfig: UserMcpConfigV1 = {
        schemaVersion: 1,
        enabled: true,
        autoConnect: true,
        servers: [server('user_tool')]
      }
      const view = await resolveEffectiveMcpConfig(userConfig, { workspaceRoot: root })
      const shape = effectiveViewToUserConfigShape(view)
      expect(shape.servers.map((s) => s.id).sort()).toEqual(['user_tool', 'ws_tool'])

      const secrets = createMemoryMcpSecretEnv()
      let connects = 0
      const manager = new McpSessionManager({
        secrets,
        createTransport: (srv) => {
          connects += 1
          return createFakeMcpTransport({
            serverId: srv.id,
            tools: [
              {
                name: 'ping',
                description: 'p',
                inputSchema: { type: 'object' },
                annotations: { readOnlyHint: true }
              }
            ]
          })
        }
      })
      await manager.applyConfig(shape)
      const snap = await manager.buildSnapshot(root)
      expect(snap.tools.length).toBeGreaterThanOrEqual(2)
      expect(connects).toBe(2)
      expect(snap.tools.every((t) => t.effectClass === 'privileged')).toBe(true)

      // opt-in readOnly policy rematerializes on applyConfig when flag flips
      await manager.applyConfig({ ...shape, honorRemoteReadOnlyHint: true })
      const snap2 = await manager.buildSnapshot(root)
      expect(snap2.tools.length).toBeGreaterThanOrEqual(2)
      expect(snap2.tools.every((t) => t.effectClass === 'read')).toBe(true)

      await manager.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('budgeted reconnect surfaces retry_wait then recovers', async () => {
    vi.useFakeTimers()
    try {
      const secrets = createMemoryMcpSecretEnv()
      let n = 0
      let last: ReturnType<typeof createFakeMcpTransport> | null = null
      const manager = new McpSessionManager({
        secrets,
        createTransport: (srv) => {
          n += 1
          last = createFakeMcpTransport({
            serverId: srv.id,
            tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }]
          })
          return last
        }
      })
      await manager.applyConfig({
        schemaVersion: 1,
        enabled: true,
        autoConnect: true,
        servers: [server('demo')]
      })
      await manager.buildSnapshot()
      expect(n).toBe(1)
      last!.emitClose()
      await Promise.resolve()
      await Promise.resolve()
      expect(manager.getRuntimeView().find((s) => s.id === 'demo')?.state).toBe('retry_wait')
      await vi.advanceTimersByTimeAsync(MCP_BUDGETS.reconnectBackoffMs[0] ?? 500)
      await Promise.resolve()
      await Promise.resolve()
      expect(n).toBe(2)
      expect(manager.getRuntimeView().find((s) => s.id === 'demo')?.state).toBe('connected')
      await manager.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
