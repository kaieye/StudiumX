/**
 * Secret-free OAuth lifecycle facts for the MCP authorization UI and diagnostics.
 *
 * Authorization codes, PKCE verifiers/state, tokens, callback URLs, and token
 * endpoint responses are deliberately main-process-only and never belong here.
 */

export const MCP_OAUTH_CALLBACK_URI = 'studiumx://mcp-oauth/callback' as const

/** Public lifecycle projection; it carries neither credentials nor callback data. */
export type McpOAuthAuthorizationState =
  | 'authorization_required'
  | 'authorizing'
  | 'authorized'
  | 'authorization_failed'

/** Stable, secret-free reason codes suitable for UI/diagnostic projection. */
export type McpOAuthAuthorizationErrorCode =
  | 'authorization_denied'
  | 'authorization_failed'
  | 'authorization_state_expired'
  | 'authorization_callback_invalid'
  | 'token_exchange_failed'
  | 'token_storage_unavailable'

/**
 * The only OAuth state intended to cross a main-process boundary in a future
 * integration. Do not add authorization URLs, codes, tokens, PKCE material, or
 * provider-supplied descriptions to this DTO.
 */
export type McpOAuthAuthorizationPublicState = Readonly<{
  serverId: string
  state: McpOAuthAuthorizationState
  errorCode: McpOAuthAuthorizationErrorCode | null
}>
