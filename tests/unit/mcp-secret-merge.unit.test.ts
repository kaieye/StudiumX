/**
 * MCP secret-merge + redact helpers (ADR-0128).
 */
import { describe, expect, it } from 'vitest'

import { mergeMcpServerSecretsFromPrevious } from '../../src/main/mcp/secret-merge'
import { redactMcpCommandLine, redactMcpCwd } from '../../src/main/mcp/redact'
import type { UserMcpServerV1 } from '../../src/shared/mcp/types'

function server(overrides: Partial<UserMcpServerV1> & Pick<UserMcpServerV1, 'id'>): UserMcpServerV1 {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    enabled: overrides.enabled ?? false,
    transport: 'stdio',
    command: overrides.command ?? 'npx',
    args: overrides.args ?? [],
    cwd: overrides.cwd ?? null,
    envSecretRefs: overrides.envSecretRefs ?? {},
    envPlain: overrides.envPlain ?? {},
    url: null,
    headersSecretRefs: overrides.headersSecretRefs ?? {},
    toolEffectOverrides: overrides.toolEffectOverrides ?? {},
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z'
  }
}

describe('mergeMcpServerSecretsFromPrevious', () => {
  it('reuses previous secret refs when new maps are empty', () => {
    const prev = [
      server({
        id: 'demo',
        envSecretRefs: { TOKEN: 'ref-1' },
        headersSecretRefs: { Authorization: 'ref-h' },
        envPlain: { NODE_ENV: 'production' }
      })
    ]
    const next = [server({ id: 'demo', command: 'node', args: ['server.js'] })]
    const merged = mergeMcpServerSecretsFromPrevious(next, prev)
    expect(merged[0]?.envSecretRefs).toEqual({ TOKEN: 'ref-1' })
    expect(merged[0]?.headersSecretRefs).toEqual({ Authorization: 'ref-h' })
    expect(merged[0]?.envPlain).toEqual({ NODE_ENV: 'production' })
    expect(merged[0]?.command).toBe('node')
  })

  it('lets explicit non-empty maps replace previous secrets', () => {
    const prev = [server({ id: 'demo', envSecretRefs: { TOKEN: 'old' } })]
    const next = [server({ id: 'demo', envSecretRefs: { TOKEN: 'new' } })]
    const merged = mergeMcpServerSecretsFromPrevious(next, prev)
    expect(merged[0]?.envSecretRefs).toEqual({ TOKEN: 'new' })
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
