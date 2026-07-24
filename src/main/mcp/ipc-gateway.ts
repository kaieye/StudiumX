/**
 * teach:mcp-* IPC handlers (ADR-0128 §8).
 * Thin gateway over McpHost; renderer never receives secret plaintext.
 */

import { ipcMain } from 'electron'
import { mcpInvokeChannels } from '../../shared/mcp/ipc-contract'
import type { McpSettingsOp } from '../../shared/mcp/mcp-ops'
import { MCP_SERVER_ID_RE } from '../../shared/mcp/tool-name'
import {
  mcpUserMessage,
  type McpRemoteToolAnnotationsSummary,
  type McpSecretInputChanges,
  type McpTestServerResult
} from '../../shared/mcp/types'
import type { McpHost } from './host'

export type RegisterMcpIpcGatewayOptions = {
  host: McpHost
}

export function registerMcpIpcGateway(options: RegisterMcpIpcGatewayOptions): void {
  const { host } = options

  ipcMain.removeHandler(mcpInvokeChannels.getConfig)
  ipcMain.removeHandler(mcpInvokeChannels.getMcpSettings)
  ipcMain.removeHandler(mcpInvokeChannels.updateConfig)
  ipcMain.removeHandler(mcpInvokeChannels.applyMcpOps)
  ipcMain.removeHandler(mcpInvokeChannels.testServer)
  ipcMain.removeHandler(mcpInvokeChannels.refreshServer)
  ipcMain.removeHandler(mcpInvokeChannels.authorizeServer)
  ipcMain.removeHandler(mcpInvokeChannels.revokeAuthorization)
  ipcMain.removeHandler(mcpInvokeChannels.listRuntime)
  ipcMain.removeHandler(mcpInvokeChannels.autoConnectNow)
  ipcMain.removeHandler(mcpInvokeChannels.marketplaceList)
  ipcMain.removeHandler(mcpInvokeChannels.marketplaceInstall)
  ipcMain.removeHandler(mcpInvokeChannels.marketplaceUninstall)
  ipcMain.removeHandler(mcpInvokeChannels.marketplaceSetCatalogUrls)
  ipcMain.removeHandler(mcpInvokeChannels.marketplaceRefreshCatalog)
  ipcMain.removeHandler(mcpInvokeChannels.getEffectiveView)

  ipcMain.handle(mcpInvokeChannels.getConfig, async () => host.getPublicConfig())

  // Live Settings path: always current store (alias of getPublicConfig).
  ipcMain.handle(mcpInvokeChannels.getMcpSettings, async () => host.getMcpSettings())

  ipcMain.handle(mcpInvokeChannels.updateConfig, async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const expectedFingerprint =
      typeof record.expectedFingerprint === 'string' ? record.expectedFingerprint : ''
    return host.updateConfig(
      record.config,
      expectedFingerprint,
      parseSecretChanges(record.secretChanges)
    )
  })

  ipcMain.handle(mcpInvokeChannels.applyMcpOps, async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const expectedFingerprint =
      typeof record.expectedFingerprint === 'string' ? record.expectedFingerprint : ''
    const ops = Array.isArray(record.ops) ? record.ops : null
    if (!ops) {
      return {
        ok: false as const,
        code: 'mcp_invalid_config' as const,
        message: 'ops must be an array'
      }
    }
    return host.applyMcpOps(
      ops as readonly McpSettingsOp[],
      expectedFingerprint,
      parseSecretChanges(record.secretChanges)
    )
  })

  ipcMain.handle(mcpInvokeChannels.testServer, async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const serverId = typeof record.serverId === 'string' ? record.serverId.trim() : ''
    const workspaceRoot =
      typeof record.workspaceRoot === 'string' && record.workspaceRoot.trim()
        ? record.workspaceRoot.trim()
        : undefined
    if (!serverId) {
      return {
        ok: false as const,
        code: 'mcp_invalid_config' as const,
        message: 'serverId is required',
        serverId: ''
      }
    }
    // Same public projection as refresh: strip transport extras; keep display annotations only.
    return toPublicListedToolsResult(await host.testServer(serverId, workspaceRoot), serverId)
  })

  ipcMain.handle(mcpInvokeChannels.refreshServer, async (_event, payload: unknown) => {
    const request = parseRefreshServerPayload(payload)
    if (!request) return invalidRefreshServerResult()
    return toPublicListedToolsResult(
      await host.refreshServer(request.serverId, request.workspaceRoot),
      request.serverId
    )
  })

  ipcMain.handle(mcpInvokeChannels.authorizeServer, async (_event, payload: unknown) => {
    const request = parseRefreshServerPayload(payload)
    if (!request) return invalidAuthorizeResult()
    return toPublicAuthorizeResult(
      await host.authorizeServer(request.serverId, request.workspaceRoot),
      request.serverId
    )
  })

  ipcMain.handle(mcpInvokeChannels.revokeAuthorization, async (_event, payload: unknown) => {
    const request = parseRefreshServerPayload(payload)
    if (!request) return invalidAuthorizeResult()
    return toPublicAuthorizeResult(
      await host.revokeAuthorization(request.serverId, request.workspaceRoot),
      request.serverId
    )
  })

  ipcMain.handle(mcpInvokeChannels.listRuntime, async () => ({
    ok: true as const,
    servers: host.listRuntime()
  }))

  ipcMain.handle(mcpInvokeChannels.autoConnectNow, async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const workspaceRoot =
      typeof record.workspaceRoot === 'string' && record.workspaceRoot.trim()
        ? record.workspaceRoot.trim()
        : null
    const results = await host.autoConnectNow(workspaceRoot)
    // Project through the same secret-free listed-tools shape as test/refresh.
    return {
      ok: true as const,
      results: results.map((result) =>
        toPublicListedToolsResult(result, result.ok ? result.serverId : result.serverId)
      )
    }
  })


  ipcMain.handle(mcpInvokeChannels.marketplaceList, async () => host.marketplaceList())

  ipcMain.handle(mcpInvokeChannels.marketplaceInstall, async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const entryId = typeof record.entryId === 'string' ? record.entryId.trim() : ''
    if (!entryId) {
      return { ok: false as const, code: 'invalid_entry', message: 'entryId is required' }
    }
    const connect = record.connect === true
    const workspaceRoot =
      typeof record.workspaceRoot === 'string' && record.workspaceRoot.trim()
        ? record.workspaceRoot.trim()
        : undefined
    return host.marketplaceInstallAndEnable(entryId, { connect, workspaceRoot })
  })

  ipcMain.handle(mcpInvokeChannels.marketplaceUninstall, async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const entryId = typeof record.entryId === 'string' ? record.entryId.trim() : ''
    if (!entryId) {
      return { ok: false as const, code: 'invalid_entry', message: 'entryId is required' }
    }
    return host.marketplaceUninstall(entryId)
  })

  ipcMain.handle(mcpInvokeChannels.marketplaceSetCatalogUrls, async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const raw = record.catalogUrls
    const catalogUrls = Array.isArray(raw)
      ? raw.filter((u): u is string => typeof u === 'string')
      : []
    return host.marketplaceSetCatalogUrls(catalogUrls)
  })

  ipcMain.handle(mcpInvokeChannels.marketplaceRefreshCatalog, async () => host.marketplaceRefreshCatalog())

  ipcMain.handle(mcpInvokeChannels.getEffectiveView, async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const workspaceRoot =
      typeof record.workspaceRoot === 'string' && record.workspaceRoot.trim()
        ? record.workspaceRoot.trim()
        : null
    return host.getEffectiveViewPublic(workspaceRoot)
  })
}

function parseSecretChanges(input: unknown): McpSecretInputChanges | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const output: Record<
    string,
    { env?: Record<string, string>; headers?: Record<string, string> }
  > = {}
  for (const [serverId, rawChanges] of Object.entries(input)) {
    if (!rawChanges || typeof rawChanges !== 'object' || Array.isArray(rawChanges)) continue
    const changes = rawChanges as Record<string, unknown>
    const env = parseStringRecord(changes.env)
    const headers = parseStringRecord(changes.headers)
    if (env || headers) output[serverId] = { ...(env ? { env } : {}), ...(headers ? { headers } : {}) }
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function parseStringRecord(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') output[key] = value
  }
  return Object.keys(output).length > 0 ? output : undefined
}

type ServerOperationRequest = Readonly<{
  serverId: string
  workspaceRoot?: string
}>

function parseRefreshServerPayload(payload: unknown): ServerOperationRequest | null {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null
  if (!record) return null

  const serverId = typeof record.serverId === 'string' ? record.serverId.trim() : ''
  if (!MCP_SERVER_ID_RE.test(serverId)) return null

  const workspaceRoot =
    typeof record.workspaceRoot === 'string' && record.workspaceRoot.trim()
      ? record.workspaceRoot.trim()
      : undefined
  return workspaceRoot === undefined ? { serverId } : { serverId, workspaceRoot }
}

function invalidRefreshServerResult(): McpTestServerResult {
  return {
    ok: false,
    code: 'mcp_invalid_config',
    message: 'A valid MCP serverId is required.',
    serverId: ''
  }
}

/**
 * Keep the renderer contract structural: no unexpected main-process fields,
 * transport diagnostics, or secret-bearing configuration data can cross IPC.
 *
 * Remote protocol annotations (readOnlyHint etc.) are display/audit only —
 * never effect authority (ADR-0132 §2.7). Only known boolean/title keys pass.
 */
function toPublicListedToolsResult(
  result: McpTestServerResult,
  requestedServerId: string
): McpTestServerResult {
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: mcpUserMessage(result.code),
      serverId: requestedServerId
    }
  }

  return {
    ok: true,
    serverId: requestedServerId,
    tools: result.tools.map((tool) => {
      const annotations = projectPublicAnnotations(tool.annotations)
      return {
        name: tool.name,
        registeredName: tool.registeredName,
        description: tool.description,
        descriptionTruncated: tool.descriptionTruncated,
        effectClass: tool.effectClass,
        registered: tool.registered,
        ...(tool.rejectReason === undefined ? {} : { rejectReason: tool.rejectReason }),
        ...(annotations ? { annotations } : {})
      }
    })
  }
}

/** Whitelist remote annotation fields for IPC (no free-form / secret smuggling). */
function projectPublicAnnotations(
  raw: McpRemoteToolAnnotationsSummary | undefined
): McpRemoteToolAnnotationsSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  } = {}
  if (typeof raw.title === 'string' && raw.title.trim()) {
    out.title = raw.title.trim().slice(0, 128)
  }
  if (typeof raw.readOnlyHint === 'boolean') out.readOnlyHint = raw.readOnlyHint
  if (typeof raw.destructiveHint === 'boolean') out.destructiveHint = raw.destructiveHint
  if (typeof raw.idempotentHint === 'boolean') out.idempotentHint = raw.idempotentHint
  if (typeof raw.openWorldHint === 'boolean') out.openWorldHint = raw.openWorldHint
  return Object.keys(out).length > 0 ? out : undefined
}

function invalidAuthorizeResult() {
  return {
    ok: false as const,
    code: 'mcp_invalid_config' as const,
    message: 'A valid MCP serverId is required.',
    authorization: {
      serverId: '',
      state: 'authorization_failed' as const,
      errorCode: 'authorization_failed' as const
    }
  }
}

function toPublicAuthorizeResult(
  result: {
    ok: boolean
    code?: string
    message?: string
    authorization: {
      serverId: string
      state: 'authorization_required' | 'authorizing' | 'authorized' | 'authorization_failed'
      errorCode: string | null
    }
  },
  requestedServerId: string
) {
  // Hard projection: never leak URL/code/state/token fields even if a future
  // manager accidentally returns extras.
  const authorization = {
    serverId: requestedServerId,
    state: result.authorization.state,
    errorCode: result.authorization.errorCode
  }
  if (result.ok) {
    return { ok: true as const, authorization }
  }
  return {
    ok: false as const,
    code: (result.code ?? 'mcp_oauth_authorization_failed') as
      | 'mcp_invalid_config'
      | 'mcp_oauth_unsupported'
      | 'mcp_oauth_not_configured'
      | 'mcp_oauth_in_progress'
      | 'mcp_oauth_authorization_required'
      | 'mcp_oauth_authorization_failed'
      | 'mcp_oauth_token_unavailable'
      | 'mcp_oauth_conflict'
      | 'mcp_server_disabled',
    message: typeof result.message === 'string' ? result.message : 'MCP OAuth authorization failed.',
    authorization
  }
}
