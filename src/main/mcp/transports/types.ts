/**
 * Lifecycle-aware MCP transport interface and in-process fake for unit tests
 * (ADR-0128 §4 / §12.1; ADR-0133 §2).
 */

/**
 * Remote MCP tool annotations (protocol hints only).
 *
 * These are display/audit/retry-hint metadata. They MUST NOT drive
 * `resolveMcpToolEffect` / effectClass — remote `readOnlyHint` must not
 * auto-downgrade privileged tools (ADR-0132 §2.7).
 */
export type McpRemoteToolAnnotations = Readonly<{
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}>

export type McpToolListItem = Readonly<{
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  /** Secret-free protocol annotations from tools/list (optional). */
  annotations?: McpRemoteToolAnnotations
}>

/** One bounded `tools/list` response page. Pagination is owned by the session manager. */
export type McpToolListPage = Readonly<{
  tools: readonly McpToolListItem[]
  nextCursor?: string
}>

export type McpListToolsOptions = Readonly<{
  cursor?: string
  signal?: AbortSignal
}>

export type McpCallToolResult = Readonly<{
  /** Ordinary MCP content blocks, preserved separately from structuredContent. */
  content?: unknown
  /** Structured MCP result data; session normalization owns safe projection. */
  structuredContent?: unknown
  isError?: boolean
}>

export type McpTransportListener = () => void
export type McpTransportErrorListener = () => void

export type McpTransport = {
  readonly serverId: string
  initialize(signal?: AbortSignal): Promise<void>
  /** Fetch exactly one `tools/list` page; callers own cursor iteration and page limits. */
  listTools(options?: McpListToolsOptions): Promise<McpToolListPage>
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpCallToolResult>
  /** Subscribe to a server `notifications/tools/list_changed` signal. */
  onToolsChanged(listener: McpTransportListener): () => void
  /** Subscribe to transport closure. Repeated closure notifications are coalesced. */
  onClose(listener: McpTransportListener): () => void
  /** Subscribe to out-of-band transport errors. */
  onError(listener: McpTransportErrorListener): () => void
  /**
   * Optional bounded, secret-free stderr/handshake diagnostic lines for Doctor/UI.
   * Implementations must never return env values, tokens, or full command lines.
   */
  getLocalDiagnostics?(): readonly string[]
  close(): Promise<void>
}

export type FakeMcpTransport = McpTransport & {
  /** Test-only lifecycle emitters; they never expose process, network, or secret state. */
  emitToolsChanged(): void
  emitClose(): void
  emitError(): void
}

export type FakeMcpTransportOptions = {
  serverId: string
  /** Single unpaged response retained as a concise fixture shorthand. */
  tools?: readonly McpToolListItem[]
  /** Ordered pages; each page's `nextCursor` selects the following page. */
  toolPages?: readonly McpToolListPage[]
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
export function createFakeMcpTransport(options: FakeMcpTransportOptions): FakeMcpTransport {
  let closed = false
  let closeEmitted = false
  const toolsChangedListeners = new Set<McpTransportListener>()
  const closeListeners = new Set<McpTransportListener>()
  const errorListeners = new Set<McpTransportErrorListener>()
  const pages = options.toolPages ?? [{ tools: options.tools ?? [] }]
  const pageIndexByCursor = new Map<string, number>()

  for (const [index, page] of pages.entries()) {
    if (page.nextCursor !== undefined) pageIndexByCursor.set(page.nextCursor, index + 1)
  }

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

  function subscribe<T>(listeners: Set<T>, listener: T): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function emitClose(): void {
    closed = true
    if (closeEmitted) return
    closeEmitted = true
    for (const listener of closeListeners) listener()
  }

  return {
    serverId: options.serverId,
    async initialize(signal) {
      if (closed) throw new Error('transport closed')
      if (options.initializeError) throw new Error(options.initializeError)
      if (signal?.aborted) throw new Error('aborted')
    },
    async listTools({ cursor, signal } = {}) {
      if (closed) throw new Error('transport closed')
      await delay(options.listDelayMs, signal)
      if (options.listError) throw new Error(options.listError)
      const pageIndex = cursor === undefined ? 0 : pageIndexByCursor.get(cursor)
      return pages[pageIndex ?? -1] ?? { tools: [] }
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
    onToolsChanged(listener) {
      return subscribe(toolsChangedListeners, listener)
    },
    onClose(listener) {
      return subscribe(closeListeners, listener)
    },
    onError(listener) {
      return subscribe(errorListeners, listener)
    },
    emitToolsChanged() {
      if (closed) return
      for (const listener of toolsChangedListeners) listener()
    },
    emitClose,
    emitError() {
      if (closed) return
      for (const listener of errorListeners) listener()
    },
    async close() {
      emitClose()
    }
  }
}
