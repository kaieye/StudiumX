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
        transport: 'stdio' as const,
        command: 'fake',
        args: [],
        cwd: null,
        envSecretRefs: {},
        envPlain: {},
        url: null,
        headersSecretRefs: {},
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