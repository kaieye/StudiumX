import { describe, expect, it } from 'vitest'

import {
  applyMcpOps,
  isMcpSettingsOpList,
  MCP_OPS_MAX_BATCH,
  type McpSettingsOp
} from '../../src/shared/mcp/mcp-ops'
import {
  defaultUserMcpConfig,
  fingerprintUserMcpConfig,
  toPublicMcpConfig
} from '../../src/shared/mcp/config-schema'
import type { UserMcpConfigV1, UserMcpServerV1 } from '../../src/shared/mcp/types'

function sampleServer(overrides: Partial<UserMcpServerV1> & { id: string }): UserMcpServerV1 {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    enabled: overrides.enabled ?? true,
    scope: overrides.scope ?? 'user',
    workspaceRoot: overrides.workspaceRoot ?? null,
    transport: overrides.transport ?? 'stdio',
    command: overrides.command ?? 'npx',
    args: overrides.args ?? ['-y', overrides.id],
    cwd: overrides.cwd ?? null,
    envSecretRefs: overrides.envSecretRefs ?? {},
    envPlain: overrides.envPlain ?? {},
    url: overrides.url ?? null,
    headersSecretRefs: overrides.headersSecretRefs ?? {},
    headersPlain: overrides.headersPlain ?? {},
    timeoutMs: overrides.timeoutMs ?? null,
    toolEffectOverrides: overrides.toolEffectOverrides ?? {},
    oauth: overrides.oauth ?? null,
    workspaceRootInjection: overrides.workspaceRootInjection ?? 'off',
    injectionIdentity: overrides.injectionIdentity ?? null,
    createdAt: overrides.createdAt ?? '2026-07-22T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-07-22T00:00:00.000Z'
  }
}

function baseWithServers(...servers: UserMcpServerV1[]): UserMcpConfigV1 {
  const rest = {
    schemaVersion: 1 as const,
    enabled: true,
    autoConnect: true,
    honorRemoteReadOnlyHint: false,
    servers
  }
  return { ...rest, fingerprint: fingerprintUserMcpConfig(rest) }
}

describe('applyMcpOps (id-level merge)', () => {
  it('applies ops in left-to-right order; last write wins for same id', () => {
    const base = baseWithServers(sampleServer({ id: 'alpha', label: 'A' }))
    const ops: McpSettingsOp[] = [
      {
        op: 'upsertServer',
        server: sampleServer({ id: 'alpha', label: 'First' })
      },
      {
        op: 'upsertServer',
        server: sampleServer({ id: 'alpha', label: 'Second' })
      },
      {
        op: 'patchServer',
        id: 'alpha',
        patch: { label: 'Patched', updatedAt: '2026-07-23T00:00:00.000Z' }
      }
    ]
    const result = applyMcpOps(base, ops)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.servers).toHaveLength(1)
    expect(result.config.servers[0]!.label).toBe('Patched')
    expect(result.config.servers[0]!.updatedAt).toBe('2026-07-23T00:00:00.000Z')
    expect(result.config.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('merges concurrent-safe id ops without clobbering unrelated servers', () => {
    const base = baseWithServers(
      sampleServer({ id: 'keep-me', label: 'Keep' }),
      sampleServer({ id: 'touch-me', label: 'Old' })
    )
    // Writer A only upserts a new server (simulates concurrent Settings path).
    const writerA = applyMcpOps(base, [
      { op: 'upsertServer', server: sampleServer({ id: 'new-a', label: 'New A' }) }
    ])
    expect(writerA.ok).toBe(true)
    if (!writerA.ok) return
    expect(writerA.config.servers.map((s) => s.id).sort()).toEqual([
      'keep-me',
      'new-a',
      'touch-me'
    ])

    // Writer B patches touch-me against the same base — keep-me preserved.
    const writerB = applyMcpOps(base, [
      {
        op: 'patchServer',
        id: 'touch-me',
        patch: { label: 'Touched', updatedAt: '2026-07-24T00:00:00.000Z' }
      }
    ])
    expect(writerB.ok).toBe(true)
    if (!writerB.ok) return
    expect(writerB.config.servers.find((s) => s.id === 'keep-me')!.label).toBe('Keep')
    expect(writerB.config.servers.find((s) => s.id === 'touch-me')!.label).toBe('Touched')
    expect(writerB.config.servers.map((s) => s.id)).toEqual(['keep-me', 'touch-me'])

    // Compose: apply writer B ops onto writer A result (serial composition).
    const composed = applyMcpOps(writerA.config, [
      {
        op: 'patchServer',
        id: 'touch-me',
        patch: { label: 'Touched', updatedAt: '2026-07-24T00:00:00.000Z' }
      }
    ])
    expect(composed.ok).toBe(true)
    if (!composed.ok) return
    expect(composed.config.servers.map((s) => s.id).sort()).toEqual([
      'keep-me',
      'new-a',
      'touch-me'
    ])
    expect(composed.config.servers.find((s) => s.id === 'new-a')).toBeTruthy()
    expect(composed.config.servers.find((s) => s.id === 'touch-me')!.label).toBe('Touched')
  })

  it('removes by id and rejects remove of unknown id', () => {
    const base = baseWithServers(
      sampleServer({ id: 'stay', label: 'Stay' }),
      sampleServer({ id: 'gone', label: 'Gone' })
    )
    const removed = applyMcpOps(base, [{ op: 'removeServer', id: 'gone' }])
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.config.servers.map((s) => s.id)).toEqual(['stay'])

    const missing = applyMcpOps(base, [{ op: 'removeServer', id: 'nope' }])
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.reason).toMatch(/unknown id/)
  })

  it('rejects invalid ops and invalid server bodies', () => {
    const base = defaultUserMcpConfig()
    expect(applyMcpOps(base, null as unknown as McpSettingsOp[]).ok).toBe(false)

    const badOp = applyMcpOps(base, [{ op: 'not-a-real-op' } as unknown as McpSettingsOp])
    expect(badOp.ok).toBe(false)

    const badId = applyMcpOps(base, [
      {
        op: 'upsertServer',
        server: sampleServer({ id: 'BAD_ID' })
      }
    ])
    expect(badId.ok).toBe(false)

    const patchMissing = applyMcpOps(base, [
      { op: 'patchServer', id: 'ghost', patch: { label: 'x' } }
    ])
    expect(patchMissing.ok).toBe(false)

    const patchId = applyMcpOps(baseWithServers(sampleServer({ id: 'demo' })), [
      {
        op: 'patchServer',
        id: 'demo',
        patch: { id: 'hijack' } as unknown as Partial<UserMcpServerV1>
      }
    ])
    expect(patchId.ok).toBe(false)
    if (patchId.ok) return
    expect(patchId.reason).toMatch(/cannot change id/)
  })

  it('applies root flags without replacing servers', () => {
    const base = baseWithServers(sampleServer({ id: 's1', label: 'S1' }))
    const result = applyMcpOps(base, [
      { op: 'setEnabled', enabled: false },
      { op: 'setAutoConnect', autoConnect: false },
      { op: 'setHonorRemoteReadOnlyHint', honorRemoteReadOnlyHint: true }
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.enabled).toBe(false)
    expect(result.config.autoConnect).toBe(false)
    expect(result.config.honorRemoteReadOnlyHint).toBe(true)
    expect(result.config.servers).toHaveLength(1)
    expect(result.config.servers[0]!.id).toBe('s1')
  })

  it('rejects oversized batches', () => {
    const base = defaultUserMcpConfig()
    const ops: McpSettingsOp[] = Array.from({ length: MCP_OPS_MAX_BATCH + 1 }, () => ({
      op: 'setEnabled',
      enabled: true
    }))
    const result = applyMcpOps(base, ops)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/max/)
  })

  it('public projection stays secret-free (no envSecretRefs / secret values)', () => {
    const server = sampleServer({
      id: 'secret-demo',
      envSecretRefs: { API_TOKEN: 'ref-abc' },
      envPlain: { VISIBLE: 'ok' }
    })
    const base = baseWithServers(server)
    const result = applyMcpOps(base, [
      {
        op: 'patchServer',
        id: 'secret-demo',
        patch: { label: 'Renamed', updatedAt: '2026-07-24T12:00:00.000Z' }
      }
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const publicView = toPublicMcpConfig(result.config)
    const json = JSON.stringify(publicView)
    expect(json).not.toContain('ref-abc')
    expect(json).not.toContain('envSecretRefs')
    expect(publicView.servers[0]!.envSecretConfigured.API_TOKEN).toBe(true)
    expect(publicView.servers[0]!.envPlain.VISIBLE).toBe('ok')
    expect(publicView.fingerprint).toBeTruthy()
  })

  it('isMcpSettingsOpList is a shallow structural guard', () => {
    expect(isMcpSettingsOpList([{ op: 'setEnabled', enabled: true }])).toBe(true)
    expect(isMcpSettingsOpList('nope')).toBe(false)
    expect(isMcpSettingsOpList([{ notOp: true }])).toBe(false)
  })
})
