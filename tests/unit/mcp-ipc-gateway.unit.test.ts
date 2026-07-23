import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mcpInvokeChannels } from '../../src/shared/mcp/ipc-contract'
import type { McpHost } from '../../src/main/mcp/host'
import type { McpTestServerResult } from '../../src/shared/mcp/types'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
  return {
    handlers,
    handle: vi.fn(
      (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler)
      }
    ),
    removeHandler: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: electron.handle,
    removeHandler: electron.removeHandler
  }
}))

const { registerMcpIpcGateway } = await import('../../src/main/mcp/ipc-gateway')

function handler(channel: string): (event: unknown, payload?: unknown) => Promise<unknown> {
  const registered = electron.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered
}

function mcpHost(overrides: Partial<Record<string, unknown>> = {}): McpHost {
  return {
    getPublicConfig: vi.fn(),
    updateConfig: vi.fn(),
    testServer: vi.fn(),
    refreshServer: vi.fn(),
    listRuntime: vi.fn(),
    ...overrides
  } as unknown as McpHost
}

describe('MCP IPC gateway refresh route', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('registers a narrow refresh route and forwards only a validated server and workspace', async () => {
    const sensitiveTransportDetail = 'Authorization: Bearer top-secret-token'
    const refreshResult = {
      ok: true,
      serverId: 'ignored-server-id',
      tools: [
        {
          name: 'search_notes',
          registeredName: 'mcp__demo_server__search_notes',
          description: 'Search learner notes.',
          descriptionTruncated: false,
          effectClass: 'privileged',
          registered: true,
          unexpectedTransportDetail: sensitiveTransportDetail
        }
      ],
      unexpectedTransportDetail: sensitiveTransportDetail
    } as unknown as McpTestServerResult
    const refreshServer = vi.fn().mockResolvedValue(refreshResult)
    registerMcpIpcGateway({ host: mcpHost({ refreshServer }) })

    const result = await handler(mcpInvokeChannels.refreshServer)(undefined, {
      serverId: '  demo_server  ',
      workspaceRoot: '  /tmp/studiumx-workspace  ',
      toolName: 'arbitrary_tool',
      arguments: { authorization: sensitiveTransportDetail }
    })

    expect(refreshServer).toHaveBeenCalledTimes(1)
    expect(refreshServer).toHaveBeenCalledWith('demo_server', '/tmp/studiumx-workspace')
    expect(result).toEqual({
      ok: true,
      serverId: 'demo_server',
      tools: [
        {
          name: 'search_notes',
          registeredName: 'mcp__demo_server__search_notes',
          description: 'Search learner notes.',
          descriptionTruncated: false,
          effectClass: 'privileged',
          registered: true
        }
      ]
    })
    expect(JSON.stringify(result)).not.toContain(sensitiveTransportDetail)
  })

  it('redacts manager failure details from the refresh response', async () => {
    const sensitiveTransportDetail = 'Authorization: Bearer top-secret-token'
    const refreshServer = vi.fn().mockResolvedValue({
      ok: false,
      code: 'mcp_server_unavailable',
      message: sensitiveTransportDetail,
      serverId: 'demo-server'
    } as unknown as McpTestServerResult)
    registerMcpIpcGateway({ host: mcpHost({ refreshServer }) })

    const result = await handler(mcpInvokeChannels.refreshServer)(undefined, {
      serverId: 'demo-server'
    })

    expect(result).toEqual({
      ok: false,
      code: 'mcp_server_unavailable',
      message: 'MCP 服务器不可用或已断开。',
      serverId: 'demo-server'
    })
    expect(JSON.stringify(result)).not.toContain(sensitiveTransportDetail)
  })

  it('rejects malformed server identifiers before any refresh side effect', async () => {
    const refreshServer = vi.fn()
    registerMcpIpcGateway({ host: mcpHost({ refreshServer }) })

    const result = await handler(mcpInvokeChannels.refreshServer)(undefined, {
      serverId: 'invalid server id!'
    })

    expect(refreshServer).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      code: 'mcp_invalid_config',
      message: 'A valid MCP serverId is required.',
      serverId: ''
    })
  })
})

describe('MCP IPC gateway OAuth authorize and revoke routes', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('rejects malformed authorize and revoke payloads before host side effects', async () => {
    const authorizeServer = vi.fn()
    const revokeAuthorization = vi.fn()
    registerMcpIpcGateway({ host: mcpHost({ authorizeServer, revokeAuthorization }) })

    for (const channel of [mcpInvokeChannels.authorizeServer, mcpInvokeChannels.revokeAuthorization]) {
      const result = await handler(channel)(undefined, {
        serverId: 'invalid server id!',
        authorizationUrl: 'https://evil.example/oauth?code=steal-me',
        accessToken: 'should-never-reach-host'
      })
      expect(result).toEqual({
        ok: false,
        code: 'mcp_invalid_config',
        message: 'A valid MCP serverId is required.',
        authorization: {
          serverId: '',
          state: 'authorization_failed',
          errorCode: 'authorization_failed'
        }
      })
    }

    expect(authorizeServer).not.toHaveBeenCalled()
    expect(revokeAuthorization).not.toHaveBeenCalled()
  })

  it('returns secret-free authorize and revoke success projections only', async () => {
    const sensitive = {
      authorizationUrl: 'https://auth.example/authorize?code_challenge=secret-challenge&oauth_state=secret-state',
      accessToken: 'access-token-leak',
      refreshToken: 'refresh-token-leak',
      code: 'authorization-code-leak',
      oauthState: 'oauth-state-leak',
      code_verifier: 'pkce-verifier-leak'
    }
    const authorizeServer = vi.fn().mockResolvedValue({
      ok: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorizing',
        errorCode: null,
        authorizationUrl: sensitive.authorizationUrl,
        accessToken: sensitive.accessToken,
        refreshToken: sensitive.refreshToken,
        code: sensitive.code,
        oauthState: sensitive.oauthState,
        code_verifier: sensitive.code_verifier
      },
      accessToken: sensitive.accessToken,
      authorizationUrl: sensitive.authorizationUrl
    })
    const revokeAuthorization = vi.fn().mockResolvedValue({
      ok: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorization_required',
        errorCode: null,
        authorizationUrl: sensitive.authorizationUrl,
        accessToken: sensitive.accessToken,
        refreshToken: sensitive.refreshToken,
        code: sensitive.code,
        oauthState: sensitive.oauthState,
        code_verifier: sensitive.code_verifier
      },
      accessToken: sensitive.accessToken
    })
    registerMcpIpcGateway({ host: mcpHost({ authorizeServer, revokeAuthorization }) })

    const authorizeResult = await handler(mcpInvokeChannels.authorizeServer)(undefined, {
      serverId: '  remote_oauth  ',
      workspaceRoot: '  /tmp/workspace  ',
      ...sensitive
    })
    const revokeResult = await handler(mcpInvokeChannels.revokeAuthorization)(undefined, {
      serverId: 'remote_oauth',
      ...sensitive
    })

    expect(authorizeServer).toHaveBeenCalledWith('remote_oauth', '/tmp/workspace')
    expect(revokeAuthorization).toHaveBeenCalledWith('remote_oauth', undefined)
    expect(authorizeResult).toEqual({
      ok: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorizing',
        errorCode: null
      }
    })
    expect(revokeResult).toEqual({
      ok: true,
      authorization: {
        serverId: 'remote_oauth',
        state: 'authorization_required',
        errorCode: null
      }
    })
    for (const result of [authorizeResult, revokeResult]) {
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('access-token-leak')
      expect(serialized).not.toContain('refresh-token-leak')
      expect(serialized).not.toContain('authorization-code-leak')
      expect(serialized).not.toContain('oauth-state-leak')
      expect(serialized).not.toContain('pkce-verifier-leak')
      expect(serialized).not.toContain('secret-challenge')
      expect(serialized).not.toContain('https://auth.example')
    }
  })
})


describe('MCP IPC gateway listed-tools projection (annotations display-only)', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('preserves display-only remote annotations on refresh and strips unknown keys', async () => {
    const sensitiveTransportDetail = 'Authorization: Bearer top-secret-token'
    const refreshServer = vi.fn().mockResolvedValue({
      ok: true,
      serverId: 'ignored',
      tools: [
        {
          name: 'search_notes',
          registeredName: 'mcp__demo_server__search_notes',
          description: 'Search learner notes.',
          descriptionTruncated: false,
          effectClass: 'privileged',
          registered: true,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
            title: 'Search',
            secretSmuggle: sensitiveTransportDetail,
            authorization: 'Bearer leak'
          },
          unexpectedTransportDetail: sensitiveTransportDetail
        }
      ]
    } as unknown as McpTestServerResult)
    registerMcpIpcGateway({ host: mcpHost({ refreshServer }) })

    const result = await handler(mcpInvokeChannels.refreshServer)(undefined, {
      serverId: 'demo_server'
    })

    expect(result).toEqual({
      ok: true,
      serverId: 'demo_server',
      tools: [
        {
          name: 'search_notes',
          registeredName: 'mcp__demo_server__search_notes',
          description: 'Search learner notes.',
          descriptionTruncated: false,
          effectClass: 'privileged',
          registered: true,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
            title: 'Search'
          }
        }
      ]
    })
    expect(JSON.stringify(result)).not.toContain(sensitiveTransportDetail)
    expect(JSON.stringify(result)).not.toContain('secretSmuggle')
    expect(JSON.stringify(result)).not.toContain('Bearer leak')
    // Effect remains privileged even when remote claims read-only.
    expect((result as { tools: Array<{ effectClass: string }> }).tools[0]?.effectClass).toBe(
      'privileged'
    )
  })

  it('projects testServer through the same listed-tools public contract', async () => {
    const testServer = vi.fn().mockResolvedValue({
      ok: true,
      serverId: 'demo_server',
      tools: [
        {
          name: 'echo',
          registeredName: 'mcp__demo_server__echo',
          description: 'Echo',
          descriptionTruncated: false,
          effectClass: 'privileged',
          registered: true,
          annotations: { readOnlyHint: true },
          internalDebug: { env: 'SECRET=1' }
        }
      ],
      unexpectedTransportDetail: 'SECRET=1'
    } as unknown as McpTestServerResult)
    registerMcpIpcGateway({ host: mcpHost({ testServer }) })

    const result = await handler(mcpInvokeChannels.testServer)(undefined, {
      serverId: 'demo_server',
      unexpected: 'x'
    })

    expect(testServer).toHaveBeenCalledWith('demo_server', undefined)
    expect(result).toEqual({
      ok: true,
      serverId: 'demo_server',
      tools: [
        {
          name: 'echo',
          registeredName: 'mcp__demo_server__echo',
          description: 'Echo',
          descriptionTruncated: false,
          effectClass: 'privileged',
          registered: true,
          annotations: { readOnlyHint: true }
        }
      ]
    })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(JSON.stringify(result)).not.toContain('internalDebug')
  })
})

