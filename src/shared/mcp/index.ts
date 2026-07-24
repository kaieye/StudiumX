/**
 * Shared MCP public exports (ADR-0128 + ADR-0134..0140 foundations).
 */

export * from './types'
export * from './tool-name'
export * from './effect-map'
export * from './config-schema'
export * from './ipc-contract'
export * from './static-tool-names'
export * from './import-export'
// McpSync pure parse / merge preview (ADR-0136 + ADR-0141 product path; no network)
export * from './mcp-sync'
// Id-level settings ops reduction (worth-learning §3.3 / Phase B)
export * from './mcp-ops'
export * from './filesystem-mcp-defaults'
export * from './oauth-types'
export * from './result-types'
// Phase E — multi-source / auto-connect eligibility (ADR-0137)
export * from './source-types'
export * from './source-resolver'
export * from './effective-view-public'
// Phase G — plugin MCP declarations (ADR-0139)
export * from './plugin-types'
// Phase H — local marketplace catalog (ADR-0140)
export * from './marketplace-types'
export * from './marketplace-catalog'
