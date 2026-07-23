import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSdkMcpTransport, type SdkMcpTransportOptions } from '../../src/main/mcp/transports/sdk-client'
import { createFakeMcpTransport } from '../../src/main/mcp/transports/types'

type TestClient = {
  connect: ReturnType<typeof vi.fn>
  listTools: ReturnType<typeof vi.fn>
  callTool: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  setNotificationHandler: ReturnType<typeof vi.fn>
  onclose?: () => void
  onerror?: (error: Error) => void
  emitToolsChanged(): void
  emitClose(): void
  emitError(error: Error): void
}

type TestSdkTransport = {
  close: ReturnType<typeof vi.fn>
  options?: unknown
}

const sdkMocks = vi.hoisted(() => ({
  clients: [] as TestClient[],
  transports: [] as TestSdkTransport[]
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class implements TestClient {
    connect = vi.fn().mockResolvedValue(undefined)
    listTools = vi.fn()
    callTool = vi.fn()
    close = vi.fn().mockResolvedValue(undefined)
    setNotificationHandler = vi.fn((_: unknown, handler: () => void) => {
      this.toolsChangedHandler = handler
    })
    onclose?: () => void
    onerror?: (error: Error) => void
    private toolsChangedHandler: (() => void) | undefined

    constructor() {
      sdkMocks.clients.push(this)
    }

    emitToolsChanged(): void {
      this.toolsChangedHandler?.()
    }

    emitClose(): void {
      this.onclose?.()
    }

    emitError(error: Error): void {
      this.onerror?.(error)
    }
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class implements TestSdkTransport {
    close = vi.fn().mockResolvedValue(undefined)
    options: unknown

    constructor(options: unknown) {
      this.options = options
      sdkMocks.transports.push(this)
    }
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class implements TestSdkTransport {
    close = vi.fn().mockResolvedValue(undefined)

    constructor() {
      sdkMocks.transports.push(this)
    }
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class implements TestSdkTransport {
    close = vi.fn().mockResolvedValue(undefined)

    constructor() {
      sdkMocks.transports.push(this)
    }
  }
}))

function sdkOptions(): SdkMcpTransportOptions {
  return {
    server: {
      id: 'demo',
      label: 'Demo',
      enabled: true,
      scope: 'user',
      workspaceRoot: null,
      transport: 'stdio',
      command: 'fake-mcp',
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
      updatedAt: '2026-07-22T00:00:00.000Z'
    },
    env: {},
    headers: {},
    timeoutMs: null
  }
}

beforeEach(() => {
  sdkMocks.clients.length = 0
  sdkMocks.transports.length = 0
})

describe('MCP SDK transport (ADR-0133)', () => {
  it('maps one requested cursor to one SDK tools/list page', async () => {
    const transport = createSdkMcpTransport(sdkOptions())
    await transport.initialize()
    const client = sdkMocks.clients[0]
    if (!client) throw new Error('expected SDK client')
    client.listTools.mockResolvedValue({
      tools: [{ name: 'next_page', description: 'second page', inputSchema: { type: 'object' } }],
      nextCursor: 'cursor-2'
    })
    const controller = new AbortController()

    await expect(transport.listTools({ cursor: 'cursor-1', signal: controller.signal })).resolves.toEqual({
      tools: [{ name: 'next_page', description: 'second page', inputSchema: { type: 'object' } }],
      nextCursor: 'cursor-2'
    })
    expect(client.listTools).toHaveBeenCalledWith(
      { cursor: 'cursor-1' },
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('preserves an empty cursor instead of treating it as an omitted first-page cursor', async () => {
    const transport = createSdkMcpTransport(sdkOptions())
    await transport.initialize()
    const client = sdkMocks.clients[0]
    if (!client) throw new Error('expected SDK client')
    client.listTools.mockResolvedValue({ tools: [] })

    await transport.listTools({ cursor: '' })

    expect(client.listTools).toHaveBeenCalledWith({ cursor: '' }, expect.any(Object))
  })

  it('preserves ordinary and structured call result content independently', async () => {
    const transport = createSdkMcpTransport(sdkOptions())
    await transport.initialize()
    const client = sdkMocks.clients[0]
    if (!client) throw new Error('expected SDK client')
    client.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'ordinary result' }],
      structuredContent: { score: 1 },
      isError: true
    })

    await expect(transport.callTool('inspect', { query: 'x' })).resolves.toEqual({
      content: [{ type: 'text', text: 'ordinary result' }],
      structuredContent: { score: 1 },
      isError: true
    })
    expect(client.callTool).toHaveBeenCalledWith(
      { name: 'inspect', arguments: { query: 'x' } },
      undefined,
      expect.any(Object)
    )
  })

  it('forwards tools-changed, close, and error lifecycle notifications without payload expansion', async () => {
    const transport = createSdkMcpTransport(sdkOptions())
    const toolsChanged = vi.fn()
    const closed = vi.fn()
    const errored = vi.fn()
    transport.onToolsChanged(toolsChanged)
    transport.onClose(closed)
    transport.onError(errored)
    await transport.initialize()
    const client = sdkMocks.clients[0]
    if (!client) throw new Error('expected SDK client')
    client.emitToolsChanged()
    client.emitError(new Error('connection unavailable'))
    client.emitClose()
    client.emitClose()

    expect(toolsChanged).toHaveBeenCalledOnce()
    expect(errored).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
    await expect(transport.listTools()).rejects.toThrow('MCP transport is not initialized')
  })

  it('makes explicit closure idempotent even if the SDK also closes its client', async () => {
    const transport = createSdkMcpTransport(sdkOptions())
    const closed = vi.fn()
    transport.onClose(closed)
    await transport.initialize()
    const client = sdkMocks.clients[0]
    if (!client) throw new Error('expected SDK client')

    await transport.close()
    client.emitClose()
    await transport.close()

    expect(client.close).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
  })

  it('provides paged lifecycle-capable fake transport fixtures without a real process or network', async () => {
    const transport = createFakeMcpTransport({
      serverId: 'fake',
      toolPages: [
        { tools: [{ name: 'first', inputSchema: { type: 'object' } }], nextCursor: '' },
        { tools: [{ name: 'second', inputSchema: { type: 'object' } }] }
      ]
    })
    const toolsChanged = vi.fn()
    const closed = vi.fn()
    const errored = vi.fn()
    const unsubscribe = transport.onToolsChanged(toolsChanged)
    transport.onClose(closed)
    transport.onError(errored)

    await expect(transport.listTools()).resolves.toEqual({
      tools: [{ name: 'first', inputSchema: { type: 'object' } }],
      nextCursor: ''
    })
    await expect(transport.listTools({ cursor: '' })).resolves.toEqual({
      tools: [{ name: 'second', inputSchema: { type: 'object' } }]
    })

    transport.emitToolsChanged()
    unsubscribe()
    transport.emitToolsChanged()
    transport.emitError()
    transport.emitClose()
    await transport.close()

    expect(toolsChanged).toHaveBeenCalledOnce()
    expect(errored).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
  })

  it('configures stdio transport to pipe stderr for bounded redacted diagnostics', async () => {
    const transport = createSdkMcpTransport(sdkOptions())
    await transport.initialize()
    const stdio = sdkMocks.transports[0]
    if (!stdio) throw new Error('expected stdio transport')
    expect(stdio.options).toMatchObject({
      command: 'fake-mcp',
      stderr: 'pipe'
    })
    await transport.close()
  })
})

