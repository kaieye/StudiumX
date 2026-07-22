import { describe, expect, it } from 'vitest'

import {
  defaultUserMcpConfig,
  fingerprintUserMcpConfig,
  parseUserMcpConfig,
  toPublicMcpConfig
} from '../../src/shared/mcp/config-schema'

function sampleServer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo',
    label: 'Demo Server',
    enabled: false,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'demo'],
    cwd: null,
    envSecretRefs: {},
    envPlain: {},
    url: null,
    headersSecretRefs: {},
    toolEffectOverrides: {},
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides
  }
}

describe('UserMcpConfig parse (ADR-0128)', () => {
  it('defaults to root off and empty servers', () => {
    const config = defaultUserMcpConfig()
    expect(config.enabled).toBe(false)
    expect(config.servers).toEqual([])
    expect(config.schemaVersion).toBe(1)
    expect(config.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects unknown schema versions fail-closed', () => {
    const result = parseUserMcpConfig({
      schemaVersion: 99,
      enabled: true,
      servers: []
    })
    expect(result.ok).toBe(false)
  })

  it('rejects secret-looking envPlain keys', () => {
    const result = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: false,
      servers: [sampleServer({ envPlain: { API_KEY: 'secret' } })]
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/envPlain|secret/i)
  })

  it('rejects non-stdio transport in Phase A', () => {
    const result = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      servers: [sampleServer({ transport: 'sse' })]
    })
    expect(result.ok).toBe(false)
  })

  it('rejects invalid effect overrides', () => {
    const result = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      servers: [sampleServer({ toolEffectOverrides: { x: 'yolo' } })]
    })
    expect(result.ok).toBe(false)
  })

  it('accepts a valid stdio server and public view never includes secret values', () => {
    const result = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      servers: [
        sampleServer({
          enabled: true,
          envSecretRefs: { TOKEN: 'ref_1' },
          envPlain: { NODE_ENV: 'production' }
        })
      ]
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pub = toPublicMcpConfig(result.config)
    expect(pub.servers[0]?.envSecretConfigured).toEqual({ TOKEN: true })
    expect(pub.servers[0]?.envPlainKeys).toEqual(['NODE_ENV'])
    expect(JSON.stringify(pub)).not.toContain('ref_1')
    expect(fingerprintUserMcpConfig(result.config)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps root enabled false by default so workspace files cannot open MCP authority (ADR-0128 §11.5)', () => {
    const empty = defaultUserMcpConfig()
    expect(empty.enabled).toBe(false)
    expect(empty.servers).toEqual([])
    // Config is userData-scoped; parse still fails closed if someone smuggles enabled without schema
    const bad = parseUserMcpConfig({ schemaVersion: 1, enabled: true, servers: 'not-array' })
    expect(bad.ok).toBe(false)
  })

})