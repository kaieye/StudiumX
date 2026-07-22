/**
 * MCP transport interface + fake transport for unit tests (ADR-0128 §4 / §12.1).
 */

export type McpToolListItem = Readonly<{
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}>

export type McpCallToolResult = Readonly<{
  content: unknown
  isError?: boolean
}>

export type McpTransport = {
  readonly serverId: string
  initialize(signal?: AbortSignal): Promise<void>
  listTools(signal?: AbortSignal): Promise<readonly McpToolListItem[]>
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpCallToolResult>
  close(): Promise<void>
}

export type FakeMcpTransportOptions = {
  serverId: string
  tools?: readonly McpToolListItem[]
  /** Artificial delay for list/call (ms). */
  listDelayMs?: number
  callDelayMs?: number
  /** Fail initialize with this message. */
  initializeError?: string
  /** Fail listTools with this message. */
  listError?: string
  /** Fail callTool with this message (or per-name map). */
  callError?: string | Readonly<Record<string, string>>
  /** callTool handler override. */
  onCall?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<McpCallToolResult> | McpCallToolResult
}

/**
 * In-process fake transport for unit tests — no real child process / network.
 */
export function createFakeMcpTransport(options: FakeMcpTransportOptions): McpTransport {
  let closed = false
  const tools = options.tools ?? []

  async function delay(ms: number | undefined, signal?: AbortSignal): Promise<void> {
    if (!ms || ms <= 0) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      }
      if (signal?.aborted) {
        clearTimeout(timer)
        reject(new Error('aborted'))
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  return {
    serverId: options.serverId,
    async initialize(signal) {
      if (closed) throw new Error('transport closed')
      if (options.initializeError) throw new Error(options.initializeError)
      if (signal?.aborted) throw new Error('aborted')
    },
    async listTools(signal) {
      if (closed) throw new Error('transport closed')
      await delay(options.listDelayMs, signal)
      if (options.listError) throw new Error(options.listError)
      return tools
    },
    async callTool(name, args, signal) {
      if (closed) throw new Error('transport closed')
      await delay(options.callDelayMs, signal)
      if (typeof options.callError === 'string' && options.callError) {
        throw new Error(options.callError)
      }
      if (options.callError && typeof options.callError === 'object') {
        const msg = options.callError[name]
        if (msg) throw new Error(msg)
      }
      if (options.onCall) return options.onCall(name, args)
      return { content: { ok: true, name, args } }
    },
    async close() {
      closed = true
    }
  }
}
