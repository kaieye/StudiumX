import { describe, expect, it } from 'vitest'
import {
  emptyMcpEffectiveViewPublic,
  projectMcpEffectiveViewPublic
} from '../../src/shared/mcp/effective-view-public'
import type { McpEffectiveConfigViewV1 } from '../../src/shared/mcp/source-types'
import type { McpRuntimeServerView, UserMcpServerV1 } from '../../src/shared/mcp/types'

function server(id: string, overrides: Partial<UserMcpServerV1> = {}): UserMcpServerV1 {
  return {
    id,
    label: `${id} label`,
    enabled: true,
    scope: 'user',
    workspaceRoot: null,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'secret-package', '--token', 'super-secret'],
    cwd: null,
    envSecretRefs: { API_KEY: 'ref-1' },
    envPlain: { SAFE: 'ok' },
    url: null,
    headersSecretRefs: {},
    headersPlain: {},
    timeoutMs: null,
    toolEffectOverrides: {},
    oauth: null,
    workspaceRootInjection: 'off',
    injectionIdentity: null,
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
    ...overrides
  }
}

describe('projectMcpEffectiveViewPublic', () => {
  it('returns empty view for null/undefined', () => {
    expect(projectMcpEffectiveViewPublic(null)).toEqual(emptyMcpEffectiveViewPublic())
    expect(projectMcpEffectiveViewPublic(undefined)).toEqual(emptyMcpEffectiveViewPublic())
  })

  it('projects winners and shadowed rows without secrets or command tokens', () => {
    const view: McpEffectiveConfigViewV1 = {
      enabled: true,
      autoConnect: false,
      effectiveServers: [
        {
          server: server('alpha', {
            command: 'npx',
            args: ['--api-key', 'sk-live-secret'],
            envSecretRefs: { TOKEN: 'ref-token' }
          }),
          source: { kind: 'user', label: 'userData/mcp/config.v1.json' }
        }
      ],
      shadowed: [
        {
          server: server('alpha', { label: 'workspace alpha' }),
          source: { kind: 'workspace', label: '.studiumx/mcp.json' },
          shadowedByServerId: 'alpha',
          shadowedBySource: { kind: 'user', label: 'userData/mcp/config.v1.json' },
          reason: 'id_collision'
        }
      ],
      warnings: ['workspace layer skipped: missing file']
    }

    const runtime: McpRuntimeServerView[] = [
      { id: 'alpha', state: 'connected', toolCount: 3 }
    ]

    const publicView = projectMcpEffectiveViewPublic(view, runtime)

    expect(publicView.enabled).toBe(true)
    expect(publicView.autoConnect).toBe(false)
    expect(publicView.effectiveServers).toHaveLength(1)
    expect(publicView.effectiveServers[0]).toEqual({
      id: 'alpha',
      label: 'alpha label',
      sourceKind: 'user',
      sourceLabel: 'userData/mcp/config.v1.json',
      enabled: true,
      transport: 'stdio',
      state: 'connected'
    })
    expect(JSON.stringify(publicView)).not.toContain('sk-live-secret')
    expect(JSON.stringify(publicView)).not.toContain('super-secret')
    expect(JSON.stringify(publicView)).not.toContain('ref-token')
    expect(JSON.stringify(publicView)).not.toMatch(/command|args|envSecret/)
    expect(publicView.shadowed).toEqual([
      {
        id: 'alpha',
        sourceKind: 'workspace',
        sourceLabel: '.studiumx/mcp.json',
        shadowedBy: {
          id: 'alpha',
          sourceKind: 'user',
          sourceLabel: 'userData/mcp/config.v1.json'
        }
      }
    ])
    expect(publicView.warnings).toEqual(['workspace layer skipped: missing file'])
  })
})
