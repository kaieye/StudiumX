import { describe, expect, it } from 'vitest'

import {
  autoConnectEligibleServers,
  DEFAULT_MAX_AUTO_CONNECT,
  resolveMcpConfigSources,
  resolveUserOnlyConfig,
  userGateFromConfig,
  userLayerFromConfig
} from '../../src/shared/mcp/source-resolver'
import type { McpConfigSourceLayer } from '../../src/shared/mcp/source-types'
import type { UserMcpConfigV1, UserMcpServerV1 } from '../../src/shared/mcp/types'
import {
  defaultUserMcpConfig,
  parseUserMcpConfig,
  toPublicMcpConfig
} from '../../src/shared/mcp/config-schema'

function sampleServer(
  id: string,
  overrides: Partial<UserMcpServerV1> = {}
): UserMcpServerV1 {
  return {
    id,
    label: id,
    enabled: true,
    scope: 'user',
    workspaceRoot: null,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', id],
    cwd: null,
    envSecretRefs: {},
    envPlain: {},
    url: null,
    headersSecretRefs: {},
    headersPlain: {},
    timeoutMs: null,
    toolEffectOverrides: {},
    oauth: null,
    workspaceRootInjection: 'off',
    injectionIdentity: null,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    ...overrides
  }
}

function layer(
  kind: McpConfigSourceLayer['origin']['kind'],
  servers: UserMcpServerV1[],
  label = kind
): McpConfigSourceLayer {
  return { origin: { kind, label }, servers }
}

describe('MCP source resolver (ADR-0013)', () => {
  it('prefers higher precedence sources for the same id (cli > env > user > workspace)', () => {
    const view = resolveMcpConfigSources({
      userGate: { enabled: true, autoConnect: false },
      layers: [
        layer('workspace', [sampleServer('shared', { label: 'from-workspace' })]),
        layer('user', [sampleServer('shared', { label: 'from-user' })]),
        layer('environment', [sampleServer('shared', { label: 'from-env' })]),
        layer('cli', [sampleServer('shared', { label: 'from-cli' })])
      ]
    })

    expect(view.effectiveServers).toHaveLength(1)
    expect(view.effectiveServers[0]!.server.label).toBe('from-cli')
    expect(view.effectiveServers[0]!.source.kind).toBe('cli')
    expect(view.shadowed).toHaveLength(3)
    expect(view.shadowed.map((s) => s.source.kind).sort()).toEqual([
      'environment',
      'user',
      'workspace'
    ])
    expect(view.shadowed.every((s) => s.reason === 'id_collision')).toBe(true)
  })

  it('keeps distinct ids from lower sources when not shadowed', () => {
    const view = resolveMcpConfigSources({
      userGate: { enabled: true, autoConnect: false },
      layers: [
        layer('user', [sampleServer('user-only')]),
        layer('workspace', [sampleServer('ws-only'), sampleServer('user-only', { label: 'ws-dupe' })])
      ]
    })
    const ids = view.effectiveServers.map((e) => e.server.id).sort()
    expect(ids).toEqual(['user-only', 'ws-only'])
    expect(view.effectiveServers.find((e) => e.server.id === 'user-only')!.source.kind).toBe(
      'user'
    )
    expect(view.shadowed).toHaveLength(1)
    expect(view.shadowed[0]!.server.label).toBe('ws-dupe')
  })

  it('takes root enabled and autoConnect only from userGate', () => {
    const view = resolveMcpConfigSources({
      userGate: { enabled: false, autoConnect: false },
      layers: [layer('workspace', [sampleServer('x', { enabled: true })])]
    })
    expect(view.enabled).toBe(false)
    expect(view.autoConnect).toBe(false)
    // Winner list still materializes definitions for UI; session manager gates on root.
    expect(view.effectiveServers).toHaveLength(1)
  })

  it('defaults autoConnect eligibility empty when gates off', () => {
    const off = resolveMcpConfigSources({
      userGate: { enabled: true, autoConnect: false },
      layers: [layer('user', [sampleServer('a')])]
    })
    expect(autoConnectEligibleServers(off)).toEqual([])

    const rootOff = resolveMcpConfigSources({
      userGate: { enabled: false, autoConnect: true },
      layers: [layer('user', [sampleServer('a')])]
    })
    expect(autoConnectEligibleServers(rootOff)).toEqual([])
  })

  it('lists enabled winners when both gates true and respects max concurrent', () => {
    const servers = Array.from({ length: 6 }, (_, i) => sampleServer(`s${i}`))
    const view = resolveMcpConfigSources({
      userGate: { enabled: true, autoConnect: true },
      layers: [layer('user', servers)]
    })
    const eligible = autoConnectEligibleServers(view)
    expect(eligible).toHaveLength(DEFAULT_MAX_AUTO_CONNECT)
    expect(eligible.every((e) => e.server.enabled)).toBe(true)

    const disabled = resolveMcpConfigSources({
      userGate: { enabled: true, autoConnect: true },
      layers: [layer('user', [sampleServer('off', { enabled: false }), sampleServer('on')])]
    })
    expect(autoConnectEligibleServers(disabled).map((e) => e.server.id)).toEqual(['on'])
  })

  it('skips OAuth servers unless isOAuthReady returns true', () => {
    const oauthServer = sampleServer('remote', {
      transport: 'http',
      command: null,
      args: [],
      url: 'https://example.com/mcp',
      oauth: {
        authorizationEndpoint: 'https://example.com/auth',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client',
        scopes: [],
        resource: null
      }
    })
    const view = resolveMcpConfigSources({
      userGate: { enabled: true, autoConnect: true },
      layers: [layer('user', [oauthServer, sampleServer('local')])]
    })
    expect(autoConnectEligibleServers(view).map((e) => e.server.id)).toEqual(['local'])
    expect(
      autoConnectEligibleServers(view, { isOAuthReady: () => true }).map((e) => e.server.id).sort()
    ).toEqual(['local', 'remote'])
  })

  it('user-only resolve matches user config servers and gates', () => {
    const config: UserMcpConfigV1 = {
      schemaVersion: 1,
      enabled: true,
      autoConnect: false,
      servers: [sampleServer('u1')]
    }
    const view = resolveUserOnlyConfig(config)
    expect(view.effectiveServers.map((e) => e.server.id)).toEqual(['u1'])
    expect(view.effectiveServers[0]!.source.kind).toBe('user')
    expect(view.shadowed).toEqual([])
    expect(userGateFromConfig(config)).toEqual({ enabled: true, autoConnect: false })
    expect(userLayerFromConfig(config).servers).toHaveLength(1)
  })

  it('warns and skips duplicate ids inside a single layer', () => {
    const view = resolveMcpConfigSources({
      userGate: { enabled: true, autoConnect: false },
      layers: [
        layer('user', [
          sampleServer('dup', { label: 'first' }),
          sampleServer('dup', { label: 'second' })
        ])
      ]
    })
    expect(view.effectiveServers).toHaveLength(1)
    expect(view.effectiveServers[0]!.server.label).toBe('first')
    expect(view.warnings.some((w) => /duplicate server id "dup"/.test(w))).toBe(true)
  })
})

describe('UserMcpConfig autoConnect field (ADR-0013)', () => {
  it('default document enables root MCP and autoConnect (Zcode-like)', () => {
    const def = defaultUserMcpConfig()
    expect(def.enabled).toBe(true)
    expect(def.autoConnect).toBe(true)
    expect(toPublicMcpConfig(def).autoConnect).toBe(true)
    expect(userGateFromConfig(def)).toEqual({ enabled: true, autoConnect: true })
  })

  it('omitted autoConnect with enabled true is effective true (omit means on)', () => {
    const parsed = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      servers: []
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // Durable parse leaves omit as undefined (not forced false).
    expect(parsed.config.autoConnect).toBeUndefined()
    expect(toPublicMcpConfig(parsed.config).autoConnect).toBe(true)
    expect(userGateFromConfig(parsed.config)).toEqual({ enabled: true, autoConnect: true })
  })

  it('explicit autoConnect false still disables when enabled', () => {
    const config: UserMcpConfigV1 = {
      schemaVersion: 1,
      enabled: true,
      autoConnect: false,
      servers: []
    }
    expect(userGateFromConfig(config)).toEqual({ enabled: true, autoConnect: false })
    expect(toPublicMcpConfig(config).autoConnect).toBe(false)
  })

  it('accepts autoConnect true; non-boolean present values coerce to false', () => {
    const ok = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      autoConnect: true,
      servers: []
    })
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.config.autoConnect).toBe(true)

    const coerced = parseUserMcpConfig({
      schemaVersion: 1,
      enabled: true,
      autoConnect: 'yes',
      servers: []
    })
    expect(coerced.ok).toBe(true)
    if (!coerced.ok) return
    expect(coerced.config.autoConnect).toBe(false)
    expect(userGateFromConfig(coerced.config).autoConnect).toBe(false)
  })
})
