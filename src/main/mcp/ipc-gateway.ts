/**
 * teach:mcp-* IPC handlers (ADR-0128 §8).
 * Thin gateway over McpHost; renderer never receives secret plaintext.
 */

import { ipcMain } from 'electron'
import { mcpInvokeChannels } from '../../shared/mcp/ipc-contract'
import type { McpSecretInputChanges } from '../../shared/mcp/types'
import type { McpHost } from './host'

export type RegisterMcpIpcGatewayOptions = {
  host: McpHost
}

export function registerMcpIpcGateway(options: RegisterMcpIpcGatewayOptions): void {
  const { host } = options

  ipcMain.removeHandler(mcpInvokeChannels.getConfig)
  ipcMain.removeHandler(mcpInvokeChannels.updateConfig)
  ipcMain.removeHandler(mcpInvokeChannels.testServer)
  ipcMain.removeHandler(mcpInvokeChannels.listRuntime)

  ipcMain.handle(mcpInvokeChannels.getConfig, async () => host.getPublicConfig())

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
    return host.testServer(serverId, workspaceRoot)
  })

  ipcMain.handle(mcpInvokeChannels.listRuntime, async () => ({
    ok: true as const,
    servers: host.listRuntime()
  }))
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
