import { describe, expect, it } from 'vitest'

import { parseMcpOAuthCallback } from '../../src/main/mcp/oauth-callback'
import { createMcpOAuthPkceMaterial } from '../../src/main/mcp/oauth-pkce'

function callbackUrl(query: Record<string, string>): string {
  const params = new URLSearchParams(query)
  return `studiumx://mcp-oauth/callback?${params.toString()}`
}

describe('MCP OAuth deep-link callback parser', () => {
  it('accepts fixed-origin authorization-code and authorization-error callbacks', () => {
    const { state } = createMcpOAuthPkceMaterial()

    expect(parseMcpOAuthCallback(callbackUrl({ state, code: 'opaque-code_123' }))).toEqual({
      ok: true,
      callback: { kind: 'authorization_code', state, code: 'opaque-code_123' }
    })
    expect(parseMcpOAuthCallback(callbackUrl({ state, error: 'access_denied' }))).toEqual({
      ok: true,
      callback: { kind: 'authorization_error', state, error: 'access_denied' }
    })
  })

  it('rejects a different deep-link authority/path and callback fragments or credentials', () => {
    const { state } = createMcpOAuthPkceMaterial()

    for (const value of [
      `studiumx://wrong/callback?state=${state}&code=ok`,
      `studiumx://mcp-oauth/not-callback?state=${state}&code=ok`,
      `studiumx://user@mcp-oauth/callback?state=${state}&code=ok`,
      `studiumx://mcp-oauth/callback?state=${state}&code=ok#fragment`,
      `https://mcp-oauth/callback?state=${state}&code=ok`
    ]) {
      expect(parseMcpOAuthCallback(value)).toEqual({ ok: false, code: 'invalid_callback' })
    }
  })

  it('requires one valid state and exactly one code-or-error without duplicate or unknown query parameters', () => {
    const { state } = createMcpOAuthPkceMaterial()

    for (const value of [
      'studiumx://mcp-oauth/callback?state=invalid&code=ok',
      `studiumx://mcp-oauth/callback?state=${state}`,
      `studiumx://mcp-oauth/callback?state=${state}&code=ok&error=access_denied`,
      `studiumx://mcp-oauth/callback?state=${state}&code=one&code=two`,
      `studiumx://mcp-oauth/callback?state=${state}&code=ok&extra=value`,
      `studiumx://mcp-oauth/callback?state=${state}&error=not allowed`
    ]) {
      expect(parseMcpOAuthCallback(value)).toEqual({ ok: false, code: 'invalid_callback' })
    }
  })
})
