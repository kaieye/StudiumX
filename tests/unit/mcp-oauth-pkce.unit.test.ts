import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  createMcpOAuthPkceMaterial,
  isValidMcpOAuthPkceVerifier,
  isValidMcpOAuthState,
  mcpOAuthStateEquals
} from '../../src/main/mcp/oauth-pkce'

describe('MCP OAuth PKCE primitives', () => {
  it('generates unique high-entropy S256 PKCE material and an opaque state', () => {
    const first = createMcpOAuthPkceMaterial()
    const second = createMcpOAuthPkceMaterial()

    expect(first.method).toBe('S256')
    expect(first.verifier).not.toBe(second.verifier)
    expect(first.state).not.toBe(second.state)
    expect(first.verifier).toHaveLength(64)
    expect(first.state).toHaveLength(43)
    expect(isValidMcpOAuthPkceVerifier(first.verifier)).toBe(true)
    expect(isValidMcpOAuthState(first.state)).toBe(true)
    expect(first.challenge).toBe(
      createHash('sha256').update(first.verifier, 'ascii').digest('base64url')
    )
  })

  it('rejects malformed values and compares valid states safely', () => {
    const { state } = createMcpOAuthPkceMaterial()

    expect(isValidMcpOAuthState('short')).toBe(false)
    expect(isValidMcpOAuthState(`${state}=`)).toBe(false)
    expect(isValidMcpOAuthPkceVerifier('a'.repeat(42))).toBe(false)
    expect(isValidMcpOAuthPkceVerifier(`${'a'.repeat(42)}!`)).toBe(false)
    expect(mcpOAuthStateEquals(state, state)).toBe(true)
    expect(mcpOAuthStateEquals(state, createMcpOAuthPkceMaterial().state)).toBe(false)
  })
})
