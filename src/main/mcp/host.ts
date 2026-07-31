/**
 * Composition-root MCP host: config store + session manager (ADR-0128 + ADR-0137).
 * Default-off; auto-connect only via autoConnectNow when user gate enables it.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { McpConfigStore } from './config-store'
import { createLocalMcpArtifactWriter } from './artifact-writer'
import { createMcpTraceStore } from './trace-store'
import {
  createMemoryMcpSecretEnv,
  createSafeStorageMcpSecretEnv,
  type McpSecretEnvResolver,
  type McpSecretStorage
} from './secret-env'
import { McpSessionManager } from './session-manager'
import {
  McpOAuthAuthorizationManager,
  type McpOAuthAuthorizeResult,
  type McpOAuthCallbackHandleResult
} from './oauth-authorization-manager'
import { McpOAuthTokenStore } from './oauth-token-store'
import {
  resolveEffectiveMcpConfig,
  type LoadMcpSourceLayersOptions
} from './source-loaders'
import { PluginMcpRegistry } from './plugin-mcp-registry'
import { bootstrapPluginMcpFromFilesystem } from './plugin-mcp-bootstrap'
import { McpMarketplaceStore } from './marketplace-store'
import {
  autoConnectEligibleServers,
  buildUserMcpServerFromMarketplaceEntry,
  effectiveViewToUserConfigShape,
  fingerprintUserMcpConfig,
  projectMcpEffectiveViewPublic,
  type McpEffectiveConfigViewV1,
  type McpGetEffectiveViewResult,
  type McpMarketplaceInstallResultV1,
  type McpMarketplaceListResultV1,
  type McpMarketplaceUninstallResultV1
} from '../../shared/mcp'
import { staticTeachingToolNameSet } from '../../shared/mcp/static-tool-names'
import type { McpSettingsOp } from '../../shared/mcp/mcp-ops'
import {
  MCP_ERROR_CODES,
  mcpUserMessage,
  type McpConfigUpdateResult,
  type McpGetConfigResult,
  type McpRuntimeServerView,
  type McpSecretInputChanges,
  type McpTestServerResult,
  type UserMcpConfigV1,
  type UserMcpServerV1
} from '../../shared/mcp/types'

export type McpHostOptions = {
  userDataPath: string
  secretStorage?: McpSecretStorage | null
  /** Test-only secret resolver override. */
  secrets?: McpSecretEnvResolver
  /** Test-only session manager options. */
  sessionManager?: McpSessionManager
  /** Open the browser for OAuth authorization (main-only). */
  openExternal?: (url: string) => Promise<void>
  /** Optional fetch override for OAuth token exchange (tests). */
  fetchImpl?: typeof fetch
  /**
   * Extra plugin/extension roots for filesystem MCP bootstrap (ADR-0139/0141).
   * Missing paths are ignored (fail-soft).
   */
  pluginScanRoots?: readonly string[]
  /** When false, skip filesystem plugin MCP bootstrap on start (tests). Default true. */
  bootstrapPluginMcp?: boolean
  /**
   * Optional process-session CLI MCP servers (highest source precedence).
   * When omitted, loaders may still read `STUDIUMX_MCP_CLI_JSON` from the environment.
   */
  cliServers?: readonly UserMcpServerV1[]
}

export class McpHost {
  readonly configStore: McpConfigStore
  readonly sessionManager: McpSessionManager
  /** Phase G in-memory plugin MCP registry (no remote install). */
  readonly pluginRegistry: PluginMcpRegistry
  /** Phase H local marketplace catalog/store (no phone-home). */
  readonly marketplaceStore: McpMarketplaceStore
  private readonly secrets: McpSecretEnvResolver
  private readonly encryptedIndex = new Map<string, string>()
  private readonly oauthTokenIndex = new Map<string, string>()
  private readonly secretIndexPath: string
  private readonly oauthTokenIndexPath: string
  private readonly durableSecretIndex: boolean
  private readonly durableOAuthTokenIndex: boolean
  private readonly oauth: McpOAuthAuthorizationManager
  private readonly userDataPath: string
  private readonly pluginScanRoots: readonly string[]
  private readonly bootstrapPluginMcpOnStart: boolean
  private cliServers: readonly UserMcpServerV1[] | undefined
  private disposed = false
  private lastEffectiveView: McpEffectiveConfigViewV1 | null = null
  private lastWorkspaceRoot: string | null = null
  /** Last known marketplace emergency flag for secret-free Doctor aggregates. */
  private lastMarketplaceEmergencyDisabled: boolean | null = null
  /** Current StudiumX user access token (set from renderer via IPC). */
  private studiumxAccessToken: string | null = null

  constructor(options: McpHostOptions) {
    this.userDataPath = options.userDataPath
    this.pluginScanRoots = options.pluginScanRoots ?? []
    this.bootstrapPluginMcpOnStart = options.bootstrapPluginMcp !== false
    this.cliServers = options.cliServers
    this.secretIndexPath = join(options.userDataPath, 'mcp/secrets.v1.json')
    this.oauthTokenIndexPath = join(options.userDataPath, 'mcp/oauth-tokens.v1.json')
    this.durableSecretIndex = Boolean(!options.secrets && options.secretStorage)
    this.durableOAuthTokenIndex = Boolean(options.secretStorage)
    this.secrets =
      options.secrets ??
      (options.secretStorage
        ? createSafeStorageMcpSecretEnv({
            storage: options.secretStorage,
            encryptedIndex: this.encryptedIndex,
            flush: () => this.writeEncryptedSecretIndex()
          })
        : createMemoryMcpSecretEnv())
    this.configStore = new McpConfigStore({
      userDataPath: options.userDataPath,
      secrets: this.secrets
    })

    const tokenCipher = options.secretStorage
      ? {
          isEncryptionAvailable: () => options.secretStorage!.isEncryptionAvailable(),
          encryptString: (value: string) => options.secretStorage!.encryptString(value),
          decryptString: (value: Buffer) => options.secretStorage!.decryptString(value)
        }
      : createMemoryTokenCipher()

    const tokenStore = new McpOAuthTokenStore({
      cipher: tokenCipher,
      encryptedIndex: this.oauthTokenIndex
    })

    this.oauth = new McpOAuthAuthorizationManager({
      tokenStore,
      openExternal:
        options.openExternal ??
        (async () => {
          throw new Error('MCP OAuth openExternal is not configured')
        }),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    })
    this.oauth.setServerResolver((serverId) => this.lookupServerSync(serverId))

    this.sessionManager =
      options.sessionManager ??
      new McpSessionManager({
        secrets: this.secrets,
        staticToolNames: staticTeachingToolNameSet(),
        // App-managed root only: MCP results never gain workspace filesystem authority.
        artifactWriter: createLocalMcpArtifactWriter({
          rootPath: join(options.userDataPath, 'mcp/artifacts')
        }),
        // Bounded, main-process-only metadata diagnostics. It has no IPC,
        // persistence, telemetry, or settlement authority.
        traceStore: createMcpTraceStore(),
        resolveAuthorizationHeader: (server) => this.resolveAuthorizationHeader(server),
        resolveStudiumxAuthHeader: () => this.resolveStudiumxAuthHeader(),
        getAuthorizationPublicState: (serverId) => this.oauth.getPublicState(serverId)
      })

    this.pluginRegistry = new PluginMcpRegistry({
      dropSessions: (serverIds) => {
        for (const id of serverIds) {
          void this.sessionManager.invalidateServer(id)
        }
      },
      forgetTokens: (serverIds) => {
        for (const id of serverIds) {
          void this.oauth.revokeAuthorization(id).catch(() => undefined)
        }
      }
    })

    this.marketplaceStore = new McpMarketplaceStore({
      userDataPath: options.userDataPath,
      cleanup: {
        onUninstall: (entryId) => {
          void this.sessionManager.invalidateServer(entryId)
          // When marketplace entryId equals a registered pluginId, drop plugin MCP layer.
          void this.pluginRegistry.unregisterPlugin(entryId).catch(() => undefined)
        },
        onRevoke: (input) => {
          if (input.entryId) {
            void this.sessionManager.invalidateServer(input.entryId)
            void this.pluginRegistry.revokePlugin(input.entryId).catch(() => undefined)
          }
        },
        onEmergencyDisable: () => {
          // Drop live sessions without disposing the manager permanently.
          void this.applyEffectiveConfig(this.lastWorkspaceRoot).catch(() => undefined)
        }
      }
    })
  }

  async start(): Promise<void> {
    await this.loadEncryptedSecretIndex()
    await this.loadEncryptedOAuthTokenIndex()
    // Best-effort marketplace load (creates empty doc if missing).
    await this.marketplaceStore.load().catch(() => undefined)
    // ADR-0139/0141: fail-soft scan of local/builtin plugin MCP manifests.
    if (this.bootstrapPluginMcpOnStart) {
      await this.bootstrapPluginMcpFromDisk().catch(() => undefined)
    }
    // Prefer multi-source effective config so trusted plugin layer participates.
    const view = await this.applyEffectiveConfig(this.lastWorkspaceRoot).catch(async () => {
      const config = await this.configStore.load()
      await this.sessionManager.applyConfig(config)
      return null
    })
    // ADR-0141: cold-start smart-connect when effective autoConnect (no workspace root ok).
    if (view?.enabled && view.autoConnect) {
      await this.autoConnectNow(this.lastWorkspaceRoot).catch(() => undefined)
    }
  }

  /**
   * Scan known plugin roots and register mcpServers into pluginRegistry.
   * Safe to call after install or when extension roots change.
   */
  async bootstrapPluginMcpFromDisk(
    extraRoots?: readonly string[]
  ): Promise<Awaited<ReturnType<typeof bootstrapPluginMcpFromFilesystem>>> {
    return bootstrapPluginMcpFromFilesystem({
      registry: this.pluginRegistry,
      userDataPath: this.userDataPath,
      scanRoots: [...this.pluginScanRoots, ...(extraRoots ?? [])]
    })
  }

  /**
   * Uninstall/revoke surface when a product plugin id is removed.
   * No full Extension install API exists yet — callers may invoke this from
   * marketplace uninstall or future extension uninstall hooks.
   */
  async unregisterPluginMcp(pluginId: string): Promise<readonly string[]> {
    return this.pluginRegistry.unregisterPlugin(pluginId)
  }

  async getPublicConfig(): Promise<McpGetConfigResult> {
    return this.configStore.getPublic()
  }

  /**
   * Live Settings getter: current store projection (not a turn-level snapshot).
   * Secret-free public DTO only.
   */
  async getMcpSettings(): Promise<McpGetConfigResult> {
    return this.configStore.getMcpSettings()
  }

  async updateConfig(
    nextDocument: unknown,
    expectedFingerprint: string,
    secretChanges?: McpSecretInputChanges
  ): Promise<McpConfigUpdateResult> {
    const result = await this.configStore.update(nextDocument, expectedFingerprint, secretChanges)
    if (result.ok) {
      // Re-resolve multi-source effective view so workspace/plugin layers stay visible.
      await this.applyEffectiveConfig(this.lastWorkspaceRoot)
    }
    return result
  }

  /**
   * CAS apply of pure id-level ops (worth-learning §3.3). Prefer over whole-document
   * updateConfig when Settings mutates individual servers concurrently.
   */
  async applyMcpOps(
    ops: readonly McpSettingsOp[],
    expectedFingerprint: string,
    secretChanges?: McpSecretInputChanges
  ): Promise<McpConfigUpdateResult> {
    const result = await this.configStore.applyOps(ops, expectedFingerprint, secretChanges)
    if (result.ok) {
      await this.applyEffectiveConfig(this.lastWorkspaceRoot)
    }
    return result
  }

  async testServer(serverId: string, workspaceRoot?: string | null): Promise<McpTestServerResult> {
    await this.applyEffectiveConfig(workspaceRoot ?? this.lastWorkspaceRoot)
    return this.sessionManager.testServer(serverId, workspaceRoot ?? undefined)
  }

  /**
   * Explicit, user-initiated inventory refresh. This is deliberately narrower
   * than MCP tool invocation: it only reconnects and re-lists one configured server.
   */
  async refreshServer(serverId: string, workspaceRoot?: string | null): Promise<McpTestServerResult> {
    await this.applyEffectiveConfig(workspaceRoot ?? this.lastWorkspaceRoot)
    return this.sessionManager.refreshServer(serverId, workspaceRoot ?? undefined)
  }

  /**
   * Explicit user-initiated OAuth authorization. Opens the provider once and
   * returns only a secret-free public state projection.
   */
  async authorizeServer(
    serverId: string,
    workspaceRoot?: string | null
  ): Promise<McpOAuthAuthorizeResult> {
    const view = await this.applyEffectiveConfig(workspaceRoot ?? this.lastWorkspaceRoot)
    const effectiveServers = view.effectiveServers.map((entry) => entry.server)
    const durable = await this.configStore.load()
    const configForGate: UserMcpConfigV1 = {
      schemaVersion: 1,
      enabled: view.enabled,
      autoConnect: view.autoConnect,
      servers: effectiveServers.length > 0 ? effectiveServers : durable.servers,
      fingerprint: durable.fingerprint
    }
    const gated = this.gateServerForAuthorization(configForGate, serverId, workspaceRoot)
    if (!gated.ok) return gated.result
    return this.oauth.authorizeServer(serverId)
  }

  async revokeAuthorization(
    serverId: string,
    _workspaceRoot?: string | null
  ): Promise<McpOAuthAuthorizeResult> {
    const result = await this.oauth.revokeAuthorization(serverId)
    await this.writeEncryptedOAuthTokenIndex().catch(() => undefined)
    await this.sessionManager.invalidateServer(
      serverId,
      MCP_ERROR_CODES.mcp_oauth_authorization_required
    )
    return result
  }

  async handleOAuthCallback(deepLink: string): Promise<McpOAuthCallbackHandleResult> {
    const result = await this.oauth.handleCallback(deepLink)
    if (result.ok && result.handled) {
      await this.writeEncryptedOAuthTokenIndex().catch(() => undefined)
      // Drop any stale connected session so the next explicit refresh/test uses
      // the newly stored bearer token without exposing secret material.
      await this.sessionManager.invalidateServer(result.authorization.serverId)
    } else if (!result.ok && result.authorization) {
      await this.sessionManager.invalidateServer(
        result.authorization.serverId,
        MCP_ERROR_CODES.mcp_oauth_authorization_failed
      )
    }
    return result
  }

  listRuntime(): readonly McpRuntimeServerView[] {
    return this.sessionManager.getRuntimeView()
  }

  /**
   * Secret-free multi-source / marketplace aggregates for Doctor (counts/flags only).
   * Omits fields when applyEffectiveConfig has not populated a view yet.
   */
  getDoctorHostAggregates(): {
    effectiveSourceCount?: number
    sourceWarningCount?: number
    marketplaceEmergencyDisabled?: boolean
  } {
    const out: {
      effectiveSourceCount?: number
      sourceWarningCount?: number
      marketplaceEmergencyDisabled?: boolean
    } = {}
    const view = this.lastEffectiveView
    if (view) {
      const kinds = new Set(view.effectiveServers.map((entry) => entry.source.kind))
      out.effectiveSourceCount = kinds.size
      out.sourceWarningCount = Math.min(view.warnings.length, 64)
    }
    if (typeof this.lastMarketplaceEmergencyDisabled === 'boolean') {
      out.marketplaceEmergencyDisabled = this.lastMarketplaceEmergencyDisabled
    }
    return out
  }

  /** Expose manager for agent-run registry inject. */
  getSessionManager(): McpSessionManager {
    return this.sessionManager
  }

  async reloadFromDisk(): Promise<UserMcpConfigV1> {
    this.configStore.invalidateCache()
    const config = await this.configStore.load()
    await this.sessionManager.applyConfig(config)
    return config
  }

  /**
   * Resolve multi-source effective config and apply winners to the session manager.
   * When no external layers load, behavior matches user-only config (pre-Phase-E).
   * Does not auto-connect unless `autoConnectNow` is called separately.
   */
  async applyEffectiveConfig(
    workspaceRoot?: string | null,
    loadOptions: Omit<LoadMcpSourceLayersOptions, 'workspaceRoot'> = {}
  ): Promise<McpEffectiveConfigViewV1> {
    const userConfig = await this.configStore.load()
    const pluginServers =
      loadOptions.pluginServers ?? this.pluginRegistry.toPluginSourceServers()
    // Emergency marketplace disable: do not surface plugin layer as connectable.
    let pluginLayer = pluginServers
    try {
      const market = await this.marketplaceStore.load()
      this.lastMarketplaceEmergencyDisabled = market.emergencyDisabled === true
      if (market.emergencyDisabled) pluginLayer = []
    } catch {
      // ignore marketplace read failures
    }
    const view = await resolveEffectiveMcpConfig(userConfig, {
      ...loadOptions,
      ...(loadOptions.cliServers === undefined && this.cliServers !== undefined
        ? { cliServers: this.cliServers }
        : {}),
      pluginServers: pluginLayer,
      workspaceRoot: workspaceRoot ?? this.lastWorkspaceRoot
    })
    this.lastEffectiveView = view
    if (workspaceRoot != null && workspaceRoot.trim()) {
      this.lastWorkspaceRoot = workspaceRoot.trim()
    }
    const shape = effectiveViewToUserConfigShape(view, userConfig.fingerprint)
    await this.sessionManager.applyConfig(shape)
    return view
  }

  /**
   * Prepare multi-source config for an agent run / workspace context.
   * When autoConnect is enabled, performs discovery-only connect for eligible servers.
   */
  async prepareForWorkspace(workspaceRoot?: string | null): Promise<McpEffectiveConfigViewV1> {
    const view = await this.applyEffectiveConfig(workspaceRoot)
    if (view.enabled && view.autoConnect) {
      await this.autoConnectNow(workspaceRoot)
      // autoConnectNow re-applies; return latest view
      return this.lastEffectiveView ?? view
    }
    return view
  }

  getLastEffectiveView(): McpEffectiveConfigViewV1 | null {
    return this.lastEffectiveView
  }

  /**
   * Replace process-session CLI MCP servers (highest precedence) and re-resolve.
   * Pass null/empty to clear the host-level override (env STUDIUMX_MCP_CLI_JSON may still apply).
   */
  async setCliServers(
    servers: readonly UserMcpServerV1[] | null,
    workspaceRoot?: string | null
  ): Promise<McpEffectiveConfigViewV1> {
    this.cliServers = servers == null ? undefined : [...servers]
    // Empty array forces an empty CLI layer (hides env STUDIUMX_MCP_CLI_JSON for this resolve).
    // null clears host override so env CLI JSON can apply again.
    if (servers == null) {
      return this.applyEffectiveConfig(workspaceRoot ?? this.lastWorkspaceRoot)
    }
    return this.applyEffectiveConfig(workspaceRoot ?? this.lastWorkspaceRoot, {
      cliServers: servers
    })
  }

  /**
   * Secret-free multi-source projection for Settings (ADR-0137 / ADR-0141).
   * Optionally re-resolves with workspace root; never returns secrets/commands with tokens.
   */
  async getEffectiveViewPublic(
    workspaceRoot?: string | null
  ): Promise<McpGetEffectiveViewResult> {
    let view = this.lastEffectiveView
    if (
      workspaceRoot != null &&
      workspaceRoot.trim() &&
      workspaceRoot.trim() !== (this.lastWorkspaceRoot ?? '')
    ) {
      view = await this.applyEffectiveConfig(workspaceRoot)
    } else if (!view) {
      view = await this.applyEffectiveConfig(workspaceRoot ?? this.lastWorkspaceRoot)
    }
    return {
      ok: true as const,
      view: projectMcpEffectiveViewPublic(view, this.listRuntime())
    }
  }

  /**
   * Controlled auto-connect discovery (ADR-0137).
   * No-op when root disabled or autoConnect false.
   * Only initialize + tools/list via testServer; never tools/call.
   * No infinite retry; failures are recorded on runtime views.
   */
  async autoConnectNow(
    workspaceRoot?: string | null
  ): Promise<readonly McpTestServerResult[]> {
    const view = await this.applyEffectiveConfig(workspaceRoot)
    if (!view.enabled || !view.autoConnect) {
      return []
    }

    const eligible = autoConnectEligibleServers(view, {
      workspaceRoot: workspaceRoot ?? this.lastWorkspaceRoot,
      isOAuthReady: (server) => {
        if (!server.oauth || server.transport === 'stdio') return true
        const state = this.oauth.getPublicState(server.id)
        return state?.state === 'authorized'
      }
    })

    const results: McpTestServerResult[] = []
    for (const entry of eligible) {
      results.push(
        await this.sessionManager.testServer(
          entry.server.id,
          workspaceRoot ?? this.lastWorkspaceRoot ?? undefined
        )
      )
    }
    return results
  }


  /** Secret-free marketplace list for Settings UI (ADR-0140/0141). */
  async marketplaceList(): Promise<McpMarketplaceListResultV1> {
    const doc = await this.marketplaceStore.load()
    return {
      ok: true,
      catalog: doc.catalog,
      installs: doc.installs,
      emergencyDisabled: doc.emergencyDisabled,
      catalogUrls: doc.catalogUrls ?? []
    }
  }

  /**
   * Pin install + merge a UserMcpServer into user config (ADR-0141).
   * Optional connect via testServer. Never grants tool approval / YOLO.
   */
  async marketplaceInstallAndEnable(
    entryId: string,
    options?: Readonly<{ connect?: boolean; workspaceRoot?: string | null; trustActorLabel?: string }>
  ): Promise<McpMarketplaceInstallResultV1> {
    const pin = await this.marketplaceStore.recordInstall(entryId, {
      trustActorLabel: options?.trustActorLabel ?? 'user'
    })
    if (!pin.ok) {
      return { ok: false, code: pin.code, message: pin.message }
    }

    const entry = await this.marketplaceStore.getEntry(entryId)
    if (!entry) {
      return { ok: false, code: 'entry_not_found', message: 'catalog_entry_not_found' }
    }

    const now = new Date().toISOString()
    const built = buildUserMcpServerFromMarketplaceEntry(entry, now, {
      workspaceRoot: options?.workspaceRoot
    })
    if (!built.ok) {
      return { ok: false, code: 'invalid_entry', message: built.reason }
    }

    const current = await this.configStore.load()
    const servers = [
      ...current.servers.filter((s) => s.id !== built.server.id),
      built.server as UserMcpServerV1
    ]
    const nextDoc = {
      schemaVersion: 1 as const,
      enabled: true,
      autoConnect: current.autoConnect === true || options?.connect === true,
      servers
    }
    const expectedFingerprint = current.fingerprint ?? fingerprintUserMcpConfig(current)
    const updated = await this.configStore.update(nextDoc, expectedFingerprint)
    if (!updated.ok) {
      return { ok: false, code: updated.code, message: updated.message }
    }

    let connected: boolean | undefined
    let connectError: string | undefined
    if (options?.connect) {
      try {
        const test = await this.testServer(built.server.id, options.workspaceRoot)
        connected = test.ok
        if (!test.ok) connectError = test.message
      } catch (err) {
        connected = false
        connectError = err instanceof Error ? err.message : String(err)
      }
    }

    return {
      ok: true,
      install: pin.value,
      serverId: built.server.id,
      ...(connected !== undefined ? { connected } : {}),
      ...(connectError !== undefined ? { connectError } : {})
    }
  }

  /**
   * Remove install pin and drop matching user MCP server config (if present).
   */
  async marketplaceUninstall(entryId: string): Promise<McpMarketplaceUninstallResultV1> {
    const un = await this.marketplaceStore.uninstall(entryId)
    if (!un.ok) {
      return { ok: false, code: un.code, message: un.message }
    }
    try {
      const current = await this.configStore.load()
      if (current.servers.some((s) => s.id === entryId)) {
        const servers = current.servers.filter((s) => s.id !== entryId)
        const nextDoc = {
          schemaVersion: 1 as const,
          enabled: current.enabled,
          autoConnect: current.autoConnect === true,
          servers
        }
        const expectedFingerprint = current.fingerprint ?? fingerprintUserMcpConfig(current)
        await this.configStore.update(nextDoc, expectedFingerprint)
      }
    } catch {
      // best-effort config cleanup
    }
    return { ok: true, entryId }
  }

  async marketplaceEmergencyDisable(): Promise<
    | { ok: true; emergencyDisabled: true }
    | { ok: false; code: string; message: string }
  > {
    const result = await this.marketplaceStore.emergencyDisableAll()
    if (!result.ok) return { ok: false, code: result.code, message: result.message }
    return { ok: true, emergencyDisabled: true }
  }

  /** Persist remote catalog URLs only (no network). */
  async marketplaceSetCatalogUrls(
    urls: readonly string[]
  ): Promise<
    | { ok: true; catalogUrls: readonly string[] }
    | { ok: false; code: string; message: string }
  > {
    const result = await this.marketplaceStore.setCatalogUrls(urls)
    if (!result.ok) return { ok: false, code: result.code, message: result.message }
    return { ok: true, catalogUrls: result.value }
  }

  /**
   * Fetch/merge remote catalogs for configured URLs (fail-soft).
   * Never product telemetry. Returns secret-free counters + current URLs.
   */
  async marketplaceRefreshCatalog(): Promise<
    | {
        ok: true
        fetched: number
        merged: number
        errors: readonly string[]
        catalogUrls: readonly string[]
      }
    | { ok: false; code: string; message: string }
  > {
    const result = await this.marketplaceStore.refreshRemoteCatalog()
    if (!result.ok) return { ok: false, code: result.code, message: result.message }
    const catalogUrls = await this.marketplaceStore.getCatalogUrls()
    return {
      ok: true,
      fetched: result.value.fetched,
      merged: result.value.merged,
      errors: result.value.errors,
      catalogUrls
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.sessionManager.dispose()
  }

  private gateServerForAuthorization(
    config: UserMcpConfigV1,
    serverId: string,
    workspaceRoot?: string | null
  ):
    | { ok: true; server: UserMcpServerV1 }
    | { ok: false; result: Extract<McpOAuthAuthorizeResult, { ok: false }> } {
    const server = config.servers.find((candidate) => candidate.id === serverId)
    if (!server) {
      return {
        ok: false,
        result: {
          ok: false,
          code: MCP_ERROR_CODES.mcp_invalid_config,
          message: mcpUserMessage(MCP_ERROR_CODES.mcp_invalid_config),
          authorization: {
            serverId,
            state: 'authorization_failed',
            errorCode: 'authorization_failed'
          }
        }
      }
    }
    if (server.scope === 'workspace') {
      const bound = server.workspaceRoot
      const active = workspaceRoot?.trim() || null
      if (!bound || !active || bound !== active) {
        return {
          ok: false,
          result: {
            ok: false,
            code: MCP_ERROR_CODES.mcp_server_disabled,
            message: mcpUserMessage(MCP_ERROR_CODES.mcp_server_disabled),
            authorization: {
              serverId,
              state: 'authorization_failed',
              errorCode: 'authorization_failed'
            }
          }
        }
      }
    }
    return { ok: true, server }
  }

  /** Prefer multi-source winner, then durable user config. */
  private lookupServerSync(serverId: string): UserMcpServerV1 | null {
    const fromEffective = this.lastEffectiveView?.effectiveServers.find(
      (entry) => entry.server.id === serverId
    )
    if (fromEffective) return fromEffective.server
    const cache = (this.configStore as unknown as { cache: UserMcpConfigV1 | null }).cache
    return cache?.servers.find((server) => server.id === serverId) ?? null
  }

  private resolveAuthorizationHeader(server: UserMcpServerV1): string | null {
    if (!server.oauth || server.transport === 'stdio') return null
    const accessToken = this.oauth.resolveAccessToken(server.id)
    return accessToken ? `Bearer ${accessToken}` : null
  }

  /**
   * Returns the current StudiumX user access token as a Bearer header value,
   * or null when no session is active. Used by system-default MCP servers
   * marked with X-StudiumX-Auth: auto.
   */
  private resolveStudiumxAuthHeader(): string | null {
    return this.studiumxAccessToken ? `Bearer ${this.studiumxAccessToken}` : null
  }

  /**
   * Set the current StudiumX user access token (called from renderer via IPC
   * on login/refresh/logout). Passing null clears the token.
   */
  setStudiumxAccessToken(token: string | null): void {
    this.studiumxAccessToken = token
  }

  private async loadEncryptedOAuthTokenIndex(): Promise<void> {
    if (!this.durableOAuthTokenIndex) return
    try {
      const parsed = JSON.parse(await readFile(this.oauthTokenIndexPath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      const tokens = (parsed as { tokens?: unknown }).tokens
      if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return
      this.oauthTokenIndex.clear()
      for (const [key, packed] of Object.entries(tokens)) {
        if (typeof packed === 'string') this.oauthTokenIndex.set(key, packed)
      }
    } catch {
      this.oauthTokenIndex.clear()
    }
  }

  private async writeEncryptedOAuthTokenIndex(): Promise<void> {
    if (!this.durableOAuthTokenIndex) return
    await mkdir(dirname(this.oauthTokenIndexPath), { recursive: true, mode: 0o700 })
    const tempPath = `${this.oauthTokenIndexPath}.tmp-${process.pid}-${Date.now()}`
    const content = `${JSON.stringify({
      schemaVersion: 1,
      tokens: Object.fromEntries([...this.oauthTokenIndex.entries()].sort(([a], [b]) => a.localeCompare(b)))
    }, null, 2)}\n`
    try {
      await writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 })
      await rename(tempPath, this.oauthTokenIndexPath)
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined)
    }
  }

  private async loadEncryptedSecretIndex(): Promise<void> {
    if (!this.durableSecretIndex) return
    try {
      const parsed = JSON.parse(await readFile(this.secretIndexPath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      const secrets = (parsed as { secrets?: unknown }).secrets
      if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) return
      this.encryptedIndex.clear()
      for (const [refId, packed] of Object.entries(secrets)) {
        if (typeof packed === 'string') this.encryptedIndex.set(refId, packed)
      }
    } catch {
      // Missing/corrupt secret index fails closed: configured refs remain unresolved.
      this.encryptedIndex.clear()
    }
  }

  private async writeEncryptedSecretIndex(): Promise<void> {
    if (!this.durableSecretIndex) return
    await mkdir(dirname(this.secretIndexPath), { recursive: true, mode: 0o700 })
    const tempPath = `${this.secretIndexPath}.tmp-${process.pid}-${Date.now()}`
    const content = `${JSON.stringify({
      schemaVersion: 1,
      secrets: Object.fromEntries([...this.encryptedIndex.entries()].sort(([a], [b]) => a.localeCompare(b)))
    }, null, 2)}\n`
    try {
      await writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 })
      await rename(tempPath, this.secretIndexPath)
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined)
    }
  }
}

function createMemoryTokenCipher() {
  const values = new Map<string, string>()
  let seq = 0
  return {
    isEncryptionAvailable: () => true,
    encryptString(value: string): Buffer {
      const id = `mem_${++seq}`
      values.set(id, value)
      return Buffer.from(id, 'utf8')
    },
    decryptString(value: Buffer): string {
      const id = value.toString('utf8')
      const plaintext = values.get(id)
      if (plaintext == null) throw new Error('missing memory token')
      return plaintext
    }
  }
}
