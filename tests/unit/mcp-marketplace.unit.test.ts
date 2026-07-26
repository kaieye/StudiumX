import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildMarketplaceInstallPreview,
  buildUserMcpServerFromMarketplaceEntry,
  isMarketplaceEntryRevoked,
  parseRemoteMarketplaceCatalog,
  pinMarketplaceVersion,
  validateMarketplaceCatalogEntry
} from '../../src/shared/mcp/marketplace-catalog'
import type { McpMarketplaceCatalogEntryV1 } from '../../src/shared/mcp/marketplace-types'
import { emptyMarketplaceStoreDocument } from '../../src/shared/mcp/marketplace-types'
import { McpMarketplaceStore } from '../../src/main/mcp/marketplace-store'
import { getFeature, isFeatureEnabled, FORBIDDEN_FEATURE_IDS } from '../../src/shared/features'

const HASH = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function sampleEntry(
  overrides: Partial<McpMarketplaceCatalogEntryV1> = {}
): McpMarketplaceCatalogEntryV1 {
  return {
    entryId: 'demo-server',
    publisher: { id: 'pub-demo', displayName: 'Demo Publisher' },
    displayName: 'Demo MCP Server',
    description: 'Local catalog fixture',
    version: '1.0.0',
    packageHash: HASH,
    signature: null,
    permissionsPreview: {
      effectSummary: ['privileged'],
      networkSummary: ['none'],
      filesystemSummary: ['userData only'],
      mayRequestSecrets: false,
      mayRequestOAuth: false
    },
    transportHint: 'stdio',
    sourceKind: 'local',
    localPackageRef: 'command:npx -y demo-mcp',
    installCommand: 'npx',
    installArgs: ['-y', 'demo-mcp'],
    ...overrides
  }
}

describe('marketplace-catalog pure helpers', () => {
  it('validates a well-formed local entry', () => {
    const result = validateMarketplaceCatalogEntry(sampleEntry())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entry.entryId).toBe('demo-server')
      expect(result.entry.packageHash).toBe(HASH)
      expect(result.entry.installCommand).toBe('npx')
    }
  })

  it('accepts remote sourceKind and rejects bad hash', () => {
    expect(
      validateMarketplaceCatalogEntry({ ...sampleEntry(), sourceKind: 'remote' }).ok
    ).toBe(true)
    expect(
      validateMarketplaceCatalogEntry({ ...sampleEntry(), packageHash: 'not-a-hash' }).ok
    ).toBe(false)
    expect(validateMarketplaceCatalogEntry({ ...sampleEntry(), entryId: '' }).ok).toBe(false)
  })

  it('parses remote catalog JSON fail-soft', () => {
    const parsed = parseRemoteMarketplaceCatalog({
      entries: [
        { ...sampleEntry(), entryId: 'a', sourceKind: undefined },
        { bad: true }
      ]
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.entries).toHaveLength(1)
      expect(parsed.entries[0]!.sourceKind).toBe('remote')
    }
  })

  it('pins version and builds install preview without secrets or tool approval', () => {
    const entry = sampleEntry()
    const pin = pinMarketplaceVersion(entry, '2026-07-23T00:00:00.000Z', {
      grantedAt: '2026-07-23T00:00:00.000Z',
      actorLabel: 'user'
    })
    expect(pin.pinnedVersion).toBe('1.0.0')
    expect(pin.pinnedHash).toBe(HASH)

    const preview = buildMarketplaceInstallPreview(entry)
    expect(preview.doesNotAutoConnect).toBe(true)
    expect(preview.doesNotGrantToolApproval).toBe(true)
    expect(preview.effectSummary).toEqual(['privileged'])
    expect(JSON.stringify(preview)).not.toMatch(/token|password|secret_value/i)
  })

  it('builds UserMcpServer draft from entry without approval grant', () => {
    const built = buildUserMcpServerFromMarketplaceEntry(sampleEntry(), '2026-07-23T00:00:00.000Z')
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.server.id).toBe('demo-server')
      expect(built.server.enabled).toBe(true)
      expect(built.server.command).toBe('npx')
      expect(built.server.args).toEqual(['-y', 'demo-mcp'])
      expect(built.server.toolEffectOverrides).toEqual({})
      expect(built.server.workspaceRootInjection).toBe('off')
    }
  })

  it('detects revocations by entryId or packageHash', () => {
    const entry = sampleEntry()
    expect(
      isMarketplaceEntryRevoked(entry, [
        {
          entryId: 'demo-server',
          packageHash: null,
          revokedAt: '2026-07-23T00:00:00.000Z',
          reasonCode: 'publisher_request'
        }
      ])
    ).toBe(true)
    expect(
      isMarketplaceEntryRevoked(entry, [
        {
          entryId: null,
          packageHash: HASH,
          revokedAt: '2026-07-23T00:00:00.000Z',
          reasonCode: 'malicious'
        }
      ])
    ).toBe(true)
    expect(isMarketplaceEntryRevoked(entry, [])).toBe(false)
  })
})

describe('McpMarketplaceStore (local durable + remote seam)', () => {
  async function withStore(
    run: (
      store: McpMarketplaceStore,
      hooks: {
        uninstall: ReturnType<typeof vi.fn>
        revoke: ReturnType<typeof vi.fn>
        emergency: ReturnType<typeof vi.fn>
      }
    ) => Promise<void>,
    opts?: { fetchImpl?: typeof fetch; catalogUrls?: string[] }
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-marketplace-'))
    const hooks = {
      uninstall: vi.fn(),
      revoke: vi.fn(),
      emergency: vi.fn()
    }
    const store = new McpMarketplaceStore({
      userDataPath: dir,
      now: () => '2026-07-23T12:00:00.000Z',
      cleanup: {
        onUninstall: hooks.uninstall,
        onRevoke: hooks.revoke,
        onEmergencyDisable: hooks.emergency
      },
      ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {})
    })
    try {
      if (opts?.catalogUrls) {
        await store.setCatalogUrls(opts.catalogUrls)
      }
      await run(store, hooks)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('lists empty catalog then upserts and installs without connecting', async () => {
    await withStore(async (store, hooks) => {
      expect(await store.listCatalog()).toEqual([])
      const up = await store.upsertCatalogEntry(sampleEntry())
      expect(up.ok).toBe(true)
      expect((await store.listCatalog()).length).toBe(1)

      const install = await store.recordInstall('demo-server', {
        trustActorLabel: 'user',
        expectedHash: HASH
      })
      expect(install.ok).toBe(true)
      if (install.ok) {
        expect(install.value.pinnedVersion).toBe('1.0.0')
        expect(install.value.trustGrant?.actorLabel).toBe('user')
      }
      expect(await store.listInstalls()).toHaveLength(1)
      expect(hooks.uninstall).not.toHaveBeenCalled()
      expect(hooks.revoke).not.toHaveBeenCalled()
    })
  })

  it('refreshRemoteCatalog merges validated entries fail-soft', async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            ...sampleEntry({ entryId: 'remote-one', sourceKind: 'remote' })
          }
        ]
      } as Response
    })
    await withStore(
      async (store) => {
        const result = await store.refreshRemoteCatalog()
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.merged).toBeGreaterThanOrEqual(1)
        }
        const catalog = await store.listCatalog()
        expect(catalog.some((e) => e.entryId === 'remote-one')).toBe(true)
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, catalogUrls: ['https://example.test/catalog.json'] }
    )
  })

  it('refuses install when revoked or emergency-disabled', async () => {
    await withStore(async (store) => {
      await store.upsertCatalogEntry(sampleEntry())
      const rev = await store.revoke({
        entryId: 'demo-server',
        reasonCode: 'security'
      })
      expect(rev.ok).toBe(true)
      expect(await store.isRevoked('demo-server')).toBe(true)
      const blocked = await store.recordInstall('demo-server')
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) expect(blocked.code).toBe('revoked')
    })

    await withStore(async (store, hooks) => {
      await store.upsertCatalogEntry(sampleEntry())
      await store.recordInstall('demo-server')
      const dis = await store.emergencyDisableAll()
      expect(dis.ok).toBe(true)
      expect(await store.isEmergencyDisabled()).toBe(true)
      expect(await store.listInstalls()).toEqual([])
      expect(hooks.emergency).toHaveBeenCalledTimes(1)
      const blocked = await store.recordInstall('demo-server')
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) expect(blocked.code).toBe('emergency_disabled')
    })
  })

  it('uninstalls and fires cleanup hook', async () => {
    await withStore(async (store, hooks) => {
      await store.upsertCatalogEntry(sampleEntry())
      await store.recordInstall('demo-server')
      const out = await store.uninstall('demo-server')
      expect(out.ok).toBe(true)
      expect(await store.listInstalls()).toEqual([])
      expect(hooks.uninstall).toHaveBeenCalledWith('demo-server')
    })
  })

  it('rejects hash mismatch on install', async () => {
    await withStore(async (store) => {
      await store.upsertCatalogEntry(sampleEntry())
      const bad = await store.recordInstall('demo-server', {
        expectedHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      })
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.code).toBe('hash_mismatch')
    })
  })

  it('starts from empty document shape with catalogUrls', () => {
    const empty = emptyMarketplaceStoreDocument('2026-07-23T00:00:00.000Z')
    expect(empty.schemaVersion).toBe(1)
    expect(empty.emergencyDisabled).toBe(false)
    expect(empty.catalog).toEqual([])
    expect(empty.catalogUrls).toEqual([])
  })
})

describe('feature registry marketplace policy', () => {
  it('keeps mcp-marketplace gated under_development and dangerous keys forbidden', () => {
    expect(FORBIDDEN_FEATURE_IDS).not.toContain('mcp_marketplace')
    expect(FORBIDDEN_FEATURE_IDS).toContain('yolo')
    // ADR-0140/0142 + product floor: marketplace has no product settings surface,
    // so the feature stays under_development (off even with allowExperimental).
    expect(getFeature('mcp-marketplace')?.stage).toBe('under_development')
    expect(isFeatureEnabled('mcp-marketplace')).toBe(false)
    expect(isFeatureEnabled('mcp-marketplace', { allowExperimental: true })).toBe(false)
  })
})
