/**
 * TeachingDoctor MCP status check (ADR-0013).
 */
import { describe, expect, it } from 'vitest'

import { runTeachingDoctor } from '../../src/main/teaching-doctor'
import { mapMcpFacts } from '../../src/main/observability/teaching-doctor-mcp-facts'
import type { UserMcpConfigV1 } from '../../src/shared/mcp/types'

const emptyConfig: UserMcpConfigV1 = {
  schemaVersion: 1,
  enabled: false,
  servers: [],
  fingerprint: 'x'
}

describe('TeachingDoctor mcp_status', () => {
  it('skips when facts missing', () => {
    const report = runTeachingDoctor({}, '2026-07-22T00:00:00.000Z')
    const check = report.checks.find((c) => c.checkId === 'mcp_status')
    expect(check?.result).toBe('skipped')
  })

  it('ok when root disabled (default)', () => {
    const report = runTeachingDoctor(
      {
        mcp: mapMcpFacts(emptyConfig, [])
      },
      '2026-07-22T00:00:00.000Z'
    )
    const check = report.checks.find((c) => c.checkId === 'mcp_status')
    expect(check?.result).toBe('ok')
    expect(check?.summary).toMatch(/off|disabled|default/i)
  })

  it('maps Phase A inventory aggregates and OAuth public state without exposing internals', () => {
    const config: UserMcpConfigV1 = {
      schemaVersion: 1,
      enabled: true,
      servers: [
        {
          id: 'demo',
          label: 'Demo',
          enabled: true,
          scope: 'user',
          workspaceRoot: null,
          transport: 'http',
          command: null,
          args: [],
          cwd: null,
          envSecretRefs: { TOKEN: 'secret-ref' },
          envPlain: {},
          url: 'https://example.invalid/mcp?token=TOP_SECRET',
          headersSecretRefs: {},
          headersPlain: {},
          toolEffectOverrides: {},
          oauth: null,
        workspaceRootInjection: 'off' as const,
        injectionIdentity: null,
          createdAt: '2026-07-22T00:00:00.000Z',
          updatedAt: '2026-07-22T00:00:00.000Z'
        }
      ]
    }

    const facts = mapMcpFacts(config, [
      {
        id: 'demo',
        state: 'disconnected',
        toolCount: undefined,
        lastErrorMessage: 'TOP_SECRET should never reach Doctor facts',
        inventory: {
          generation: 7,
          stale: true,
          discoveredToolCount: 5,
          registeredToolCount: 3,
          rejectedToolCount: 2
        },
        refresh: {
          refreshCount: 4,
          lastRefreshAt: '2026-07-22T01:00:00.000Z',
          retry: { attemptCount: 1, maxAttempts: 1 }
        },
        authorization: {
          serverId: 'demo',
          state: 'authorization_required',
          errorCode: null
        }
      }
    ])

    expect(facts.errorServerCount).toBe(1)
    expect(facts.servers).toEqual([
      expect.objectContaining({
        id: 'demo',
        state: 'disconnected',
        toolCount: 3,
        errorCode: null,
        inventory: {
          discoveredToolCount: 5,
          registeredToolCount: 3,
          rejectedToolCount: 2,
          stale: true
        },
        authorizationState: 'authorization_required'
      })
    ])
    expect(JSON.stringify(facts)).not.toContain('TOP_SECRET')
    expect(JSON.stringify(facts)).not.toContain('secret-ref')
    expect(JSON.stringify(facts)).not.toContain('generation')
    expect(JSON.stringify(facts)).not.toContain('refreshCount')
    expect(JSON.stringify(facts)).not.toContain('access_token')
  })


  it('omits refresh attempt internals while preserving inventory aggregates', () => {
    const facts = mapMcpFacts(
      {
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
            args: [],
            cwd: null,
            envSecretRefs: {},
            envPlain: {},
            url: null,
            headersSecretRefs: {},
            headersPlain: {},
            toolEffectOverrides: {},
          oauth: null,
        workspaceRootInjection: 'off' as const,
        injectionIdentity: null,
            createdAt: '2026-07-22T00:00:00.000Z',
            updatedAt: '2026-07-22T00:00:00.000Z'
          }
        ],
        fingerprint: 'y'
      },
      [
        {
          id: 'demo',
          state: 'connected',
          inventory: {
            generation: 99,
            stale: false,
            discoveredToolCount: 2,
            registeredToolCount: 2,
            rejectedToolCount: 0
          },
          refresh: {
            refreshCount: 9,
            lastRefreshAt: '2026-07-22T02:00:00.000Z',
            lastSuccessfulRefreshAt: '2026-07-22T02:00:00.000Z',
            retry: { attemptCount: 3, maxAttempts: 5, retryAt: '2026-07-22T03:00:00.000Z' }
          }
        }
      ]
    )
    const server = facts.servers[0]
    expect(server?.inventory).toEqual({
      discoveredToolCount: 2,
      registeredToolCount: 2,
      rejectedToolCount: 0,
      stale: false
    })
    expect(server?.toolCount).toBe(2)
    const blob = JSON.stringify(facts)
    expect(blob).not.toContain('refreshCount')
    expect(blob).not.toContain('retryAt')
        expect(blob).not.toContain('generation')
    expect(blob).not.toContain('lastSuccessfulRefreshAt')
  })

  it('warns when enabled servers are in error', () => {
    const config: UserMcpConfigV1 = {
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
          args: ['-y', 'x'],
          cwd: null,
          envSecretRefs: {},
          envPlain: {},
          url: null,
          headersSecretRefs: {},
          headersPlain: {},
          toolEffectOverrides: {},
          oauth: null,
        workspaceRootInjection: 'off' as const,
        injectionIdentity: null,
          createdAt: '2026-07-22T00:00:00.000Z',
          updatedAt: '2026-07-22T00:00:00.000Z'
        }
      ]
    }
    const report = runTeachingDoctor(
      {
        mcp: mapMcpFacts(config, [
          { id: 'demo', state: 'error', errorCode: 'mcp_spawn_failed', toolCount: 0 }
        ])
      },
      '2026-07-22T00:00:00.000Z'
    )
    const check = report.checks.find((c) => c.checkId === 'mcp_status')
    expect(check?.result).toBe('warning')
  })

  it('projects autoConnectEnabled and optional host aggregates without secrets', () => {
    const config: UserMcpConfigV1 = {
      schemaVersion: 1,
      enabled: true,
      // omit autoConnect → effective true when root enabled (ADR-0013)
      servers: [],
      fingerprint: 'z'
    }
    const facts = mapMcpFacts(config, [], undefined, {
      effectiveSourceCount: 2,
      sourceWarningCount: 1,
      marketplaceEmergencyDisabled: true
    })
    expect(facts.autoConnectEnabled).toBe(true)
    expect(facts.effectiveSourceCount).toBe(2)
    expect(facts.sourceWarningCount).toBe(1)
    expect(facts.marketplaceEmergencyDisabled).toBe(true)

    const explicitOff = mapMcpFacts(
      { ...config, autoConnect: false },
      [],
      undefined,
      { effectiveSourceCount: 0, sourceWarningCount: 0 }
    )
    expect(explicitOff.autoConnectEnabled).toBe(false)

    const report = runTeachingDoctor({ mcp: facts }, '2026-07-23T00:00:00.000Z')
    const check = report.checks.find((c) => c.checkId === 'mcp_status')
    expect(check?.result).toBe('ok')
    expect(check?.evidence.fields.autoConnectEnabled).toBe(true)
    expect(check?.evidence.fields.effectiveSourceCount).toBe(2)
    expect(check?.evidence.fields.sourceWarningCount).toBe(1)
    expect(check?.evidence.fields.marketplaceEmergencyDisabled).toBe(true)
    expect(JSON.stringify(check)).not.toContain('secret')
  })
})
