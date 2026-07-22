/**
 * TeachingDoctor MCP status check (ADR-0128 Phase E).
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

  it('warns when enabled servers are in error', () => {
    const config: UserMcpConfigV1 = {
      schemaVersion: 1,
      enabled: true,
      servers: [
        {
          id: 'demo',
          label: 'Demo',
          enabled: true,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'x'],
          cwd: null,
          envSecretRefs: {},
          envPlain: {},
          url: null,
          headersSecretRefs: {},
          toolEffectOverrides: {},
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
})
