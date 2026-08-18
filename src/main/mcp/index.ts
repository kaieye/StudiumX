/**
 * Main-process MCP module exports (ADR-0013).
 * Phase E–H modules (source-resolver, workspace-root-injection, …) export only when present.
 */

export { McpConfigStore, MCP_CONFIG_RELATIVE_PATH } from './config-store'
export {
  buildSanitizedMcpEnv,
  createMemoryMcpSecretEnv,
  createSafeStorageMcpSecretEnv,
  type McpSecretEnvResolver,
  type McpSecretStorage
} from './secret-env'
export { McpSessionManager, createFakeMcpTransport } from './session-manager'
export type { McpToolsSnapshot, McpSnapshotTool } from './session-manager'
export {
  attachMcpTools,
  clearMcpRuntimeState,
  createMcpToolEntry,
  getRuntimeMcpEffectMap,
  lookupRuntimeMcpEffect,
  setRuntimeMcpEffectMap
} from './tool-bridge'
export { injectMcpToolsIntoRegistry } from './registry-inject'
export { redactMcpCommandLine, redactMcpCwd } from './redact'
export type { McpTransport, McpToolListItem } from './transports/types'
export { McpHost } from './host'
export { registerMcpIpcGateway } from './ipc-gateway'
export { materializeMcpServerSecrets } from './secret-merge'

// Phase B — result safety / artifacts / local trace (ADR-0013)
export { normalizeMcpToolResult } from './result-normalizer'
export {
  LocalMcpArtifactWriter,
  createLocalMcpArtifactWriter,
  type LocalMcpArtifactWriterOptions
} from './artifact-writer'
export {
  createMcpTraceStore,
  MCP_TRACE_DEFAULT_CAPACITY,
  MCP_TRACE_MAX_CAPACITY,
  type McpTraceStore,
  type McpTraceEntry,
  type McpTraceAppendInput,
  type McpTraceStoreOptions,
  type McpTraceResultKind
} from './trace-store'

// Phase C — OAuth PKCE / token lifecycle (ADR-0013)
export {
  McpOAuthAuthorizationManager,
  type McpOAuthAuthorizeResult,
  type McpOAuthCallbackHandleResult,
  type McpOAuthAuthorizationManagerOptions
} from './oauth-authorization-manager'
export {
  parseMcpOAuthCallback,
  type McpOAuthCallback,
  type McpOAuthCallbackParseResult,
  type McpOAuthAuthorizationCodeCallback,
  type McpOAuthAuthorizationErrorCallback
} from './oauth-callback'
export {
  installMcpOAuthDeepLinkBridge,
  extractMcpOAuthDeepLink,
  isMcpOAuthCallbackCandidate,
  type McpOAuthDeepLinkHandler,
  type McpOAuthDeepLinkApp,
  type InstallMcpOAuthDeepLinkBridgeOptions
} from './oauth-deep-link-bridge'
export {
  createMcpOAuthPkceMaterial,
  isValidMcpOAuthState,
  isValidMcpOAuthPkceVerifier,
  mcpOAuthStateEquals,
  type McpOAuthPkceMaterial
} from './oauth-pkce'
export {
  McpOAuthPendingStateStore,
  McpOAuthPendingStateStoreError,
  type McpOAuthPendingAuthorization,
  type McpOAuthPendingStateStoreOptions
} from './oauth-state-store'
export {
  McpOAuthTokenStore,
  McpOAuthTokenStoreError,
  type McpOAuthTokenCipher,
  type McpOAuthTokenSet,
  type McpOAuthEncryptedTokenIndex,
  type McpOAuthTokenStoreOptions
} from './oauth-token-store'

// Phase E — multi-source precedence + controlled auto-connect (ADR-0013)
export {
  loadMcpSourceLayers,
  resolveEffectiveMcpConfig,
  draftToRuntimeServer,
  STUDIUMX_MCP_CONFIG_JSON_ENV,
  STUDIUMX_MCP_CLI_JSON_ENV,
  type LoadMcpSourceLayersOptions,
  type LoadedMcpSourceLayers
} from './source-loaders'

// Phase F — workspace-root injection (ADR-0013)
export {
  resolveInjectedStdioServer,
  canonicalizePath,
  isPathContained,
  type ResolveInjectedStdioServerResult
} from './workspace-root-injection'

// Phase G — plugin MCP registry + filesystem bootstrap (ADR-0013)
export {
  PluginMcpRegistry,
  type PluginMcpCleanupHooks,
  type PluginMcpRegisterResult
} from './plugin-mcp-registry'
export {
  bootstrapPluginMcpFromFilesystem,
  defaultBuiltinMcpPluginRoots,
  listPluginCandidateDirs,
  loadPluginMcpFragmentFromDir,
  unregisterBootstrappedPlugin,
  type PluginMcpBootstrapHit,
  type PluginMcpBootstrapOptions,
  type PluginMcpBootstrapResult
} from './plugin-mcp-bootstrap'

// Phase H — local marketplace store (ADR-0013)
export { McpMarketplaceStore } from './marketplace-store'

