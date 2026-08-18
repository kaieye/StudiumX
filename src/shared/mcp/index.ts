/**
 * Shared MCP public exports (ADR-0013 foundations).
 */

export * from './types'
export * from './tool-name'
export * from './effect-map'
export * from './config-schema'
export * from './ipc-contract'
export * from './static-tool-names'
export * from './import-export'
// McpSync pure parse / merge preview (ADR-0013 product path; no network)
export * from './mcp-sync'
// Id-level settings ops reduction (worth-learning §3.3 / Phase B)
export * from './mcp-ops'
export * from './filesystem-mcp-defaults'
export * from './oauth-types'
export * from './result-types'
// Phase E — multi-source / auto-connect eligibility (ADR-0013)
export * from './source-types'
export * from './source-resolver'
export * from './effective-view-public'
// Phase G — plugin MCP declarations (ADR-0013)
export * from './plugin-types'
// Phase H - local marketplace catalog (ADR-0013)
export * from './marketplace-types'
export * from './marketplace-catalog'
// System-default MCP servers (built-in, disabled by default)
export * from './system-defaults'
