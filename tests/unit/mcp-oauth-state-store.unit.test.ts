import { describe, expect, it } from 'vitest'

import { createMcpOAuthPkceMaterial } from '../../src/main/mcp/oauth-pkce'
import {
  McpOAuthPendingStateStore,
  McpOAuthPendingStateStoreError
} from '../../src/main/mcp/oauth-state-store'

function pending(serverId = 'server_one') {
  const pkce = createMcpOAuthPkceMaterial()
  return { serverId, state: pkce.state, verifier: pkce.verifier }
}

describe('MCP OAuth pending-state store', () => {
  it('consumes a valid state exactly once without retaining entries', () => {
    const store = new McpOAuthPendingStateStore()
    const input = pending()
    store.issue(input)

    expect(store.size).toBe(1)
    expect(store.consume(input.state)).toEqual(input)
    expect(store.consume(input.state)).toBeNull()
    expect(store.size).toBe(0)
  })

  it('expires pending authorization state and treats malformed state as absent', () => {
    let now = 1_000
    const store = new McpOAuthPendingStateStore({ now: () => now, ttlMs: 100 })
    const input = pending()
    store.issue(input)
    now += 100

    expect(store.consume(input.state)).toBeNull()
    expect(store.consume('not-a-valid-state')).toBeNull()
    expect(store.size).toBe(0)
  })

  it('fails closed at capacity instead of evicting an in-flight authorization', () => {
    const store = new McpOAuthPendingStateStore({ maxEntries: 1 })
    const first = pending('server_one')
    store.issue(first)

    expect(() => store.issue(pending('server_two'))).toThrow(McpOAuthPendingStateStoreError)
    try {
      store.issue(pending('server_two'))
    } catch (error) {
      expect(error).toMatchObject({ code: 'pending_state_capacity' })
    }
    expect(store.consume(first.state)).toEqual(first)
  })

  it('rejects invalid server ids, state, verifier, and duplicate state without exposing values', () => {
    const store = new McpOAuthPendingStateStore()
    const input = pending()

    expect(() => store.issue({ ...input, serverId: 'bad server id' })).toThrow(
      McpOAuthPendingStateStoreError
    )
    expect(() => store.issue({ ...input, state: 'invalid' })).toThrow(McpOAuthPendingStateStoreError)
    expect(() => store.issue({ ...input, verifier: 'invalid' })).toThrow(
      McpOAuthPendingStateStoreError
    )

    store.issue(input)
    expect(() => store.issue(input)).toThrow(McpOAuthPendingStateStoreError)
    expect(store.size).toBe(1)
  })
})
