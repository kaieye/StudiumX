/**
 * MCP secret materialization + redact helpers (ADR-0128).
 */
import { describe, expect, it } from 'vitest'

import { materializeMcpServerSecrets } from '../../src/main/mcp/secret-merge'
import { createMemoryMcpSecretEnv } from '../../src/main/mcp/secret-env'
import { redactMcpCommandLine, redactMcpCwd } from '../../src/main/mcp/redact'
import {
  MCP_SECRET_REF_KEEP,
  MCP_SECRET_REF_PENDING,
  type UserMcpServerV1
} from '../../src/shared/mcp/types'

function server(overrides: Partial<UserMcpServerV1> & Pick<UserMcpServerV1, 'id'>): UserMcpServerV1 {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    enabled: overrides.enabled ?? false,
    scope: overrides.scope ?? 'user',
    workspaceRoot: overrides.workspaceRoot ?? null,
    transport: overrides.transport ?? 'stdio',
    command: overrides.command ?? 'npx',
    args: overrides.args ?? [],
    cwd: overrides.cwd ?? null,
    envSecretRefs: overrides.envSecretRefs ?? {},
    envPlain: overrides.envPlain ?? {},
    url: overrides.url ?? null,
    headersSecretRefs: overrides.headersSecretRefs ?? {},
    headersPlain: overrides.headersPlain ?? {},
    timeoutMs: overrides.timeoutMs ?? null,
    toolEffectOverrides: overrides.toolEffectOverrides ?? {},
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z'
  }
}

describe('materializeMcpServerSecrets', () => {
  it('keeps the same server/key ref only when explicitly requested', () => {
    const secrets = createMemoryMcpSecretEnv()
    const previous = [server({ id: 'demo', envSecretRefs: { TOKEN: 'ref-1' } })]
    const result = materializeMcpServerSecrets({
      previousServers: previous,
      nextServers: [server({ id: 'demo', envSecretRefs: { TOKEN: MCP_SECRET_REF_KEEP } })],
      secrets
    })
    expect(result.servers[0]?.envSecretRefs).toEqual({ TOKEN: 'ref-1' })
    expect(result.createdRefs).toEqual([])
    expect(result.refsToForget).toEqual([])
  })

  it('stores pending plaintext through the one-way changes payload', () => {
    const secrets = createMemoryMcpSecretEnv()
    const result = materializeMcpServerSecrets({
      previousServers: [],
      nextServers: [server({ id: 'demo', envSecretRefs: { TOKEN: MCP_SECRET_REF_PENDING } })],
      secretChanges: { demo: { env: { TOKEN: 'top-secret' } } },
      secrets
    })
    const refId = result.servers[0]?.envSecretRefs.TOKEN
    expect(refId).toBeTruthy()
    expect(refId).not.toBe(MCP_SECRET_REF_PENDING)
    expect(secrets.resolve(refId!)).toBe('top-secret')
    expect(result.createdRefs).toEqual([refId])
  })

  it('treats a missing key as deletion and rejects renderer-provided ref ids', () => {
    const secrets = createMemoryMcpSecretEnv()
    const previous = [server({ id: 'demo', envSecretRefs: { TOKEN: 'ref-old' } })]
    const deleted = materializeMcpServerSecrets({
      previousServers: previous,
      nextServers: [server({ id: 'demo' })],
      secrets
    })
    expect(deleted.servers[0]?.envSecretRefs).toEqual({})
    expect(deleted.refsToForget).toEqual(['ref-old'])

    expect(() =>
      materializeMcpServerSecrets({
        previousServers: previous,
        nextServers: [server({ id: 'demo', envSecretRefs: { TOKEN: 'ref-guessed' } })],
        secrets
      })
    ).toThrow(/invalid secret marker/)
  })
})

describe('redactMcpCommandLine / cwd', () => {
  it('redacts secret-shaped tokens in args', () => {
    const out = redactMcpCommandLine('npx', ['-y', 'pkg', '--token=sk-secret-value'])
    expect(out.command).toBe('npx')
    expect(out.args.join(' ')).not.toContain('sk-secret-value')
  })

  it('returns null cwd for empty', () => {
    expect(redactMcpCwd(null)).toBeNull()
    expect(redactMcpCwd('')).toBeNull()
  })
})
