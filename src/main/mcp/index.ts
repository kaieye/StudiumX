/**
 * Main-process MCP module exports (ADR-0128).
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
