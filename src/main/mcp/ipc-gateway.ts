/**
 * teach:mcp-* IPC handlers (ADR-0128 §8).
 * Thin gateway over McpHost; renderer never receives secret plaintext.
 */

import { ipcMain } from 'electron'
import { mcpInvokeChannels } from '../../shared/mcp/ipc-contract'
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
    return host.updateConfig(record.config, expectedFingerprint)
  })

  ipcMain.handle(mcpInvokeChannels.testServer, async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const serverId = typeof record.serverId === 'string' ? record.serverId.trim() : ''
    if (!serverId) {
      return {
        ok: false as const,
        code: 'mcp_invalid_config' as const,
        message: 'serverId is required',
        serverId: ''
      }
    }
    return host.testServer(serverId)
  })

  ipcMain.handle(mcpInvokeChannels.listRuntime, async () => ({
    ok: true as const,
    servers: host.listRuntime()
  }))
}