/**
 * MCP session manager: connection lifecycle, tools/list cache, budgets (ADR-0128 §4–§5).
 */

import { resolve } from 'node:path'

import type { McpOAuthAuthorizationPublicState } from '../../shared/mcp/oauth-types'
import {
  MCP_BUDGETS,
  MCP_ERROR_CODES,
  mcpUserMessage,
  type McpEffectClass,
  type McpErrorCode,
  type McpListedToolSummary,
  type McpRuntimeInventorySummary,
  type McpRuntimeRefreshDiagnostics,
  type McpRuntimeServerView,
  type McpTestServerResult,
  type UserMcpConfigV1,
  type UserMcpServerV1
} from '../../shared/mcp/types'
import {
  allocateUniqueRawToolNames,
  encodeMcpToolName
} from '../../shared/mcp/tool-name'
import { resolveMcpToolEffect } from '../../shared/mcp/effect-map'
import { effectiveAutoConnect, isServerConnectable } from '../../shared/mcp/config-schema'
import { resolveInjectedStdioServer } from './workspace-root-injection'
import {
  buildResolvedMcpHeaders,
  buildSanitizedMcpEnv,
  type McpSecretEnvResolver
} from './secret-env'
import { createSdkMcpTransport } from './transports/sdk-client'
import { normalizeMcpToolResult } from './result-normalizer'
import type { McpArtifactWriter, McpNormalizedToolResult } from '../../shared/mcp/result-types'
import type { McpTraceResultKind, McpTraceStore } from './trace-store'
import {
  createFakeMcpTransport,
  type McpToolListItem,
  type McpTransport
} from './transports/types'

export type McpSnapshotTool = Readonly<{
  registeredName: string
  serverId: string
  rawToolName: string
  description: string
  descriptionTruncated: boolean
  parameters: Record<string, unknown>
  /**
   * Effect is resolved from config overrides, then optional trusted remote
   * readOnlyHint when `honorRemoteReadOnlyHint` is on (ADR-0141). Default remains
   * privileged (fail-closed).
   */
  effectClass: McpEffectClass
  /**
   * Protocol annotations retained for UI/audit. When honorRemoteReadOnlyHint is
   * false they must not influence effectClass or permission gates.
   */
  annotations?: import('../../shared/mcp/types').McpRemoteToolAnnotationsSummary
}>

export type McpToolsSnapshot = Readonly<{
  tools: readonly McpSnapshotTool[]
  effectByRegisteredName: ReadonlyMap<string, McpEffectClass>
  serverHealth: readonly McpRuntimeServerView[]
  warnings: readonly string[]
}>

/**
 * MCP call result adapted for the existing bridge. Successful calls retain the
 * legacy `content` alias while directly exposing the normalized Phase-B facts.
 * Transport/session failures remain deliberately distinct because no untrusted
 * MCP result was received to normalize.
 */
export type McpNormalizedCallFacts = Omit<McpNormalizedToolResult, 'content'> &
  Readonly<{ normalizedContent: McpNormalizedToolResult['content'] }>

export type McpSessionToolCallResult =
  | (Readonly<{ ok: true; content: string }> & McpNormalizedCallFacts)
  | (Readonly<{ ok: false; code: McpErrorCode; message: string }> &
      Partial<McpNormalizedCallFacts>)

export type McpSessionManagerOptions = {
  secrets: McpSecretEnvResolver
  /** Override transport factory (tests inject fakes). */
  createTransport?: (
    server: UserMcpServerV1,
    env: Record<string, string>,
    headers: Record<string, string>
  ) => McpTransport
  /** Static tool names that MCP must not collide with. */
  staticToolNames?: ReadonlySet<string> | readonly string[]
  /** Main-process artifact sink for bounded binary MCP result spillover. */
  artifactWriter?: McpArtifactWriter
  /** Optional process-local, metadata-only diagnostic trace. */
  traceStore?: McpTraceStore
  now?: () => number
  /**
   * Main-only Authorization header resolver for OAuth-backed HTTP/SSE servers.
   * Must never surface token material into runtime/public DTOs.
   */
  resolveAuthorizationHeader?: (server: UserMcpServerV1) => string | null
  /** Secret-free OAuth public projection attached to runtime views. */
  getAuthorizationPublicState?: (
    serverId: string
  ) => McpOAuthAuthorizationPublicState | null
}

type McpToolInventory = McpRuntimeInventorySummary

type LiveSession = {
  /** Config-document server (no injected args). */
  server: UserMcpServerV1
  transport: McpTransport
  tools: McpSnapshotTool[]
  inventory: McpToolInventory
  refresh: McpRuntimeRefreshDiagnostics
  state: McpRuntimeServerView
  unsubscribeLifecycle: () => void
  /** Canonical active root used at spawn time, or null when no injection. */
  injectedWorkspaceRoot: string | null
}

const MAX_TOOL_LIST_PAGES = 32
const MAX_DISCOVERED_TOOLS_PER_SERVER = MCP_BUDGETS.maxToolsPerServer * 4
const RECONNECT_MAX_ATTEMPTS = MCP_BUDGETS.reconnectMaxAttempts
const RECONNECT_BACKOFF_MS = MCP_BUDGETS.reconnectBackoffMs

export class McpSessionManager {
  private readonly sessions = new Map<string, LiveSession>()
  private readonly transientRuntime = new Map<string, McpRuntimeServerView>()
  private readonly inventoryGenerations = new Map<string, number>()
  private readonly refreshDiagnostics = new Map<string, McpRuntimeRefreshDiagnostics>()
  /** Per-server reconnect attempt count for the current disconnect streak. */
  private readonly reconnectAttempts = new Map<string, number>()
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false
  private config: UserMcpConfigV1 | null = null
  private lastHonorRemoteReadOnlyHint = false
  private lastWorkspaceRoot: string | undefined
  private readonly staticToolNames: Set<string>
  private readonly createTransport: (
    server: UserMcpServerV1,
    env: Record<string, string>,
    headers: Record<string, string>
  ) => McpTransport

  constructor(private readonly options: McpSessionManagerOptions) {
    this.staticToolNames = new Set(
      options.staticToolNames ? [...options.staticToolNames] : []
    )
    this.createTransport =
      options.createTransport ??
      ((server, env, headers) =>
        createSdkMcpTransport({
          server,
          env,
          headers,
          timeoutMs: server.timeoutMs
        }))
  }

  /**
   * Replace active config. Sessions are reusable only while their runtime-relevant
   * definition is unchanged; edits must not keep an old process/tool snapshot alive.
   */
  async applyConfig(config: UserMcpConfigV1): Promise<void> {
    const honorRemote = config.honorRemoteReadOnlyHint === true
    const honorRemoteChanged = honorRemote !== this.lastHonorRemoteReadOnlyHint
    this.lastHonorRemoteReadOnlyHint = honorRemote
    this.config = config
    this.transientRuntime.clear()
    if (!config.enabled || !effectiveAutoConnectForConfig(config)) {
      this.cancelAllReconnects()
    }
    const enabledById = new Map<string, UserMcpServerV1>()
    if (config.enabled) {
      for (const server of config.servers) {
        if (server.enabled) enabledById.set(server.id, server)
      }
    }
    for (const [id, session] of this.sessions) {
      const nextServer = enabledById.get(id)
      // Root effect policy change must rematerialize tools (ADR-0141 honorRemoteReadOnlyHint).
      if (
        !nextServer ||
        !hasSameSessionDefinition(session.server, nextServer) ||
        honorRemoteChanged
      ) {
        this.cancelReconnect(id)
        await this.dropSession(id)
      }
    }
    // Drop timers for servers no longer enabled.
    for (const id of [...this.reconnectTimers.keys()]) {
      if (!enabledById.has(id)) this.cancelReconnect(id)
    }
  }

  getRuntimeView(): readonly McpRuntimeServerView[] {
    if (!this.config) return []
    return this.config.servers.map((server) => {
      const live = this.sessions.get(server.id)
      let view: McpRuntimeServerView
      if (!this.config!.enabled || !server.enabled) {
        view = { id: server.id, state: 'disabled' as const }
      } else if (live) {
        view = attachLocalDiagnostics(live.state, live.transport)
      } else {
        view = this.transientRuntime.get(server.id) ?? { id: server.id, state: 'idle' as const }
      }
      return this.withAuthorization(view)
    })
  }

  /**
   * Build a run-scoped snapshot: connect enabled servers, list tools, apply budgets.
   * Safe to call when root disabled → empty snapshot.
   */
  async buildSnapshot(
    workspaceRoot?: string,
    signal?: AbortSignal
  ): Promise<McpToolsSnapshot> {
    const config = this.config
    if (!config || !config.enabled) {
      return emptySnapshot()
    }

    this.lastWorkspaceRoot = workspaceRoot

    const warnings: string[] = []
    const tools: McpSnapshotTool[] = []
    const effectByRegisteredName = new Map<string, McpEffectClass>()
    const serverHealth: McpRuntimeServerView[] = []
    let globalSchemaBytes = 0

    for (const server of config.servers) {
      if (!server.enabled || !serverMatchesWorkspaceScope(server, workspaceRoot)) {
        serverHealth.push({ id: server.id, state: 'disabled' })
        continue
      }

      if (tools.length >= MCP_BUDGETS.maxGlobalTools) {
        warnings.push(`global MCP tool cap ${MCP_BUDGETS.maxGlobalTools} reached; skipped ${server.id}`)
        const budgetError: McpRuntimeServerView = {
          id: server.id,
          state: 'error',
          errorCode: MCP_ERROR_CODES.mcp_budget_exceeded,
          lastErrorMessage: mcpUserMessage(MCP_ERROR_CODES.mcp_budget_exceeded)
        }
        this.transientRuntime.set(server.id, budgetError)
        serverHealth.push(budgetError)
        continue
      }

      try {
        const session = await this.ensureSession(server, signal, workspaceRoot)
        let accepted = 0
        for (const tool of session.tools) {
          if (tools.length >= MCP_BUDGETS.maxGlobalTools) {
            warnings.push('global MCP tool budget exhausted')
            break
          }
          if (accepted >= MCP_BUDGETS.maxToolsPerServer) {
            warnings.push(`server ${server.id} tool list truncated at ${MCP_BUDGETS.maxToolsPerServer}`)
            break
          }
          const schemaBytes = Buffer.byteLength(JSON.stringify(tool.parameters), 'utf8')
          if (schemaBytes > MCP_BUDGETS.maxToolSchemaBytes) {
            warnings.push(`rejected ${tool.registeredName}: schema too large`)
            continue
          }
          if (globalSchemaBytes + schemaBytes > MCP_BUDGETS.maxGlobalSchemaBytes) {
            warnings.push('global MCP schema budget exhausted')
            break
          }
          tools.push(tool)
          effectByRegisteredName.set(tool.registeredName, tool.effectClass)
          globalSchemaBytes += schemaBytes
          accepted += 1
        }
        serverHealth.push({
          ...session.state,
          toolCount: accepted
        })
      } catch (error) {
        const code = classifySessionError(error)
        const errorState: McpRuntimeServerView = {
          id: server.id,
          state: 'error',
          errorCode: code,
          lastErrorMessage: mcpUserMessage(code)
        }
        await this.dropSession(server.id)
        this.transientRuntime.set(server.id, errorState)
        serverHealth.push(errorState)
      }
    }

    return { tools, effectByRegisteredName, serverHealth, warnings }
  }

  async testServer(
    serverId: string,
    workspaceRoot?: string,
    signal?: AbortSignal
  ): Promise<McpTestServerResult> {
    const config = this.config
    if (!config) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_invalid_config,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_invalid_config),
        serverId
      }
    }
    if (!config.enabled) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_disabled,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_disabled),
        serverId
      }
    }
    const server = config.servers.find((s) => s.id === serverId)
    if (!server) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_invalid_config,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_invalid_config),
        serverId
      }
    }
    if (!server.enabled) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_server_disabled,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_server_disabled),
        serverId
      }
    }
    if (!serverMatchesWorkspaceScope(server, workspaceRoot)) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_server_disabled,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_server_disabled),
        serverId
      }
    }

    try {
      const session = await this.ensureSession(server, signal, workspaceRoot)
      const tools: McpListedToolSummary[] = session.tools.map((t) => ({
        name: t.rawToolName,
        registeredName: t.registeredName,
        description: t.description,
        descriptionTruncated: t.descriptionTruncated,
        effectClass: t.effectClass,
        registered: true,
        ...(t.annotations ? { annotations: t.annotations } : {})
      }))
      return { ok: true, tools, serverId }
    } catch (error) {
      const code = classifySessionError(error)
      const message = mcpUserMessage(code)
      await this.dropSession(serverId)
      this.transientRuntime.set(serverId, {
        id: serverId,
        state: 'error',
        errorCode: code,
        lastErrorMessage: message
      })
      return {
        ok: false,
        code,
        message,
        serverId
      }
    }
  }

  /**
   * Explicit, user-initiated inventory refresh. This is deliberately separate
   * from tools/call: it only re-establishes a configured server after applying
   * the same root/scope gates as testServer().
   */
  async refreshServer(
    serverId: string,
    workspaceRoot?: string,
    signal?: AbortSignal
  ): Promise<McpTestServerResult> {
    const config = this.config
    if (!config) {
      return unavailableTestResult(serverId, MCP_ERROR_CODES.mcp_invalid_config)
    }
    if (!config.enabled) {
      return unavailableTestResult(serverId, MCP_ERROR_CODES.mcp_disabled)
    }
    const server = config.servers.find((candidate) => candidate.id === serverId)
    if (!server) {
      return unavailableTestResult(serverId, MCP_ERROR_CODES.mcp_invalid_config)
    }
    if (!server.enabled || !serverMatchesWorkspaceScope(server, workspaceRoot)) {
      return unavailableTestResult(serverId, MCP_ERROR_CODES.mcp_server_disabled)
    }

    await this.dropSession(serverId)
    this.transientRuntime.delete(serverId)
    return this.testServer(serverId, workspaceRoot, signal)
  }

  /**
   * Narrow public invalidation for OAuth/token lifecycle events. Drops only the
   * target server session without exposing transport internals.
   */
  async invalidateServer(serverId: string, code?: McpErrorCode): Promise<void> {
    if (code) {
      await this.invalidateSession(serverId, code)
      return
    }
    await this.dropSession(serverId)
    this.transientRuntime.delete(serverId)
  }

  async callTool(
    registeredName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpSessionToolCallResult> {
    const parts = registeredName.startsWith('mcp__')
      ? registeredName.slice('mcp__'.length).split('__')
      : []
    if (parts.length < 2) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_tool_not_registered,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_tool_not_registered)
      }
    }
    const serverId = parts[0]!
    const session = this.sessions.get(serverId)
    if (!session) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_server_unavailable,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_server_unavailable)
      }
    }
    const tool = session.tools.find((t) => t.registeredName === registeredName)
    if (!tool) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_tool_not_registered,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_tool_not_registered)
      }
    }

    // Call with original MCP name: reverse map from registered raw suffix when needed.
    const mcpName = findOriginalMcpName(session, tool) ?? tool.rawToolName
    const startedAt = (this.options.now ?? Date.now)()
    try {
      const result = await withTimeout(
        session.transport.callTool(mcpName, args, signal),
        session.server.timeoutMs ?? MCP_BUDGETS.callTimeoutMs,
        signal
      )
      const normalized = await normalizeMcpToolResult(result, {
        ...(this.options.artifactWriter ? { artifactWriter: this.options.artifactWriter } : {})
      })
      this.appendTrace({
        serverId,
        registeredToolName: registeredName,
        rawToolName: mcpName,
        durationMs: (this.options.now ?? Date.now)() - startedAt,
        cancelled: signal?.aborted === true,
        resultBytes: normalized.byteCount,
        truncated: normalized.truncated,
        spilled: normalized.spilled,
        resultKind: traceResultKind(normalized),
        errorCode: normalized.errorCode ?? null
      })
      const { content: normalizedContent, ...normalizedFacts } = normalized
      if (normalized.isError) {
        return {
          ...normalizedFacts,
          normalizedContent,
          ok: false,
          code: MCP_ERROR_CODES.mcp_call_failed,
          message: normalized.modelText || mcpUserMessage(MCP_ERROR_CODES.mcp_call_failed)
        }
      }
      return { ...normalizedFacts, normalizedContent, ok: true, content: normalized.modelText }
    } catch (error) {
      const code = isTimeoutError(error)
        ? MCP_ERROR_CODES.mcp_call_timeout
        : MCP_ERROR_CODES.mcp_call_failed
      // A transport failure/timeout invalidates the cached client. An MCP
      // application result with isError has already returned above and does
      // not take this path.
      await this.invalidateSession(serverId, code)
      return {
        ok: false,
        code,
        message: mcpUserMessage(code)
      }
    }
  }

  private appendTrace(input: Parameters<McpTraceStore['append']>[0]): void {
    try {
      this.options.traceStore?.append(input)
    } catch {
      // Diagnostics must never alter an MCP tool result or session lifecycle.
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.cancelAllReconnects()
    for (const id of [...this.sessions.keys()]) {
      await this.dropSession(id)
    }
    this.transientRuntime.clear()
    this.inventoryGenerations.clear()
    this.refreshDiagnostics.clear()
    this.reconnectAttempts.clear()
    this.config = null
  }

  private async ensureSession(
    server: UserMcpServerV1,
    signal?: AbortSignal,
    activeWorkspaceRoot?: string
  ): Promise<LiveSession> {
    if (activeWorkspaceRoot !== undefined) {
      this.lastWorkspaceRoot = activeWorkspaceRoot
    }
    const injection = resolveInjectedStdioServer(server, activeWorkspaceRoot)
    const spawnServer = injection.server
    const injectedWorkspaceRoot = injection.injectedRoot ?? null

    const existing = this.sessions.get(server.id)
    if (
      existing &&
      !existing.inventory.stale &&
      existing.injectedWorkspaceRoot === injectedWorkspaceRoot
    ) {
      return existing
    }
    if (existing) await this.dropSession(server.id)

    const envResult = buildSanitizedMcpEnv({
      envPlain: server.envPlain,
      envSecretRefs: server.envSecretRefs,
      secrets: this.options.secrets
    })
    if (!envResult.ok) {
      throw Object.assign(new Error('secret unresolved'), {
        mcpCode: MCP_ERROR_CODES.mcp_secret_unresolved
      })
    }
    const headersResult = buildResolvedMcpHeaders({
      headersPlain: server.headersPlain,
      headersSecretRefs: server.headersSecretRefs,
      secrets: this.options.secrets
    })
    if (!headersResult.ok) {
      throw Object.assign(new Error('secret unresolved'), {
        mcpCode: MCP_ERROR_CODES.mcp_secret_unresolved
      })
    }

    const headers = { ...headersResult.headers }
    if (server.oauth && server.transport !== 'stdio') {
      // Fail closed when static Authorization coexists with OAuth config.
      if (Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')) {
        throw Object.assign(new Error('oauth authorization header conflict'), {
          mcpCode: MCP_ERROR_CODES.mcp_oauth_conflict
        })
      }
      const authorizationHeader = this.options.resolveAuthorizationHeader?.(server) ?? null
      if (!authorizationHeader) {
        throw Object.assign(new Error('oauth authorization required'), {
          mcpCode: MCP_ERROR_CODES.mcp_oauth_authorization_required
        })
      }
      headers.Authorization = authorizationHeader
    }

    let transport: McpTransport
    try {
      transport = this.createTransport(spawnServer, envResult.env, headers)
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        mcpCode:
          server.transport === 'stdio'
            ? MCP_ERROR_CODES.mcp_spawn_failed
            : MCP_ERROR_CODES.mcp_server_unavailable
      })
    }

    const refresh = this.beginRefresh(server.id)
    this.transientRuntime.set(server.id, {
      id: server.id,
      state: 'connecting',
      refresh
    })
    const unsubscribeLifecycle = observeTransportLifecycle(
      transport,
      () => this.markInventoryStale(server.id),
      () => void this.invalidateSession(server.id, MCP_ERROR_CODES.mcp_server_unavailable)
    )

    try {
      await withTimeout(
        transport.initialize(signal),
        server.timeoutMs ?? MCP_BUDGETS.initializeTimeoutMs,
        signal
      )
    } catch (error) {
      unsubscribeLifecycle()
      await transport.close().catch(() => undefined)
      if (isTimeoutError(error)) {
        throw Object.assign(new Error('handshake timeout'), {
          mcpCode: MCP_ERROR_CODES.mcp_handshake_failed
        })
      }
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        mcpCode: MCP_ERROR_CODES.mcp_handshake_failed
      })
    }

    let listed: readonly McpToolListItem[]
    try {
      listed = await this.listAllTools(transport, server, signal)
    } catch (error) {
      unsubscribeLifecycle()
      await transport.close().catch(() => undefined)
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        mcpCode: getMcpCode(error) ?? MCP_ERROR_CODES.mcp_list_failed
      })
    }

    const honorRemote =
      this.config?.honorRemoteReadOnlyHint === true
    const materialized = materializeTools(
      server,
      listed,
      this.staticToolNames,
      honorRemote
    )
    const generation = (this.inventoryGenerations.get(server.id) ?? 0) + 1
    this.inventoryGenerations.set(server.id, generation)
    const inventory: McpToolInventory = {
      generation,
      stale: false,
      discoveredToolCount: materialized.discoveredToolCount,
      registeredToolCount: materialized.tools.length,
      rejectedToolCount: materialized.rejectedToolCount
    }
    const completedRefresh = this.completeRefresh(server.id, refresh)
    const state = connectedRuntimeView(server.id, inventory, completedRefresh)
    const session: LiveSession = {
      server,
      transport,
      tools: materialized.tools,
      inventory,
      refresh: completedRefresh,
      state,
      unsubscribeLifecycle,
      injectedWorkspaceRoot
    }
    this.sessions.set(server.id, session)
    this.transientRuntime.delete(server.id)
    // Successful connect clears the reconnect streak for this server.
    this.reconnectAttempts.delete(server.id)
    return session
  }

  private async listAllTools(
    transport: McpTransport,
    server: UserMcpServerV1,
    signal?: AbortSignal
  ): Promise<readonly McpToolListItem[]> {
    const listed: McpToolListItem[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined

    for (let pageIndex = 0; pageIndex < MAX_TOOL_LIST_PAGES; pageIndex += 1) {
      const response = await withTimeout(
        transport.listTools({ cursor, signal }),
        server.timeoutMs ?? MCP_BUDGETS.listTimeoutMs,
        signal
      )
      for (const item of response.tools) {
        if (listed.length >= MAX_DISCOVERED_TOOLS_PER_SERVER) {
          throw withMcpCode(
            new Error('tool discovery budget exceeded'),
            MCP_ERROR_CODES.mcp_budget_exceeded
          )
        }
        listed.push(item)
      }

      const nextCursor = response.nextCursor
      if (!nextCursor) return listed
      if (seenCursors.has(nextCursor)) {
        throw withMcpCode(
          new Error('repeated tools/list cursor'),
          MCP_ERROR_CODES.mcp_list_failed
        )
      }
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }

    throw withMcpCode(
      new Error('tools/list page budget exceeded'),
      MCP_ERROR_CODES.mcp_budget_exceeded
    )
  }

  private beginRefresh(serverId: string): McpRuntimeRefreshDiagnostics {
    const prior = this.refreshDiagnostics.get(serverId)
    const refresh: McpRuntimeRefreshDiagnostics = {
      refreshCount: (prior?.refreshCount ?? 0) + 1,
      lastRefreshAt: new Date((this.options.now ?? Date.now)()).toISOString(),
      retry: { attemptCount: 0, maxAttempts: 0 }
    }
    this.refreshDiagnostics.set(serverId, refresh)
    return refresh
  }

  private completeRefresh(
    serverId: string,
    refresh: McpRuntimeRefreshDiagnostics
  ): McpRuntimeRefreshDiagnostics {
    const completed: McpRuntimeRefreshDiagnostics = {
      ...refresh,
      lastSuccessfulRefreshAt: refresh.lastRefreshAt
    }
    this.refreshDiagnostics.set(serverId, completed)
    return completed
  }

  private markInventoryStale(serverId: string): void {
    const session = this.sessions.get(serverId)
    if (!session || session.inventory.stale) return
    const inventory: McpToolInventory = { ...session.inventory, stale: true }
    session.inventory = inventory
    session.state = connectedRuntimeView(serverId, inventory, session.refresh)
  }

  private withAuthorization(view: McpRuntimeServerView): McpRuntimeServerView {
    const authorization = this.options.getAuthorizationPublicState?.(view.id) ?? null
    if (!authorization) return view
    return { ...view, authorization }
  }

  private async invalidateSession(serverId: string, code: McpErrorCode): Promise<void> {
    const session = this.sessions.get(serverId)
    if (!session) return
    this.sessions.delete(serverId)
    session.unsubscribeLifecycle()
    const inventory = { ...session.inventory, stale: true }
    const priorRefresh = session.refresh
    this.transientRuntime.set(
      serverId,
      disconnectedRuntimeView(serverId, inventory, priorRefresh, code)
    )
    await session.transport.close().catch(() => undefined)

    // Budgeted reconnect: only when root enabled + effective autoConnect.
    // Never tools/call; only ensureSession / discovery.
    if (this.disposed) return
    const config = this.config
    if (!config || !config.enabled || !effectiveAutoConnectForConfig(config)) return
    const server = config.servers.find((s) => s.id === serverId)
    if (!server || !server.enabled) return

    const attempt = (this.reconnectAttempts.get(serverId) ?? 0) + 1
    if (attempt > RECONNECT_MAX_ATTEMPTS) {
      this.reconnectAttempts.set(serverId, attempt)
      const exhaustedRefresh: McpRuntimeRefreshDiagnostics = {
        ...priorRefresh,
        retry: {
          attemptCount: RECONNECT_MAX_ATTEMPTS,
          maxAttempts: RECONNECT_MAX_ATTEMPTS
        }
      }
      this.refreshDiagnostics.set(serverId, exhaustedRefresh)
      this.transientRuntime.set(
        serverId,
        disconnectedRuntimeView(serverId, inventory, exhaustedRefresh, code)
      )
      return
    }

    this.reconnectAttempts.set(serverId, attempt)
    const delayMs =
      RECONNECT_BACKOFF_MS[attempt - 1] ??
      RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1] ??
      1500
    const nowMs = (this.options.now ?? Date.now)()
    const retryAt = new Date(nowMs + delayMs).toISOString()
    const retryRefresh: McpRuntimeRefreshDiagnostics = {
      ...priorRefresh,
      retry: {
        attemptCount: attempt,
        maxAttempts: RECONNECT_MAX_ATTEMPTS,
        retryAt
      }
    }
    this.refreshDiagnostics.set(serverId, retryRefresh)
    this.transientRuntime.set(serverId, {
      id: serverId,
      state: 'retry_wait',
      errorCode: code,
      lastErrorMessage: mcpUserMessage(code),
      toolCount: inventory.registeredToolCount,
      inventory,
      refresh: retryRefresh
    })

    this.cancelReconnect(serverId, { keepAttempts: true })
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(serverId)
      void this.runBudgetedReconnect(serverId)
    }, delayMs)
    this.reconnectTimers.set(serverId, timer)
  }

  private async runBudgetedReconnect(serverId: string): Promise<void> {
    if (this.disposed) return
    const config = this.config
    if (!config || !config.enabled || !effectiveAutoConnectForConfig(config)) return
    const server = config.servers.find((s) => s.id === serverId)
    if (!server || !server.enabled) return
    // Avoid racing an already-live session (e.g. user refresh / snapshot).
    if (this.sessions.has(serverId)) return

    this.transientRuntime.set(serverId, {
      id: serverId,
      state: 'connecting',
      refresh: this.refreshDiagnostics.get(serverId) ?? {
        refreshCount: 0,
        retry: {
          attemptCount: this.reconnectAttempts.get(serverId) ?? 0,
          maxAttempts: RECONNECT_MAX_ATTEMPTS
        }
      }
    })

    try {
      await this.ensureSession(server, undefined, this.lastWorkspaceRoot)
    } catch {
      if (this.disposed) return
      const liveConfig = this.config
      if (!liveConfig || !liveConfig.enabled || !effectiveAutoConnectForConfig(liveConfig)) {
        return
      }
      const attempt = this.reconnectAttempts.get(serverId) ?? 0
      if (attempt >= RECONNECT_MAX_ATTEMPTS) {
        const prior = this.refreshDiagnostics.get(serverId)
        const exhausted: McpRuntimeRefreshDiagnostics = {
          refreshCount: prior?.refreshCount ?? 0,
          lastRefreshAt: prior?.lastRefreshAt,
          lastSuccessfulRefreshAt: prior?.lastSuccessfulRefreshAt,
          retry: {
            attemptCount: RECONNECT_MAX_ATTEMPTS,
            maxAttempts: RECONNECT_MAX_ATTEMPTS
          }
        }
        this.refreshDiagnostics.set(serverId, exhausted)
        this.transientRuntime.set(
          serverId,
          disconnectedRuntimeView(
            serverId,
            {
              generation: this.inventoryGenerations.get(serverId) ?? 0,
              stale: true,
              discoveredToolCount: 0,
              registeredToolCount: 0,
              rejectedToolCount: 0
            },
            exhausted,
            MCP_ERROR_CODES.mcp_server_unavailable
          )
        )
        return
      }
      await this.scheduleReconnectAfterFailedAttempt(serverId)
    }
  }

  private async scheduleReconnectAfterFailedAttempt(serverId: string): Promise<void> {
    if (this.disposed) return
    const config = this.config
    if (!config || !config.enabled || !effectiveAutoConnectForConfig(config)) return
    const server = config.servers.find((s) => s.id === serverId)
    if (!server || !server.enabled) return
    if (this.sessions.has(serverId)) return

    const attempt = (this.reconnectAttempts.get(serverId) ?? 0) + 1
    this.reconnectAttempts.set(serverId, attempt)
    if (attempt > RECONNECT_MAX_ATTEMPTS) {
      const prior = this.refreshDiagnostics.get(serverId)
      const exhausted: McpRuntimeRefreshDiagnostics = {
        refreshCount: prior?.refreshCount ?? 0,
        lastRefreshAt: prior?.lastRefreshAt,
        lastSuccessfulRefreshAt: prior?.lastSuccessfulRefreshAt,
        retry: {
          attemptCount: RECONNECT_MAX_ATTEMPTS,
          maxAttempts: RECONNECT_MAX_ATTEMPTS
        }
      }
      this.refreshDiagnostics.set(serverId, exhausted)
      this.transientRuntime.set(
        serverId,
        disconnectedRuntimeView(
          serverId,
          {
            generation: this.inventoryGenerations.get(serverId) ?? 0,
            stale: true,
            discoveredToolCount: 0,
            registeredToolCount: 0,
            rejectedToolCount: 0
          },
          exhausted,
          MCP_ERROR_CODES.mcp_server_unavailable
        )
      )
      return
    }

    const delayMs =
      RECONNECT_BACKOFF_MS[attempt - 1] ??
      RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1] ??
      1500
    const nowMs = (this.options.now ?? Date.now)()
    const retryAt = new Date(nowMs + delayMs).toISOString()
    const prior = this.refreshDiagnostics.get(serverId)
    const retryRefresh: McpRuntimeRefreshDiagnostics = {
      refreshCount: prior?.refreshCount ?? 0,
      lastRefreshAt: prior?.lastRefreshAt,
      lastSuccessfulRefreshAt: prior?.lastSuccessfulRefreshAt,
      retry: {
        attemptCount: attempt,
        maxAttempts: RECONNECT_MAX_ATTEMPTS,
        retryAt
      }
    }
    this.refreshDiagnostics.set(serverId, retryRefresh)
    this.transientRuntime.set(serverId, {
      id: serverId,
      state: 'retry_wait',
      errorCode: MCP_ERROR_CODES.mcp_server_unavailable,
      lastErrorMessage: mcpUserMessage(MCP_ERROR_CODES.mcp_server_unavailable),
      refresh: retryRefresh
    })

    this.cancelReconnect(serverId, { keepAttempts: true })
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(serverId)
      void this.runBudgetedReconnect(serverId)
    }, delayMs)
    this.reconnectTimers.set(serverId, timer)
  }

  private cancelReconnect(
    serverId: string,
    options: { keepAttempts?: boolean } = {}
  ): void {
    const timer = this.reconnectTimers.get(serverId)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(serverId)
    }
    if (!options.keepAttempts) {
      this.reconnectAttempts.delete(serverId)
    }
  }

  private cancelAllReconnects(): void {
    for (const id of [...this.reconnectTimers.keys()]) {
      this.cancelReconnect(id)
    }
    this.reconnectAttempts.clear()
  }

  private async dropSession(serverId: string): Promise<void> {
    const session = this.sessions.get(serverId)
    if (!session) return
    this.sessions.delete(serverId)
    session.unsubscribeLifecycle()
    await session.transport.close().catch(() => undefined)
  }
}

function effectiveAutoConnectForConfig(
  config: Pick<UserMcpConfigV1, 'enabled' | 'autoConnect'>
): boolean {
  return effectiveAutoConnect(config)
}

function traceResultKind(result: McpNormalizedToolResult): McpTraceResultKind {
  if (result.isError) return 'error'

  const kinds = new Set<string>()
  for (const item of result.content) {
    if (item.kind === 'image' || item.kind === 'audio' || item.kind === 'resource' || item.kind === 'binary') {
      kinds.add('artifact')
    } else {
      kinds.add(item.kind)
    }
  }
  if (result.structuredContent) kinds.add('structured')
  if (kinds.size === 0) return 'empty'
  if (kinds.size > 1) return 'mixed'

  const [kind] = kinds
  switch (kind) {
    case 'text':
    case 'structured':
    case 'resource_link':
    case 'artifact':
    case 'unknown':
      return kind
    default:
      return 'unknown'
  }
}

function materializeTools(
  server: UserMcpServerV1,
  listed: readonly McpToolListItem[],
  staticToolNames: ReadonlySet<string>,
  honorRemoteReadOnlyHint: boolean
): Readonly<{
  tools: McpSnapshotTool[]
  discoveredToolCount: number
  rejectedToolCount: number
  rejectedByReason: Readonly<Record<string, number>>
}> {
  const rejectedByReason: Record<string, number> = {}
  const candidates: Array<{
    item: McpToolListItem
    parameters: Record<string, unknown>
    description: string
    descriptionTruncated: boolean
  }> = []

  for (const item of listed) {
    if (!isUsableToolName(item.name)) {
      recordToolRejection(rejectedByReason, 'invalid_name')
      continue
    }
    const parameters = normalizeToolParameters(item.inputSchema)
    if (!parameters) {
      recordToolRejection(rejectedByReason, 'invalid_schema')
      continue
    }
    const schemaBytes = byteLengthOfJson(parameters)
    if (schemaBytes === null || schemaBytes > MCP_BUDGETS.maxToolSchemaBytes) {
      recordToolRejection(rejectedByReason, 'schema_too_large')
      continue
    }

    let description = typeof item.description === 'string' ? item.description : ''
    let descriptionTruncated = false
    if (description.length > MCP_BUDGETS.maxDescriptionChars) {
      description =
        description.slice(0, MCP_BUDGETS.maxDescriptionChars - 12) + '…[truncated]'
      descriptionTruncated = true
    }
    candidates.push({ item, parameters, description, descriptionTruncated })
  }

  // Build names only from candidates that survived schema validation. Invalid
  // or over-budget entries therefore cannot consume a later valid tool's name.
  const nameMap = allocateUniqueRawToolNames(candidates.map(({ item }) => item.name))
  const registeredNames = new Set<string>()
  const tools: McpSnapshotTool[] = []

  for (const candidate of candidates) {
    const mappedRaw = nameMap.get(candidate.item.name) ?? candidate.item.name
    const registeredName = encodeMcpToolName(server.id, mappedRaw)
    if (
      staticToolNames.has(registeredName) ||
      staticToolNames.has(mappedRaw) ||
      registeredNames.has(registeredName)
    ) {
      recordToolRejection(rejectedByReason, 'name_conflict')
      continue
    }
    if (tools.length >= MCP_BUDGETS.maxToolsPerServer) {
      recordToolRejection(rejectedByReason, 'tool_budget')
      continue
    }

    registeredNames.add(registeredName)
    const annotations = normalizeListedAnnotations(candidate.item.annotations)
    const effectClass = resolveMcpToolEffect(
      candidate.item.name,
      server.toolEffectOverrides,
      {
        honorRemoteReadOnlyHint,
        annotations
      }
    )
    tools.push({
      registeredName,
      serverId: server.id,
      rawToolName: candidate.item.name,
      description: candidate.description,
      descriptionTruncated: candidate.descriptionTruncated,
      parameters: candidate.parameters,
      effectClass,
      ...(annotations ? { annotations } : {})
    })
  }

  return {
    tools,
    discoveredToolCount: listed.length,
    rejectedToolCount: Object.values(rejectedByReason).reduce((total, count) => total + count, 0),
    rejectedByReason
  }
}

function isUsableToolName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0
}

/**
 * Bound secret-free remote annotations for inventory / listed summaries.
 * May feed resolveMcpToolEffect only when honorRemoteReadOnlyHint is true.
 */
function normalizeListedAnnotations(
  raw: McpToolListItem['annotations'] | undefined
): import('../../shared/mcp/types').McpRemoteToolAnnotationsSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: import('../../shared/mcp/types').McpRemoteToolAnnotationsSummary = {
    ...(typeof raw.title === 'string' && raw.title.trim()
      ? { title: raw.title.trim().slice(0, 128) }
      : {}),
    ...(typeof raw.readOnlyHint === 'boolean' ? { readOnlyHint: raw.readOnlyHint } : {}),
    ...(typeof raw.destructiveHint === 'boolean' ? { destructiveHint: raw.destructiveHint } : {}),
    ...(typeof raw.idempotentHint === 'boolean' ? { idempotentHint: raw.idempotentHint } : {}),
    ...(typeof raw.openWorldHint === 'boolean' ? { openWorldHint: raw.openWorldHint } : {})
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeToolParameters(inputSchema: unknown): Record<string, unknown> | null {
  if (inputSchema === undefined || inputSchema === null) {
    return { type: 'object', properties: {} }
  }
  if (typeof inputSchema !== 'object' || Array.isArray(inputSchema)) return null
  return inputSchema as Record<string, unknown>
}

function byteLengthOfJson(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return null
  }
}

function recordToolRejection(rejections: Record<string, number>, reason: string): void {
  rejections[reason] = (rejections[reason] ?? 0) + 1
}

function connectedRuntimeView(
  serverId: string,
  inventory: McpToolInventory,
  refresh: McpRuntimeRefreshDiagnostics
): McpRuntimeServerView {
  return {
    id: serverId,
    state: 'connected',
    toolCount: inventory.registeredToolCount,
    inventory,
    refresh
  }
}

function disconnectedRuntimeView(
  serverId: string,
  inventory: McpToolInventory,
  refresh: McpRuntimeRefreshDiagnostics,
  code: McpErrorCode
): McpRuntimeServerView {
  return {
    id: serverId,
    state: 'disconnected',
    errorCode: code,
    lastErrorMessage: mcpUserMessage(code),
    toolCount: inventory.registeredToolCount,
    inventory,
    refresh
  }
}

function unavailableTestResult(serverId: string, code: McpErrorCode): McpTestServerResult {
  return { ok: false, code, message: mcpUserMessage(code), serverId }
}

function withMcpCode(error: Error, mcpCode: McpErrorCode): Error {
  return Object.assign(error, { mcpCode })
}

function getMcpCode(error: unknown): McpErrorCode | null {
  if (error && typeof error === 'object' && 'mcpCode' in error) {
    const code = (error as { mcpCode?: string }).mcpCode
    if (code && code in MCP_ERROR_CODES) return code as McpErrorCode
  }
  return null
}

function observeTransportLifecycle(
  transport: McpTransport,
  onToolsChanged: () => void,
  onUnavailable: () => void
): () => void {
  const unsubscribeToolsChanged = transport.onToolsChanged(onToolsChanged)
  const unsubscribeClose = transport.onClose(onUnavailable)
  const unsubscribeError = transport.onError(onUnavailable)
  return () => {
    unsubscribeToolsChanged()
    unsubscribeClose()
    unsubscribeError()
  }
}

/**
 * Project optional transport local diagnostics onto a runtime view.
 * Max 3 lines × 120 chars; never invents content when the transport has no ring.
 */
function attachLocalDiagnostics(
  view: McpRuntimeServerView,
  transport: McpTransport
): McpRuntimeServerView {
  if (typeof transport.getLocalDiagnostics !== 'function') return view
  let raw: readonly string[]
  try {
    raw = transport.getLocalDiagnostics() ?? []
  } catch {
    return view
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ...view, diagnosticsLineCount: 0 }
  }
  const lines = raw
    .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    .map((line) => line.trim().slice(0, 120))
    .slice(-3)
  return {
    ...view,
    diagnosticsLineCount: Math.min(raw.length, 32),
    ...(lines.length > 0 ? { diagnosticsLines: lines } : {})
  }
}

function findOriginalMcpName(
  _session: LiveSession,
  tool: McpSnapshotTool
): string | null {
  return tool.rawToolName
}

function hasSameSessionDefinition(
  current: UserMcpServerV1,
  next: UserMcpServerV1
): boolean {
  return (
    current.transport === next.transport &&
    current.scope === next.scope &&
    current.workspaceRoot === next.workspaceRoot &&
    current.command === next.command &&
    arraysEqual(current.args, next.args) &&
    current.cwd === next.cwd &&
    recordsEqual(current.envSecretRefs, next.envSecretRefs) &&
    recordsEqual(current.envPlain, next.envPlain) &&
    current.url === next.url &&
    recordsEqual(current.headersSecretRefs, next.headersSecretRefs) &&
    recordsEqual(current.headersPlain, next.headersPlain) &&
    current.timeoutMs === next.timeoutMs &&
    recordsEqual(current.toolEffectOverrides, next.toolEffectOverrides) &&
    oauthConfigsEqual(current.oauth, next.oauth) &&
    current.workspaceRootInjection === next.workspaceRootInjection &&
    current.injectionIdentity === next.injectionIdentity
  )
}


function oauthConfigsEqual(
  left: UserMcpServerV1['oauth'],
  right: UserMcpServerV1['oauth']
): boolean {
  if (left == null && right == null) return true
  if (left == null || right == null) return false
  return (
    left.authorizationEndpoint === right.authorizationEndpoint &&
    left.tokenEndpoint === right.tokenEndpoint &&
    left.clientId === right.clientId &&
    left.resource === right.resource &&
    left.scopes.length === right.scopes.length &&
    left.scopes.every((scope, index) => scope === right.scopes[index])
  )
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function recordsEqual<T extends string>(
  left: Readonly<Record<string, T>>,
  right: Readonly<Record<string, T>>
): boolean {
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every((key) => left[key] === right[key])
}

function emptySnapshot(): McpToolsSnapshot {
  return {
    tools: [],
    effectByRegisteredName: new Map(),
    serverHealth: [],
    warnings: []
  }
}

function serverMatchesWorkspaceScope(
  server: UserMcpServerV1,
  workspaceRoot: string | undefined
): boolean {
  if (server.scope === 'user') return true
  if (!workspaceRoot || !server.workspaceRoot) return false
  const normalize = (value: string): string => {
    const normalized = resolve(value)
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
  }
  return normalize(server.workspaceRoot) === normalize(workspaceRoot)
}

function classifySessionError(error: unknown): McpErrorCode {
  if (error && typeof error === 'object' && 'mcpCode' in error) {
    const code = (error as { mcpCode?: string }).mcpCode
    if (code && code in MCP_ERROR_CODES) return code as McpErrorCode
  }
  if (isTimeoutError(error)) return MCP_ERROR_CODES.mcp_handshake_failed
  const message = error instanceof Error ? error.message : String(error)
  if (/spawn|ENOENT|EACCES/i.test(message)) return MCP_ERROR_CODES.mcp_spawn_failed
  return MCP_ERROR_CODES.mcp_server_unavailable
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|aborted/i.test(message)
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) throw new Error('aborted')
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mcp timeout')), ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

/** Test helper re-export */
export { createFakeMcpTransport, isServerConnectable }
