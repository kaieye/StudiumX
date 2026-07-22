/**
 * Shared MCP wire DTOs, error codes, and pure helpers (ADR-0128).
 * Pure types only — no Node / Electron / FS.
 */

export const MCP_CONFIG_SCHEMA_VERSION = 1 as const

export const MCP_ERROR_CODES = {
  mcp_disabled: 'mcp_disabled',
  mcp_server_disabled: 'mcp_server_disabled',
  mcp_invalid_config: 'mcp_invalid_config',
  mcp_cas_conflict: 'mcp_cas_conflict',
  mcp_transport_unsupported: 'mcp_transport_unsupported',
  mcp_spawn_failed: 'mcp_spawn_failed',
  mcp_handshake_failed: 'mcp_handshake_failed',
  mcp_list_failed: 'mcp_list_failed',
  mcp_budget_exceeded: 'mcp_budget_exceeded',
  mcp_tool_not_registered: 'mcp_tool_not_registered',
  mcp_call_failed: 'mcp_call_failed',
  mcp_call_timeout: 'mcp_call_timeout',
  mcp_server_unavailable: 'mcp_server_unavailable',
  mcp_secret_unresolved: 'mcp_secret_unresolved',
  mcp_name_conflict: 'mcp_name_conflict'
} as const

export type McpErrorCode = (typeof MCP_ERROR_CODES)[keyof typeof MCP_ERROR_CODES]

/** Effect lattice for MCP tool overrides (same as ToolEffectClass). */
export type McpEffectClass = 'read' | 'workspace_write' | 'external_write' | 'privileged'

export type McpTransportKind = 'stdio' // Phase C may add 'sse' | 'http'

export type UserMcpServerV1 = Readonly<{
  id: string
  label: string
  enabled: boolean
  transport: McpTransportKind
  command: string | null
  args: readonly string[]
  cwd: string | null
  envSecretRefs: Readonly<Record<string, string>>
  envPlain: Readonly<Record<string, string>>
  url: string | null
  headersSecretRefs: Readonly<Record<string, string>>
  toolEffectOverrides: Readonly<Record<string, McpEffectClass>>
  createdAt: string
  updatedAt: string
}>

export type UserMcpConfigV1 = Readonly<{
  schemaVersion: typeof MCP_CONFIG_SCHEMA_VERSION
  enabled: boolean
  servers: readonly UserMcpServerV1[]
  /** CAS token; optional on empty default. */
  fingerprint?: string
}>

/** Secret-free view for renderer / doctor (no secret values). */
export type UserMcpServerPublicV1 = Readonly<{
  id: string
  label: string
  enabled: boolean
  transport: McpTransportKind
  command: string | null
  args: readonly string[]
  cwd: string | null
  envSecretConfigured: Readonly<Record<string, boolean>>
  envPlainKeys: readonly string[]
  url: string | null
  headersSecretConfigured: Readonly<Record<string, boolean>>
  toolEffectOverrides: Readonly<Record<string, McpEffectClass>>
  createdAt: string
  updatedAt: string
}>

export type UserMcpConfigPublicV1 = Readonly<{
  schemaVersion: typeof MCP_CONFIG_SCHEMA_VERSION
  enabled: boolean
  servers: readonly UserMcpServerPublicV1[]
  fingerprint: string
}>

export type McpRuntimeServerState =
  | 'disabled'
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'

export type McpRuntimeServerView = Readonly<{
  id: string
  state: McpRuntimeServerState
  errorCode?: McpErrorCode
  toolCount?: number
  lastErrorMessage?: string
}>

export type McpListedToolSummary = Readonly<{
  name: string
  registeredName: string
  description: string
  descriptionTruncated: boolean
  effectClass: McpEffectClass
  registered: boolean
  rejectReason?: McpErrorCode | string
}>

export type McpTestServerResult =
  | Readonly<{
      ok: true
      tools: readonly McpListedToolSummary[]
      serverId: string
    }>
  | Readonly<{
      ok: false
      code: McpErrorCode
      message: string
      serverId: string
    }>

export type McpErrorResult = Readonly<{
  ok: false
  code: McpErrorCode
  message: string
}>

export type McpConfigUpdateResult =
  | Readonly<{ ok: true; config: UserMcpConfigPublicV1 }>
  | McpErrorResult

export type McpGetConfigResult =
  | Readonly<{ ok: true; config: UserMcpConfigPublicV1 }>
  | McpErrorResult

/** Budget defaults (ADR-0128 §5.3). */
export const MCP_BUDGETS = {
  maxToolsPerServer: 64,
  maxGlobalTools: 128,
  maxDescriptionChars: 4 * 1024,
  maxToolSchemaBytes: 32 * 1024,
  maxGlobalSchemaBytes: 256 * 1024,
  initializeTimeoutMs: 30_000,
  listTimeoutMs: 30_000,
  callTimeoutMs: 60_000
} as const

export const MCP_USER_MESSAGES: Readonly<Record<McpErrorCode, string>> = {
  mcp_disabled: 'MCP 总开关已关闭。',
  mcp_server_disabled: '该 MCP 服务器未启用。',
  mcp_invalid_config: 'MCP 配置无效。',
  mcp_cas_conflict: 'MCP 配置已被其他写入更新，请刷新后重试。',
  mcp_transport_unsupported: '当前版本不支持该 MCP 传输类型。',
  mcp_spawn_failed: '无法启动 MCP 服务器进程。',
  mcp_handshake_failed: 'MCP 握手失败。',
  mcp_list_failed: '无法列出 MCP 工具。',
  mcp_budget_exceeded: 'MCP 工具数量或 schema 超出预算。',
  mcp_tool_not_registered: '该 MCP 工具未注册。',
  mcp_call_failed: 'MCP 工具调用失败。',
  mcp_call_timeout: 'MCP 工具调用超时。',
  mcp_server_unavailable: 'MCP 服务器不可用或已断开。',
  mcp_secret_unresolved: '无法解析 MCP 密钥引用。',
  mcp_name_conflict: 'MCP 工具名与内建工具冲突。'
}

export function mcpUserMessage(code: McpErrorCode): string {
  return MCP_USER_MESSAGES[code] ?? 'MCP 操作失败。'
}
