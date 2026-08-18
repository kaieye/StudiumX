/**
 * Main-process OAuth authorization-code + PKCE manager (ADR-0013).
 *
 * Secret material (state, verifier, codes, tokens) stays here. Public callers
 * only receive secret-free lifecycle DTOs.
 */

import {
  MCP_OAUTH_CALLBACK_URI,
  type McpOAuthAuthorizationErrorCode,
  type McpOAuthAuthorizationPublicState,
  type McpOAuthAuthorizationState
} from '../../shared/mcp/oauth-types'
import {
  MCP_ERROR_CODES,
  mcpUserMessage,
  type McpErrorCode,
  type UserMcpServerV1
} from '../../shared/mcp/types'
import { parseMcpOAuthCallback } from './oauth-callback'
import { createMcpOAuthPkceMaterial } from './oauth-pkce'
import { McpOAuthPendingStateStore } from './oauth-state-store'
import {
  McpOAuthTokenStore,
  type McpOAuthTokenCipher,
  type McpOAuthTokenSet
} from './oauth-token-store'

export type McpOAuthAuthorizeResult =
  | Readonly<{ ok: true; authorization: McpOAuthAuthorizationPublicState }>
  | Readonly<{ ok: false; code: McpErrorCode; message: string; authorization: McpOAuthAuthorizationPublicState }>

export type McpOAuthCallbackHandleResult =
  | Readonly<{ ok: true; handled: true; authorization: McpOAuthAuthorizationPublicState }>
  | Readonly<{ ok: true; handled: false }>
  | Readonly<{ ok: false; code: McpErrorCode; message: string; authorization?: McpOAuthAuthorizationPublicState }>

export type McpOAuthAuthorizationManagerOptions = Readonly<{
  tokenStore: McpOAuthTokenStore
  pendingStates?: McpOAuthPendingStateStore
  openExternal: (url: string) => Promise<void>
  fetchImpl?: typeof fetch
  now?: () => number
  /** Optional clock skew grace when judging access-token expiry. */
  expirySkewMs?: number
}>

type ResolveServer = (serverId: string) => UserMcpServerV1 | null

const DEFAULT_EXPIRY_SKEW_MS = 30_000
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000

export class McpOAuthAuthorizationManager {
  private readonly tokenStore: McpOAuthTokenStore
  private readonly pendingStates: McpOAuthPendingStateStore
  private readonly openExternal: (url: string) => Promise<void>
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly expirySkewMs: number
  private readonly publicByServer = new Map<string, McpOAuthAuthorizationPublicState>()
  private resolveServer: ResolveServer = () => null

  constructor(options: McpOAuthAuthorizationManagerOptions) {
    this.tokenStore = options.tokenStore
    this.pendingStates = options.pendingStates ?? new McpOAuthPendingStateStore({ now: options.now })
    this.openExternal = options.openExternal
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.expirySkewMs = options.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS
  }

  /** Bind the live server lookup after host/config composition is ready. */
  setServerResolver(resolveServer: ResolveServer): void {
    this.resolveServer = resolveServer
  }

  getPublicState(serverId: string): McpOAuthAuthorizationPublicState | null {
    const remembered = this.publicByServer.get(serverId)
    if (remembered) return remembered
    if (!this.tokenStore.has(serverId)) return null
    return this.remember(serverId, 'authorized', null)
  }

  hasAuthorizedToken(serverId: string): boolean {
    return this.tokenStore.has(serverId)
  }

  /**
   * Main-only access-token resolution for transport header construction.
   * Never log or return this value outside the main process.
   */
  resolveAccessToken(serverId: string): string | null {
    const tokenSet = this.tokenStore.read(serverId)
    if (!tokenSet) return null
    if (isExpired(tokenSet, this.now(), this.expirySkewMs)) return null
    return tokenSet.accessToken
  }

  async authorizeServer(serverId: string): Promise<McpOAuthAuthorizeResult> {
    const server = this.resolveServer(serverId)
    if (!server) {
      return fail(serverId, MCP_ERROR_CODES.mcp_invalid_config, 'authorization_failed')
    }
    if (server.transport === 'stdio') {
      return fail(serverId, MCP_ERROR_CODES.mcp_oauth_unsupported, 'authorization_failed')
    }
    if (!server.oauth) {
      return fail(serverId, MCP_ERROR_CODES.mcp_oauth_not_configured, 'authorization_failed')
    }
    if (hasStaticAuthorizationHeader(server)) {
      return fail(serverId, MCP_ERROR_CODES.mcp_oauth_conflict, 'authorization_failed')
    }

    const material = createMcpOAuthPkceMaterial()
    try {
      this.pendingStates.issue({
        serverId,
        state: material.state,
        verifier: material.verifier
      })
    } catch {
      return fail(serverId, MCP_ERROR_CODES.mcp_oauth_authorization_failed, 'authorization_failed')
    }

    const authorizationUrl = buildAuthorizationUrl({
      oauth: server.oauth,
      state: material.state,
      challenge: material.challenge
    })

    this.remember(serverId, 'authorizing', null)
    try {
      await this.openExternal(authorizationUrl)
    } catch {
      this.pendingStates.discard(material.state)
      return fail(serverId, MCP_ERROR_CODES.mcp_oauth_authorization_failed, 'authorization_failed')
    }

    return {
      ok: true,
      authorization: this.remember(serverId, 'authorizing', null)
    }
  }

  async handleCallback(deepLink: unknown): Promise<McpOAuthCallbackHandleResult> {
    const parsed = parseMcpOAuthCallback(deepLink)
    if (!parsed.ok) {
      // Not our callback (or malformed). Callers treat this as unhandled.
      return { ok: true, handled: false }
    }

    const consumed = this.pendingStates.consume(parsed.callback.state)
    if (!consumed) {
      return {
        ok: false,
        code: MCP_ERROR_CODES.mcp_oauth_authorization_failed,
        message: mcpUserMessage(MCP_ERROR_CODES.mcp_oauth_authorization_failed)
      }
    }

    const server = this.resolveServer(consumed.serverId)
    if (!server?.oauth || server.transport === 'stdio') {
      return failHandled(consumed.serverId, MCP_ERROR_CODES.mcp_oauth_not_configured, 'authorization_failed')
    }

    if (parsed.callback.kind === 'authorization_error') {
      const errorCode: McpOAuthAuthorizationErrorCode =
        parsed.callback.error === 'access_denied' ? 'authorization_denied' : 'authorization_failed'
      // Public lifecycle must leave authorizing so UI/doctor do not stay stuck mid-flow.
      this.remember(consumed.serverId, 'authorization_failed', errorCode)
      return failHandled(
        consumed.serverId,
        MCP_ERROR_CODES.mcp_oauth_authorization_failed,
        errorCode
      )
    }

    try {
      const tokenSet = await this.exchangeAuthorizationCode({
        server,
        code: parsed.callback.code,
        verifier: consumed.verifier
      })
      this.tokenStore.store(consumed.serverId, tokenSet)
      const authorization = this.remember(consumed.serverId, 'authorized', null)
      return { ok: true, handled: true, authorization }
    } catch {
      this.remember(consumed.serverId, 'authorization_failed', 'token_exchange_failed')
      return failHandled(
        consumed.serverId,
        MCP_ERROR_CODES.mcp_oauth_authorization_failed,
        'token_exchange_failed'
      )
    }
  }

  async revokeAuthorization(serverId: string): Promise<McpOAuthAuthorizeResult> {
    this.tokenStore.forget(serverId)
    const authorization = this.remember(serverId, 'authorization_required', null)
    return { ok: true, authorization }
  }

  /**
   * Single controlled refresh attempt. On failure the stored token is cleared so
   * later calls surface authorization_required without looping.
   */
  async refreshAccessToken(serverId: string): Promise<
    | Readonly<{ ok: true; accessToken: string }>
    | Readonly<{ ok: false; code: McpErrorCode }>
  > {
    const server = this.resolveServer(serverId)
    if (!server?.oauth || server.transport === 'stdio') {
      return { ok: false, code: MCP_ERROR_CODES.mcp_oauth_not_configured }
    }
    const existing = this.tokenStore.read(serverId)
    if (!existing?.refreshToken) {
      this.tokenStore.forget(serverId)
      this.remember(serverId, 'authorization_required', 'token_storage_unavailable')
      return { ok: false, code: MCP_ERROR_CODES.mcp_oauth_token_unavailable }
    }

    try {
      const tokenSet = await this.exchangeRefreshToken({
        server,
        refreshToken: existing.refreshToken
      })
      this.tokenStore.store(serverId, tokenSet)
      this.remember(serverId, 'authorized', null)
      return { ok: true, accessToken: tokenSet.accessToken }
    } catch {
      this.tokenStore.forget(serverId)
      this.remember(serverId, 'authorization_required', 'token_exchange_failed')
      return { ok: false, code: MCP_ERROR_CODES.mcp_oauth_token_unavailable }
    }
  }

  private async exchangeAuthorizationCode(input: {
    server: UserMcpServerV1
    code: string
    verifier: string
  }): Promise<McpOAuthTokenSet> {
    const oauth = input.server.oauth!
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: MCP_OAUTH_CALLBACK_URI,
      client_id: oauth.clientId,
      code_verifier: input.verifier
    })
    if (oauth.resource) body.set('resource', oauth.resource)
    return this.requestToken(oauth.tokenEndpoint, body)
  }

  private async exchangeRefreshToken(input: {
    server: UserMcpServerV1
    refreshToken: string
  }): Promise<McpOAuthTokenSet> {
    const oauth = input.server.oauth!
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: oauth.clientId
    })
    if (oauth.resource) body.set('resource', oauth.resource)
    if (oauth.scopes.length > 0) body.set('scope', oauth.scopes.join(' '))
    return this.requestToken(oauth.tokenEndpoint, body)
  }

  private async requestToken(tokenEndpoint: string, body: URLSearchParams): Promise<McpOAuthTokenSet> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(tokenEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString(),
        signal: controller.signal
      })
      if (!response.ok) throw new Error('token endpoint rejected request')
      const payload: unknown = await response.json()
      return parseTokenResponse(payload, this.now())
    } finally {
      clearTimeout(timer)
    }
  }

  private remember(
    serverId: string,
    state: McpOAuthAuthorizationState,
    errorCode: McpOAuthAuthorizationErrorCode | null
  ): McpOAuthAuthorizationPublicState {
    const publicState: McpOAuthAuthorizationPublicState = Object.freeze({
      serverId,
      state,
      errorCode
    })
    this.publicByServer.set(serverId, publicState)
    return publicState
  }
}

function fail(
  serverId: string,
  code: McpErrorCode,
  errorCode: McpOAuthAuthorizationErrorCode
): McpOAuthAuthorizeResult {
  return {
    ok: false,
    code,
    message: mcpUserMessage(code),
    authorization: Object.freeze({
      serverId,
      state: 'authorization_failed' as const,
      errorCode
    })
  }
}

function failHandled(
  serverId: string,
  code: McpErrorCode,
  errorCode: McpOAuthAuthorizationErrorCode
): Extract<McpOAuthCallbackHandleResult, { ok: false }> {
  return {
    ok: false,
    code,
    message: mcpUserMessage(code),
    authorization: Object.freeze({
      serverId,
      state: 'authorization_failed' as const,
      errorCode
    })
  }
}

function buildAuthorizationUrl(input: {
  oauth: NonNullable<UserMcpServerV1['oauth']>
  state: string
  challenge: string
}): string {
  const url = new URL(input.oauth.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.oauth.clientId)
  url.searchParams.set('redirect_uri', MCP_OAUTH_CALLBACK_URI)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (input.oauth.scopes.length > 0) {
    url.searchParams.set('scope', input.oauth.scopes.join(' '))
  }
  if (input.oauth.resource) {
    url.searchParams.set('resource', input.oauth.resource)
  }
  return url.toString()
}

function parseTokenResponse(payload: unknown, nowMs: number): McpOAuthTokenSet {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalid token response')
  }
  const record = payload as Record<string, unknown>
  if (typeof record.access_token !== 'string' || !record.access_token) {
    throw new Error('missing access_token')
  }
  const expiresIn =
    typeof record.expires_in === 'number' && Number.isFinite(record.expires_in)
      ? Math.max(0, Math.floor(record.expires_in))
      : undefined
  return Object.freeze({
    accessToken: record.access_token,
    ...(typeof record.refresh_token === 'string' && record.refresh_token
      ? { refreshToken: record.refresh_token }
      : {}),
    ...(typeof record.token_type === 'string' && record.token_type
      ? { tokenType: record.token_type }
      : {}),
    ...(expiresIn !== undefined ? { expiresAt: nowMs + expiresIn * 1000 } : {}),
    ...(typeof record.scope === 'string' && record.scope ? { scope: record.scope } : {})
  })
}

function isExpired(tokenSet: McpOAuthTokenSet, nowMs: number, skewMs: number): boolean {
  if (tokenSet.expiresAt === undefined) return false
  return tokenSet.expiresAt <= nowMs + skewMs
}

function hasStaticAuthorizationHeader(server: UserMcpServerV1): boolean {
  const keys = [...Object.keys(server.headersPlain), ...Object.keys(server.headersSecretRefs)]
  return keys.some((key) => key.toLowerCase() === 'authorization')
}

// Keep cipher type re-exported for host construction convenience.
export type { McpOAuthTokenCipher }
