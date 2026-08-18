/** Official MCP TypeScript SDK transport adapter for stdio, Streamable HTTP, and SSE. */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'

import { MCP_BUDGETS, type UserMcpServerV1 } from '../../../shared/mcp/types'
import type {
  McpCallToolResult,
  McpListToolsOptions,
  McpToolListPage,
  McpTransport,
  McpTransportErrorListener,
  McpTransportListener
} from './types'

export type SdkMcpTransportOptions = Readonly<{
  server: UserMcpServerV1
  env: Record<string, string>
  headers: Record<string, string>
  timeoutMs: number | null
}>

export function createSdkMcpTransport(options: SdkMcpTransportOptions): McpTransport {
  const { server, timeoutMs } = options
  let client: Client | null = null
  let connected = false
  let closeEmitted = false
  const toolsChangedListeners = new Set<McpTransportListener>()
  const closeListeners = new Set<McpTransportListener>()
  const errorListeners = new Set<McpTransportErrorListener>()
  /** Bounded, secret-free local diagnostics (never env/token/command). */
  const localDiagnostics: string[] = []

  function pushDiagnostic(line: string): void {
    const cleaned = line
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted>')
      .replace(/(bearer\s+)[^\s]+/gi, '$1<redacted>')
      .replace(/(token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=<redacted>')
      .trim()
      .slice(0, 200)
    if (!cleaned) return
    if (localDiagnostics.length >= 8) localDiagnostics.shift()
    localDiagnostics.push(cleaned)
  }

  function subscribe<T>(listeners: Set<T>, listener: T): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function emitClose(): void {
    connected = false
    client = null
    if (closeEmitted) return
    closeEmitted = true
    for (const listener of closeListeners) listener()
  }

  function emitError(): void {
    for (const listener of errorListeners) listener()
  }

  return {
    serverId: server.id,
    async initialize(signal) {
      if (connected) return
      closeEmitted = false
      const nextClient = new Client({ name: 'studiumx', version: '0.0.0' }, { capabilities: {} })
      nextClient.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        for (const listener of toolsChangedListeners) listener()
      })
      nextClient.onclose = emitClose
      nextClient.onerror = () => emitError()
      const transport = createClientTransport(options)
      attachStdioStderrDiagnostics(transport as { stderr?: NodeJS.ReadableStream | null }, pushDiagnostic)
      try {
        await nextClient.connect(transport, {
          signal,
          timeout: timeoutMs ?? MCP_BUDGETS.initializeTimeoutMs
        })
        client = nextClient
        connected = true
        pushDiagnostic('handshake_ok')
      } catch (error) {
        pushDiagnostic(
          `handshake_failed:${error instanceof Error ? error.name : 'error'}`
        )
        await transport.close().catch(() => undefined)
        throw error
      }
    },
    async listTools({ cursor, signal }: McpListToolsOptions = {}): Promise<McpToolListPage> {
      const activeClient = requireClient(client, connected)
      const result = await activeClient.listTools(
        cursor === undefined ? {} : { cursor },
        { signal, timeout: timeoutMs ?? MCP_BUDGETS.listTimeoutMs }
      )
      return {
        tools: result.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
          // Retain protocol annotations for UI/audit only. Never use them to
          // resolve StudiumX effectClass (ADR-0013).
          ...(tool.annotations
            ? { annotations: sanitizeRemoteToolAnnotations(tool.annotations) }
            : {})
        })),
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor })
      }
    },
    async callTool(name, args, signal) {
      const activeClient = requireClient(client, connected)
      const result = await activeClient.callTool(
        { name, arguments: args },
        undefined,
        { signal, timeout: timeoutMs ?? MCP_BUDGETS.callTimeoutMs }
      )
      return {
        ...(result.content === undefined ? {} : { content: result.content }),
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: result.structuredContent }),
        ...(typeof result.isError === 'boolean' ? { isError: result.isError } : {})
      } satisfies McpCallToolResult
    },
    onToolsChanged(listener) {
      return subscribe(toolsChangedListeners, listener)
    },
    onClose(listener) {
      return subscribe(closeListeners, listener)
    },
    onError(listener) {
      return subscribe(errorListeners, listener)
    },
    getLocalDiagnostics() {
      return Object.freeze([...localDiagnostics])
    },
    async close() {
      const activeClient = client
      if (!activeClient) {
        emitClose()
        return
      }
      await activeClient.close().catch(() => undefined)
      emitClose()
    }
  }
}

function createClientTransport(options: SdkMcpTransportOptions) {
  const { server } = options
  if (server.transport === 'stdio') {
    return new StdioClientTransport({
      command: server.command ?? '',
      args: [...server.args],
      cwd: server.cwd ?? undefined,
      env: options.env,
      // Pipe stderr so we can keep a short redacted diagnostic ring (never secrets).
      stderr: 'pipe'
    })
  }

  const url = new URL(server.url ?? '')
  const requestInit: RequestInit = { headers: options.headers }
  if (server.transport === 'sse') {
    return new SSEClientTransport(url, {
      requestInit,
      eventSourceInit: {
        fetch: async (input, init) =>
          fetch(input, {
            ...init,
            headers: { ...Object.fromEntries(new Headers(init.headers)), ...options.headers }
          })
      }
    })
  }
  return new StreamableHTTPClientTransport(url, { requestInit })
}

function attachStdioStderrDiagnostics(
  transport: { stderr?: NodeJS.ReadableStream | null },
  pushDiagnostic: (line: string) => void
): void {
  const stream = transport.stderr
  if (!stream || typeof stream.on !== 'function') return
  stream.setEncoding?.('utf8')
  stream.on('data', (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) pushDiagnostic(line)
    }
  })
}

function requireClient(client: Client | null, connected: boolean): Client {
  if (!client || !connected) throw new Error('MCP transport is not initialized')
  return client
}

/**
 * Copy only known boolean/title annotation fields. Drops unknown keys so remote
 * free-form metadata cannot smuggle secrets into the inventory path.
 */
function sanitizeRemoteToolAnnotations(raw: unknown): {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const out: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  } = {}
  if (typeof source.title === 'string' && source.title.trim()) {
    out.title = source.title.trim().slice(0, 128)
  }
  if (typeof source.readOnlyHint === 'boolean') out.readOnlyHint = source.readOnlyHint
  if (typeof source.destructiveHint === 'boolean') out.destructiveHint = source.destructiveHint
  if (typeof source.idempotentHint === 'boolean') out.idempotentHint = source.idempotentHint
  if (typeof source.openWorldHint === 'boolean') out.openWorldHint = source.openWorldHint
  return out
}
