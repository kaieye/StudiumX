import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkSyncSession } from '../../src/renderer/src/sync/session-check'
import { clearSyncAuth, getSyncState, setSyncAuth } from '../../src/renderer/src/sync/sync-store'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('checkSyncSession', () => {
  beforeEach(() => {
    clearSyncAuth()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('keeps the persisted login when token refresh is temporarily unavailable', async () => {
    setSyncAuth({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1' }
    })
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401))
      .mockRejectedValueOnce(new Error('backend restarting')) as typeof fetch

    await expect(checkSyncSession()).resolves.toEqual({ isValid: true })
    expect(getSyncState()).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1' }
    })
  })

  it('clears the persisted login when the refresh token is rejected', async () => {
    setSyncAuth({ accessToken: 'access-token', refreshToken: 'refresh-token' })
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401)) as typeof fetch

    await expect(checkSyncSession()).resolves.toEqual({ isValid: false, reason: 'refresh_failed' })
    expect(getSyncState()).toMatchObject({ accessToken: null, refreshToken: null, user: null })
  })
})
