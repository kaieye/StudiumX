/**
 * Pure McpSync envelope parse / merge preview (ADR-0013).
 * No network; fail-closed on bad envelope; conflicts never auto-overwrite.
 */
import { describe, expect, it } from 'vitest'

import {
  MCP_SYNC_CONTRACT_VERSION,
  toMcpSyncEnvelope
} from '../../src/shared/mcp/import-export'
import {
  mcpSyncServersToImportJson,
  parseMcpSyncEnvelope,
  parseMcpSyncEnvelopeText,
  previewMcpSyncMerge
} from '../../src/shared/mcp/mcp-sync'
import type { UserMcpConfigPublicV1 } from '../../src/shared/mcp/types'

const local: UserMcpConfigPublicV1 = {
  schemaVersion: 1,
  enabled: false,
  fingerprint: 'fp',
  servers: [
    {
      id: 'existing',
      label: 'Existing',
      enabled: true,
      scope: 'user',
      workspaceRoot: null,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'x'],
      cwd: null,
      envPlain: {},
      envSecretConfigured: {},
      url: null,
      headersPlain: {},
      headersSecretConfigured: {},
      timeoutMs: null,
      toolEffectOverrides: {},
      oauth: null,
      workspaceRootInjection: 'off',
      injectionIdentity: null,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z'
    }
  ]
}

function sampleEnvelope(servers: unknown[]) {
  return {
    contractVersion: MCP_SYNC_CONTRACT_VERSION,
    kind: 'mcp_sync_export' as const,
    exportedAt: '2026-07-23T12:00:00.000Z',
    payload: {
      enabled: true,
      servers
    }
  }
}

describe('parseMcpSyncEnvelope', () => {
  it('fail-closed on invalid JSON text', () => {
    expect(parseMcpSyncEnvelopeText('{not json').ok).toBe(false)
    expect(parseMcpSyncEnvelopeText('{not json')).toMatchObject({
      ok: false,
      reason: 'invalid_json'
    })
  })

  it('fail-closed on wrong contract version / kind / shape', () => {
    expect(parseMcpSyncEnvelope(null).ok).toBe(false)
    expect(parseMcpSyncEnvelope({ contractVersion: 99 }).ok).toBe(false)
    expect(
      parseMcpSyncEnvelope({
        contractVersion: MCP_SYNC_CONTRACT_VERSION,
        kind: 'nope',
        exportedAt: 'x',
        payload: { enabled: true, servers: [] }
      }).ok
    ).toBe(false)
    expect(
      parseMcpSyncEnvelope({
        contractVersion: MCP_SYNC_CONTRACT_VERSION,
        kind: 'mcp_sync_export',
        exportedAt: '',
        payload: { enabled: true, servers: [] }
      })
    ).toMatchObject({ ok: false, reason: 'exportedAt_required' })
  })

  it('accepts a valid envelope and skips malformed server rows', () => {
    const parsed = parseMcpSyncEnvelope(
      sampleEnvelope([
        {
          id: 'new-a',
          label: 'A',
          enabled: true,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'a']
        },
        { id: '', label: 'bad' },
        { not: 'a server' }
      ])
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.envelope.payload.servers).toHaveLength(1)
    expect(parsed.envelope.payload.servers[0]!.id).toBe('new-a')
  })
})

describe('previewMcpSyncMerge', () => {
  it('marks id collisions as conflicts and keeps non-conflicting importable', () => {
    const envelope = parseMcpSyncEnvelope(
      sampleEnvelope([
        {
          id: 'existing',
          label: 'Clash',
          transport: 'stdio',
          command: 'npx',
          args: []
        },
        {
          id: 'fresh',
          label: 'Fresh',
          transport: 'http',
          url: 'https://example.test/mcp'
        }
      ])
    )
    expect(envelope.ok).toBe(true)
    if (!envelope.ok) return
    const preview = previewMcpSyncMerge(local, envelope.envelope)
    expect(preview.conflicts).toEqual([{ serverId: 'existing', reason: 'id_collision' }])
    expect(preview.importableServers.map((s) => s.id)).toEqual(['fresh'])
  })
})

describe('mcpSyncServersToImportJson', () => {
  it('emits Claude-style mcpServers map for import path', () => {
    const envelope = parseMcpSyncEnvelope(
      sampleEnvelope([
        {
          id: 'fresh',
          label: 'Fresh',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'pkg']
        }
      ])
    )
    expect(envelope.ok).toBe(true)
    if (!envelope.ok) return
    const json = mcpSyncServersToImportJson(envelope.envelope.payload.servers)
    const doc = JSON.parse(json) as { mcpServers: Record<string, { command?: string }> }
    expect(doc.mcpServers.fresh?.command).toBe('npx')
  })

  it('round-trips via toMcpSyncEnvelope without network', () => {
    const env = toMcpSyncEnvelope(local)
    const again = parseMcpSyncEnvelope(env)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.envelope.payload.servers[0]!.id).toBe('existing')
  })
})
