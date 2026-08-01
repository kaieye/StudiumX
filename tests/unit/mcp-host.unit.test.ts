import { describe, expect, it, vi } from 'vitest'

import { McpHost } from '../../src/main/mcp/host'
import { defaultUserMcpConfig } from '../../src/shared/mcp/config-schema'
import type { McpTestServerResult, UserMcpConfigV1, UserMcpServerV1 } from '../../src/shared/mcp/types'

function oauthHttpServer(id = 'remote_oauth'): UserMcpServerV1 {
  return {
    id,
    label: 'Remote OAuth',
    enabled: true,
    scope: 'user',
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
      resource: null
    },
    workspaceRootInjection: 'off',
    injectionIdentity: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function configWithServers(servers: readonly UserMcpServerV1[]): UserMcpConfigV1 {
  return {
    ...defaultUserMcpConfig(),
    enabled: true,
    servers
  }
}

describe('McpHost refreshServer', () => {
  it('reloads and applies config before forwarding the scoped explicit refresh', async () => {
    const host = new McpHost({ userDataPath: '/tmp/studiumx-mcp-host-refresh-test' })
    const config = defaultUserMcpConfig()
    const load = vi.spyOn(host.configStore, 'load').mockResolvedValue(config)
    const applyConfig = vi.spyOn(host.sessionManager, 'applyConfig').mockResolvedValue()
    const refreshResult = {
      ok: false,
      code: 'mcp_invalid_config',
      message: 'MCP 配置无效。',
      serverId: 'demo-server'
    } satisfies McpTestServerResult
    const refreshServer = vi.fn().mockResolvedValue(refreshResult)
    ;(host.sessionManager as unknown as {
      refreshServer: typeof refreshServer
    }).refreshServer = refreshServer

    await expect(host.refreshServer('demo-server', '/tmp/studiumx-workspace')).resolves.toEqual(
      refreshResult
    )

    expect(load).toHaveBeenCalledTimes(1)
    expect(applyConfig).toHaveBeenCalled()
    const applied = applyConfig.mock.calls[0][0]
    expect(applied.enabled).toBe(config.enabled)
    expect(applied.servers).toEqual(expect.arrayContaining(config.servers))
    expect(refreshServer).toHaveBeenCalledWith('demo-server', '/tmp/studiumx-workspace')
  })
})

describe('McpHost StudiumX access-token lifecycle', () => {
  it('invalidates the context-docs session after a token change so the next request uses the new token', async () => {
    const host = new McpHost({ userDataPath: '/tmp/studiumx-mcp-host-token-refresh' })
    const invalidateServer = vi.spyOn(host.sessionManager, 'invalidateServer').mockResolvedValue(undefined)

    await host.setStudiumxAccessToken('fresh-access-token')

    expect(invalidateServer).toHaveBeenCalledWith('context-docs')
  })
})

describe('McpHost OAuth authorize and revoke', () => {
  it('authorizeServer loads config, opens external with PKCE challenge, and returns secret-free authorizing state', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const host = new McpHost({
      userDataPath: '/tmp/studiumx-mcp-host-oauth-auth',
      openExternal
    })
    const config = configWithServers([oauthHttpServer()])
    vi.spyOn(host.configStore, 'load').mockResolvedValue(config)
    vi.spyOn(host.sessionManager, 'applyConfig').mockResolvedValue()
    // Sync resolver reads configStore cache; seed it for authorize path.
    ;(host.configStore as unknown as { cache: UserMcpConfigV1 | null }).cache = config

    const result = await host.authorizeServer('remote_oauth')

    expect(result).toEqual({
      ok: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorizing',
        errorCode: null
      }
    })
    expect(openExternal).toHaveBeenCalledTimes(1)
    const opened = String(openExternal.mock.calls[0]?.[0] ?? '')
    expect(opened).toContain('code_challenge=')
    expect(opened).toContain('code_challenge_method=S256')
    expect(JSON.stringify(result)).not.toContain(opened)
    expect(JSON.stringify(result)).not.toMatch(/code_challenge|access_token|code_verifier/)
  })

  it('revokeAuthorization deletes tokens and invalidates the server session', async () => {
    const host = new McpHost({
      userDataPath: '/tmp/studiumx-mcp-host-oauth-revoke',
      openExternal: async () => undefined
    })
    const invalidateServer = vi.fn().mockResolvedValue(undefined)
    ;(host.sessionManager as unknown as { invalidateServer: typeof invalidateServer }).invalidateServer =
      invalidateServer

    const oauth = (host as unknown as { oauth: {
      revokeAuthorization: (serverId: string) => Promise<{
        ok: true
        authorization: { serverId: string; state: 'authorization_required'; errorCode: null }
      }>
    } }).oauth
    const revoke = vi.spyOn(oauth, 'revokeAuthorization').mockResolvedValue({
      ok: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorization_required',
        errorCode: null
      }
    })

    const result = await host.revokeAuthorization('remote_oauth')

    expect(revoke).toHaveBeenCalledWith('remote_oauth')
    expect(invalidateServer).toHaveBeenCalledWith(
      'remote_oauth',
      'mcp_oauth_authorization_required'
    )
    expect(result).toEqual({
      ok: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorization_required',
        errorCode: null
      }
    })
  })

  it('refuses authorize for stdio servers via the OAuth manager', async () => {
    const host = new McpHost({
      userDataPath: '/tmp/studiumx-mcp-host-oauth-stdio',
      openExternal: async () => undefined
    })
    const stdio: UserMcpServerV1 = {
      ...oauthHttpServer('local_stdio'),
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      url: null
    }
    const config = configWithServers([stdio])
    vi.spyOn(host.configStore, 'load').mockResolvedValue(config)
    vi.spyOn(host.sessionManager, 'applyConfig').mockResolvedValue()
    ;(host.configStore as unknown as { cache: UserMcpConfigV1 | null }).cache = config

    const result = await host.authorizeServer('local_stdio')
    expect(result).toMatchObject({
      ok: false,
      code: 'mcp_oauth_unsupported',
      authorization: { serverId: 'local_stdio', state: 'authorization_failed' }
    })
  })
})

describe('McpHost start smart-connect (ADR-0141)', () => {
  it('runs autoConnectNow on start when root enabled and autoConnect effective', async () => {
    const host = new McpHost({
      userDataPath: '/tmp/studiumx-mcp-host-start-ac',
      bootstrapPluginMcp: false
    })
    const config: UserMcpConfigV1 = {
      ...defaultUserMcpConfig(),
      enabled: true,
      autoConnect: true,
      servers: []
    }
    vi.spyOn(host.configStore, 'load').mockResolvedValue(config)
    vi.spyOn(host.sessionManager, 'applyConfig').mockResolvedValue()
    vi.spyOn(host.marketplaceStore, 'load').mockResolvedValue({
      schemaVersion: 1,
      emergencyDisabled: false,
      entries: [],
      fingerprint: 'fp'
    } as never)
    const autoConnectNow = vi.spyOn(host, 'autoConnectNow').mockResolvedValue([])

    await host.start()

    expect(autoConnectNow).toHaveBeenCalled()
  })

  it('does not autoConnect on start when autoConnect is explicitly false', async () => {
    const host = new McpHost({
      userDataPath: '/tmp/studiumx-mcp-host-start-off',
      bootstrapPluginMcp: false
    })
    const config: UserMcpConfigV1 = {
      ...defaultUserMcpConfig(),
      enabled: true,
      autoConnect: false,
      servers: []
    }
    vi.spyOn(host.configStore, 'load').mockResolvedValue(config)
    vi.spyOn(host.sessionManager, 'applyConfig').mockResolvedValue()
    vi.spyOn(host.marketplaceStore, 'load').mockResolvedValue({
      schemaVersion: 1,
      emergencyDisabled: false,
      entries: [],
      fingerprint: 'fp'
    } as never)
    const autoConnectNow = vi.spyOn(host, 'autoConnectNow').mockResolvedValue([])

    await host.start()

    expect(autoConnectNow).not.toHaveBeenCalled()
  })
})
