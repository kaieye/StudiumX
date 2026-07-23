import { describe, expect, it, vi } from 'vitest'

import {
  extractMcpOAuthDeepLink,
  installMcpOAuthDeepLinkBridge,
  isMcpOAuthCallbackCandidate
} from '../../src/main/mcp/oauth-deep-link-bridge'
import { MCP_OAUTH_CALLBACK_URI } from '../../src/shared/mcp/oauth-types'

const VALID_CALLBACK = `${MCP_OAUTH_CALLBACK_URI}?state=s&code=c`

function createFakeApp() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    setAsDefaultProtocolClient: vi.fn().mockReturnValue(true),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return undefined as never
    }),
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    }
  }
}

describe('MCP OAuth deep-link bridge (ADR-0135)', () => {
  it('extracts only studiumx://mcp-oauth/callback candidates from argv', () => {
    expect(extractMcpOAuthDeepLink(['--flag', VALID_CALLBACK, 'other'])).toBe(VALID_CALLBACK)
    expect(extractMcpOAuthDeepLink(['studiumx://other/path', 'https://example.com'])).toBeNull()
    expect(isMcpOAuthCallbackCandidate(VALID_CALLBACK)).toBe(true)
    expect(isMcpOAuthCallbackCandidate('studiumx://mcp-oauth/other')).toBe(false)
  })

  it('routes open-url and second-instance only when the fixed callback prefix matches', async () => {
    const app = createFakeApp()
    const handleDeepLink = vi.fn().mockResolvedValue(undefined)

    installMcpOAuthDeepLinkBridge({
      app: app as never,
      handleDeepLink,
      platform: 'darwin',
      argv: []
    })

    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('studiumx')

    const preventDefault = vi.fn()
    app.emit('open-url', { preventDefault }, VALID_CALLBACK)
    app.emit('open-url', { preventDefault }, 'studiumx://evil/callback')
    app.emit('second-instance', {}, ['--x', VALID_CALLBACK], '', {})
    app.emit('second-instance', {}, ['studiumx://not-oauth'], '', {})

    await vi.waitFor(() => {
      expect(handleDeepLink).toHaveBeenCalledTimes(2)
    })
    expect(handleDeepLink).toHaveBeenNthCalledWith(1, VALID_CALLBACK)
    expect(handleDeepLink).toHaveBeenNthCalledWith(2, VALID_CALLBACK)
    expect(preventDefault).toHaveBeenCalled()
  })

  it('handles non-darwin cold-start argv and swallows handler failures', async () => {
    const app = createFakeApp()
    const handleDeepLink = vi.fn().mockRejectedValue(new Error('boom'))

    installMcpOAuthDeepLinkBridge({
      app: app as never,
      handleDeepLink,
      platform: 'win32',
      argv: ['electron', VALID_CALLBACK]
    })

    await vi.waitFor(() => {
      expect(handleDeepLink).toHaveBeenCalledWith(VALID_CALLBACK)
    })
  })

  it('does not cold-start route on darwin from argv', () => {
    const app = createFakeApp()
    const handleDeepLink = vi.fn()

    installMcpOAuthDeepLinkBridge({
      app: app as never,
      handleDeepLink,
      platform: 'darwin',
      argv: [VALID_CALLBACK]
    })

    expect(handleDeepLink).not.toHaveBeenCalled()
  })
})
