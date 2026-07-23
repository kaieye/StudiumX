import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { McpOAuthAuthorizationManager } from '../../src/main/mcp/oauth-authorization-manager'
import { createMcpOAuthPkceMaterial } from '../../src/main/mcp/oauth-pkce'
import { McpOAuthPendingStateStore } from '../../src/main/mcp/oauth-state-store'
import {
  McpOAuthTokenStore,
  type McpOAuthTokenCipher
} from '../../src/main/mcp/oauth-token-store'
import type { UserMcpServerV1 } from '../../src/shared/mcp/types'

function memoryCipher(): McpOAuthTokenCipher {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0xa5)),
    decryptString: (value) =>
      Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString('utf8')
  }
}

function httpOAuthServer(overrides: Partial<UserMcpServerV1> = {}): UserMcpServerV1 {
  return {
    id: 'remote_oauth',
    label: 'Remote OAuth',
    enabled: true,
    scope: 'global',
    workspaceRoot: null,
    transport: 'http',
    command: null,
    args: [],
    cwd: null,
    envSecretRefs: {},
    envPlain: {},
    url: 'https://mcp.example/mcp',
    headersSecretRefs: {},
    headersPlain: {},
    timeoutMs: null,
    toolEffectOverrides: {},
    oauth: {
      authorizationEndpoint: 'https://auth.example/authorize',
      tokenEndpoint: 'https://auth.example/token',
      clientId: 'client-public',
      scopes: ['mcp.read'],
      resource: 'https://mcp.example/mcp'
    },
    workspaceRootInjection: 'off',
    injectionIdentity: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function stdioServer(): UserMcpServerV1 {
  return {
    ...httpOAuthServer({
      id: 'local_stdio',
      label: 'Local stdio',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      url: null,
      oauth: {
        authorizationEndpoint: 'https://auth.example/authorize',
        tokenEndpoint: 'https://auth.example/token',
        clientId: 'client-public',
        scopes: [],
        resource: null
      }
    })
  }
}

function createManager(input: {
  servers?: readonly UserMcpServerV1[]
  openExternal?: (url: string) => Promise<void>
  fetchImpl?: typeof fetch
  now?: () => number
  pendingStates?: McpOAuthPendingStateStore
  tokenStore?: McpOAuthTokenStore
}) {
  const servers = input.servers ?? [httpOAuthServer()]
  const tokenStore =
    input.tokenStore ??
    new McpOAuthTokenStore({ cipher: memoryCipher(), encryptedIndex: new Map() })
  const openExternal = input.openExternal ?? vi.fn().mockResolvedValue(undefined)
  const manager = new McpOAuthAuthorizationManager({
    tokenStore,
    pendingStates: input.pendingStates,
    openExternal,
    fetchImpl: input.fetchImpl,
    now: input.now
  })
  manager.setServerResolver((serverId) => servers.find((server) => server.id === serverId) ?? null)
  return { manager, tokenStore, openExternal, servers }
}

function callbackUrl(query: Record<string, string>): string {
  return `studiumx://mcp-oauth/callback?${new URLSearchParams(query).toString()}`
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function assertNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toMatch(/code_challenge|code_verifier|access_token|refresh_token/)
  expect(serialized).not.toMatch(/authorization_code|Bearer |https:\/\/auth\.example/)
  expect(serialized).not.toMatch(/opaque-auth-code|access-secret|refresh-secret/)
}

describe('McpOAuthAuthorizationManager', () => {
  it('starts PKCE authorize with pending state, openExternal challenge URL, and public authorizing only', async () => {
    const opened: string[] = []
    const { manager, openExternal } = createManager({
      openExternal: async (url) => {
        opened.push(url)
      }
    })

    const result = await manager.authorizeServer('remote_oauth')

    expect(result).toEqual({
      ok: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorizing',
        errorCode: null
      }
    })
    expect(manager.getPublicState('remote_oauth')).toEqual({
      serverId: 'remote_oauth',
      state: 'authorizing',
      errorCode: null
    })
    assertNoSecrets(result)
    assertNoSecrets(manager.getPublicState('remote_oauth'))

    expect(opened).toHaveLength(1)
    const authUrl = new URL(opened[0]!)
    expect(authUrl.origin + authUrl.pathname).toBe('https://auth.example/authorize')
    expect(authUrl.searchParams.get('response_type')).toBe('code')
    expect(authUrl.searchParams.get('client_id')).toBe('client-public')
    expect(authUrl.searchParams.get('redirect_uri')).toBe('studiumx://mcp-oauth/callback')
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authUrl.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32,128}$/)
    expect(authUrl.searchParams.get('scope')).toBe('mcp.read')
    expect(authUrl.searchParams.get('resource')).toBe('https://mcp.example/mcp')
    // Renderer-facing result must not carry authorize URL / challenge / state / verifier.
    expect(JSON.stringify(result)).not.toContain(authUrl.searchParams.get('code_challenge')!)
    expect(JSON.stringify(result)).not.toContain(authUrl.searchParams.get('state')!)
    expect(JSON.stringify(result)).not.toContain(opened[0]!)
  })

  it('completes authorize → callback success → authorized public state with token-only storage', async () => {
    let authorizationState = ''
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ''))
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('opaque-auth-code')
      expect(body.get('redirect_uri')).toBe('studiumx://mcp-oauth/callback')
      expect(body.get('client_id')).toBe('client-public')
      expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
      expect(body.get('resource')).toBe('https://mcp.example/mcp')
      return jsonResponse({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'mcp.read'
      })
    }) as unknown as typeof fetch

    const { manager, tokenStore } = createManager({
      fetchImpl,
      openExternal: async (url) => {
        authorizationState = new URL(url).searchParams.get('state') ?? ''
      }
    })

    await expect(manager.authorizeServer('remote_oauth')).resolves.toMatchObject({
      ok: true,
      authorization: { state: 'authorizing' }
    })

    const handled = await manager.handleCallback(
      callbackUrl({ state: authorizationState, code: 'opaque-auth-code' })
    )

    expect(handled).toEqual({
      ok: true,
      handled: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorized',
        errorCode: null
      }
    })
    assertNoSecrets(handled)
    expect(manager.getPublicState('remote_oauth')).toEqual({
      serverId: 'remote_oauth',
      state: 'authorized',
      errorCode: null
    })
    expect(manager.hasAuthorizedToken('remote_oauth')).toBe(true)
    expect(manager.resolveAccessToken('remote_oauth')).toBe('access-secret')
    expect(tokenStore.read('remote_oauth')).toMatchObject({
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret'
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails closed on state mismatch, expiry, reuse, and provider error callbacks', async () => {
    let now = 1_000
    let authorizationState = ''
    const pendingStates = new McpOAuthPendingStateStore({ now: () => now, ttlMs: 100 })
    const { manager } = createManager({
      pendingStates,
      now: () => now,
      openExternal: async (url) => {
        authorizationState = new URL(url).searchParams.get('state') ?? ''
      }
    })

    await manager.authorizeServer('remote_oauth')

    // Mismatch: unknown state (not issued).
    const foreign = createMcpOAuthPkceMaterial().state
    await expect(
      manager.handleCallback(callbackUrl({ state: foreign, code: 'opaque-auth-code' }))
    ).resolves.toMatchObject({
      ok: false,
      code: 'mcp_oauth_authorization_failed'
    })

    // Expire pending state, then callback fails closed.
    now += 100
    const expired = await manager.handleCallback(
      callbackUrl({ state: authorizationState, code: 'opaque-auth-code' })
    )
    expect(expired).toMatchObject({ ok: false, code: 'mcp_oauth_authorization_failed' })

    // Fresh authorize for reuse + provider error coverage.
    now += 1
    authorizationState = ''
    await manager.authorizeServer('remote_oauth')
    const first = await manager.handleCallback(
      callbackUrl({ state: authorizationState, error: 'access_denied' })
    )
    expect(first).toEqual({
      ok: false,
      code: 'mcp_oauth_authorization_failed',
      message: 'MCP OAuth 授权失败。',
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorization_failed',
        errorCode: 'authorization_denied'
      }
    })
    assertNoSecrets(first)
    expect(manager.getPublicState('remote_oauth')).toMatchObject({
      state: 'authorization_failed',
      errorCode: 'authorization_denied'
    })

    // Reuse of the already-consumed state fails closed.
    const reuse = await manager.handleCallback(
      callbackUrl({ state: authorizationState, code: 'opaque-auth-code' })
    )
    expect(reuse).toMatchObject({ ok: false, code: 'mcp_oauth_authorization_failed' })
  })

  it('clears tokens and surfaces authorization_required when refresh fails', async () => {
    const tokenStore = new McpOAuthTokenStore({
      cipher: memoryCipher(),
      encryptedIndex: new Map()
    })
    tokenStore.store('remote_oauth', {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: Date.now() - 1
    })
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400)) as unknown as typeof fetch
    const { manager } = createManager({ tokenStore, fetchImpl })

    const refreshed = await manager.refreshAccessToken('remote_oauth')
    expect(refreshed).toEqual({ ok: false, code: 'mcp_oauth_token_unavailable' })
    expect(tokenStore.has('remote_oauth')).toBe(false)
    expect(manager.getPublicState('remote_oauth')).toEqual({
      serverId: 'remote_oauth',
      state: 'authorization_required',
      errorCode: 'token_exchange_failed'
    })
    expect(manager.resolveAccessToken('remote_oauth')).toBeNull()
  })

  it('revoke deletes tokens and returns authorization_required public state', async () => {
    const tokenStore = new McpOAuthTokenStore({
      cipher: memoryCipher(),
      encryptedIndex: new Map()
    })
    tokenStore.store('remote_oauth', { accessToken: 'access-secret', refreshToken: 'refresh-secret' })
    const { manager } = createManager({ tokenStore })

    const revoked = await manager.revokeAuthorization('remote_oauth')
    expect(revoked).toEqual({
      ok: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorization_required',
        errorCode: null
      }
    })
    expect(tokenStore.has('remote_oauth')).toBe(false)
    expect(manager.hasAuthorizedToken('remote_oauth')).toBe(false)
    assertNoSecrets(revoked)
  })

  it('refuses OAuth for stdio transport servers', async () => {
    const { manager } = createManager({ servers: [stdioServer()] })
    const result = await manager.authorizeServer('local_stdio')
    expect(result).toEqual({
      ok: false,
      code: 'mcp_oauth_unsupported',
      message: '该 MCP 传输不支持 OAuth 授权。',
      authorization: {
        serverId: 'local_stdio',
        state: 'authorization_failed',
        errorCode: 'authorization_failed'
      }
    })
    assertNoSecrets(result)
  })
})

describe('MCP OAuth modules settlement isolation', () => {
  it('oauth modules do not import ledger or outcome committers', async () => {
    const files = [
      'oauth-authorization-manager.ts',
      'oauth-callback.ts',
      'oauth-deep-link-bridge.ts',
      'oauth-pkce.ts',
      'oauth-state-store.ts',
      'oauth-token-store.ts'
    ]
    for (const file of files) {
      const source = await readFile(join(process.cwd(), 'src/main/mcp', file), 'utf8')
      expect(source).not.toMatch(/learning-session-ledger|outcome-committer|LearningSessionLedger/)
      expect(source).not.toMatch(/commitLearningOutcome|learning-work-ledger/)
    }
  })
})
