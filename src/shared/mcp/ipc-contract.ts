/** MCP IPC channels (ADR-0128 §8) — registered with teaching IPC. */

import type { McpSecretInputChanges } from './types'

export const mcpInvokeChannels = {
  getConfig: 'teach:mcp-get-config',
  updateConfig: 'teach:mcp-update-config',
  testServer: 'teach:mcp-test-server',
  refreshServer: 'teach:mcp-refresh-server',
  authorizeServer: 'teach:mcp-authorize-server',
  revokeAuthorization: 'teach:mcp-revoke-authorization',
  listRuntime: 'teach:mcp-list-runtime',
  /** Opt-in discovery auto-connect (ADR-0137); never tools/call. */
  autoConnectNow: 'teach:mcp-auto-connect-now',
  /**
   * Secret-free multi-source effective view (ADR-0137 / ADR-0141).
   * Optional: Settings may omit when API missing (older preload).
   */
  getEffectiveView: 'teach:mcp-get-effective-view',
  /** Secret-free marketplace list (ADR-0140/0141). */
  marketplaceList: 'teach:mcp-marketplace-list',
  /** Install pin + merge user server; optional connect (never tool approval). */
  marketplaceInstall: 'teach:mcp-marketplace-install',
  /** Uninstall pin + remove matching user server. */
  marketplaceUninstall: 'teach:mcp-marketplace-uninstall',
  /** Persist optional remote catalog URLs (no fetch). */
  marketplaceSetCatalogUrls: 'teach:mcp-marketplace-set-catalog-urls',
  /** Fetch remote catalogs for configured URLs (fail-soft; no telemetry). */
  marketplaceRefreshCatalog: 'teach:mcp-marketplace-refresh-catalog'
} as const

export type McpInvokeChannel = (typeof mcpInvokeChannels)[keyof typeof mcpInvokeChannels]

export type McpUpdateConfigPayload = Readonly<{
  expectedFingerprint: string
  /** Full UserMcpConfigV1-shaped document. Secret fields contain transient markers only. */
  config: unknown
  /** Plaintext travels renderer → main only and is never echoed back. */
  secretChanges?: McpSecretInputChanges
}>

/**
 * Narrow, secret-free request for a user-initiated MCP inventory refresh.
 * This route intentionally has no tool name or tool arguments.
 */
export type McpRefreshServerPayload = Readonly<{
  serverId: string
  /** Active workspace used to enforce an explicit workspace-scoped server binding. */
  workspaceRoot?: string | null
}>

export type McpTestServerPayload = Readonly<{
  serverId: string
  /** Active workspace used to enforce an explicit workspace-scoped server binding. */
  workspaceRoot?: string | null
}>

/** Narrow, secret-free request for explicit OAuth authorization / revocation. */
export type McpAuthorizeServerPayload = Readonly<{
  serverId: string
  /** Active workspace used to enforce an explicit workspace-scoped server binding. */
  workspaceRoot?: string | null
}>

export type McpRevokeAuthorizationPayload = McpAuthorizeServerPayload

/** Explicit opt-in discovery-only auto-connect for eligible servers. */
export type McpAutoConnectNowPayload = Readonly<{
  workspaceRoot?: string | null
}>

/** Resolve multi-source effective view for Settings provenance UI. */
export type McpGetEffectiveViewPayload = Readonly<{
  workspaceRoot?: string | null
}>

/** Secret-free marketplace install request (ADR-0141). */
export type McpMarketplaceInstallPayload = Readonly<{
  entryId: string
  connect?: boolean
  workspaceRoot?: string | null
}>

export type McpMarketplaceUninstallPayload = Readonly<{
  entryId: string
}>

/** Secret-free catalog URL list (one URL per entry; main normalizes). */
export type McpMarketplaceSetCatalogUrlsPayload = Readonly<{
  catalogUrls: readonly string[]
}>

export type McpMarketplaceSetCatalogUrlsResult =
  | Readonly<{ ok: true; catalogUrls: readonly string[] }>
  | Readonly<{ ok: false; code: string; message: string }>

export type McpMarketplaceRefreshCatalogResult =
  | Readonly<{
      ok: true
      fetched: number
      merged: number
      errors: readonly string[]
      catalogUrls: readonly string[]
    }>
  | Readonly<{ ok: false; code: string; message: string }>
