/** Official MCP TypeScript SDK transport adapter for stdio, Streamable HTTP, and SSE. */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { MCP_BUDGETS, type UserMcpServerV1 } from '../../../shared/mcp/types'
import type { McpCallToolResult, McpTransport } from './types'

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

  return {
    serverId: server.id,
    async initialize(signal) {
      if (connected) return
      const nextClient = new Client({ name: 'studiumx', version: '0.0.0' }, { capabilities: {} })
      const transport = createClientTransport(options)
      try {
        await nextClient.connect(transport, {
          signal,
          timeout: timeoutMs ?? MCP_BUDGETS.initializeTimeoutMs
        })
        client = nextClient
        connected = true
      } catch (error) {
        await transport.close().catch(() => undefined)
        throw error
      }
    },
    async listTools(signal) {
      const activeClient = requireClient(client, connected)
      const result = await activeClient.listTools(
        {},
        { signal, timeout: timeoutMs ?? MCP_BUDGETS.listTimeoutMs }
      )
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>
      }))
    },
    async callTool(name, args, signal) {
      const activeClient = requireClient(client, connected)
      const result = await activeClient.callTool(
        { name, arguments: args },
        undefined,
        { signal, timeout: timeoutMs ?? MCP_BUDGETS.callTimeoutMs }
      )
      return {
        content: result.content ?? result.structuredContent ?? null,
        ...(typeof result.isError === 'boolean' ? { isError: result.isError } : {})
      } satisfies McpCallToolResult
    },
    async close() {
      const activeClient = client
      client = null
      connected = false
      if (activeClient) await activeClient.close().catch(() => undefined)
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
      stderr: 'ignore'
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

function requireClient(client: Client | null, connected: boolean): Client {
  if (!client || !connected) throw new Error('MCP transport is not initialized')
  return client
}
