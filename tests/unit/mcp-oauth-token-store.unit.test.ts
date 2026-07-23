import { describe, expect, it } from 'vitest'

import {
  McpOAuthTokenStore,
  McpOAuthTokenStoreError,
  type McpOAuthTokenCipher
} from '../../src/main/mcp/oauth-token-store'

function cipher(available = true): McpOAuthTokenCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0xa5)),
    decryptString: (value) =>
      Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString('utf8')
  }
}

describe('MCP OAuth encrypted token store', () => {
  it('stores an encrypted token record and only reads it through the main-only store', () => {
    const encryptedIndex = new Map<string, string>()
    const store = new McpOAuthTokenStore({ cipher: cipher(), encryptedIndex })
    const secret = 'access-token-that-must-not-be-public'

    store.store('server_one', {
      accessToken: secret,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: 1_700_000_000_000,
      scope: 'mcp.read'
    })

    const serializedIndex = JSON.stringify([...encryptedIndex])
    expect(serializedIndex).not.toContain(secret)
    expect(serializedIndex).not.toContain('server_one')
    expect(store.read('server_one')).toEqual({
      accessToken: secret,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: 1_700_000_000_000,
      scope: 'mcp.read'
    })
    expect(store.has('server_one')).toBe(true)

    store.forget('server_one')
    expect(store.read('server_one')).toBeNull()
  })

  it('fails closed when encryption is unavailable or input is invalid', () => {
    const unavailable = new McpOAuthTokenStore({ cipher: cipher(false), encryptedIndex: new Map() })
    expect(() => unavailable.store('server_one', { accessToken: 'token' })).toThrow(
      McpOAuthTokenStoreError
    )
    try {
      unavailable.store('server_one', { accessToken: 'token' })
    } catch (error) {
      expect(error).toMatchObject({ code: 'token_storage_unavailable' })
    }

    const store = new McpOAuthTokenStore({ cipher: cipher(), encryptedIndex: new Map() })
    expect(() => store.store('bad server id', { accessToken: 'token' })).toThrow(
      McpOAuthTokenStoreError
    )
    expect(() => store.store('server_one', { accessToken: '' })).toThrow(McpOAuthTokenStoreError)
  })

  it('treats corrupt encrypted records as absent and removes them without echoing plaintext', () => {
    const encryptedIndex = new Map<string, string>()
    const store = new McpOAuthTokenStore({ cipher: cipher(), encryptedIndex })
    store.store('server_one', { accessToken: 'known-secret' })
    const [key] = encryptedIndex.keys()
    encryptedIndex.set(key, 'mcpOauthToken:v1:not-valid-encrypted-json')

    expect(store.read('server_one')).toBeNull()
    expect(encryptedIndex.size).toBe(0)
  })
})
