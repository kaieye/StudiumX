/**
 * MCP IPC channels (ADR-0128 §8) — teach:mcp-* prefix, registered with teaching IPC.
 */

export const mcpInvokeChannels = {
  getConfig: 'teach:mcp-get-config',
  updateConfig: 'teach:mcp-update-config',
  testServer: 'teach:mcp-test-server',
  listRuntime: 'teach:mcp-list-runtime'
} as const

export type McpInvokeChannel = (typeof mcpInvokeChannels)[keyof typeof mcpInvokeChannels]

export type McpUpdateConfigPayload = Readonly<{
  expectedFingerprint: string
  /** Full UserMcpConfigV1-shaped document (secret refs only; no secret plaintext). */
  config: unknown
}>

export type McpTestServerPayload = Readonly<{
  serverId: string
}>