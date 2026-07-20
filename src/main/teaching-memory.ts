import type {
  CreateTeachingMemoryPayload,
  TeachingMemoryDiagnostics,
  TeachingMemoryLegacyMigrationDryRunIntentPreview,
  TeachingMemoryLegacyMigrationDryRunReceiptPreview,
  TeachingMemoryRecord,
  TeachingSettingsV1,
  UpdateTeachingMemoryPayload
} from '../shared/teaching-types'
import {
  TeachingMemoryCatalog,
  normalizeTeachingMemoryRecord,
  normalizeTeachingMemoryScope,
  type TeachingMemoryAccess,
  type TeachingMemoryCatalogIndexScan
} from './teaching-memory-catalog'
import { TeachingMemoryLegacyMigrationDryRun } from './teaching-memory-catalog/migration-dry-run'
import { TeachingMemoryRecall, type TeachingMemoryRecallInput } from './teaching-memory-recall'
import { normalizeTraceId } from '../shared/trace-context'

export { pathExists } from './teaching-memory-catalog'

/** Main-process-only metadata; renderer IPC payloads never reach this seam. */
type TeachingMemoryMutationOptions = {
  traceId?: string
}

function normalizedMutationTrace(options?: TeachingMemoryMutationOptions): Pick<TeachingMemoryRecord, 'traceId'> | Record<never, never> {
  const traceId = normalizeTraceId(options?.traceId)
  return traceId ? { traceId } : {}
}

/**
 * Teaching workspace façade for durable Memory records and recall.
 *
 * The catalog is the internal durable local-file seam. Recall policy is kept
 * behind TeachingMemoryRecall so callers do not coordinate eligibility,
 * ranking, limits, or telemetry themselves.
 */
export class TeachingMemoryStore {
  private readonly catalog: TeachingMemoryCatalog
  private readonly recall: TeachingMemoryRecall
  private readonly migrationDryRun: TeachingMemoryLegacyMigrationDryRun

  constructor(
    private readonly options: {
      rootDir: string
      settingsProvider: () => Promise<TeachingSettingsV1>
      nowIso?: () => string
      idGenerator?: () => string
    }
  ) {
    this.catalog = new TeachingMemoryCatalog(options.rootDir)
    this.recall = new TeachingMemoryRecall({
      catalog: this.catalog,
      settingsProvider: options.settingsProvider
    })
    this.migrationDryRun = new TeachingMemoryLegacyMigrationDryRun(this.catalog)
  }

  async create(input: CreateTeachingMemoryPayload, options?: TeachingMemoryMutationOptions): Promise<TeachingMemoryRecord> {
    const now = this.now()
    const scope = normalizeTeachingMemoryScope(input.scope)
    const workspaceRoot = input.workspaceRoot
    const record = normalizeTeachingMemoryRecord({
      id: this.options.idGenerator?.() ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      content: input.content,
      scope,
      workspace: scope !== 'user' ? workspaceRoot : undefined,
      project: scope === 'project' ? workspaceRoot : undefined,
      tags: input.tags ?? [],
      confidence: input.confidence ?? 1,
      ...normalizedMutationTrace(options),
      createdAt: now,
      updatedAt: now
    })
    await this.catalog.write(record)
    return record
  }

  async update(id: string, patch: UpdateTeachingMemoryPayload, access?: TeachingMemoryAccess, options?: TeachingMemoryMutationOptions): Promise<TeachingMemoryRecord> {
    const current = await this.catalog.get(id, access)
    const now = this.now()
    const next = normalizeTeachingMemoryRecord({
      ...current,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.disabled === true ? { disabledAt: current.disabledAt ?? now } : {}),
      ...(patch.disabled === false ? { disabledAt: undefined } : {}),
      ...normalizedMutationTrace(options),
      updatedAt: now
    })
    await this.catalog.write(next)
    return next
  }

  async delete(id: string, access?: TeachingMemoryAccess, options?: TeachingMemoryMutationOptions): Promise<void> {
    const current = await this.catalog.get(id, access)
    const now = this.now()
    const next = normalizeTeachingMemoryRecord({
      ...current,
      ...normalizedMutationTrace(options),
      deletedAt: current.deletedAt ?? now,
      updatedAt: now
    })
    await this.catalog.write(next)
  }

  async list(workspaceRoot?: string, includeDeleted = false): Promise<TeachingMemoryRecord[]> {
    return this.catalog.list(workspaceRoot, includeDeleted)
  }

  /** Main-process-only canonical scan for the disposable local SQLite projection. */
  async scanForLocalDataIndex(): Promise<TeachingMemoryCatalogIndexScan> {
    return this.catalog.scanForLocalDataIndex()
  }

  async retrieve(input: TeachingMemoryRecallInput): Promise<TeachingMemoryRecord[]> {
    return this.recall.retrieve(input)
  }

  async diagnostics(): Promise<TeachingMemoryDiagnostics> {
    return this.recall.diagnostics()
  }

  /**
   * Main-only readonly dry-run intent preview. Never mutates Memory and never
   * authorizes destructive migration. No renderer path/target/checksum input.
   */
  async previewLegacyMigrationDryRun(request?: unknown): Promise<TeachingMemoryLegacyMigrationDryRunIntentPreview> {
    return this.migrationDryRun.previewIntent(request)
  }

  /**
   * Main-only readonly dry-run receipt preview. Fresh discovery only; never
   * copy/hold/publish/delete. Intent IDs are not destructive consent.
   */
  async completeLegacyMigrationDryRun(intentId: string): Promise<TeachingMemoryLegacyMigrationDryRunReceiptPreview> {
    return this.migrationDryRun.completeReceipt(intentId)
  }

  setLastInjected(ids: string[]): void {
    this.recall.setLastInjected(ids)
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}
