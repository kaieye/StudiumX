/**
 * Strict parser for the one fixed OAuth deep-link callback. Parsed codes remain
 * main-process-only; callers must not log or surface the returned payload.
 */

import { MCP_OAUTH_CALLBACK_URI } from '../../shared/mcp/oauth-types'
import { isValidMcpOAuthState } from './oauth-pkce'

const CALLBACK_PROTOCOL = 'studiumx:'
const CALLBACK_HOST = 'mcp-oauth'
const CALLBACK_PATHNAME = '/callback'
const ALLOWED_QUERY_KEYS = new Set(['state', 'code', 'error'])
const OPAQUE_VALUE_RE = /^[\x21-\x7e]+$/
const OAUTH_ERROR_RE = /^[A-Za-z0-9._~-]{1,128}$/
const MAX_CODE_LENGTH = 4096

export type McpOAuthAuthorizationCodeCallback = Readonly<{
  kind: 'authorization_code'
  state: string
  code: string
}>

export type McpOAuthAuthorizationErrorCallback = Readonly<{
  kind: 'authorization_error'
  state: string
  error: string
}>

export type McpOAuthCallback = McpOAuthAuthorizationCodeCallback | McpOAuthAuthorizationErrorCallback

export type McpOAuthCallbackParseResult =
  | Readonly<{ ok: true; callback: McpOAuthCallback }>
  | Readonly<{ ok: false; code: 'invalid_callback' }>

/**
 * Accepts exactly `studiumx://mcp-oauth/callback?state=...&code=...` or the
 * equivalent `error=...` form. Fragments, credentials, duplicate/unknown
 * parameters, mixed code+error, and malformed opaque values fail closed.
 */
export function parseMcpOAuthCallback(input: unknown): McpOAuthCallbackParseResult {
  if (typeof input !== 'string' || input.length === 0 || input.length > 8192) return invalid()

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return invalid()
  }

  if (
    url.protocol !== CALLBACK_PROTOCOL ||
    url.hostname !== CALLBACK_HOST ||
    url.pathname !== CALLBACK_PATHNAME ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    return invalid()
  }

  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || url.searchParams.getAll(key).length !== 1) return invalid()
  }

  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  if (!isValidMcpOAuthState(state) || (code === null && error === null) || (code !== null && error !== null)) {
    return invalid()
  }

  if (code !== null) {
    if (!isValidOpaqueCode(code)) return invalid()
    return Object.freeze({ ok: true, callback: Object.freeze({ kind: 'authorization_code', state, code }) })
  }

  if (!isValidOAuthError(error)) return invalid()
  return Object.freeze({ ok: true, callback: Object.freeze({ kind: 'authorization_error', state, error }) })
}

function invalid(): McpOAuthCallbackParseResult {
  return Object.freeze({ ok: false, code: 'invalid_callback' })
}

function isValidOpaqueCode(value: string): boolean {
  return value.length > 0 && value.length <= MAX_CODE_LENGTH && OPAQUE_VALUE_RE.test(value)
}

function isValidOAuthError(value: string | null): value is string {
  return typeof value === 'string' && OAUTH_ERROR_RE.test(value)
}

// Keep the fixed literal colocated with the parser and fail safely if a future
// shared DTO changes it by accident.
if (MCP_OAUTH_CALLBACK_URI !== 'studiumx://mcp-oauth/callback') {
  throw new Error('invalid MCP OAuth callback URI contract')
}
