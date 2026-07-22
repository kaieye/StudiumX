import { describe, expect, it } from 'vitest'

import { defaultUserMcpConfig } from '../../src/shared/mcp/config-schema'
import { MCP_BUDGETS, MCP_ERROR_CODES } from '../../src/shared/mcp/types'
import {
  createFakeMcpTransport,
  McpSessionManager
} from '../../src/main/mcp/session-manager'
import { createMemoryMcpSecretEnv } from '../../src/main/mcp/secret-env'
import { ToolRegistry } from '../../src/main/ai/tools/registry'
import { attachMcpTools, clearMcpRuntimeState } from '../../src/main/mcp/tool-bridge'
import { McpConfigStore } from '../../src/main/mcp/config-store'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

function enabledConfig(serverOverrides: Record<string, unknown> = {}) {
  const base = defaultUserMcpConfig()
  return {
    ...base,
    enabled: true,
    servers: [
      {
        id: 'demo',
        label: 'Demo',
        enabled: true,
        scope: 'user' as const,
        workspaceRoot: null,
        transport: 'stdio' as const,
        command: 'fake',
        args: [],
        cwd: null,
        envSecretRefs: {},
        envPlain: {},
        url: null,
        headersSecretRefs: {},
        headersPlain: {},
        timeoutMs: null,
        toolEffectOverrides: {},
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
        ...serverOverrides
      }
    ]
  }
}

describe('McpSessionManager fake transport (ADR-0128)', () => {
  it('lists tools under budgets and attaches to registry', async () => {
    const secrets = createMemoryMcpSecretEnv()
    const manyTools = Array.from({ length: 3 }, (_, i) => ({
      name: `tool_${i}`,
      description: 'd'.repeat(10),
      inputSchema: { type: 'object', properties: {} }
    }))
    const manager = new McpSessionManager({
      secrets,
      staticToolNames: ['write_workspace_file'],
      createTransport: (server) =>
        createFakeMcpTransport({ serverId: server.id, tools: manyTools })
    })
    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()
    expect(snapshot.tools.length).toBe(3)
    expect(snapshot.tools[0]?.registeredName).toMatch(/^mcp__demo__tool_/)
    expect(snapshot.effectByRegisteredName.get(snapshot.tools[0]!.registeredName)).toBe(
      'privileged'
    )

    const registry = new ToolRegistry()
    registry.register({
      definition: {
        type: 'function',
        function: {
          name: 'write_workspace_file',
          description: 'static',
          parameters: { type: 'object', properties: {} }
        }
      },
      handler: async () => 'ok'
    })
    const attached = attachMcpTools(registry, snapshot, manager)
    expect(attached.attached).toBe(3)
    expect(registry.names()).toContain(snapshot.tools[0]!.registeredName)

    const call = await manager.callTool(snapshot.tools[0]!.registeredName, { x: 1 })
    expect(call.ok).toBe(true)
    clearMcpRuntimeState()
    await manager.dispose()
  })

  it('truncates tools/list at per-server budget', async () => {
    const secrets = createMemoryMcpSecretEnv()
    const tools = Array.from({ length: MCP_BUDGETS.maxToolsPerServer + 5 }, (_, i) => ({
      name: `t${i}`,
      description: 'x',
      inputSchema: { type: 'object', properties: {} }
    }))
    const manager = new McpSessionManager({
      secrets,
      createTransport: (server) =>
        createFakeMcpTransport({ serverId: server.id, tools })
    })
    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()
    expect(snapshot.tools.length).toBe(MCP_BUDGETS.maxToolsPerServer)
    await manager.dispose()
  })

  it('restarts a live session when its runtime definition changes', async () => {
    const createdCommands: string[] = []
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => {
        createdCommands.push(server.command ?? '')
        return createFakeMcpTransport({
          serverId: server.id,
          tools: [
            {
              name: server.command ?? 'unknown',
              description: 'runtime definition marker',
              inputSchema: { type: 'object' }
            }
          ]
        })
      }
    })

    await manager.applyConfig(enabledConfig())
    await manager.buildSnapshot()
    expect(createdCommands).toEqual(['fake'])

    await manager.applyConfig(
      enabledConfig({
        label: 'Renamed only',
        updatedAt: '2026-07-22T01:00:00.000Z'
      })
    )
    await manager.buildSnapshot()
    expect(createdCommands).toEqual(['fake'])

    await manager.applyConfig(
      enabledConfig({
        command: 'replacement',
        updatedAt: '2026-07-22T02:00:00.000Z'
      })
    )
    expect(manager.getRuntimeView()).toEqual([{ id: 'demo', state: 'idle' }])
    const replacement = await manager.buildSnapshot()
    expect(createdCommands).toEqual(['fake', 'replacement'])
    expect(replacement.tools[0]?.rawToolName).toBe('replacement')
    await manager.dispose()
  })

  it('connects a user-scoped server for any workspace snapshot', async () => {
    const connected: string[] = []
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => {
        connected.push(server.id)
        return createFakeMcpTransport({
          serverId: server.id,
          tools: [{ name: 'user_tool', description: 'user scope', inputSchema: { type: 'object' } }]
        })
      }
    })

    await manager.applyConfig(enabledConfig({ scope: 'user', workspaceRoot: null }))
    const first = await manager.buildSnapshot('/tmp/workspace-a')
    const second = await manager.buildSnapshot('/tmp/workspace-b')

    expect(first.tools).toHaveLength(1)
    expect(second.tools).toHaveLength(1)
    expect(connected).toEqual(['demo'])
    await manager.dispose()
  })

  it('only connects a workspace-scoped server for the matching root', async () => {
    const connected: string[] = []
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => {
        connected.push(server.id)
        return createFakeMcpTransport({
          serverId: server.id,
          tools: [{ name: 'workspace_tool', description: 'workspace scope', inputSchema: { type: 'object' } }]
        })
      }
    })

    await manager.applyConfig(
      enabledConfig({ scope: 'workspace', workspaceRoot: '/tmp/studiumx-workspace' })
    )
    const mismatched = await manager.buildSnapshot('/tmp/another-workspace')
    expect(mismatched.tools).toEqual([])
    expect(mismatched.serverHealth).toEqual([{ id: 'demo', state: 'disabled' }])
    expect(connected).toEqual([])

    const matched = await manager.buildSnapshot('/tmp/studiumx-workspace')
    expect(matched.tools).toHaveLength(1)
    expect(connected).toEqual(['demo'])
    await manager.dispose()
  })

  it('rejects test connection when workspace scope does not match', async () => {
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => createFakeMcpTransport({ serverId: server.id, tools: [] })
    })
    await manager.applyConfig(
      enabledConfig({ scope: 'workspace', workspaceRoot: '/tmp/studiumx-workspace' })
    )

    const result = await manager.testServer('demo', '/tmp/another-workspace')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(MCP_ERROR_CODES.mcp_server_disabled)
    await manager.dispose()
  })

  it('resolves HTTP and SSE headers before creating SDK transports', async () => {
    const secrets = createMemoryMcpSecretEnv()
    secrets.store('auth-ref', 'Bearer secret-token')
    const created: Array<{
      transport: string
      env: Record<string, string>
      headers: Record<string, string>
    }> = []
    const manager = new McpSessionManager({
      secrets,
      createTransport: (server, env, headers) => {
        created.push({ transport: server.transport, env, headers })
        return createFakeMcpTransport({ serverId: server.id, tools: [] })
      }
    })

    const remoteConfig = (transport: 'http' | 'sse') =>
      enabledConfig({
        transport,
        command: null,
        args: [],
        url: 'https://example.com/mcp',
        headersPlain: { 'X-Client': 'StudiumX' },
        headersSecretRefs: { Authorization: 'auth-ref' }
      })

    await manager.applyConfig(remoteConfig('http'))
    await manager.buildSnapshot()
    await manager.applyConfig(remoteConfig('sse'))
    await manager.buildSnapshot()

    expect(created.map(({ transport }) => transport)).toEqual(['http', 'sse'])
    for (const entry of created) {
      expect(entry.headers).toEqual({
        'X-Client': 'StudiumX',
        Authorization: 'Bearer secret-token'
      })
      expect(entry.env).not.toHaveProperty('Authorization')
    }
    await manager.dispose()
  })

  it('restarts remote sessions when URL, headers, timeout, scope, or workspace changes', async () => {
    const createdDefinitions: string[] = []
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => {
        createdDefinitions.push(
          JSON.stringify({
            transport: server.transport,
            scope: server.scope,
            workspaceRoot: server.workspaceRoot,
            url: server.url,
            headersPlain: server.headersPlain,
            timeoutMs: server.timeoutMs
          })
        )
        return createFakeMcpTransport({ serverId: server.id, tools: [] })
      }
    })
    const remote = (overrides: Record<string, unknown> = {}) =>
      enabledConfig({
        transport: 'http',
        command: null,
        args: [],
        url: 'https://example.com/mcp',
        headersPlain: { 'X-Version': '1' },
        timeoutMs: 30_000,
        ...overrides
      })

    await manager.applyConfig(remote())
    await manager.buildSnapshot()

    await manager.applyConfig(remote({ label: 'Display name only' }))
    await manager.buildSnapshot()
    expect(createdDefinitions).toHaveLength(1)

    await manager.applyConfig(remote({ url: 'https://example.com/mcp-v2' }))
    await manager.buildSnapshot()
    await manager.applyConfig(remote({ headersPlain: { 'X-Version': '2' } }))
    await manager.buildSnapshot()
    await manager.applyConfig(remote({ timeoutMs: 45_000 }))
    await manager.buildSnapshot()
    await manager.applyConfig(
      remote({ scope: 'workspace', workspaceRoot: '/tmp/studiumx-workspace-a' })
    )
    await manager.buildSnapshot('/tmp/studiumx-workspace-a')
    await manager.applyConfig(
      remote({ scope: 'workspace', workspaceRoot: '/tmp/studiumx-workspace-b' })
    )
    await manager.buildSnapshot('/tmp/studiumx-workspace-b')

    expect(createdDefinitions).toHaveLength(6)
    await manager.dispose()
  })

  it('retains a failed test connection in the secret-free runtime view', async () => {
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) =>
        createFakeMcpTransport({
          serverId: server.id,
          initializeError: 'handshake failed with sensitive transport detail'
        })
    })

    await manager.applyConfig(enabledConfig())
    const result = await manager.testServer('demo')
    expect(result.ok).toBe(false)
    expect(manager.getRuntimeView()).toEqual([
      {
        id: 'demo',
        state: 'error',
        errorCode: MCP_ERROR_CODES.mcp_handshake_failed,
        lastErrorMessage: 'MCP 握手失败。'
      }
    ])
    await manager.dispose()
  })

  it('returns empty snapshot when root disabled', async () => {
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => createFakeMcpTransport({ serverId: server.id, tools: [] })
    })
    await manager.applyConfig(defaultUserMcpConfig())
    const snapshot = await manager.buildSnapshot()
    expect(snapshot.tools).toEqual([])
    await manager.dispose()
  })

  it('surfaces call timeout as mcp_call_timeout', async () => {
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) =>
        createFakeMcpTransport({
          serverId: server.id,
          tools: [{ name: 'slow', description: 's', inputSchema: { type: 'object' } }],
          callDelayMs: 120_000
        })
    })
    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()
    // Force short timeout path via abort
    const controller = new AbortController()
    queueMicrotask(() => controller.abort())
    const result = await manager.callTool(snapshot.tools[0]!.registeredName, {}, controller.signal)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect([
        MCP_ERROR_CODES.mcp_call_timeout,
        MCP_ERROR_CODES.mcp_call_failed
      ]).toContain(result.code)
    }
    await manager.dispose()
  })

  it('rejects static name collisions', async () => {
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      staticToolNames: ['echo'],
      createTransport: (server) =>
        createFakeMcpTransport({
          serverId: server.id,
          tools: [{ name: 'echo', description: 'x', inputSchema: { type: 'object' } }]
        })
    })
    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()
    expect(snapshot.tools.length).toBe(0)
    await manager.dispose()
  })
})

describe('McpConfigStore CAS', () => {
  it('rejects mismatched fingerprint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-cfg-'))
    try {
      const store = new McpConfigStore({ userDataPath: dir })
      const loaded = await store.load()
      const next = {
        schemaVersion: 1 as const,
        enabled: true,
        servers: []
      }
      const conflict = await store.update(next, 'wrong-fingerprint')
      expect(conflict.ok).toBe(false)
      if (!conflict.ok) expect(conflict.code).toBe(MCP_ERROR_CODES.mcp_cas_conflict)

      const ok = await store.update(next, loaded.fingerprint!)
      expect(ok.ok).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('MCP bridge settlement isolation', () => {
  it('tool-bridge module does not import ledger or outcome committer', async () => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const source = await readFile(join(process.cwd(), 'src/main/mcp/tool-bridge.ts'), 'utf8')
    expect(source).not.toMatch(/learning-session-ledger|outcome-committer|LearningSessionLedger/)
    expect(source).not.toMatch(/commitLearningOutcome/)
  })
})
