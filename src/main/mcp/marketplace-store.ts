/**
 * MCP marketplace catalog + install records (ADR-0013).
 * userData-backed JSON. Optional remote catalog fetch is fail-soft when catalogUrls set.
 * Install pin does not grant tool approval. installAndEnable (host) may merge config + connect.
 */

import { join } from 'node:path'

import {
  buildMarketplaceInstallPreview,
  isMarketplaceEntryRevoked,
  parseRemoteMarketplaceCatalog,
  pinMarketplaceVersion,
  validateMarketplaceCatalogEntry
} from '../../shared/mcp/marketplace-catalog'
import {
  emptyMarketplaceStoreDocument,
  MCP_MARKETPLACE_SCHEMA_VERSION,
  type McpMarketplaceCatalogEntryV1,
  type McpMarketplaceInstallRecordV1,
  type McpMarketplaceRevokeRecordV1,
  type McpMarketplaceStoreDocumentV1
} from '../../shared/mcp/marketplace-types'
import {
  readValidatedWithBackup,
  replaceWithBackup,
  type DurableFileOperations
} from '../persistence/durable-file'

export const MCP_MARKETPLACE_RELATIVE_PATH = 'mcp/marketplace.v1.json'

const DEFAULT_REMOTE_CATALOG_TIMEOUT_MS = 8_000
const MAX_CATALOG_URLS = 16

/**
 * Optional lifecycle cleanup for sessions / tokens / tools.
 * Marketplace store never imports session-manager; callers wire hooks.
 */
export type McpMarketplaceCleanupHooks = Readonly<{
  onUninstall?: (entryId: string) => void | Promise<void>
  onRevoke?: (input: {
    entryId?: string | null
    packageHash?: string | null
  }) => void | Promise<void>
  onEmergencyDisable?: () => void | Promise<void>
}>

export type McpMarketplaceStoreOptions = Readonly<{
  userDataPath: string
  operations?: DurableFileOperations
  now?: () => string
  cleanup?: McpMarketplaceCleanupHooks
  /**
   * Optional catalog fetch inject (tests / custom). Product uses refreshRemoteCatalog
   * with global fetch when catalogUrls is non-empty.
   */
  fetchCatalog?: () => Promise<readonly McpMarketplaceCatalogEntryV1[]>
  /** Override fetch for remote catalog (tests). */
  fetchImpl?: typeof fetch
  remoteCatalogTimeoutMs?: number
}>

export type MarketplaceStoreErrorCode =
  | 'invalid_entry'
  | 'entry_not_found'
  | 'revoked'
  | 'emergency_disabled'
  | 'hash_mismatch'
  | 'persist_failed'

export type MarketplaceStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: MarketplaceStoreErrorCode; message: string }

function isMarketplaceDocument(value: unknown): value is McpMarketplaceStoreDocumentV1 {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const doc = value as Record<string, unknown>
  if (doc.schemaVersion !== MCP_MARKETPLACE_SCHEMA_VERSION) return false
  if (!Array.isArray(doc.catalog) || !Array.isArray(doc.installs) || !Array.isArray(doc.revocations)) {
    return false
  }
  if (typeof doc.emergencyDisabled !== 'boolean') return false
  if (doc.catalogUrls !== undefined && !Array.isArray(doc.catalogUrls)) return false
  return true
}

function normalizeCatalogUrls(urls: readonly string[] | undefined): string[] {
  if (!urls?.length) return []
  const out: string[] = []
  for (const u of urls) {
    if (typeof u !== 'string') continue
    const t = u.trim()
    if (!t || t.length > 2048) continue
    if (!/^https?:\/\//i.test(t)) continue
    if (!out.includes(t)) out.push(t)
    if (out.length >= MAX_CATALOG_URLS) break
  }
  return out
}

export class McpMarketplaceStore {
  private readonly path: string
  private readonly operations?: DurableFileOperations
  private readonly now: () => string
  private readonly cleanup: McpMarketplaceCleanupHooks
  /** Present for inject seam only. */
  readonly fetchCatalog?: () => Promise<readonly McpMarketplaceCatalogEntryV1[]>
  private readonly fetchImpl: typeof fetch
  private readonly remoteCatalogTimeoutMs: number
  private cache: McpMarketplaceStoreDocumentV1 | null = null

  constructor(options: McpMarketplaceStoreOptions) {
    this.path = join(options.userDataPath, MCP_MARKETPLACE_RELATIVE_PATH)
    this.operations = options.operations
    this.now = options.now ?? (() => new Date().toISOString())
    this.cleanup = options.cleanup ?? {}
    this.fetchCatalog = options.fetchCatalog
    this.fetchImpl = options.fetchImpl ?? fetch
    this.remoteCatalogTimeoutMs = options.remoteCatalogTimeoutMs ?? DEFAULT_REMOTE_CATALOG_TIMEOUT_MS
  }

  get storePath(): string {
    return this.path
  }

  async load(): Promise<McpMarketplaceStoreDocumentV1> {
    if (this.cache) return this.cache

    const recovered = await readValidatedWithBackup({
      path: this.path,
      validate: isMarketplaceDocument,
      operations: this.operations
    })

    if (recovered.value) {
      const normalized: McpMarketplaceStoreDocumentV1 = {
        ...recovered.value,
        catalogUrls: normalizeCatalogUrls(recovered.value.catalogUrls)
      }
      this.cache = normalized
      return normalized
    }

    const empty = emptyMarketplaceStoreDocument(this.now())
    this.cache = empty
    return empty
  }

  async listCatalog(): Promise<readonly McpMarketplaceCatalogEntryV1[]> {
    const doc = await this.load()
    return doc.catalog
  }

  async getEntry(entryId: string): Promise<McpMarketplaceCatalogEntryV1 | null> {
    const doc = await this.load()
    return doc.catalog.find((e) => e.entryId === entryId) ?? null
  }

  async getCatalogUrls(): Promise<readonly string[]> {
    const doc = await this.load()
    return doc.catalogUrls ?? []
  }

  /**
   * Persist optional remote catalog URLs (default empty). No fetch performed here.
   */
  async setCatalogUrls(urls: readonly string[]): Promise<MarketplaceStoreResult<readonly string[]>> {
    const doc = await this.load()
    const catalogUrls = normalizeCatalogUrls(urls)
    const next = await this.persist({ ...doc, catalogUrls })
    if (!next.ok) return next
    return { ok: true, value: catalogUrls }
  }

  /**
   * Fetch remote catalogs for configured URLs (fail-soft). Validates with pure helpers.
   * Merges remote entries into local catalog by entryId (remote overwrites same id).
   * Never sends telemetry. No-op when catalogUrls empty and no fetchCatalog inject.
   */
  async refreshRemoteCatalog(): Promise<
    MarketplaceStoreResult<{
      fetched: number
      merged: number
      errors: readonly string[]
    }>
  > {
    const doc = await this.load()
    const errors: string[] = []
    let fetched = 0
    const remoteEntries: McpMarketplaceCatalogEntryV1[] = []

    if (this.fetchCatalog) {
      try {
        const entries = await this.fetchCatalog()
        for (const raw of entries) {
          const v = validateMarketplaceCatalogEntry(raw)
          if (v.ok) {
            remoteEntries.push(v.entry)
            fetched += 1
          }
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'fetchCatalog_failed')
      }
    }

    const urls = normalizeCatalogUrls(doc.catalogUrls)
    for (const url of urls) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.remoteCatalogTimeoutMs)
        try {
          const res = await this.fetchImpl(url, {
            method: 'GET',
            signal: controller.signal,
            headers: { Accept: 'application/json' }
          })
          if (!res.ok) {
            errors.push(`http_${res.status}`)
            continue
          }
          const json: unknown = await res.json()
          const parsed = parseRemoteMarketplaceCatalog(json)
          if (!parsed.ok) {
            errors.push(parsed.reason)
            continue
          }
          for (const e of parsed.entries) {
            remoteEntries.push(e)
            fetched += 1
          }
        } finally {
          clearTimeout(timer)
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'remote_fetch_failed')
      }
    }

    if (remoteEntries.length === 0) {
      return { ok: true, value: { fetched: 0, merged: 0, errors } }
    }

    const byId = new Map<string, McpMarketplaceCatalogEntryV1>()
    for (const e of doc.catalog) byId.set(e.entryId, e)
    let merged = 0
    for (const e of remoteEntries) {
      byId.set(e.entryId, e)
      merged += 1
    }
    const nextCatalog = [...byId.values()]
    const next = await this.persist({ ...doc, catalog: nextCatalog })
    if (!next.ok) return next
    return { ok: true, value: { fetched, merged, errors } }
  }

  /**
   * Upsert a validated catalog entry (no network).
   */
  async upsertCatalogEntry(
    raw: unknown
  ): Promise<MarketplaceStoreResult<McpMarketplaceCatalogEntryV1>> {
    const validated = validateMarketplaceCatalogEntry(raw)
    if (!validated.ok) {
      return { ok: false, code: 'invalid_entry', message: validated.reason }
    }
    const doc = await this.load()
    const nextCatalog = [
      ...doc.catalog.filter((e) => e.entryId !== validated.entry.entryId),
      validated.entry
    ]
    const next = await this.persist({ ...doc, catalog: nextCatalog })
    if (!next.ok) return next
    return { ok: true, value: validated.entry }
  }

  /**
   * Record a pinned install. Does **not** auto-connect and does **not** grant
   * tool approval. Refuses when emergency-disabled or revoked.
   */
  async recordInstall(
    entryId: string,
    options?: Readonly<{ trustActorLabel?: string; expectedHash?: string }>
  ): Promise<MarketplaceStoreResult<McpMarketplaceInstallRecordV1>> {
    const doc = await this.load()
    if (doc.emergencyDisabled) {
      return {
        ok: false,
        code: 'emergency_disabled',
        message: 'marketplace_emergency_disabled'
      }
    }

    const entry = doc.catalog.find((e) => e.entryId === entryId)
    if (!entry) {
      return { ok: false, code: 'entry_not_found', message: 'catalog_entry_not_found' }
    }

    if (isMarketplaceEntryRevoked(entry, doc.revocations)) {
      return { ok: false, code: 'revoked', message: 'entry_or_hash_revoked' }
    }

    if (options?.expectedHash && options.expectedHash !== entry.packageHash) {
      return { ok: false, code: 'hash_mismatch', message: 'package_hash_mismatch' }
    }

    const installedAt = this.now()
    const trustGrant = options?.trustActorLabel
      ? { grantedAt: installedAt, actorLabel: options.trustActorLabel }
      : undefined
    const pin = pinMarketplaceVersion(entry, installedAt, trustGrant)

    const nextInstalls = [
      ...doc.installs.filter((i) => i.entryId !== entryId),
      pin
    ]
    const next = await this.persist({ ...doc, installs: nextInstalls })
    if (!next.ok) return next
    return { ok: true, value: pin }
  }

  async uninstall(entryId: string): Promise<MarketplaceStoreResult<{ entryId: string }>> {
    const doc = await this.load()
    const nextInstalls = doc.installs.filter((i) => i.entryId !== entryId)
    const next = await this.persist({ ...doc, installs: nextInstalls })
    if (!next.ok) return next
    await this.cleanup.onUninstall?.(entryId)
    return { ok: true, value: { entryId } }
  }

  async revoke(
    input: Readonly<{
      entryId?: string | null
      packageHash?: string | null
      reasonCode: string
      note?: string | null
    }>
  ): Promise<MarketplaceStoreResult<McpMarketplaceRevokeRecordV1>> {
    if (!input.entryId && !input.packageHash) {
      return { ok: false, code: 'invalid_entry', message: 'revoke_requires_entry_or_hash' }
    }
    const doc = await this.load()
    const record: McpMarketplaceRevokeRecordV1 = {
      entryId: input.entryId ?? null,
      packageHash: input.packageHash ?? null,
      revokedAt: this.now(),
      reasonCode: input.reasonCode,
      note: input.note ?? null
    }
    const nextInstalls = doc.installs.filter((inst) => {
      if (input.entryId && inst.entryId === input.entryId) return false
      if (input.packageHash && inst.pinnedHash === input.packageHash) return false
      return true
    })
    const next = await this.persist({
      ...doc,
      revocations: [...doc.revocations, record],
      installs: nextInstalls
    })
    if (!next.ok) return next
    await this.cleanup.onRevoke?.({
      entryId: input.entryId,
      packageHash: input.packageHash
    })
    return { ok: true, value: record }
  }

  async isRevoked(entryId: string): Promise<boolean> {
    const doc = await this.load()
    const entry = doc.catalog.find((e) => e.entryId === entryId)
    if (!entry) {
      return doc.revocations.some((r) => r.entryId === entryId)
    }
    return isMarketplaceEntryRevoked(entry, doc.revocations)
  }

  async emergencyDisableAll(): Promise<MarketplaceStoreResult<{ emergencyDisabled: true }>> {
    const doc = await this.load()
    const next = await this.persist({
      ...doc,
      emergencyDisabled: true,
      installs: []
    })
    if (!next.ok) return next
    await this.cleanup.onEmergencyDisable?.()
    return { ok: true, value: { emergencyDisabled: true } }
  }

  async listInstalls(): Promise<readonly McpMarketplaceInstallRecordV1[]> {
    const doc = await this.load()
    return doc.installs
  }

  async isEmergencyDisabled(): Promise<boolean> {
    const doc = await this.load()
    return doc.emergencyDisabled
  }

  /** Pure preview helper exposed for callers with a known entry. */
  previewInstall(entry: McpMarketplaceCatalogEntryV1) {
    return buildMarketplaceInstallPreview(entry)
  }

  private async persist(
    doc: McpMarketplaceStoreDocumentV1
  ): Promise<MarketplaceStoreResult<McpMarketplaceStoreDocumentV1>> {
    const stamped: McpMarketplaceStoreDocumentV1 = {
      ...doc,
      schemaVersion: MCP_MARKETPLACE_SCHEMA_VERSION,
      catalogUrls: normalizeCatalogUrls(doc.catalogUrls),
      updatedAt: this.now()
    }
    try {
      await replaceWithBackup({
        path: this.path,
        content: JSON.stringify(stamped, null, 2),
        validate: isMarketplaceDocument,
        operations: this.operations
      })
      this.cache = stamped
      return { ok: true, value: stamped }
    } catch {
      return { ok: false, code: 'persist_failed', message: 'marketplace_persist_failed' }
    }
  }
}
