/** MCP IPC channels (ADR-0128 §8) — registered with teaching IPC. */

import type { McpSecretInputChanges } from './types'

export const mcpInvokeChannels = {
  getConfig: 'teach:mcp-get-config',
  updateConfig: 'teach:mcp-update-config',
  testServer: 'teach:mcp-test-server',
  listRuntime: 'teach:mcp-list-runtime'
} as const

export type McpInvokeChannel = (typeof mcpInvokeChannels)[keyof typeof mcpInvokeChannels]

export type McpUpdateConfigPayload = Readonly<{
  expectedFingerprint: string
  /** Full UserMcpConfigV1-shaped document. Secret fields contain transient markers only. */
  config: unknown
  /** Plaintext travels renderer → main only and is never echoed back. */
  secretChanges?: McpSecretInputChanges
}>

export type McpTestServerPayload = Readonly<{
  serverId: string
  /** Active workspace used to enforce an explicit workspace-scoped server binding. */
  workspaceRoot?: string | null
}>
