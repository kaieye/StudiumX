/**
 * Shared MCP wire DTOs, error codes, and pure helpers (ADR-0013).
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
  mcp_name_conflict: 'mcp_name_conflict',
  mcp_oauth_unsupported: 'mcp_oauth_unsupported',
  mcp_oauth_not_configured: 'mcp_oauth_not_configured',
  mcp_oauth_in_progress: 'mcp_oauth_in_progress',
  mcp_oauth_authorization_required: 'mcp_oauth_authorization_required',
  mcp_oauth_authorization_failed: 'mcp_oauth_authorization_failed',
  mcp_oauth_token_unavailable: 'mcp_oauth_token_unavailable',
  mcp_oauth_conflict: 'mcp_oauth_conflict'
} as const

export type McpErrorCode = (typeof MCP_ERROR_CODES)[keyof typeof MCP_ERROR_CODES]

/** Effect lattice for MCP tool overrides (same as ToolEffectClass). */
export type McpEffectClass = 'read' | 'workspace_write' | 'external_write' | 'privileged'

export type McpTransportKind = 'stdio' | 'http' | 'sse'
export type McpServerScope = 'user' | 'workspace'

/**
 * Explicit user grant for appending the active workspace root to stdio args
 * (ADR-0013). Default is always off — never inject without grant.
 */
export type McpWorkspaceRootInjection = 'off' | 'granted'

/**
 * User-selected identity label for injection policy / future allowlists.
 * Does not authorize injection by itself (grant required).
 */
export type McpInjectionIdentity = 'filesystem_mcp' | 'generic'

/**
 * Secret-free OAuth public configuration for an HTTP/SSE MCP server.
 * Tokens, client secrets, and redirect URLs never live here.
 */
export type UserMcpServerOAuthConfigV1 = Readonly<{
  /** Authorization endpoint (https preferred; http allowed for local tooling). */
  authorizationEndpoint: string
  /** Token endpoint used for code exchange / optional refresh. */
  tokenEndpoint: string
  /** Public OAuth client identifier. Client secrets are not supported. */
  clientId: string
  /** Optional space-delimited scopes requested at authorization time. */
  scopes: readonly string[]
  /** Optional OAuth resource / audience binding. */
  resource: string | null
}>

/** Renderer-visible placeholder for a configured secret whose plaintext stays in main. */
export const MCP_SECRET_CONFIGURED_PLACEHOLDER = '<configured>' as const
/** Transient ref markers accepted only on renderer → main config updates. */
export const MCP_SECRET_REF_KEEP = 'mcp-secret:keep' as const
export const MCP_SECRET_REF_PENDING = 'mcp-secret:pending' as const

/** Plaintext secret values travel renderer → main only and are never echoed back. */
export type McpSecretInputChanges = Readonly<
  Record<
    string,
    Readonly<{
      env?: Readonly<Record<string, string>>
      headers?: Readonly<Record<string, string>>
    }>
  >
>

export type UserMcpServerV1 = Readonly<{
  id: string
  label: string
  enabled: boolean
  scope: McpServerScope
  /** Explicit user-approved workspace binding; config remains stored in userData. */
  workspaceRoot: string | null
  transport: McpTransportKind
  command: string | null
  args: readonly string[]
  cwd: string | null
  envSecretRefs: Readonly<Record<string, string>>
  envPlain: Readonly<Record<string, string>>
  url: string | null
  headersSecretRefs: Readonly<Record<string, string>>
  headersPlain: Readonly<Record<string, string>>
  timeoutMs: number | null
  toolEffectOverrides: Readonly<Record<string, McpEffectClass>>
  /** Secret-free OAuth public config; null when OAuth is not configured. */
  oauth: UserMcpServerOAuthConfigV1 | null
  /**
   * Explicit grant to inject the active workspace root into stdio args (ADR-0013).
   * Default `'off'`. Never inferred from command/label fuzzy match.
   */
  workspaceRootInjection: McpWorkspaceRootInjection
  /**
   * Optional user-selected identity for policy surfaces; null when unset.
   * Not sufficient for injection without `workspaceRootInjection: 'granted'`.
   */
  injectionIdentity: McpInjectionIdentity | null
  createdAt: string
  updatedAt: string
}>

export type UserMcpConfigV1 = Readonly<{
  schemaVersion: typeof MCP_CONFIG_SCHEMA_VERSION
  enabled: boolean
  /**
   * Smart-connect preference (ADR-0013).
   * When omitted and `enabled` is true, effective auto-connect is true
   * (`enabled && autoConnect !== false`). Explicit `false` disables discovery.
   * Never tools/call by itself.
   */
  autoConnect?: boolean
  /**
   * When true, tools/list remote `readOnlyHint` (without `destructiveHint`) may
   * map to effect `read` after explicit overrides (ADR-0013). Default/omit false.
   * Never a YOLO / skip-permission switch.
   */
  honorRemoteReadOnlyHint?: boolean
  servers: readonly UserMcpServerV1[]
  /** CAS token; optional on empty default. */
  fingerprint?: string
}>

/** Secret-free view for renderer / doctor (no secret values). */
export type UserMcpServerPublicV1 = Readonly<{
  id: string
  label: string
  enabled: boolean
  scope: McpServerScope
  workspaceRoot: string | null
  transport: McpTransportKind
  command: string | null
  args: readonly string[]
  cwd: string | null
  envSecretConfigured: Readonly<Record<string, boolean>>
  envPlain: Readonly<Record<string, string>>
  envPlainKeys: readonly string[]
  url: string | null
  headersSecretConfigured: Readonly<Record<string, boolean>>
  headersPlain: Readonly<Record<string, string>>
  timeoutMs: number | null
  toolEffectOverrides: Readonly<Record<string, McpEffectClass>>
  /** Secret-free OAuth public config projection. */
  oauth: UserMcpServerOAuthConfigV1 | null
  /** Secret-free Phase F grant (default off). */
  workspaceRootInjection: McpWorkspaceRootInjection
  /** Secret-free optional injection identity label. */
  injectionIdentity: McpInjectionIdentity | null
  createdAt: string
  updatedAt: string
}>

export type UserMcpConfigPublicV1 = Readonly<{
  schemaVersion: typeof MCP_CONFIG_SCHEMA_VERSION
  enabled: boolean
  /**
   * Projected effective preference (ADR-0013):
   * `enabled && durable.autoConnect !== false` (omit means on when root enabled).
   */
  autoConnect: boolean
  /**
   * Explicit user policy: trust remote readOnlyHint for effect mapping.
   * Always projected as boolean (default false).
   */
  honorRemoteReadOnlyHint: boolean
  servers: readonly UserMcpServerPublicV1[]
  fingerprint: string
}>

/**
 * Secret-free public lifecycle state for one configured MCP server.
 *
 * `error` remains as the legacy terminal-state spelling for compatibility.
 * New runtime code should use `failed` for a non-reusable failed attempt and
 * `disconnected` when a previously live transport is lost. `retry_wait` is
 * diagnostic only: it never authorizes background reconnects by itself.
 */
export type McpRuntimeServerState =
  | 'disabled'
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'retry_wait'
  | 'failed'
  | 'error'

/**
 * Aggregate-only tools inventory diagnostics for a server's current session.
 * These counters intentionally exclude tool names, schemas, cursors, and any
 * server-supplied payload. A stale inventory remains safe for status display,
 * but must not mutate a registry snapshot already attached to a run.
 */
export type McpRuntimeInventorySummary = Readonly<{
  /** Monotonically increasing per-process inventory replacement generation. */
  generation: number
  /** A `tools/list_changed` notification was received after this inventory. */
  stale: boolean
  /** Total tool descriptors discovered while materializing this inventory. */
  discoveredToolCount: number
  /** Descriptors admitted to this server inventory after local safety checks. */
  registeredToolCount: number
  /** Descriptors rejected by local safety/budget checks, aggregated only. */
  rejectedToolCount: number
}>

/**
 * Bounded retry status exposed only as local diagnostics.
 *
 * This is not a reconnect instruction. In Phase A callers may reconnect only
 * through an explicit refresh or a later run snapshot; no consumer may infer
 * permission to start an autonomous retry loop from this object.
 */
export type McpRuntimeRetryDiagnostics = Readonly<{
  /** Number of attempts already consumed by the bounded policy. */
  attemptCount: number
  /** Inclusive upper bound for that policy; zero means no retry is scheduled. */
  maxAttempts: number
  /** Optional local eligibility timestamp, never a remote server value. */
  retryAt?: string
}>

/**
 * Secret-free, bounded connection/refresh metadata for status surfaces.
 * Timestamps are local ISO-8601 values; no URL, command, header, env, cursor,
 * error payload, or secret reference belongs here.
 */
export type McpRuntimeRefreshDiagnostics = Readonly<{
  /** Explicit or next-run inventory refresh attempts for the current session. */
  refreshCount: number
  lastRefreshAt?: string
  lastSuccessfulRefreshAt?: string
  retry?: McpRuntimeRetryDiagnostics
}>

/**
 * Renderer/Doctor-safe runtime projection. All Phase A additions are optional
 * so persisted/test callers producing the ADR-0013 v1 shape remain compatible.
 */
export type McpRuntimeServerView = Readonly<{
  id: string
  state: McpRuntimeServerState
  errorCode?: McpErrorCode
  toolCount?: number
  /** Must be locally sanitized and bounded before this public projection. */
  lastErrorMessage?: string
  inventory?: McpRuntimeInventorySummary
  refresh?: McpRuntimeRefreshDiagnostics
  /**
   * Secret-free OAuth authorization projection for this server. Distinct from
   * transport `state` so connection health and authorization lifecycle never
   * collapse into a single ambiguous status.
   */
  authorization?: import('./oauth-types').McpOAuthAuthorizationPublicState
  /**
   * Count of bounded local transport diagnostics (stderr/handshake ring).
   * Never includes env, tokens, or full command lines.
   */
  diagnosticsLineCount?: number
  /**
   * Optional last few redacted diagnostic lines for Settings/Doctor (max 3 × 120 chars).
   * Prefer `diagnosticsLineCount` alone when UI only needs a badge.
   */
  diagnosticsLines?: readonly string[]
}>

/**
 * Secret-free MCP protocol annotations retained for UI / audit / diagnostics.
 * Independent of `effectClass` (overrides + fail-closed privileged default).
 * Remote readOnlyHint MUST NOT auto-downgrade effect (ADR-0013).
 */
export type McpRemoteToolAnnotationsSummary = Readonly<{
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}>

export type McpListedToolSummary = Readonly<{
  name: string
  registeredName: string
  description: string
  descriptionTruncated: boolean
  effectClass: McpEffectClass
  registered: boolean
  rejectReason?: McpErrorCode | string
  /** Display/audit only — never used as effect authority. */
  annotations?: McpRemoteToolAnnotationsSummary
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

/** Budget and reconnect defaults (ADR-0013). */
export const MCP_BUDGETS = {
  maxToolsPerServer: 64,
  maxGlobalTools: 128,
  maxDescriptionChars: 4 * 1024,
  maxToolSchemaBytes: 32 * 1024,
  maxGlobalSchemaBytes: 256 * 1024,
  initializeTimeoutMs: 30_000,
  listTimeoutMs: 30_000,
  callTimeoutMs: 60_000,
  /** Max autonomous reconnect attempts after transport close/error (never tools/call). */
  reconnectMaxAttempts: 2,
  /** Backoff delays (ms) per reconnect attempt index (0-based). */
  reconnectBackoffMs: [500, 1500] as const
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
  mcp_name_conflict: 'MCP 工具名与内建工具冲突。',
  mcp_oauth_unsupported: '该 MCP 传输不支持 OAuth 授权。',
  mcp_oauth_not_configured: '该 MCP 服务器未配置 OAuth。',
  mcp_oauth_in_progress: 'MCP OAuth 授权正在进行中。',
  mcp_oauth_authorization_required: '需要先完成 MCP OAuth 授权。',
  mcp_oauth_authorization_failed: 'MCP OAuth 授权失败。',
  mcp_oauth_token_unavailable: '无法使用已存储的 MCP OAuth 凭据。',
  mcp_oauth_conflict: '该 MCP 服务器不能同时使用静态 Authorization 头与 OAuth。'
}

export function mcpUserMessage(code: McpErrorCode): string {
  return MCP_USER_MESSAGES[code] ?? 'MCP 操作失败。'
}
