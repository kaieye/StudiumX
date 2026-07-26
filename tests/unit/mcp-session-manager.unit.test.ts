import { describe, expect, it, vi } from 'vitest'

import { defaultUserMcpConfig } from '../../src/shared/mcp/config-schema'
import { MCP_BUDGETS, MCP_ERROR_CODES } from '../../src/shared/mcp/types'
import type { McpToolListItem, McpTransport } from '../../src/main/mcp/transports/types'
import {
  createFakeMcpTransport,
  McpSessionManager
} from '../../src/main/mcp/session-manager'
import { createMemoryMcpSecretEnv } from '../../src/main/mcp/secret-env'
import { ToolRegistry } from '../../src/main/ai/tools/registry'
import { attachMcpTools, clearMcpRuntimeState } from '../../src/main/mcp/tool-bridge'
import { McpConfigStore } from '../../src/main/mcp/config-store'
import { createMcpTraceStore } from '../../src/main/mcp/trace-store'
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
        workspaceRootInjection: 'off' as const,
        injectionIdentity: null,
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
        ...serverOverrides
      }
    ]
  }
}

type PagedTransportHarness = Readonly<{
  transport: McpTransport
  cursors: readonly (string | undefined)[]
  emit: (type: 'tools_changed' | 'closed' | 'error') => void
  getCloseCount: () => number
}>

function createPagedTransportHarness(input: Readonly<{
  serverId: string
  pages: Readonly<Record<string, Readonly<{ tools: readonly McpToolListItem[]; nextCursor?: string }>>>
  callError?: string
  listError?: string
  /** When true, listTools waits until aborted (or never resolves if no signal). */
  hangListUntilAbort?: boolean
}>): PagedTransportHarness {
  const cursors: Array<string | undefined> = []
  const toolsChangedListeners = new Set<() => void>()
  const closeListeners = new Set<() => void>()
  const errorListeners = new Set<() => void>()
  let closeCount = 0
  const initialKey = '__initial__'
  const transport = {
    serverId: input.serverId,
    async initialize() {},
    async listTools(request?: { cursor?: string; signal?: AbortSignal }) {
      const cursor = request?.cursor
      cursors.push(cursor)
      if (input.hangListUntilAbort) {
        const signal = request?.signal
        if (signal?.aborted) throw new Error('aborted')
        await new Promise<never>((_resolve, reject) => {
          const onAbort = (): void => reject(new Error('aborted'))
          signal?.addEventListener('abort', onAbort, { once: true })
        })
      }
      if (input.listError) throw new Error(input.listError)
      return input.pages[cursor ?? initialKey] ?? { tools: [] }
    },
    async callTool() {
      if (input.callError) throw new Error(input.callError)
      return { content: { ok: true } }
    },
    async close() {
      closeCount += 1
    },
    onToolsChanged(listener: () => void) {
      toolsChangedListeners.add(listener)
      return () => toolsChangedListeners.delete(listener)
    },
    onClose(listener: () => void) {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    onError(listener: () => void) {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    }
  }
  return {
    transport: transport as unknown as McpTransport,
    cursors,
    emit: (type) => {
      const listeners =
        type === 'tools_changed'
          ? toolsChangedListeners
          : type === 'closed'
            ? closeListeners
            : errorListeners
      for (const listener of listeners) listener()
    },
    getCloseCount: () => closeCount
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

  it('normalizes structured MCP results before exposing the legacy model-text alias', async () => {
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) =>
        createFakeMcpTransport({
          serverId: server.id,
          tools: [{ name: 'inspect', inputSchema: { type: 'object' } }],
          onCall: () => ({
            content: [{ type: 'text', text: 'ordinary result' }],
            structuredContent: { score: 1, nested: { safe: true } }
          })
        })
    })

    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()
    const result = await manager.callTool(snapshot.tools[0]!.registeredName, {})

    expect(result).toMatchObject({
      ok: true,
      status: 'succeeded',
      isError: false,
      content: expect.stringContaining('ordinary result'),
      normalizedContent: [{ kind: 'text', text: 'ordinary result', truncated: false }],
      modelText: expect.stringContaining('ordinary result'),
      structuredContent: { json: expect.stringContaining('\"score\":1') },
      truncated: false,
      spilled: false
    })
    if (result.ok) expect(result.content).toBe(result.modelText)
    await manager.dispose()
  })

  it('keeps an MCP application error connected and records only normalized trace facts', async () => {
    const trace = createMcpTraceStore()
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      traceStore: trace,
      now: (() => {
        let now = 1_000
        return () => (now += 25)
      })(),
      createTransport: (server) =>
        createFakeMcpTransport({
          serverId: server.id,
          tools: [{ name: 'fails', inputSchema: { type: 'object' } }],
          onCall: () => ({
            content: [{ type: 'text', text: 'server supplied application failure' }],
            structuredContent: { reason: 'denied' },
            isError: true
          })
        })
    })

    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()
    const result = await manager.callTool(snapshot.tools[0]!.registeredName, { password: 'not-traced' })

    expect(result).toMatchObject({
      ok: false,
      code: MCP_ERROR_CODES.mcp_call_failed,
      status: 'failed',
      isError: true,
      errorCode: 'mcp_application_error',
      modelText: expect.stringContaining('server supplied application failure')
    })
    expect(manager.getRuntimeView()[0]).toMatchObject({ state: 'connected' })
    expect(trace.snapshot()).toEqual([
      expect.objectContaining({
        serverId: 'demo',
        registeredToolName: snapshot.tools[0]!.registeredName,
        rawToolName: 'fails',
        durationMs: 25,
        cancelled: false,
        truncated: false,
        spilled: false,
        resultKind: 'error',
        errorCode: 'mcp_application_error'
      })
    ])
    expect(JSON.stringify(trace.snapshot())).not.toContain('not-traced')
    await manager.dispose()
  })

  it('uses the injected artifact writer for binary result spill without exposing bytes', async () => {
    const writes: Array<Readonly<{ kind: string; byteLength: number }>> = []
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      artifactWriter: {
        async writeArtifact(input) {
          writes.push({ kind: input.kind, byteLength: input.bytes.byteLength })
          return {
            id: 'mcp-artifact:sha256:0123456789abcdef',
            kind: input.kind,
            byteLength: input.bytes.byteLength,
            digestPrefix: '0123456789abcdef',
            summary: 'Stored MCP binary artifact.'
          }
        }
      },
      createTransport: (server) =>
        createFakeMcpTransport({
          serverId: server.id,
          tools: [{ name: 'image', inputSchema: { type: 'object' } }],
          onCall: () => ({
            content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }]
          })
        })
    })

    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()
    const result = await manager.callTool(snapshot.tools[0]!.registeredName, {})

    expect(writes).toEqual([{ kind: 'image', byteLength: 5 }])
    expect(result).toMatchObject({ ok: true, spilled: true, artifactRefs: [{ kind: 'image' }] })
    if (result.ok) expect(result.modelText).not.toContain('aGVsbG8=')
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


  it('paginates tools/list and retains later valid tools after rejected entries', async () => {
    const harness = createPagedTransportHarness({
      serverId: 'demo',
      pages: {
        __initial__: {
          tools: [
            {
              name: 'blocked',
              inputSchema: { type: 'object', properties: {} }
            },
            {
              name: 'too_large',
              inputSchema: { type: 'object', properties: { value: { type: 'string', description: 'x'.repeat(MCP_BUDGETS.maxToolSchemaBytes) } } }
            }
          ],
          nextCursor: 'page-2'
        },
        'page-2': {
          tools: [{ name: 'later_valid', inputSchema: { type: 'object', properties: {} } }]
        }
      }
    })
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      staticToolNames: ['blocked'],
      createTransport: () => harness.transport
    })

    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()

    expect(harness.cursors).toEqual([undefined, 'page-2'])
    expect(snapshot.tools.map((tool) => tool.rawToolName)).toEqual(['later_valid'])
    expect(manager.getRuntimeView()[0]).toMatchObject({
      state: 'connected',
      inventory: {
        stale: false,
        generation: 1,
        discoveredToolCount: 3,
        registeredToolCount: 1,
        rejectedToolCount: 2
      },
      refresh: { refreshCount: 1 }
    })
    await manager.dispose()
  })

  it('marks list_changed inventory stale without mutating the current snapshot, then reconnects next run', async () => {
    const harnesses: PagedTransportHarness[] = []
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => {
        const index = harnesses.length
        const harness = createPagedTransportHarness({
          serverId: server.id,
          pages: {
            __initial__: {
              tools: [{ name: index === 0 ? 'before_change' : 'after_change', inputSchema: { type: 'object' } }]
            }
          }
        })
        harnesses.push(harness)
        return harness.transport
      }
    })

    await manager.applyConfig(enabledConfig())
    const first = await manager.buildSnapshot()
    harnesses[0]!.emit('tools_changed')

    expect(first.tools.map((tool) => tool.rawToolName)).toEqual(['before_change'])
    expect(manager.getRuntimeView()[0]).toMatchObject({
      state: 'connected',
      inventory: { stale: true }
    })

    const replacement = await manager.buildSnapshot()
    expect(harnesses).toHaveLength(2)
    expect(harnesses[0]!.getCloseCount()).toBe(1)
    expect(replacement.tools.map((tool) => tool.rawToolName)).toEqual(['after_change'])
    expect(manager.getRuntimeView()[0]).toMatchObject({
      state: 'connected',
      inventory: { stale: false, generation: 2 }
    })
    await manager.dispose()
  })

  it('invalidates a closed transport and reconnects only on a later snapshot', async () => {
    const harnesses: PagedTransportHarness[] = []
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => {
        const harness = createPagedTransportHarness({
          serverId: server.id,
          pages: { __initial__: { tools: [{ name: `tool_${harnesses.length}`, inputSchema: { type: 'object' } }] } }
        })
        harnesses.push(harness)
        return harness.transport
      }
    })

    await manager.applyConfig(enabledConfig())
    const initial = await manager.buildSnapshot()
    harnesses[0]!.emit('closed')
    await Promise.resolve()

    expect(await manager.callTool(initial.tools[0]!.registeredName, {})).toMatchObject({
      ok: false,
      code: MCP_ERROR_CODES.mcp_server_unavailable
    })
    // ADR-0133: invalidation now enters budgeted retry_wait (disconnected is the retries-exhausted terminal state).
    expect(manager.getRuntimeView()[0]).toMatchObject({
      state: 'retry_wait',
      inventory: { stale: true },
      errorCode: MCP_ERROR_CODES.mcp_server_unavailable
    })
    expect(harnesses).toHaveLength(1)

    const replacement = await manager.buildSnapshot()
    expect(harnesses).toHaveLength(2)
    expect(replacement.tools.map((tool) => tool.rawToolName)).toEqual(['tool_1'])
    await manager.dispose()
  })

  it('refreshServer drops the cached transport and applies the same server gates', async () => {
    const harnesses: PagedTransportHarness[] = []
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => {
        const harness = createPagedTransportHarness({
          serverId: server.id,
          pages: { __initial__: { tools: [{ name: `refresh_${harnesses.length}`, inputSchema: { type: 'object' } }] } }
        })
        harnesses.push(harness)
        return harness.transport
      }
    })

    await manager.applyConfig(enabledConfig())
    await manager.buildSnapshot()
    const refreshed = await manager.refreshServer('demo')

    expect(refreshed).toMatchObject({ ok: true, serverId: 'demo' })
    expect(harnesses).toHaveLength(2)
    expect(harnesses[0]!.getCloseCount()).toBe(1)
    expect(refreshed.ok && refreshed.tools.map((tool) => tool.name)).toEqual(['refresh_1'])
    await manager.dispose()
  })

  it('stops a cursor cycle with a bounded list failure', async () => {
    const harness = createPagedTransportHarness({
      serverId: 'demo',
      pages: {
        __initial__: { tools: [{ name: 'first', inputSchema: { type: 'object' } }], nextCursor: 'loop' },
        loop: { tools: [{ name: 'second', inputSchema: { type: 'object' } }], nextCursor: 'loop' }
      }
    })
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: () => harness.transport
    })

    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()

    expect(snapshot.tools).toEqual([])
    expect(harness.cursors).toEqual([undefined, 'loop'])
    expect(harness.getCloseCount()).toBe(1)
    expect(snapshot.serverHealth[0]).toMatchObject({
      state: 'error',
      errorCode: MCP_ERROR_CODES.mcp_list_failed
    })
    await manager.dispose()
  })

  it('drops a session after a transport call failure so a later run reconnects', async () => {
    const failing = createPagedTransportHarness({
      serverId: 'demo',
      pages: { __initial__: { tools: [{ name: 'unstable', inputSchema: { type: 'object' } }] } },
      callError: 'socket reset'
    })
    const recovered = createPagedTransportHarness({
      serverId: 'demo',
      pages: { __initial__: { tools: [{ name: 'recovered', inputSchema: { type: 'object' } }] } }
    })
    let createCount = 0
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: () => (createCount++ === 0 ? failing.transport : recovered.transport)
    })

    await manager.applyConfig(enabledConfig())
    const initial = await manager.buildSnapshot()
    expect(await manager.callTool(initial.tools[0]!.registeredName, {})).toMatchObject({
      ok: false,
      code: MCP_ERROR_CODES.mcp_call_failed
    })
    // ADR-0133: transport-call failure schedules a budgeted reconnect (retry_wait), not terminal disconnected.
    expect(manager.getRuntimeView()[0]).toMatchObject({ state: 'retry_wait' })

    const replacement = await manager.buildSnapshot()
    expect(replacement.tools.map((tool) => tool.rawToolName)).toEqual(['recovered'])
    await manager.dispose()
  })

  it('stops pagination when nextCursor is empty or omitted after the first page', async () => {
    const harness = createPagedTransportHarness({
      serverId: 'demo',
      pages: {
        __initial__: {
          tools: [{ name: 'only_page', inputSchema: { type: 'object' } }],
          nextCursor: ''
        }
      }
    })
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: () => harness.transport
    })

    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()

    expect(harness.cursors).toEqual([undefined])
    expect(snapshot.tools.map((tool) => tool.rawToolName)).toEqual(['only_page'])
    await manager.dispose()
  })

  it('fails closed when tools/list exceeds the hard page cap', async () => {
    const pages: Record<string, { tools: McpToolListItem[]; nextCursor?: string }> = {
      __initial__: {
        tools: [{ name: 't0', inputSchema: { type: 'object' } }],
        nextCursor: 'c1'
      }
    }
    // Manager allows at most 32 pages; chain 33 unique cursors so the 33rd is never fetched.
    for (let i = 1; i <= 33; i += 1) {
      pages[`c${i}`] = {
        tools: [{ name: `t${i}`, inputSchema: { type: 'object' } }],
        nextCursor: `c${i + 1}`
      }
    }
    const harness = createPagedTransportHarness({ serverId: 'demo', pages })
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: () => harness.transport
    })

    await manager.applyConfig(enabledConfig())
    const snapshot = await manager.buildSnapshot()

    expect(harness.cursors).toHaveLength(32)
    expect(snapshot.tools).toEqual([])
    expect(snapshot.serverHealth[0]).toMatchObject({
      state: 'error',
      errorCode: MCP_ERROR_CODES.mcp_budget_exceeded
    })
    expect(harness.getCloseCount()).toBe(1)
    await manager.dispose()
  })

  it('aborts tools/list pagination without leaving a reusable session', async () => {
    const harness = createPagedTransportHarness({
      serverId: 'demo',
      pages: { __initial__: { tools: [] } },
      hangListUntilAbort: true
    })
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: () => harness.transport
    })
    await manager.applyConfig(enabledConfig())
    const controller = new AbortController()
    queueMicrotask(() => controller.abort())

    const snapshot = await manager.buildSnapshot(undefined, controller.signal)

    expect(snapshot.tools).toEqual([])
    expect(snapshot.serverHealth[0]).toMatchObject({
      state: 'error',
      errorCode: expect.stringMatching(/mcp_list_failed|mcp_handshake_failed|mcp_server_unavailable/)
    })
    expect(manager.getRuntimeView()[0]?.state).not.toBe('connected')
    await manager.dispose()
  })

  it('invalidates on transport error notifications and reconnects on the next snapshot', async () => {
    const harnesses: PagedTransportHarness[] = []
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) => {
        const harness = createPagedTransportHarness({
          serverId: server.id,
          pages: {
            __initial__: {
              tools: [{ name: `err_${harnesses.length}`, inputSchema: { type: 'object' } }]
            }
          }
        })
        harnesses.push(harness)
        return harness.transport
      }
    })

    await manager.applyConfig(enabledConfig())
    const initial = await manager.buildSnapshot()
    harnesses[0]!.emit('error')
    await Promise.resolve()

    expect(await manager.callTool(initial.tools[0]!.registeredName, {})).toMatchObject({
      ok: false,
      code: MCP_ERROR_CODES.mcp_server_unavailable
    })
    // ADR-0133: invalidation now enters budgeted retry_wait (disconnected is the retries-exhausted terminal state).
    expect(manager.getRuntimeView()[0]).toMatchObject({
      state: 'retry_wait',
      inventory: { stale: true },
      errorCode: MCP_ERROR_CODES.mcp_server_unavailable
    })

    const replacement = await manager.buildSnapshot()
    expect(harnesses).toHaveLength(2)
    expect(replacement.tools.map((tool) => tool.rawToolName)).toEqual(['err_1'])
    await manager.dispose()
  })

  it('refreshServer rejects unknown ids and mismatched workspace scope without spawning', async () => {
    let createCount = 0
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: () => {
        createCount += 1
        return createFakeMcpTransport({ serverId: 'demo', tools: [] })
      }
    })
    await manager.applyConfig(
      enabledConfig({ scope: 'workspace', workspaceRoot: '/tmp/studiumx-workspace' })
    )

    await expect(manager.refreshServer('missing')).resolves.toMatchObject({
      ok: false,
      code: MCP_ERROR_CODES.mcp_invalid_config
    })
    await expect(manager.refreshServer('demo', '/tmp/other')).resolves.toMatchObject({
      ok: false,
      code: MCP_ERROR_CODES.mcp_server_disabled
    })
    expect(createCount).toBe(0)
    await manager.dispose()
  })

  it('enforces global tool budget after per-server discovery without reusing over-cap sessions', async () => {
    const fullServerTools = (prefix: string) =>
      Array.from({ length: MCP_BUDGETS.maxToolsPerServer }, (_, i) => ({
        name: `${prefix}_${i}`,
        inputSchema: { type: 'object', properties: {} }
      }))
    const baseServer = enabledConfig().servers[0]!
    const config = {
      ...defaultUserMcpConfig(),
      enabled: true,
      servers: [
        { ...baseServer, id: 'alpha', command: 'a' },
        { ...baseServer, id: 'beta', command: 'b' },
        { ...baseServer, id: 'gamma', command: 'c' }
      ]
    }
    const manager = new McpSessionManager({
      secrets: createMemoryMcpSecretEnv(),
      createTransport: (server) =>
        createFakeMcpTransport({
          serverId: server.id,
          tools: fullServerTools(server.id)
        })
    })

    await manager.applyConfig(config)
    const snapshot = await manager.buildSnapshot()

    // 3 × maxToolsPerServer > maxGlobalTools; third server is skipped after the cap.
    expect(snapshot.tools.length).toBe(MCP_BUDGETS.maxGlobalTools)
    expect(snapshot.warnings.some((w) => /global MCP tool cap/i.test(w))).toBe(true)
    expect(snapshot.serverHealth.find((h) => h.id === 'gamma')).toMatchObject({
      state: 'error',
      errorCode: MCP_ERROR_CODES.mcp_budget_exceeded
    })
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

  it('applyOps merges by server id under CAS and returns secret-free public DTO', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-cfg-ops-'))
    try {
      const store = new McpConfigStore({ userDataPath: dir })
      const base = await store.load()
      const seed = await store.update(
        {
          schemaVersion: 1 as const,
          enabled: true,
          autoConnect: true,
          servers: [
            {
              id: 'keep-me',
              label: 'Keep',
              enabled: true,
              scope: 'user' as const,
              workspaceRoot: null,
              transport: 'stdio' as const,
              command: 'npx',
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
              workspaceRootInjection: 'off' as const,
              injectionIdentity: null,
              createdAt: '2026-07-22T00:00:00.000Z',
              updatedAt: '2026-07-22T00:00:00.000Z'
            },
            {
              id: 'touch-me',
              label: 'Old',
              enabled: true,
              scope: 'user' as const,
              workspaceRoot: null,
              transport: 'stdio' as const,
              command: 'npx',
              args: [],
              cwd: null,
              envSecretRefs: {},
              envPlain: { VISIBLE: 'ok' },
              url: null,
              headersSecretRefs: {},
              headersPlain: {},
              timeoutMs: null,
              toolEffectOverrides: {},
              oauth: null,
              workspaceRootInjection: 'off' as const,
              injectionIdentity: null,
              createdAt: '2026-07-22T00:00:00.000Z',
              updatedAt: '2026-07-22T00:00:00.000Z'
            }
          ]
        },
        base.fingerprint!
      )
      expect(seed.ok).toBe(true)
      if (!seed.ok) return

      const liveBefore = await store.getMcpSettings()
      expect(liveBefore.ok).toBe(true)
      if (!liveBefore.ok) return
      expect(JSON.stringify(liveBefore)).not.toContain('envSecretRefs')

      const conflict = await store.applyOps(
        [{ op: 'setEnabled', enabled: false }],
        'stale-fingerprint'
      )
      expect(conflict.ok).toBe(false)
      if (!conflict.ok) expect(conflict.code).toBe(MCP_ERROR_CODES.mcp_cas_conflict)

      const applied = await store.applyOps(
        [
          {
            op: 'patchServer',
            id: 'touch-me',
            patch: { label: 'Touched', updatedAt: '2026-07-24T00:00:00.000Z' }
          },
          {
            op: 'upsertServer',
            server: {
              id: 'new-a',
              label: 'New A',
              enabled: true,
              scope: 'user' as const,
              workspaceRoot: null,
              transport: 'stdio' as const,
              command: 'npx',
              args: ['-y', 'new-a'],
              cwd: null,
              envSecretRefs: {},
              envPlain: {},
              url: null,
              headersSecretRefs: {},
              headersPlain: {},
              timeoutMs: null,
              toolEffectOverrides: {},
              oauth: null,
              workspaceRootInjection: 'off' as const,
              injectionIdentity: null,
              createdAt: '2026-07-24T00:00:00.000Z',
              updatedAt: '2026-07-24T00:00:00.000Z'
            }
          }
        ],
        liveBefore.config.fingerprint
      )
      expect(applied.ok).toBe(true)
      if (!applied.ok) return
      expect(applied.config.servers.map((s) => s.id).sort()).toEqual(['keep-me', 'new-a', 'touch-me'])
      expect(applied.config.servers.find((s) => s.id === 'touch-me')!.label).toBe('Touched')
      expect(applied.config.servers.find((s) => s.id === 'keep-me')!.label).toBe('Keep')
      const pub = JSON.stringify(applied.config)
      expect(pub).not.toContain('envSecretRefs')

      const liveAfter = await store.getMcpSettings()
      expect(liveAfter.ok).toBe(true)
      if (!liveAfter.ok) return
      expect(liveAfter.config.fingerprint).toBe(applied.config.fingerprint)
      expect(liveAfter.config.servers.find((s) => s.id === 'touch-me')!.label).toBe('Touched')
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

describe('budgeted reconnect (ADR-0141)', () => {
  it('schedules retry_wait then reconnects when autoConnect is effective', async () => {
    vi.useFakeTimers()
    try {
      const secrets = createMemoryMcpSecretEnv()
      let transportCount = 0
      let activeHarness: PagedTransportHarness | null = null
      const manager = new McpSessionManager({
        secrets,
        createTransport: (server) => {
          transportCount += 1
          activeHarness = createPagedTransportHarness({
            serverId: server.id,
            pages: {
              __initial__: {
                tools: [{ name: 'echo', description: 'e', inputSchema: { type: 'object' } }]
              }
            }
          })
          return activeHarness.transport
        }
      })
      await manager.applyConfig({
        ...enabledConfig(),
        autoConnect: true
      })
      await manager.buildSnapshot()
      expect(transportCount).toBe(1)
      expect(manager.getRuntimeView().find((s) => s.id === 'demo')?.state).toBe('connected')

      activeHarness!.emit('closed')
      // allow invalidateSession promise microtasks
      await Promise.resolve()
      await Promise.resolve()

      const waiting = manager.getRuntimeView().find((s) => s.id === 'demo')
      expect(waiting?.state).toBe('retry_wait')
      expect(waiting?.refresh?.retry?.attemptCount).toBe(1)
      expect(waiting?.refresh?.retry?.maxAttempts).toBe(MCP_BUDGETS.reconnectMaxAttempts)

      await vi.advanceTimersByTimeAsync(500)
      await Promise.resolve()
      await Promise.resolve()

      expect(transportCount).toBe(2)
      const reconnected = manager.getRuntimeView().find((s) => s.id === 'demo')
      expect(reconnected?.state).toBe('connected')

      await manager.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reconnect when autoConnect is explicitly false', async () => {
    vi.useFakeTimers()
    try {
      const secrets = createMemoryMcpSecretEnv()
      let transportCount = 0
      let activeHarness: PagedTransportHarness | null = null
      const manager = new McpSessionManager({
        secrets,
        createTransport: (server) => {
          transportCount += 1
          activeHarness = createPagedTransportHarness({
            serverId: server.id,
            pages: {
              __initial__: {
                tools: [{ name: 'echo', description: 'e', inputSchema: { type: 'object' } }]
              }
            }
          })
          return activeHarness.transport
        }
      })
      await manager.applyConfig({
        ...enabledConfig(),
        autoConnect: false
      })
      await manager.buildSnapshot()
      activeHarness!.emit('closed')
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(5_000)
      await Promise.resolve()
      expect(transportCount).toBe(1)
      expect(manager.getRuntimeView().find((s) => s.id === 'demo')?.state).toBe('disconnected')
      await manager.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
