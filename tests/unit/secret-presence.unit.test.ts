import { describe, expect, it } from 'vitest'
import {
  hasAnySecretConfigured,
  isSecretConfigured,
  isSecretFieldKey,
  projectSecretPresenceMap,
  SECRET_FIELD_KEY_RE
} from '../../src/shared/secret-presence'
import {
  parseUserMcpConfig,
  toPublicMcpConfig
} from '../../src/shared/mcp/config-schema'
import { previewSupportBundle } from '../../src/main/support-bundle'
import { createTeachingDoctorConfigFactsCollector } from '../../src/main/observability/teaching-doctor-config-facts'

describe('secret-presence (ADR-0006)', () => {
  it('detects secret-bearing field keys without matching lifecycle labels loosely', () => {
    expect(isSecretFieldKey('apiKey')).toBe(true)
    expect(isSecretFieldKey('Authorization')).toBe(true)
    expect(isSecretFieldKey('access_token')).toBe(true)
    expect(isSecretFieldKey('NODE_ENV')).toBe(false)
    expect(SECRET_FIELD_KEY_RE.test('API_KEY')).toBe(true)
  })

  it('isSecretConfigured is presence-only and never returns the value', () => {
    expect(isSecretConfigured('sk-live-super-secret-key-do-not-leak')).toBe(true)
    expect(isSecretConfigured('   ')).toBe(false)
    expect(isSecretConfigured('')).toBe(false)
    expect(isSecretConfigured(null)).toBe(false)
    expect(isSecretConfigured(true)).toBe(true)
    expect(isSecretConfigured(false)).toBe(false)
    expect(hasAnySecretConfigured(['', 'x'])).toBe(true)
    expect(hasAnySecretConfigured(['', null])).toBe(false)
  })

  it('projectSecretPresenceMap maps refs to booleans and sorts keys', () => {
    const map = projectSecretPresenceMap({
      TOKEN: 'ref_abc',
      EMPTY: '',
      Z_LAST: 'keep'
    })
    expect(Object.keys(map)).toEqual(['EMPTY', 'TOKEN', 'Z_LAST'])
    expect(map).toEqual({ EMPTY: false, TOKEN: true, Z_LAST: true })
    expect(JSON.stringify(map)).not.toContain('ref_abc')
    expect(JSON.stringify(map)).not.toContain('keep')
  })
})

describe('MCP public DTO presence-only (ADR-0013)', () => {
  it('toPublicMcpConfig never includes secret refs and scrubs credential-shaped args', () => {
    const parsed = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      servers: [
        {
          id: 'demo',
          label: 'Demo',
          enabled: true,
          scope: 'user',
          workspaceRoot: null,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'pkg', '--api-key=sk-live-must-not-public-abcdef012345'],
          cwd: null,
          envSecretRefs: { TOKEN: 'ref_env_should_not_leak' },
          envPlain: { NODE_ENV: 'production' },
          url: null,
          headersSecretRefs: {},
          headersPlain: {},
          timeoutMs: null,
          toolEffectOverrides: {},
          oauth: null,
          workspaceRootInjection: 'off',
          injectionIdentity: null,
          createdAt: '2026-07-20T10:00:00.000Z',
          updatedAt: '2026-07-20T10:00:00.000Z'
        }
      ]
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const pub = toPublicMcpConfig(parsed.config)
    const json = JSON.stringify(pub)
    expect(pub.servers[0]?.envSecretConfigured).toEqual({ TOKEN: true })
    expect(pub.servers[0]?.envPlainKeys).toEqual(['NODE_ENV'])
    expect(json).not.toContain('ref_env_should_not_leak')
    expect(json).not.toContain('sk-live-must-not-public')
    expect(json).toMatch(/\[redacted\]/)
  })
})

describe('Doctor config facts presence-only (ADR-0006)', () => {
  it('collects providerConfigured without embedding raw apiKey', async () => {
    const secret = 'sk-live-doctor-must-not-leak-abcdef0123456789'
    const collector = createTeachingDoctorConfigFactsCollector({
      async load() {
        return {
          provider: {
            activeProviderId: 'openai',
            providers: [{ id: 'openai', apiKey: secret, models: [] }]
          },
          generator: { model: '' }
        }
      }
    })
    const partial = await collector.collect()
    const blob = JSON.stringify(partial)
    expect(partial.config?.providerConfigured).toBe(true)
    expect(blob).not.toContain(secret)
    expect(blob).not.toMatch(/sk-live-doctor/)
  })
})

describe('support-bundle deny secret-shaped smuggled keys (ADR-0006 / ADR-0007)', () => {
  it('redacts newly smuggled secret field names while keeping presence booleans', () => {
    const secret = 'sk-live-smuggle-presence-abcdef0123456789'
    const preview = previewSupportBundle({
      now: () => '2026-07-24T00:00:00.000Z',
      environment: {
        platform: 'win32',
        appVersion: '0.0.0-test',
        // @ts-expect-error intentional smuggle
        customApiKey: secret,
        // @ts-expect-error intentional smuggle
        oauthClientSecret: secret,
        // Legitimate presence flag must survive
        hasApiKey: true
      } as never
    })
    const env = preview.sections.find((s) => s.id === 'environment')
    const json = JSON.stringify(env?.payload ?? {})
    expect(json).not.toContain(secret)
    expect(json).not.toMatch(/sk-live-smuggle/)
    expect(json).toContain('hasApiKey')
    // Smuggled secret values replaced (denied) — boolean presence flag kept.
    expect(JSON.stringify(preview)).toMatch(/hasApiKey":true|"hasApiKey": true/)
  })
})
