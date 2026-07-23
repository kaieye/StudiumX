/**
 * ADR-0136 MCP import / export / migration report + secret-free export.
 */
import { describe, expect, it } from 'vitest'

import {
  assertExportIsSecretFree,
  exportPublicMcpConfig,
  exportPublicMcpConfigJson,
  exportPublicMcpServersMap,
  parseMcpImportDocument,
  parseMcpImportText,
  selectMcpImportDrafts,
  toMcpSyncEnvelope
} from '../../src/shared/mcp/import-export'
import type { UserMcpConfigPublicV1 } from '../../src/shared/mcp/types'

const publicConfig: UserMcpConfigPublicV1 = {
  schemaVersion: 1,
  enabled: false,
  fingerprint: 'fp',
  servers: [
    {
      id: 'stdio-demo',
      label: 'Stdio Demo',
      enabled: true,
      scope: 'user',
      workspaceRoot: null,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-mcp'],
      cwd: null,
      envPlain: { PATH: '/usr/bin', API_TOKEN: '<configured>' },
      envSecretConfigured: { API_TOKEN: true },
      url: null,
      headersPlain: {},
      headersSecretConfigured: {},
      timeoutMs: null,
      toolEffectOverrides: {},
      oauth: null,
      workspaceRootInjection: 'off' as const,
      injectionIdentity: null,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z'
    },
    {
      id: 'http-demo',
      label: 'HTTP Demo',
      enabled: false,
      scope: 'user',
      workspaceRoot: null,
      transport: 'http',
      command: null,
      args: [],
      cwd: null,
      envPlain: {},
      envSecretConfigured: {},
      url: 'https://example.invalid/mcp',
      headersPlain: { Authorization: '<configured>' },
      headersSecretConfigured: { Authorization: true },
      timeoutMs: 30_000,
      toolEffectOverrides: {},
      oauth: {
        authorizationEndpoint: 'https://auth.example/authorize',
        tokenEndpoint: 'https://auth.example/token',
        clientId: 'public-client',
        scopes: ['mcp'],
        resource: 'https://example.invalid/mcp'
      },
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z'
    }
  ]
}

describe('parseMcpImportDocument', () => {
  it('parses Claude/Cursor mcpServers map with risk flags', () => {
    const result = parseMcpImportDocument(
      {
        mcpServers: {
          fs: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: { API_KEY: 'sk-live-should-not-persist-as-export' }
          },
          remote: {
            type: 'streamableHttp',
            url: 'https://mcp.example/sse',
            headers: { Authorization: 'Bearer abc.def.ghi' }
          }
        }
      },
      { existingIds: [] }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sourceShape).toBe('claude_cursor_mcpServers')
    expect(result.drafts).toHaveLength(2)
    const fs = result.drafts.find((d) => d.proposedId === 'fs')
    const remote = result.drafts.find((d) => d.proposedId === 'remote')
    expect(fs?.risks).toEqual(expect.arrayContaining(['command_execution', 'secret_present']))
    expect(remote?.risks).toEqual(expect.arrayContaining(['remote_url', 'secret_present']))
    expect(remote?.transport).toBe('http')
    expect(result.report.preservedOriginalFiles).toBe(true)
  })

  it('parses nested mcp.servers and studiumx v1 shapes', () => {
    const nested = parseMcpImportDocument({
      mcp: {
        servers: {
          nested: { command: 'node', args: ['server.js'] }
        }
      }
    })
    expect(nested.ok).toBe(true)
    if (nested.ok) {
      expect(nested.sourceShape).toBe('mcp_servers_nested')
      expect(nested.drafts[0]?.proposedId).toBe('nested')
    }

    const studiumx = parseMcpImportDocument({
      schemaVersion: 1,
      enabled: false,
      servers: [
        {
          id: 'local',
          label: 'Local',
          enabled: true,
          transport: 'stdio',
          command: 'echo',
          args: []
        }
      ]
    })
    expect(studiumx.ok).toBe(true)
    if (studiumx.ok) {
      expect(studiumx.sourceShape).toBe('studiumx_user_mcp_v1')
      expect(studiumx.drafts[0]?.label).toBe('Local')
    }
  })

  it('renames conflicting ids and supports selection report', () => {
    const preview = parseMcpImportDocument(
      {
        mcpServers: {
          'stdio-demo': { command: 'npx', args: ['x'] }
        }
      },
      { existingIds: ['stdio-demo'] }
    )
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.report.conflictCount).toBe(1)
    expect(preview.drafts[0]?.proposedId).not.toBe('stdio-demo')
    expect(preview.drafts[0]?.risks).toContain('id_conflict')

    const selected = selectMcpImportDrafts(preview, [preview.drafts[0]!.draftKey])
    expect(selected.selected).toHaveLength(1)
    expect(selected.report.selectedCount).toBe(1)
  })

  it('rejects unsupported JSON and invalid text', () => {
    expect(parseMcpImportDocument({ foo: 1 }).ok).toBe(false)
    expect(parseMcpImportText('{not json').ok).toBe(false)
  })

  it('rejects oauth shapes that carry secrets (fail-closed; no partial secret draft)', () => {
    const result = parseMcpImportDocument({
      mcpServers: {
        o: {
          url: 'https://example.invalid',
          type: 'http',
          oauth: {
            authorizationEndpoint: 'https://auth.example/a',
            tokenEndpoint: 'https://auth.example/t',
            clientId: 'cid',
            client_secret: 'should-drop',
            scopes: ['mcp']
          }
        },
        clean: {
          url: 'https://example.invalid/mcp',
          type: 'http',
          oauth: {
            authorizationEndpoint: 'https://auth.example/a',
            tokenEndpoint: 'https://auth.example/t',
            clientId: 'cid',
            scopes: ['mcp']
          }
        }
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Secret-bearing oauth entry is skipped; clean public oauth is kept.
    expect(result.drafts.some((d) => d.proposedId === 'o')).toBe(false)
    expect(result.report.skippedCount).toBeGreaterThanOrEqual(1)
    const clean = result.drafts.find((d) => d.proposedId === 'clean')
    expect(clean?.oauth?.clientId).toBe('cid')
    expect(JSON.stringify(result.drafts)).not.toContain('should-drop')
  })
}
)

describe('exportPublicMcpConfig', () => {
  it('exports redacted document without secret values or oauth tokens', () => {
    const doc = exportPublicMcpConfig(publicConfig, {
      exportedAt: '2026-07-23T12:00:00.000Z'
    })
    expect(doc.export.secretsRedacted).toBe(true)
    expect(doc.export.kind).toBe('studiumx_mcp_export')
    const assertion = assertExportIsSecretFree(doc)
    expect(assertion).toEqual({ ok: true })
    const json = exportPublicMcpConfigJson(publicConfig, {
      exportedAt: '2026-07-23T12:00:00.000Z'
    })
    expect(json).toContain('<configured>')
    expect(json).not.toContain('sk-')
    expect(json).not.toContain('access_token')
    expect(json).not.toContain('refresh_token')

    const map = exportPublicMcpServersMap(publicConfig)
    expect(map.mcpServers['http-demo']?.type).toBe('streamableHttp')
    expect(JSON.stringify(map)).not.toMatch(/Bearer\s+\w/i)

    const envelope = toMcpSyncEnvelope(publicConfig, {
      exportedAt: '2026-07-23T12:00:00.000Z'
    })
    expect(envelope.contractVersion).toBe(1)
    expect(envelope.kind).toBe('mcp_sync_export')
    expect(envelope.payload.servers.some((s) => s.id === 'stdio-demo')).toBe(true)
  })
})
