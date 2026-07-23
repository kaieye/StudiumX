import { describe, expect, it } from 'vitest'

import {
  defaultUserMcpConfig,
  fingerprintUserMcpConfig,
  isUserMcpConfigDocument,
  parseUserMcpConfig,
  toPublicMcpConfig
} from '../../src/shared/mcp/config-schema'
import {
  MCP_SECRET_REF_KEEP,
  MCP_SECRET_REF_PENDING
} from '../../src/shared/mcp/types'

function sampleServer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo',
    label: 'Demo Server',
    enabled: false,
    scope: 'user',
    workspaceRoot: null,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'demo'],
    cwd: null,
    envSecretRefs: {},
    envPlain: {},
    url: null,
    headersSecretRefs: {},
    headersPlain: {},
    timeoutMs: null,
    toolEffectOverrides: {},
        workspaceRootInjection: 'off' as const,
        injectionIdentity: null,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides
  }
}

function parseServer(overrides: Record<string, unknown> = {}) {
  return parseUserMcpConfig({
    schemaVersion: 1,
    enabled: true,
    servers: [sampleServer(overrides)]
  })
}

describe('UserMcpConfig parse (ADR-0128)', () => {
  it('defaults to root off and empty servers', () => {
    const config = defaultUserMcpConfig()
    expect(config.enabled).toBe(true)
    expect(config.servers).toEqual([])
    expect(config.schemaVersion).toBe(1)
    expect(config.honorRemoteReadOnlyHint).toBe(false)
    expect(config.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('parses honorRemoteReadOnlyHint opt-in and projects public false by default', () => {
    const omitted = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      servers: []
    })
    expect(omitted.ok).toBe(true)
    if (!omitted.ok) return
    expect(omitted.config.honorRemoteReadOnlyHint).toBeUndefined()
    expect(toPublicMcpConfig(omitted.config).honorRemoteReadOnlyHint).toBe(false)

    const on = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      honorRemoteReadOnlyHint: true,
      servers: []
    })
    expect(on.ok).toBe(true)
    if (!on.ok) return
    expect(on.config.honorRemoteReadOnlyHint).toBe(true)
    expect(toPublicMcpConfig(on.config).honorRemoteReadOnlyHint).toBe(true)

    const coerced = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      honorRemoteReadOnlyHint: 'yes',
      servers: []
    })
    expect(coerced.ok).toBe(true)
    if (!coerced.ok) return
    expect(coerced.config.honorRemoteReadOnlyHint).toBe(false)
  })

  it('rejects unknown schema versions fail-closed', () => {
    const result = parseUserMcpConfig({
      schemaVersion: 99,
      enabled: true,
      servers: []
    })
    expect(result.ok).toBe(false)
  })

  it('rejects secret-looking plain env and header keys', () => {
    const env = parseServer({ envPlain: { API_KEY: 'secret' } })
    expect(env.ok).toBe(false)
    if (!env.ok) expect(env.reason).toMatch(/envPlain|secret/i)

    const headers = parseServer({
      transport: 'http',
      command: null,
      args: [],
      url: 'https://example.com/mcp',
      headersPlain: { Authorization: 'Bearer secret' }
    })
    expect(headers.ok).toBe(false)
    if (!headers.ok) expect(headers.reason).toMatch(/headersPlain|secret/i)
  })

  it('accepts streamableHttp and normalizes it to http', () => {
    const result = parseServer({
      transport: 'streamableHttp',
      command: null,
      args: [],
      url: 'https://example.com/mcp',
      headersPlain: { 'X-Client': 'StudiumX' },
      timeoutMs: 30_000
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.servers[0]).toMatchObject({
      transport: 'http',
      command: null,
      args: [],
      url: 'https://example.com/mcp',
      headersPlain: { 'X-Client': 'StudiumX' },
      timeoutMs: 30_000
    })
  })

  it('accepts SSE with URL, plain headers, and secret header refs', () => {
    const result = parseServer({
      transport: 'sse',
      command: null,
      args: [],
      url: 'https://example.com/events',
      headersPlain: { Accept: 'text/event-stream' },
      headersSecretRefs: { Authorization: 'ref_auth' }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.servers[0]).toMatchObject({
      transport: 'sse',
      headersPlain: { Accept: 'text/event-stream' },
      headersSecretRefs: { Authorization: 'ref_auth' }
    })
  })

  it('only accepts http and https URLs for HTTP transports', () => {
    for (const url of ['file:///tmp/mcp', 'ftp://example.com/mcp', 'not-a-url']) {
      const result = parseServer({
        transport: 'http',
        command: null,
        args: [],
        url
      })
      expect(result.ok).toBe(false)
    }
  })

  it('requires an absolute root for workspace scope', () => {
    const missing = parseServer({ scope: 'workspace', workspaceRoot: null })
    expect(missing.ok).toBe(false)

    const relative = parseServer({ scope: 'workspace', workspaceRoot: './workspace' })
    expect(relative.ok).toBe(false)

    const absolute = parseServer({ scope: 'workspace', workspaceRoot: '/tmp/studiumx-workspace' })
    expect(absolute.ok).toBe(true)
    if (absolute.ok) {
      expect(absolute.config.servers[0]?.workspaceRoot).toBe('/tmp/studiumx-workspace')
    }
  })

  it('normalizes workspaceRoot to null for user scope', () => {
    const result = parseServer({ scope: 'user', workspaceRoot: '/tmp/ignored-workspace' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.servers[0]?.workspaceRoot).toBeNull()
  })

  it('requires timeoutMs to be a positive integer', () => {
    for (const timeoutMs of [0, -1, 1.5, '30000']) {
      expect(parseServer({ timeoutMs }).ok).toBe(false)
    }
    expect(parseServer({ timeoutMs: 1 }).ok).toBe(true)
    expect(parseServer({ timeoutMs: null }).ok).toBe(true)
  })

  it('rejects invalid effect overrides', () => {
    const result = parseServer({ toolEffectOverrides: { x: 'yolo' } })
    expect(result.ok).toBe(false)
  })

  it('accepts a valid stdio server and public view never includes secret refs', () => {
    const result = parseServer({
      enabled: true,
      envSecretRefs: { TOKEN: 'ref_env' },
      envPlain: { NODE_ENV: 'production' }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pub = toPublicMcpConfig(result.config)
    expect(pub.servers[0]?.envSecretConfigured).toEqual({ TOKEN: true })
    expect(pub.servers[0]?.envPlainKeys).toEqual(['NODE_ENV'])
    expect(pub.servers[0]?.envPlain).toEqual({ NODE_ENV: 'production' })
    expect(JSON.stringify(pub)).not.toContain('ref_env')
    expect(fingerprintUserMcpConfig(result.config)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not expose HTTP header secret refs in the public DTO', () => {
    const result = parseServer({
      transport: 'http',
      command: null,
      args: [],
      url: 'https://example.com/mcp',
      headersSecretRefs: { Authorization: 'ref_header' },
      headersPlain: { 'X-Client': 'StudiumX' }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pub = toPublicMcpConfig(result.config)
    expect(pub.servers[0]?.headersSecretConfigured).toEqual({ Authorization: true })
    expect(pub.servers[0]?.headersPlain).toEqual({ 'X-Client': 'StudiumX' })
    expect(JSON.stringify(pub)).not.toContain('ref_header')
  })

  it('rejects transient renderer secret markers as durable documents', () => {
    for (const refId of [MCP_SECRET_REF_KEEP, MCP_SECRET_REF_PENDING]) {
      const document = {
        schemaVersion: 1,
        enabled: true,
        servers: [sampleServer({ envSecretRefs: { TOKEN: refId } })]
      }
      expect(parseUserMcpConfig(document).ok).toBe(true)
      expect(isUserMcpConfigDocument(document)).toBe(false)
    }
  })

  it('defaults root MCP enabled (Zcode-like; workspace files still cannot write user gate)', () => {
    const empty = defaultUserMcpConfig()
    expect(empty.enabled).toBe(true)
    expect(empty.servers).toEqual([])
    const bad = parseUserMcpConfig({ schemaVersion: 1, enabled: true, servers: 'not-array' })
    expect(bad.ok).toBe(false)
  })
})
