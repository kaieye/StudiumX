/**
 * MCP session manager: connection lifecycle, tools/list cache, budgets (ADR-0128 §4–§5).
 */

import {
  MCP_BUDGETS,
  MCP_ERROR_CODES,
  mcpUserMessage,
  type McpEffectClass,
  type McpErrorCode,
  type McpListedToolSummary,
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
import { isServerConnectable } from '../../shared/mcp/config-schema'
import {
  buildSanitizedMcpEnv,
  type McpSecretEnvResolver
} from './secret-env'
import { createStdioMcpTransport } from './transports/stdio'
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
  effectClass: McpEffectClass
}>

export type McpToolsSnapshot = Readonly<{
  tools: readonly McpSnapshotTool[]
  effectByRegisteredName: ReadonlyMap<string, McpEffectClass>
  serverHealth: readonly McpRuntimeServerView[]
  warnings: readonly string[]
}>

export type McpSessionManagerOptions = {
  secrets: McpSecretEnvResolver
  /** Override transport factory (tests inject fakes). */
  createTransport?: (server: UserMcpServerV1, env: Record<string, string>) => McpTransport
  /** Static tool names that MCP must not collide with. */
  staticToolNames?: ReadonlySet<string> | readonly string[]
  now?: () => number
}

type LiveSession = {
  server: UserMcpServerV1
  transport: McpTransport
  tools: McpSnapshotTool[]
  state: McpRuntimeServerView
}

export class McpSessionManager {
  private readonly sessions = new Map<string, LiveSession>()
  private config: UserMcpConfigV1 | null = null
  private readonly staticToolNames: Set<string>
  private readonly createTransport: (
    server: UserMcpServerV1,
    env: Record<string, string>
  ) => McpTransport

  constructor(private readonly options: McpSessionManagerOptions) {
    this.staticToolNames = new Set(
      options.staticToolNames ? [...options.staticToolNames] : []
    )
    this.createTransport =
      options.createTransport ??
      ((server, env) =>
        createStdioMcpTransport({
          serverId: server.id,
          command: server.command ?? 'false',
          args: server.args,
          cwd: server.cwd,
          env,
          initializeTimeoutMs: MCP_BUDGETS.initializeTimeoutMs,
          listTimeoutMs: MCP_BUDGETS.listTimeoutMs,
          callTimeoutMs: MCP_BUDGETS.callTimeoutMs
        }))
  }

  /** Replace active config. Drops sessions for removed/disabled servers. */
  async applyConfig(config: UserMcpConfigV1): Promise<void> {
    this.config = config
    const enabledIds = new Set(
      config.enabled
        ? config.servers.filter((s) => s.enabled).map((s) => s.id)
        : []
    )
    for (const id of this.sessions.keys()) {
      if (!enabledIds.has(id)) {
        await this.dropSession(id)
      }
    }
  }

  getRuntimeView(): readonly McpRuntimeServerView[] {
    if (!this.config) return []
    return this.config.servers.map((server) => {
      const live = this.sessions.get(server.id)
      if (!this.config!.enabled || !server.enabled) {
        return { id: server.id, state: 'disabled' as const }
      }
      if (live) return live.state
      return { id: server.id, state: 'idle' as const }
    })
  }

  /**
   * Build a run-scoped snapshot: connect enabled servers, list tools, apply budgets.
   * Safe to call when root disabled → empty snapshot.
   */
  async buildSnapshot(signal?: AbortSignal): Promise<McpToolsSnapshot> {
    const config = this.config
    if (!config || !config.enabled) {
      return emptySnapshot()
    }

    const warnings: string[] = []
    const tools: McpSnapshotTool[] = []
    const effectByRegisteredName = new Map<string, McpEffectClass>()
    const serverHealth: McpRuntimeServerView[] = []
    let globalSchemaBytes = 0

    for (const server of config.servers) {
      if (!server.enabled) {
        serverHealth.push({ id: server.id, state: 'disabled' })
        continue
      }

      if (tools.length >= MCP_BUDGETS.maxGlobalTools) {
        warnings.push(`global MCP tool cap ${MCP_BUDGETS.maxGlobalTools} reached; skipped ${server.id}`)
        serverHealth.push({
          id: server.id,
          state: 'error',
          errorCode: MCP_ERROR_CODES.mcp_budget_exceeded
        })
        continue
      }

      try {
        const session = await this.ensureSession(server, signal)
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
        serverHealth.push({
          id: server.id,
          state: 'error',
          errorCode: code,
          lastErrorMessage: mcpUserMessage(code)
        })
        await this.dropSession(server.id)
      }
    }

    return { tools, effectByRegisteredName, serverHealth, warnings }
  }

  async testServer(serverId: string, signal?: AbortSignal): Promise<McpTestServerResult> {
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

    try {
      const session = await this.ensureSession(server, signal)
      const tools: McpListedToolSummary[] = session.tools.map((t) => ({
        name: t.rawToolName,
        registeredName: t.registeredName,
        description: t.description,
        descriptionTruncated: t.descriptionTruncated,
        effectClass: t.effectClass,
        registered: true
      }))
      return { ok: true, tools, serverId }
    } catch (error) {
      const code = classifySessionError(error)
      return {
        ok: false,
        code,
        message: mcpUserMessage(code),
        serverId
      }
    }
  }

  async callTool(
    registeredName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<
    | { ok: true; content: string }
    | { ok: false; code: McpErrorCode; message: string }
  > {
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
    const rawMapped = parts.slice(1).join('__')
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

    try {
      // Call with original MCP name: reverse map from registered raw suffix when needed.
      const mcpName = findOriginalMcpName(session, tool) ?? tool.rawToolName
      const result = await withTimeout(
        session.transport.callTool(mcpName, args, signal),
        MCP_BUDGETS.callTimeoutMs,
        signal
      )
      const content =
        typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content ?? null)
      if (result.isError) {
        return {
          ok: false,
          code: MCP_ERROR_CODES.mcp_call_failed,
          message: content || mcpUserMessage(MCP_ERROR_CODES.mcp_call_failed)
        }
      }
      return { ok: true, content }
    } catch (error) {
      if (isTimeoutError(error)) {
        return {
          ok: false,
          code: MCP_ERROR_CODES.mcp_call_timeout,
          message: mcpUserMessage(MCP_ERROR_CODES.mcp_call_timeout)
        }
      }
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_call_failed,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_call_failed)
      }
    }

    void rawMapped
  }

  async dispose(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.dropSession(id)
    }
    this.config = null
  }

  private async ensureSession(
    server: UserMcpServerV1,
    signal?: AbortSignal
  ): Promise<LiveSession> {
    const existing = this.sessions.get(server.id)
    if (existing) return existing

    if (server.transport !== 'stdio') {
      throw Object.assign(new Error('unsupported transport'), {
        mcpCode: MCP_ERROR_CODES.mcp_transport_unsupported
      })
    }

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

    let transport: McpTransport
    try {
      transport = this.createTransport(server, envResult.env)
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        mcpCode: MCP_ERROR_CODES.mcp_spawn_failed
      })
    }

    try {
      await withTimeout(transport.initialize(signal), MCP_BUDGETS.initializeTimeoutMs, signal)
    } catch (error) {
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
      listed = await withTimeout(
        transport.listTools(signal),
        MCP_BUDGETS.listTimeoutMs,
        signal
      )
    } catch (error) {
      await transport.close().catch(() => undefined)
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        mcpCode: MCP_ERROR_CODES.mcp_list_failed
      })
    }

    const tools = materializeTools(server, listed, this.staticToolNames)
    const session: LiveSession = {
      server,
      transport,
      tools,
      state: {
        id: server.id,
        state: 'connected',
        toolCount: tools.length
      }
    }
    this.sessions.set(server.id, session)
    return session
  }

  private async dropSession(serverId: string): Promise<void> {
    const session = this.sessions.get(serverId)
    if (!session) return
    this.sessions.delete(serverId)
    await session.transport.close().catch(() => undefined)
  }
}

function materializeTools(
  server: UserMcpServerV1,
  listed: readonly McpToolListItem[],
  staticToolNames: ReadonlySet<string>
): McpSnapshotTool[] {
  const limited = listed.slice(0, MCP_BUDGETS.maxToolsPerServer)
  const nameMap = allocateUniqueRawToolNames(limited.map((t) => t.name))
  const tools: McpSnapshotTool[] = []

  for (const item of limited) {
    const mappedRaw = nameMap.get(item.name) ?? item.name
    const registeredName = encodeMcpToolName(server.id, mappedRaw)
    if (staticToolNames.has(registeredName) || staticToolNames.has(mappedRaw)) {
      // Reject collision with static registry names.
      continue
    }
    // Also reject if registered name collides with known static tools.
    if (staticToolNames.has(registeredName)) continue

    let description = typeof item.description === 'string' ? item.description : ''
    let descriptionTruncated = false
    if (description.length > MCP_BUDGETS.maxDescriptionChars) {
      description =
        description.slice(0, MCP_BUDGETS.maxDescriptionChars - 12) + '…[truncated]'
      descriptionTruncated = true
    }

    const parameters =
      item.inputSchema && typeof item.inputSchema === 'object'
        ? (item.inputSchema as Record<string, unknown>)
        : { type: 'object', properties: {} }

    const schemaBytes = Buffer.byteLength(JSON.stringify(parameters), 'utf8')
    if (schemaBytes > MCP_BUDGETS.maxToolSchemaBytes) {
      continue
    }

    tools.push({
      registeredName,
      serverId: server.id,
      rawToolName: item.name,
      description,
      descriptionTruncated,
      parameters,
      effectClass: resolveMcpToolEffect(item.name, server.toolEffectOverrides)
    })
  }

  return tools
}

function findOriginalMcpName(
  _session: LiveSession,
  tool: McpSnapshotTool
): string | null {
  return tool.rawToolName
}

function emptySnapshot(): McpToolsSnapshot {
  return {
    tools: [],
    effectByRegisteredName: new Map(),
    serverHealth: [],
    warnings: []
  }
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
