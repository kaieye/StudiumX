import { createHash } from 'node:crypto'
import { existsSync, renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { AgentConversationRecord, AgentConversationSummary, TeachingMemoryRecord } from '../../shared/teaching-types'
import { resolveTeachingMemoryKind, resolveTeachingMemoryStatus } from '../../shared/teaching-memory-kind'
import { sanitizePersistedAgentConversationRecord, sanitizePersistedConversationTitle } from '../../shared/agent-persisted-history'
import { listPersistedAgentConversationRecords } from '../teaching-agent-conversations'
import type { TeachingMemoryCatalogIndexScan } from '../teaching-memory-catalog'
import type { AnalyticsWorkspaceScanResult } from '../teaching/services/learning-analytics'
import type { LedgerSnapshot, LearningWorkLedgerSnapshotsRead } from '../teaching/services/analytics/token-evidence'
import { readDurableJsonlSources } from '../durable-jsonl'
import {
  parseUsageLedgerLine,
  readUsageLedgerSources,
  summarizeUsageEntries,
  usageLedgerActivePath,
  usageLedgerWorkspacePath,
  type UsageAnalyticsSummary,
  type UsageLedgerEntry
} from '../usage-ledger'
import { SchemaMigrationChecksumConflict, listAppliedSchemaMigrations, migrateLocalDataIndex, type AppliedSchemaMigration } from './schema-migration'

export { LOCAL_DATA_INDEX_MIGRATIONS, SCHEMA_MIGRATION_APPLIED_BY, ensureSchemaMigrationMetadataColumns, listAppliedSchemaMigrations, migrateLocalDataIndex, type AppliedSchemaMigration } from './schema-migration'

export type LocalDataIndexStatus = 'ready' | 'building' | 'incomplete' | 'unavailable' | 'closed'
export type LocalDataIndexIssue = { sourceKey: string; sourcePath?: string; code: string; message: string }
/** Aggregate-only usage ledger diagnostics for doctor (no paths, no row bodies). */
export type LocalDataIndexUsageDiagnostics = {
  /** Number of durable usage JSONL segment files scanned on last rebuild projection. */
  segmentFileCount: number
  /** Distinct entryId rows projected into usage_projection. */
  projectedEntryCount: number
  /** Invalid / skipped JSONL rows across all scanned segments. */
  invalidRowCount: number
  /** Issue rows with code invalid_row scoped to usage sources. */
  invalidRowIssueCount: number
  /** Issue rows with code read_failed scoped to usage sources. */
  readFailedIssueCount: number
}

export type LocalDataIndexDiagnostics = {
  /** Projection file basename only — never an absolute host path. */
  indexFileName: typeof INDEX_FILE
  /** Whether the disposable projection file currently exists on disk. */
  pathExists: boolean
  status: LocalDataIndexStatus
  reason: string | null
  /** index_state.complete when a DB is open; null when unavailable/closed without state. */
  complete: boolean | null
  rebuiltAt: string | null
  version: string | null
  /** Applied migration ids only (no SQL bodies). */
  migrationIds: string[]
  appliedMigrations: AppliedSchemaMigration[]
  /** Aggregate issue counts by stable issue code (source_drift / read_failed / …). */
  issueCountsByCode: Record<string, number>
  issueCount: number
  /** DB-OPT-4: usage segment / invalid row counters (aggregate-only). */
  usage: LocalDataIndexUsageDiagnostics
  /** True: support tooling must never pack conversation/memory projection row bodies. */
  aggregateOnly: true
  /** Explicit support copy: projection may be deleted and rebuilt. */
  disposable: true
  disposableNote: string
}
/** Constructable better-sqlite3 Database used by LocalDataIndex (overridable in tests). */
export type LocalDataIndexSqliteConstructor = new (path: string) => Database.Database

/** Named fault-injection points for LocalDataIndex open/rebuild boundary tests (test-only). */
export type LocalDataIndexFaultPoint =
  | 'sqlite_load'
  | 'sqlite_open'
  | 'busy_timeout_pragma'
  | 'wal_pragma'
  | 'migration'
  | 'integrity_check'

export type LocalDataIndexTestHooks = {
  /** Deterministic seams for C-1 source-currentness boundary tests. */
  beforeCurrentnessVerification?: () => void | Promise<void>
  afterPrecommitVerification?: () => void | Promise<void>
  beforeFinalReadyTransition?: () => void | Promise<void>
  /** Simulates the unavoidable external filesystem TOCTOU after the last rebuild check. */
  afterFinalReadyVerification?: () => void | Promise<void>
  /** Runs after analytics receives adapters but before an adapter revalidates sources and executes SQL. */
  beforeAdapterQueryCurrentnessVerification?: () => void | Promise<void>
  /**
   * Optional fault injector for open/migrate/integrity/busy boundaries.
   * Only intended for unit/integration tests — never wired from production call sites.
   */
  injectFault?: (point: LocalDataIndexFaultPoint) => void
  /** Override SQLite constructor resolution (simulate missing native binding / open failure). */
  loadSqlite?: () => LocalDataIndexSqliteConstructor
  /** Override busy_timeout pragma milliseconds (default 3000). */
  busyTimeoutMs?: number
  /** Force integrity_check result instead of reading PRAGMA (e.g. 'disk image is malformed'). */
  integrityCheckResult?: string | (() => string)
  /**
   * DB-OPT-2: when true, rebuild attempts conversation per-source incremental upsert
   * after a full baseline exists. Any failure falls back to full DELETE+INSERT.
   * Production callers leave this unset (default full rebuild).
   */
  enableIncrementalConversationRebuild?: boolean
  /** Test-only: throw during incremental path to force full fallback. */
  failIncrementalRebuild?: boolean
}

export type LocalDataIndexSources = {
  listWorkspaces: () => Promise<AnalyticsWorkspaceScanResult[]>
  listTemporaryConversations?: () => Promise<AgentConversationSummary[]>
  /** Canonical main-process scan: all scopes/tombstones plus recovery facts. */
  scanMemory?: () => Promise<TeachingMemoryCatalogIndexScan>
  /** Compatibility seam; callers should provide scanMemory. */
  listMemory?: () => Promise<TeachingMemoryRecord[]>
}

type ProjectionDb = Database.Database
type MemoryInput = { records: TeachingMemoryRecord[]; issues: LocalDataIndexIssue[]; sourcePaths: string[]; sourceFingerprints: Array<{ path: string; fingerprint: string }>; recordFingerprints: Array<{ memoryId: string; fingerprint: string }> }
type BuildInput = { appDataRoot: string; workspaces: AnalyticsWorkspaceScanResult[]; temporaryConversations: AgentConversationSummary[]; memory: MemoryInput }
type ProjectedConversation = { summary: AgentConversationSummary; workspaceId?: string; scope: 'workspace' | 'temporary'; record: AgentConversationRecord; path: string; fingerprint: string }
type ProjectedLedger = LedgerSnapshot & { workspaceId: string; entryId: string; path: string; sourceKey: string; fingerprint: string }
type ProjectedUsage = { entry: UsageLedgerEntry; path: string; fingerprint: string }
/** Last rebuild usage scan counters (in-memory; not durable authority). */
type UsageScanStats = {
  segmentFileCount: number
  projectedEntryCount: number
  invalidRowCount: number
}
type SqliteConstructor = LocalDataIndexSqliteConstructor

type LocalDataIndexConversationRead =
  | { state: 'readable'; record: AgentConversationRecord }
  | { state: 'unreadable' }
  | { state: 'unavailable' }
type LocalDataIndexLedgerRead = LearningWorkLedgerSnapshotsRead | { state: 'unavailable' }
export type LocalDataIndexUsageAnalyticsRead =
  | { state: 'readable'; summary: UsageAnalyticsSummary }
  | { state: 'unavailable' }
export type LocalDataIndexTokenEvidenceAdapters = {
  conversations: { read: (workspaceId: string, conversationId: string) => Promise<LocalDataIndexConversationRead> }
  temporaryConversations: { read: (workspaceId: string | undefined, conversationId: string) => Promise<LocalDataIndexConversationRead> }
  ledger: { read: (workspace: { workspaceId: string }) => Promise<LocalDataIndexLedgerRead> }
}
export type LocalDataIndexUsageAnalyticsAdapter = {
  /** Aggregate-only usage view. Never returns raw JSONL lines or secret/prompt fields. */
  summarize: () => Promise<LocalDataIndexUsageAnalyticsRead>
}

/** Metadata-only conversation list row for session/resume pickers (no snippets/highlights). */
export type LocalDataIndexConversationListItem = {
  conversationId: string
  workspaceId: string | null
  scope: 'workspace' | 'temporary'
  /** Redacted title only — never raw secret-bearing titles. */
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  pinned: boolean
  archived: boolean
  relativePath: string
}

export type LocalDataIndexConversationListQuery = {
  workspaceId?: string | null
  scope?: 'workspace' | 'temporary'
  /** When false (default), omit archived conversations from the list. */
  includeArchived?: boolean
  limit?: number
}

export type LocalDataIndexConversationListRead =
  | { state: 'readable'; source: 'index'; items: LocalDataIndexConversationListItem[] }
  | { state: 'unavailable' }

const INDEX_FILE = 'studiumx-index.sqlite'
const INDEX_VERSION = '2'

/** Explicit support copy: projection may be deleted and rebuilt from canonical files. */
export const LOCAL_DATA_INDEX_DISPOSABLE_NOTE =
  'studiumx-index.sqlite can be safely deleted and rebuilt from canonical local files (JSON/JSONL).'

/**
 * DB-OPT-2: pure planning helper for per-source incremental rebuild.
 * Default production rebuild remains full DELETE+INSERT; this plan supports
 * upserting only changed sources. Failure paths must fall back to full rebuild.
 */
export type ProjectionSourceFingerprint = { sourceKey: string; fingerprint: string }

export type IncrementalRebuildPlan = {
  mode: 'full' | 'incremental'
  /** Sources whose fingerprint changed or are new — must be rewritten. */
  upsertKeys: string[]
  /** Sources present previously but absent now — must be deleted. */
  deleteKeys: string[]
  /** Sources with identical fingerprint — may be retained. */
  unchangedKeys: string[]
  /** Why incremental was rejected (when mode === 'full'). */
  reason?: string
}

export function planIncrementalRebuild(input: {
  previous: readonly ProjectionSourceFingerprint[]
  next: readonly ProjectionSourceFingerprint[]
  /** Force full rebuild (default production path). */
  forceFull?: boolean
}): IncrementalRebuildPlan {
  if (input.forceFull) {
    return {
      mode: 'full',
      upsertKeys: input.next.map((item) => item.sourceKey),
      deleteKeys: input.previous.map((item) => item.sourceKey),
      unchangedKeys: [],
      reason: 'force_full'
    }
  }
  const previous = new Map(input.previous.map((item) => [item.sourceKey, item.fingerprint]))
  const next = new Map(input.next.map((item) => [item.sourceKey, item.fingerprint]))
  const upsertKeys: string[] = []
  const unchangedKeys: string[] = []
  const deleteKeys: string[] = []
  for (const [sourceKey, fingerprint] of next) {
    const prior = previous.get(sourceKey)
    if (prior === fingerprint) unchangedKeys.push(sourceKey)
    else upsertKeys.push(sourceKey)
  }
  for (const sourceKey of previous.keys()) {
    if (!next.has(sourceKey)) deleteKeys.push(sourceKey)
  }
  // If nothing can be retained, full rebuild is simpler and equivalent.
  if (unchangedKeys.length === 0 && (upsertKeys.length > 0 || deleteKeys.length > 0)) {
    return {
      mode: 'full',
      upsertKeys,
      deleteKeys,
      unchangedKeys: [],
      reason: 'no_retained_rows'
    }
  }
  return {
    mode: 'incremental',
    upsertKeys: upsertKeys.sort(),
    deleteKeys: deleteKeys.sort(),
    unchangedKeys: unchangedKeys.sort()
  }
}

/** A disposable, main-process-only SQLite projection of canonical local files. */
export class LocalDataIndex {
  private db: ProjectionDb | null = null
  private statusValue: LocalDataIndexStatus = 'unavailable'
  private buildPromise: Promise<void> | null = null
  private unavailableReason: string | null = null
  private readyInputFingerprint: string | null = null
  /** Last successful usage projection scan counters (DB-OPT-4). */
  private lastUsageScan: UsageScanStats = { segmentFileCount: 0, projectedEntryCount: 0, invalidRowCount: 0 }

  constructor(private readonly options: {
    appDataRoot: string
    sources: LocalDataIndexSources
    now?: () => Date
    testHooks?: LocalDataIndexTestHooks
  }) {}
  get path(): string { return join(this.options.appDataRoot, INDEX_FILE) }
  get status(): LocalDataIndexStatus { return this.statusValue }
  get reason(): string | null { return this.unavailableReason }

  /** Opens/migrates only. Native SQLite resolution failures remain a file-scan fallback. */
  open(): boolean {
    if (this.db) return true
    try {
      this.openDatabase()
      this.statusValue = 'incomplete'
      this.unavailableReason = null
      return true
    } catch (error) {
      if (!isRepairableDatabaseError(error)) { this.markUnavailable(error); return false }
      this.closeDbOnly()
      // Projection files are disposable; never touch canonical JSON/JSONL sources.
      try { this.quarantineProjectionSync(); this.openDatabase(); this.statusValue = 'incomplete'; return true } catch (repairError) { this.markUnavailable(repairError); return false }
    }
  }

  scheduleRebuild(): void { if (this.db && !this.buildPromise) this.buildPromise = this.rebuild().finally(() => { this.buildPromise = null }) }

  async rebuild(): Promise<void> {
    if (!this.db && !this.openAsync()) return
    if (!this.db) return
    this.statusValue = 'building'
    this.readyInputFingerprint = null
    const rebuildId = `${this.nowIso()}:${Math.random().toString(36).slice(2)}`
    const issues: LocalDataIndexIssue[] = []
    try {
      const input = await this.snapshotSources(issues)
      const projections = await this.projectSources(input, issues)
      // This is derived solely from the immutable reads that produced projections.
      // It is never replaced with a later fingerprint from a different source read.
      const inputFingerprint = sourceManifestFingerprint(input, projections.provenance)
      await this.options.testHooks?.beforeCurrentnessVerification?.()
      if (!await this.sourceManifestMatches(inputFingerprint)) {
        issues.push(sourceDriftIssue('Canonical sources changed while the projection was being scanned.'))
      }
      // The precommit check itself has a boundary: a writer may mutate a source
      // before replacement starts. Take a new exact-byte manifest at that boundary.
      await this.options.testHooks?.afterPrecommitVerification?.()
      if (!issues.length && !await this.sourceManifestMatches(inputFingerprint)) {
        issues.push(sourceDriftIssue('Canonical sources changed after precommit verification and before projection replacement.'))
      }
      const db = this.db
      if (!db) return
      let appliedIncrementalConversations = false
      if (
        this.options.testHooks?.enableIncrementalConversationRebuild === true &&
        !issues.length
      ) {
        try {
          if (this.options.testHooks?.failIncrementalRebuild) {
            throw new Error('Incremental rebuild test fault')
          }
          appliedIncrementalConversations = this.tryIncrementalConversationReplace(
            db,
            input,
            projections,
            rebuildId,
            issues,
            inputFingerprint
          )
        } catch {
          appliedIncrementalConversations = false
        }
      }
      if (!appliedIncrementalConversations) {
        this.applyFullProjectionReplace(db, input, projections, rebuildId, issues, inputFingerprint)
      }
      if (issues.length) { this.statusValue = 'incomplete'; return }
      // Replacement commits with complete=0. The last controllable boundary is
      // immediately before complete=1, so verify a fresh exact-byte manifest there.
      await this.options.testHooks?.beforeFinalReadyTransition?.()
      if (!await this.sourceManifestMatches(inputFingerprint)) {
        this.recordIncomplete(rebuildId, [sourceDriftIssue('Canonical sources changed immediately before the projection could be marked ready.')])
        this.statusValue = 'incomplete'
        return
      }
      await this.options.testHooks?.afterFinalReadyVerification?.()
      // An external filesystem writer can still win the physical TOCTOU race after
      // this final read. The adapter query boundary repeats this exact-manifest
      // validation before every projection statement, so stale SQLite rows remain
      // unavailable even in that unavoidable interval.
      db.transaction(() => { putState(db, 'complete', '1') })()
      this.readyInputFingerprint = inputFingerprint
      this.statusValue = 'ready'
    } catch (error) {
      issues.push({ sourceKey: 'index', code: 'rebuild_failed', message: messageOf(error) })
      this.recordIncomplete(rebuildId, issues)
      this.statusValue = 'incomplete'
    }
  }

  async isCompleteForCurrentSources(): Promise<boolean> {
    if (!this.db || this.statusValue !== 'ready') return false
    try {
      const expected = this.readyInputFingerprint
      if (!expected || !await this.sourceManifestMatches(expected)) { this.readyInputFingerprint = null; this.statusValue = 'incomplete'; this.scheduleRebuild(); return false }
      return true
    } catch { this.readyInputFingerprint = null; this.statusValue = 'incomplete'; this.scheduleRebuild(); return false }
  }

  tokenEvidenceAdapters(): LocalDataIndexTokenEvidenceAdapters | null {
    if (!this.db || this.statusValue !== 'ready') return null
    const db = this.db
    return {
      conversations: { read: async (workspaceId, conversationId) => this.readConversation(db, workspaceId, conversationId, 'workspace') },
      temporaryConversations: { read: async (_workspaceId, conversationId) => this.readConversation(db, null, conversationId, 'temporary') },
      ledger: { read: async (workspace) => this.readLedger(db, workspace.workspaceId) }
    }
  }

  /**
   * Metadata-first conversation list for session/resume UIs.
   * Uses SQLite only when the projection is complete and current; otherwise returns
   * unavailable so callers fall back to filesystem scan (listAgentConversations).
   * Never returns snippets, highlights, or turn content.
   */
  async listConversations(query: LocalDataIndexConversationListQuery = {}): Promise<LocalDataIndexConversationListRead> {
    if (!this.db || this.statusValue !== 'ready') return { state: 'unavailable' }
    const db = this.db
    if (!await this.canExecuteProjectionQuery(db)) return { state: 'unavailable' }
    try {
      const limit = normalizeConversationListLimit(query.limit)
      const includeArchived = query.includeArchived === true
      const clauses: string[] = []
      const params: unknown[] = []
      if (query.scope === 'workspace' || query.scope === 'temporary') {
        clauses.push('scope = ?')
        params.push(query.scope)
      }
      if (query.workspaceId !== undefined) {
        if (query.workspaceId === null) {
          clauses.push('workspace_id IS NULL')
        } else {
          clauses.push('workspace_id = ?')
          params.push(query.workspaceId)
        }
      }
      if (!includeArchived) {
        clauses.push('archived = 0')
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      // List indexes: conversation_projection_scope_updated_idx / conversation_projection_workspace_updated_idx
      const sql = `SELECT conversation_id, workspace_id, scope, title, created_at, updated_at, message_count, pinned, archived, relative_path
        FROM conversation_projection
        ${where}
        ORDER BY pinned DESC, updated_at DESC, conversation_id ASC
        LIMIT ?`
      params.push(limit)
      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>
      return {
        state: 'readable',
        source: 'index',
        items: rows.map(hydrateConversationListItem)
      }
    } catch {
      return { state: 'unavailable' }
    }
  }
  /** Read-only aggregate usage analytics. Projection damage yields unavailable, never throws. */
  usageAnalyticsAdapter(): LocalDataIndexUsageAnalyticsAdapter | null {
    if (!this.db || this.statusValue !== 'ready') return null
    const db = this.db
    return {
      summarize: async () => this.readUsageAnalytics(db)
    }
  }
  issues(): LocalDataIndexIssue[] { return this.db ? this.db.prepare('SELECT source_key sourceKey, source_path sourcePath, code, message FROM index_issue ORDER BY id').all() as LocalDataIndexIssue[] : [] }
  /** Applied migration ids + checksum digests for doctor (no SQL bodies). */
  appliedMigrations(): AppliedSchemaMigration[] { return this.db ? listAppliedSchemaMigrations(this.db) : [] }

  /**
   * Aggregate-only diagnostics for TeachingDoctor / support-bundle.
   * Never includes conversation/memory projection row bodies or absolute paths
   * beyond path existence; callers should treat the file as disposable.
   */
  diagnostics(): LocalDataIndexDiagnostics {
    const pathExists = existsSync(this.path)
    const appliedMigrations = this.appliedMigrations()
    const issueRows = this.issues()
    const issueCountsByCode: Record<string, number> = {}
    for (const issue of issueRows) {
      const code = issue.code || 'unknown'
      issueCountsByCode[code] = (issueCountsByCode[code] ?? 0) + 1
    }
    let complete: boolean | null = null
    let rebuiltAt: string | null = null
    let version: string | null = null
    let projectedEntryCount = this.lastUsageScan.projectedEntryCount
    if (this.db) {
      try {
        complete = getState(this.db, 'complete') === '1'
        rebuiltAt = getState(this.db, 'rebuilt_at')
        version = getState(this.db, 'version')
        const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM usage_projection').get() as { n?: number } | undefined
        if (typeof countRow?.n === 'number') projectedEntryCount = countRow.n
      } catch {
        complete = null
        rebuiltAt = null
        version = null
      }
    }
    let invalidRowIssueCount = 0
    let readFailedIssueCount = 0
    for (const issue of issueRows) {
      if (!issue.sourceKey.startsWith('usage:')) continue
      if (issue.code === 'invalid_row') invalidRowIssueCount += 1
      if (issue.code === 'read_failed') readFailedIssueCount += 1
    }
    return {
      indexFileName: INDEX_FILE,
      pathExists,
      status: this.statusValue,
      reason: this.unavailableReason,
      complete,
      rebuiltAt,
      version,
      migrationIds: appliedMigrations.map((row) => row.id),
      appliedMigrations,
      issueCountsByCode,
      issueCount: issueRows.length,
      usage: {
        segmentFileCount: this.lastUsageScan.segmentFileCount,
        projectedEntryCount,
        invalidRowCount: this.lastUsageScan.invalidRowCount,
        invalidRowIssueCount,
        readFailedIssueCount
      },
      aggregateOnly: true,
      disposable: true,
      disposableNote: LOCAL_DATA_INDEX_DISPOSABLE_NOTE
    }
  }

  close(): void { this.closeDbOnly(); this.readyInputFingerprint = null; this.statusValue = 'closed' }

  private openDatabase(): void {
    this.options.testHooks?.injectFault?.('sqlite_load')
    const Sqlite = this.options.testHooks?.loadSqlite?.() ?? loadSqlite()
    this.options.testHooks?.injectFault?.('sqlite_open')
    this.db = new Sqlite(this.path)
    this.db.pragma('foreign_keys = ON')
    const busyTimeoutMs = this.options.testHooks?.busyTimeoutMs ?? 3000
    this.options.testHooks?.injectFault?.('busy_timeout_pragma')
    this.db.pragma(`busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`)
    try {
      this.options.testHooks?.injectFault?.('wal_pragma')
      this.db.pragma('journal_mode = WAL')
    } catch { /* rollback journal is still safe */ }
    this.options.testHooks?.injectFault?.('migration')
    migrateLocalDataIndex(this.db)
    this.options.testHooks?.injectFault?.('integrity_check')
    const injected = this.options.testHooks?.integrityCheckResult
    const integrity = typeof injected === 'function'
      ? injected()
      : typeof injected === 'string'
        ? injected
        : this.db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${String(integrity)}`)
  }
  private async openAsync(): Promise<boolean> {
    try { this.openDatabase(); this.statusValue = 'incomplete'; return true } catch (error) {
      if (!isRepairableDatabaseError(error)) { this.markUnavailable(error); return false }
      this.closeDbOnly(); this.quarantineProjectionSync();
      try { this.openDatabase(); this.statusValue = 'incomplete'; return true } catch (retryError) { this.markUnavailable(retryError); return false }
    }
  }
  private quarantineProjectionSync(): void {
    const suffix = `.quarantined-${Date.now()}-${Math.random().toString(36).slice(2)}`
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      try { renameSync(path, `${path}${suffix}`) } catch (error) { if (!isMissing(error)) throw error }
    }
  }
  private closeDbOnly(): void { try { this.db?.close() } catch { /* shutdown/recovery remains best effort */ } this.db = null }
  private markUnavailable(error: unknown): void { this.closeDbOnly(); this.readyInputFingerprint = null; this.statusValue = 'unavailable'; this.unavailableReason = messageOf(error) }

  private async snapshotSources(issues: LocalDataIndexIssue[]): Promise<BuildInput> {
    const [workspaces, temporary, memory] = await Promise.allSettled([
      this.options.sources.listWorkspaces(), this.options.sources.listTemporaryConversations?.() ?? Promise.resolve([]), this.readMemoryScan()
    ])
    if (workspaces.status !== 'fulfilled') issues.push({ sourceKey: 'workspace_catalog', code: 'read_failed', message: messageOf(workspaces.reason) })
    if (temporary.status !== 'fulfilled') issues.push({ sourceKey: 'temporary_conversations', code: 'read_failed', message: messageOf(temporary.reason) })
    if (memory.status !== 'fulfilled') issues.push({ sourceKey: 'memory', code: 'read_failed', message: messageOf(memory.reason) })
    const memoryInput = memory.status === 'fulfilled' ? memory.value : { records: [], issues: [], sourcePaths: [], sourceFingerprints: [], recordFingerprints: [] }
    issues.push(...memoryInput.issues)
    return { appDataRoot: this.options.appDataRoot, workspaces: workspaces.status === 'fulfilled' ? workspaces.value : [], temporaryConversations: temporary.status === 'fulfilled' ? temporary.value : [], memory: memoryInput }
  }
  private async readMemoryScan(): Promise<MemoryInput> {
    if (this.options.sources.scanMemory) {
      const scan = await this.options.sources.scanMemory()
      return { records: scan.records, sourcePaths: scan.sourcePaths, sourceFingerprints: scan.sourceFingerprints, recordFingerprints: scan.recordFingerprints, issues: scan.recoveryIssues.map((item) => ({ sourceKey: `memory:${item.fileName}`, sourcePath: item.filePath, code: item.reason, message: 'Memory record recovery issue.' })) }
    }
    return { records: await (this.options.sources.listMemory?.() ?? Promise.resolve([])), sourcePaths: [], sourceFingerprints: [], recordFingerprints: [], issues: [] }
  }

  private async sourceManifestMatches(expected: string): Promise<boolean> {
    const issues: LocalDataIndexIssue[] = []
    const input = await this.snapshotSources(issues)
    const projections = await this.projectSources(input, issues)
    return !issues.length && expected === sourceManifestFingerprint(input, projections.provenance)
  }

  private async projectSources(input: BuildInput, issues: LocalDataIndexIssue[]) {
    const usableWorkspaces = input.workspaces.filter((item) => item.summary)
    for (const item of input.workspaces.filter((item) => !item.summary)) issues.push({ sourceKey: `workspace:${item.workspaceId}`, sourcePath: item.rootPath, code: 'workspace_unreadable', message: item.error ?? 'Workspace summary is unavailable.' })
    const conversations: ProjectedConversation[] = []
    const provenance: Array<{ sourceKey: string; kind: string; path: string; fingerprint: string }> = []
    for (const scope of [...usableWorkspaces.map((item) => ({ scope: 'workspace' as const, workspace: item, root: item.rootPath, workspaceId: item.workspaceId, summaries: item.summary!.conversations })), { scope: 'temporary' as const, workspace: undefined, root: input.appDataRoot, workspaceId: undefined, summaries: input.temporaryConversations }]) {
      try {
        const persisted = await listPersistedAgentConversationRecords(scope.root, { excludeDeleted: true })
        const summaries = new Map(scope.summaries.map((item) => [item.id, item]))
        for (const item of persisted) {
          const path = join(scope.root, item.jsonRelativePath)
          if (!item.sourceFingerprint) throw new Error('Canonical conversation scan did not retain its source fingerprint.')
          const fingerprint = item.sourceFingerprint
          // Legacy canonical JSON is read-only source material. Project only a
          // safe view into SQLite and leave the source bytes untouched.
          const record = sanitizePersistedAgentConversationRecord(item.record)
          const sourceSummary = summaries.get(item.record.id) ?? summaryFromRecord(record, scope.workspaceId)
          const summary = { ...sourceSummary, title: sanitizePersistedConversationTitle(sourceSummary.title) }
          conversations.push({ summary, workspaceId: scope.workspaceId, scope: scope.scope, record, path, fingerprint })
          provenance.push({ sourceKey: `conversation:${scope.scope}:${scope.workspaceId ?? 'global'}:${item.record.id}`, kind: 'conversation_json', path, fingerprint })
        }
        const persistedIds = new Set(persisted.map((item) => item.record.id))
        for (const summary of scope.summaries) if (!persistedIds.has(summary.id)) issues.push({ sourceKey: `conversation:${scope.scope}:${scope.workspaceId ?? 'global'}:${summary.id}`, code: 'source_missing', message: 'Conversation listed by the canonical catalog was not readable from persisted JSON.' })
      } catch (error) { issues.push({ sourceKey: `conversation:${scope.scope}:${scope.workspaceId ?? 'global'}`, sourcePath: scope.root, code: 'invalid_persisted_records', message: messageOf(error) }) }
    }
    const ledgers: ProjectedLedger[] = []
    for (const workspace of usableWorkspaces) {
      try {
        const sources = await readLedgerEntries(workspace.rootPath)
        for (const source of sources) {
          provenance.push({ sourceKey: `ledger_file:${workspace.workspaceId}:${source.path}`, kind: 'learning_work_jsonl', path: source.path, fingerprint: source.fingerprint })
          for (let lineNumber = 0; lineNumber < source.lines.length; lineNumber++) {
            const snapshot = parseLedgerSnapshot(source.lines[lineNumber]!)
            if (!snapshot) { issues.push({ sourceKey: `ledger:${workspace.workspaceId}`, sourcePath: source.path, code: 'invalid_row', message: 'An invalid learning-work JSONL row was found.' }); continue }
            ledgers.push({ ...snapshot, workspaceId: workspace.workspaceId, path: source.path, fingerprint: source.fingerprint, sourceKey: `ledger:${workspace.workspaceId}:${source.fingerprint}:${lineNumber}` })
          }
        }
      } catch (error) { issues.push({ sourceKey: `ledger:${workspace.workspaceId}`, sourcePath: join(workspace.rootPath, '.studiumx', 'learning-work.jsonl'), code: 'read_failed', message: messageOf(error) }) }
    }
    for (const source of input.memory.sourceFingerprints) provenance.push({ sourceKey: `memory:${source.path}`, kind: 'memory_json', path: source.path, fingerprint: source.fingerprint })
    const usageProjection = await this.projectUsageSources(input, usableWorkspaces, issues)
    return {
      workspaces: usableWorkspaces.map((item) => ({ workspaceId: item.workspaceId, workspaceName: item.workspaceName, rootPath: item.rootPath, fingerprint: fingerprintJson(workspaceIdentity(item)) })),
      workspaceRoots: usableWorkspaces.map((item) => item.rootPath),
      conversations,
      ledgers,
      usages: usageProjection.usages,
      provenance,
      usageProvenance: usageProjection.provenance,
      usageScan: usageProjection.usageScan
    }
  }
  private async projectUsageSources(
    input: BuildInput,
    usableWorkspaces: AnalyticsWorkspaceScanResult[],
    issues: LocalDataIndexIssue[]
  ): Promise<{ usages: ProjectedUsage[]; provenance: Array<{ sourceKey: string; kind: string; path: string; fingerprint: string }>; usageScan: UsageScanStats }> {
    // Usage ledgers are rebuildable observability projections. They are intentionally
    // excluded from the readiness fingerprint so frequent appends do not thrash
    // conversation/memory currentness. source_provenance still records usage files.
    const byEntryId = new Map<string, ProjectedUsage>()
    const usageProvenance: Array<{ sourceKey: string; kind: string; path: string; fingerprint: string }> = []
    let segmentFileCount = 0
    let invalidRowCount = 0
    const ingest = async (scopeKey: string, activePath: string, sourcePathHint: string) => {
      try {
        const sources = await readUsageLedgerSources(activePath)
        for (const source of sources) {
          segmentFileCount += 1
          usageProvenance.push({ sourceKey: `usage_file:${scopeKey}:${source.path}`, kind: 'usage_jsonl', path: source.path, fingerprint: source.fingerprint })
          if (source.invalid > 0) {
            invalidRowCount += source.invalid
            issues.push({ sourceKey: `usage:${scopeKey}`, sourcePath: source.path, code: 'invalid_row', message: `${source.invalid} invalid usage JSONL row(s) were skipped.` })
          }
          for (const entry of source.entries) {
            // Same entryId may appear in app + workspace mirrors; keep first projection.
            if (!byEntryId.has(entry.entryId)) {
              byEntryId.set(entry.entryId, { entry, path: source.path, fingerprint: source.fingerprint })
            }
          }
        }
      } catch (error) {
        issues.push({ sourceKey: `usage:${scopeKey}`, sourcePath: sourcePathHint, code: 'read_failed', message: messageOf(error) })
      }
    }
    await ingest('app', usageLedgerActivePath(input.appDataRoot), usageLedgerActivePath(input.appDataRoot))
    for (const workspace of usableWorkspaces) {
      await ingest(`workspace:${workspace.workspaceId}`, usageLedgerWorkspacePath(workspace.rootPath), usageLedgerWorkspacePath(workspace.rootPath))
    }
    const usages = [...byEntryId.values()].sort((left, right) => left.entry.timestamp.localeCompare(right.entry.timestamp) || left.entry.entryId.localeCompare(right.entry.entryId))
    return {
      usages,
      provenance: usageProvenance,
      usageScan: {
        segmentFileCount,
        projectedEntryCount: usages.length,
        invalidRowCount
      }
    }
  }
  private async readUsageAnalytics(db: ProjectionDb): Promise<LocalDataIndexUsageAnalyticsRead> {
    if (!await this.canExecuteProjectionQuery(db)) return { state: 'unavailable' }
    try {
      const rows = db.prepare(`SELECT entry_id, kind, timestamp, provider, model, status, started_at, completed_at, duration_ms, input_tokens, output_tokens, reasoning_tokens, cache_tokens, tool_name, read_only, destructive, approval_status, trace_id, turn_id, conversation_id, ttft_ms, retry_count, truncated, error_type FROM usage_projection`).all() as Array<Record<string, unknown>>
      const entries: UsageLedgerEntry[] = []
      for (const row of rows) {
        const entry = hydrateUsageProjectionRow(row)
        if (entry) entries.push(entry)
      }
      return { state: 'readable', summary: summarizeUsageEntries(entries) }
    } catch {
      return { state: 'unavailable' }
    }
  }
  private async readConversation(db: ProjectionDb, workspaceId: string | null, conversationId: string, scope: 'workspace' | 'temporary'): Promise<LocalDataIndexConversationRead> {
    if (!await this.canExecuteProjectionQuery(db)) return { state: 'unavailable' }
    try {
      const row = db.prepare('SELECT * FROM conversation_projection WHERE workspace_id IS ? AND conversation_id = ? AND scope = ?').get(workspaceId, conversationId, scope) as Record<string, unknown> | undefined
      return row ? { state: 'readable', record: hydrateConversation(row) } : { state: 'unreadable' }
    } catch { return { state: 'unreadable' } }
  }
  private async readLedger(db: ProjectionDb, workspaceId: string): Promise<LocalDataIndexLedgerRead> {
    if (!await this.canExecuteProjectionQuery(db)) return { state: 'unavailable' }
    try {
      const rows = db.prepare('SELECT snapshot_json FROM learning_work_projection WHERE workspace_id = ? ORDER BY occurred_at DESC, ledger_created_at DESC, entry_id DESC').all(workspaceId) as Array<{ snapshot_json: string }>
      const latestByConversation = new Map<string, LedgerSnapshot>()
      for (const row of rows) { const value = JSON.parse(row.snapshot_json) as LedgerSnapshot; if (!latestByConversation.has(value.conversationId)) latestByConversation.set(value.conversationId, value) }
      return { latestByConversation, scanned: rows.length, invalid: 0, readError: false }
    } catch { return { latestByConversation: new Map(), scanned: 0, invalid: 0, readError: true } }
  }
  private async canExecuteProjectionQuery(db: ProjectionDb): Promise<boolean> {
    if (this.db !== db || this.statusValue !== 'ready') return false
    const expected = this.readyInputFingerprint
    if (!expected) { this.markProjectionStaleAtQuery(); return false }
    try {
      await this.options.testHooks?.beforeAdapterQueryCurrentnessVerification?.()
      // This exact canonical manifest check is deliberately the final awaited work
      // before a projection SQL statement executes in each adapter method.
      if (this.db !== db || this.statusValue !== 'ready' || !await this.sourceManifestMatches(expected)) {
        this.markProjectionStaleAtQuery()
        return false
      }
      return true
    } catch {
      this.markProjectionStaleAtQuery()
      return false
    }
  }
  private markProjectionStaleAtQuery(): void {
    this.readyInputFingerprint = null
    if (this.statusValue !== 'closed' && this.statusValue !== 'unavailable') this.statusValue = 'incomplete'
    if (this.db) {
      try {
        this.db.transaction(() => {
          putState(this.db!, 'complete', '0')
          this.db!.prepare('INSERT INTO index_issue (rebuild_id, source_key, source_path, code, message, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            `query:${this.nowIso()}`, 'source_manifest', null, 'source_drift', 'Canonical sources changed before a SQLite projection query could execute.', this.nowIso()
          )
        })()
      } catch { /* availability fallback remains safe even if diagnostics cannot be persisted */ }
    }
    this.scheduleRebuild()
  }
  private recordIncomplete(rebuildId: string, issues: LocalDataIndexIssue[]): void {
    if (!this.db) return
    this.db.transaction(() => { this.db!.exec('DELETE FROM index_issue'); const insert = this.db!.prepare('INSERT INTO index_issue (rebuild_id, source_key, source_path, code, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'); for (const item of issues) insert.run(rebuildId, item.sourceKey, item.sourcePath ?? null, item.code, item.message, this.nowIso()); putState(this.db!, 'complete', '0') })()
  }

  /**
   * DB-OPT-2: conversation-only incremental path. Returns true when applied.
   * Non-conversation tables still full-refresh inside the same transaction so
   * readiness/currentness stays consistent. Failure → false (caller does full).
   */
  private tryIncrementalConversationReplace(
    db: ProjectionDb,
    input: BuildInput,
    projections: Awaited<ReturnType<LocalDataIndex['projectSources']>>,
    rebuildId: string,
    issues: LocalDataIndexIssue[],
    inputFingerprint: string
  ): boolean {
    const previousRows = db.prepare(
      `SELECT source_key AS sourceKey, source_fingerprint AS fingerprint FROM conversation_projection`
    ).all() as Array<{ sourceKey: string; fingerprint: string }>
    if (previousRows.length === 0) return false
    const nextFingerprints = projections.conversations.map((item) => ({
      sourceKey: `conversation:${item.scope}:${item.workspaceId ?? 'global'}:${item.summary.id}`,
      fingerprint: item.fingerprint
    }))
    const plan = planIncrementalRebuild({ previous: previousRows, next: nextFingerprints })
    if (plan.mode !== 'incremental') return false

    const byKey = new Map<string, (typeof projections.conversations)[number]>()
    for (const item of projections.conversations) {
      byKey.set(`conversation:${item.scope}:${item.workspaceId ?? 'global'}:${item.summary.id}`, item)
    }
    db.transaction(() => {
      // Full refresh non-conversation projections (safe fallback surface stays simple).
      db.exec('DELETE FROM workspace_projection; DELETE FROM memory_projection; DELETE FROM learning_work_projection; DELETE FROM usage_projection; DELETE FROM source_provenance; DELETE FROM index_issue;')
      const workspace = db.prepare('INSERT INTO workspace_projection VALUES (?, ?, ?, ?, ?)')
      const memory = db.prepare('INSERT INTO memory_projection (memory_id, scope, workspace_path, project_path, source_lesson_id, tags_json, confidence, created_at, updated_at, disabled_at, deleted_at, source_fingerprint, indexed_at, kind, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const ledger = db.prepare('INSERT INTO learning_work_projection VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const usage = db.prepare(`INSERT INTO usage_projection (
          entry_id, kind, timestamp, provider, model, status, started_at, completed_at, duration_ms,
          input_tokens, output_tokens, reasoning_tokens, cache_tokens, tool_name, read_only, destructive,
          approval_status, trace_id, turn_id, conversation_id, source_path, source_fingerprint, indexed_at,
          ttft_ms, retry_count, truncated, error_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      const conversation = db.prepare('INSERT INTO conversation_projection VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const deleteConversation = db.prepare('DELETE FROM conversation_projection WHERE source_key = ?')
      const provenance = db.prepare('INSERT INTO source_provenance VALUES (?, ?, ?, ?, ?)')
      const issue = db.prepare('INSERT INTO index_issue (rebuild_id, source_key, source_path, code, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (const key of plan.deleteKeys) deleteConversation.run(key)
      for (const key of plan.upsertKeys) {
        const item = byKey.get(key)
        if (!item) continue
        deleteConversation.run(key)
        conversation.run(key, item.workspaceId ?? null, item.summary.id, item.scope, item.summary.title, item.summary.createdAt, item.summary.updatedAt, item.summary.relativePath, '', item.summary.messageCount, JSON.stringify(projectConversation(item.record)), item.fingerprint, this.nowIso(), item.summary.pinned === true ? 1 : 0, item.record.branch?.status === 'archived' ? 1 : 0)
      }
      for (const item of projections.workspaces) workspace.run(item.workspaceId, item.workspaceName, item.rootPath, item.fingerprint, this.nowIso())
      const memoryFingerprints = new Map(input.memory.recordFingerprints.map((item) => [item.memoryId, item.fingerprint]))
      for (const item of input.memory.records) memory.run(item.id, item.scope, item.workspace ?? null, item.project ?? null, item.sourceLessonId ?? null, JSON.stringify(item.tags), item.confidence, item.createdAt, item.updatedAt, item.disabledAt ?? null, item.deletedAt ?? null, memoryFingerprints.get(item.id) ?? fingerprintJson(memoryIdentity(item)), this.nowIso(), resolveTeachingMemoryKind(item) ?? null, resolveTeachingMemoryStatus(item))
      for (const item of projections.ledgers) ledger.run(item.sourceKey, item.workspaceId, item.conversationId, item.entryId, item.occurredAt, item.ledgerCreatedAt, JSON.stringify(snapshotProjection(item)), item.path, item.fingerprint, this.nowIso())
      for (const item of projections.usages) {
        const entry = item.entry
        usage.run(
          entry.entryId, entry.kind, entry.timestamp, entry.provider ?? null, entry.model ?? null, entry.status ?? null,
          entry.startedAt ?? null, entry.completedAt ?? null, entry.durationMs ?? null, entry.inputTokens ?? null,
          entry.outputTokens ?? null, entry.reasoningTokens ?? null, entry.cacheTokens ?? null, entry.toolName ?? null,
          entry.readOnly === undefined ? null : entry.readOnly ? 1 : 0,
          entry.destructive === undefined ? null : entry.destructive ? 1 : 0,
          entry.approvalStatus ?? null, entry.traceId ?? null, entry.turnId ?? null, entry.conversationId ?? null,
          relativeUsageSourcePath(item.path, input.appDataRoot, projections.workspaceRoots),
          item.fingerprint, this.nowIso(), entry.ttftMs ?? null, entry.retryCount ?? null,
          entry.truncated === undefined ? null : entry.truncated ? 1 : 0, entry.errorType ?? null
        )
      }
      this.lastUsageScan = projections.usageScan
      for (const item of projections.provenance) provenance.run(item.sourceKey, item.kind, item.path, item.fingerprint, this.nowIso())
      for (const item of projections.usageProvenance) provenance.run(item.sourceKey, item.kind, item.path, item.fingerprint, this.nowIso())
      for (const item of issues) issue.run(rebuildId, item.sourceKey, item.sourcePath ?? null, item.code, item.message, this.nowIso())
      putState(db, 'version', INDEX_VERSION); putState(db, 'input_fingerprint', inputFingerprint); putState(db, 'complete', '0'); putState(db, 'rebuilt_at', this.nowIso())
    })()
    return true
  }

  /** Reliable full DELETE+INSERT rebuild (default production path). */
  private applyFullProjectionReplace(
    db: ProjectionDb,
    input: BuildInput,
    projections: Awaited<ReturnType<LocalDataIndex['projectSources']>>,
    rebuildId: string,
    issues: LocalDataIndexIssue[],
    inputFingerprint: string
  ): void {
    db.transaction(() => {
      db.exec('DELETE FROM workspace_projection; DELETE FROM conversation_projection; DELETE FROM memory_projection; DELETE FROM learning_work_projection; DELETE FROM usage_projection; DELETE FROM source_provenance; DELETE FROM index_issue;')
      const workspace = db.prepare('INSERT INTO workspace_projection VALUES (?, ?, ?, ?, ?)')
      const conversation = db.prepare('INSERT INTO conversation_projection VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const memory = db.prepare('INSERT INTO memory_projection (memory_id, scope, workspace_path, project_path, source_lesson_id, tags_json, confidence, created_at, updated_at, disabled_at, deleted_at, source_fingerprint, indexed_at, kind, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const ledger = db.prepare('INSERT INTO learning_work_projection VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const usage = db.prepare(`INSERT INTO usage_projection (
          entry_id, kind, timestamp, provider, model, status, started_at, completed_at, duration_ms,
          input_tokens, output_tokens, reasoning_tokens, cache_tokens, tool_name, read_only, destructive,
          approval_status, trace_id, turn_id, conversation_id, source_path, source_fingerprint, indexed_at,
          ttft_ms, retry_count, truncated, error_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      const provenance = db.prepare('INSERT INTO source_provenance VALUES (?, ?, ?, ?, ?)')
      const issue = db.prepare('INSERT INTO index_issue (rebuild_id, source_key, source_path, code, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (const item of projections.workspaces) workspace.run(item.workspaceId, item.workspaceName, item.rootPath, item.fingerprint, this.nowIso())
      for (const item of projections.conversations) {
        const sourceKey = `conversation:${item.scope}:${item.workspaceId ?? 'global'}:${item.summary.id}`
        conversation.run(sourceKey, item.workspaceId ?? null, item.summary.id, item.scope, item.summary.title, item.summary.createdAt, item.summary.updatedAt, item.summary.relativePath, '', item.summary.messageCount, JSON.stringify(projectConversation(item.record)), item.fingerprint, this.nowIso(), item.summary.pinned === true ? 1 : 0, item.record.branch?.status === 'archived' ? 1 : 0)
      }
      const memoryFingerprints = new Map(input.memory.recordFingerprints.map((item) => [item.memoryId, item.fingerprint]))
      for (const item of input.memory.records) memory.run(item.id, item.scope, item.workspace ?? null, item.project ?? null, item.sourceLessonId ?? null, JSON.stringify(item.tags), item.confidence, item.createdAt, item.updatedAt, item.disabledAt ?? null, item.deletedAt ?? null, memoryFingerprints.get(item.id) ?? fingerprintJson(memoryIdentity(item)), this.nowIso(), resolveTeachingMemoryKind(item) ?? null, resolveTeachingMemoryStatus(item))
      for (const item of projections.ledgers) ledger.run(item.sourceKey, item.workspaceId, item.conversationId, item.entryId, item.occurredAt, item.ledgerCreatedAt, JSON.stringify(snapshotProjection(item)), item.path, item.fingerprint, this.nowIso())
      for (const item of projections.usages) {
        const entry = item.entry
        usage.run(
          entry.entryId, entry.kind, entry.timestamp, entry.provider ?? null, entry.model ?? null, entry.status ?? null,
          entry.startedAt ?? null, entry.completedAt ?? null, entry.durationMs ?? null, entry.inputTokens ?? null,
          entry.outputTokens ?? null, entry.reasoningTokens ?? null, entry.cacheTokens ?? null, entry.toolName ?? null,
          entry.readOnly === undefined ? null : entry.readOnly ? 1 : 0,
          entry.destructive === undefined ? null : entry.destructive ? 1 : 0,
          entry.approvalStatus ?? null, entry.traceId ?? null, entry.turnId ?? null, entry.conversationId ?? null,
          relativeUsageSourcePath(item.path, input.appDataRoot, projections.workspaceRoots),
          item.fingerprint, this.nowIso(), entry.ttftMs ?? null, entry.retryCount ?? null,
          entry.truncated === undefined ? null : entry.truncated ? 1 : 0, entry.errorType ?? null
        )
      }
      this.lastUsageScan = projections.usageScan
      for (const item of projections.provenance) provenance.run(item.sourceKey, item.kind, item.path, item.fingerprint, this.nowIso())
      for (const item of projections.usageProvenance) provenance.run(item.sourceKey, item.kind, item.path, item.fingerprint, this.nowIso())
      for (const item of issues) issue.run(rebuildId, item.sourceKey, item.sourcePath ?? null, item.code, item.message, this.nowIso())
      putState(db, 'version', INDEX_VERSION); putState(db, 'input_fingerprint', inputFingerprint); putState(db, 'complete', '0'); putState(db, 'rebuilt_at', this.nowIso())
    })()
  }

  private nowIso(): string { return (this.options.now ?? (() => new Date()))().toISOString() }
}

function loadSqlite(): SqliteConstructor {
  // Do not import better-sqlite3 at module initialization: a missing/unloadable native binding must not crash Electron startup.
  const loaded = createRequire(import.meta.url)('better-sqlite3') as { default?: SqliteConstructor } | SqliteConstructor
  return (typeof loaded === 'function' ? loaded : loaded.default) as SqliteConstructor
}
function isRepairableDatabaseError(error: unknown): boolean { return error instanceof SchemaMigrationChecksumConflict || /not a database|malformed|integrity check failed|database disk image is malformed/i.test(messageOf(error)) }
function isMissing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT' }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function sourceDriftIssue(message: string): LocalDataIndexIssue { return { sourceKey: 'source_manifest', code: 'source_drift', message } }
function putState(db: ProjectionDb, key: string, value: string): void { db.prepare('INSERT INTO index_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value) }
function getState(db: ProjectionDb, key: string): string | null {
  const row = db.prepare('SELECT value FROM index_state WHERE key = ?').get(key) as { value?: string } | undefined
  return typeof row?.value === 'string' ? row.value : null
}
function fingerprintJson(value: unknown): string { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex') }
function workspaceIdentity(item: AnalyticsWorkspaceScanResult) { return { workspaceId: item.workspaceId, workspaceName: item.workspaceName, rootPath: item.rootPath, summary: item.summary?.conversations.map((c) => ({ id: c.id, updatedAt: c.updatedAt, messageCount: c.messageCount, relativePath: c.relativePath })) ?? null, error: item.error } }
function memoryIdentity(item: TeachingMemoryRecord) { return { id: item.id, scope: item.scope, workspace: item.workspace, project: item.project, sourceLessonId: item.sourceLessonId, memoryKind: item.memoryKind, tags: item.tags, confidence: item.confidence, createdAt: item.createdAt, updatedAt: item.updatedAt, disabledAt: item.disabledAt, deletedAt: item.deletedAt } }
function sourceManifestFingerprint(
  input: BuildInput,
  provenance: Array<{ sourceKey: string; kind: string; path: string; fingerprint: string }>
): string {
  return fingerprintJson({
    workspaces: input.workspaces.map(workspaceIdentity),
    temporary: input.temporaryConversations.map((item) => ({ id: item.id, updatedAt: item.updatedAt, relativePath: item.relativePath })),
    memory: input.memory.records.map(memoryIdentity),
    memoryPaths: [...input.memory.sourcePaths].sort(),
    sourceBytes: provenance.map(({ sourceKey, kind, path, fingerprint }) => ({ sourceKey, kind, path, fingerprint })).sort((left, right) => left.path.localeCompare(right.path) || left.sourceKey.localeCompare(right.sourceKey))
  })
}
async function readLedgerEntries(rootPath: string): Promise<Array<{ path: string; fingerprint: string; lines: string[] }>> {
  return (await readDurableJsonlSources(join(rootPath, '.studiumx', 'learning-work.jsonl'))).map((source) => ({
    path: source.path,
    fingerprint: createHash('sha256').update(source.bytes).digest('hex'),
    lines: source.lines
  }))
}
function summaryFromRecord(record: AgentConversationRecord, workspaceId?: string): AgentConversationSummary { return { id: record.id, ...(workspaceId ? { workspaceId } : {}), title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, relativePath: record.relativePath, absolutePath: record.absolutePath, messageCount: record.messageCount } }
function projectConversation(record: AgentConversationRecord): object { return { turns: record.turns.map((turn) => ({ id: turn.id, role: turn.role, createdAt: turn.createdAt, ...(turn.toolCalls?.length ? { toolCalls: turn.toolCalls.map((tool) => ({ name: tool.name, ...(tool.isError ? { isError: true } : {}) })) } : {}), ...(turn.metadata ? { metadata: { version: turn.metadata.version, ...(turn.metadata.runUsage ? { runUsage: turn.metadata.runUsage } : {}), governance: { compactionEvents: turn.metadata.compactions?.length ?? 0, replacedTokens: sum(turn.metadata.compactions?.map((item) => item.replacedTokens) ?? []), hygieneSavedTokens: sum(turn.metadata.contextHygiene?.map((item) => item.savedTokens) ?? []) } } } : {}) })) } }
/** Index-first list with filesystem fallback for resume/session pickers (metadata only). */
export async function listConversationsWithFilesystemFallback(
  index: Pick<LocalDataIndex, 'listConversations'> | null | undefined,
  filesystemList: () => Promise<LocalDataIndexConversationListItem[]>,
  query: LocalDataIndexConversationListQuery = {}
): Promise<{ source: 'index' | 'filesystem'; items: LocalDataIndexConversationListItem[] }> {
  if (index) {
    try {
      const indexed = await index.listConversations(query)
      if (indexed.state === 'readable') return { source: 'index', items: indexed.items }
    } catch {
      // fall through to filesystem scan
    }
  }
  const items = await filesystemList()
  return { source: 'filesystem', items: applyConversationListQuery(items, query) }
}

/** Maps catalog summaries into the stable list-item shape (metadata-first, no snippets). */
export function conversationListItemsFromSummaries(
  summaries: readonly AgentConversationSummary[],
  scope: 'workspace' | 'temporary' = 'workspace'
): LocalDataIndexConversationListItem[] {
  return summaries.map((summary) => ({
    conversationId: summary.id,
    workspaceId: summary.workspaceId ?? null,
    scope,
    title: sanitizePersistedConversationTitle(summary.title),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    messageCount: summary.messageCount,
    pinned: summary.pinned === true,
    archived: summary.branch?.status === 'archived',
    relativePath: summary.relativePath
  }))
}

function applyConversationListQuery(
  items: readonly LocalDataIndexConversationListItem[],
  query: LocalDataIndexConversationListQuery
): LocalDataIndexConversationListItem[] {
  const limit = normalizeConversationListLimit(query.limit)
  const includeArchived = query.includeArchived === true
  return items
    .filter((item) => {
      if (query.scope && item.scope !== query.scope) return false
      if (query.workspaceId !== undefined) {
        if (query.workspaceId === null) {
          if (item.workspaceId !== null) return false
        } else if (item.workspaceId !== query.workspaceId) return false
      }
      if (!includeArchived && item.archived) return false
      return true
    })
    .sort((left, right) => {
      const leftPinned = left.pinned ? 1 : 0
      const rightPinned = right.pinned ? 1 : 0
      if (leftPinned !== rightPinned) return rightPinned - leftPinned
      const updated = right.updatedAt.localeCompare(left.updatedAt)
      if (updated !== 0) return updated
      return left.conversationId.localeCompare(right.conversationId)
    })
    .slice(0, limit)
}

function hydrateConversationListItem(row: Record<string, unknown>): LocalDataIndexConversationListItem {
  return {
    conversationId: String(row.conversation_id),
    workspaceId: row.workspace_id == null ? null : String(row.workspace_id),
    scope: row.scope === 'temporary' ? 'temporary' : 'workspace',
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    messageCount: Number(row.message_count) || 0,
    pinned: Number(row.pinned) === 1,
    archived: Number(row.archived) === 1,
    relativePath: String(row.relative_path)
  }
}
function normalizeConversationListLimit(limit: number | undefined): number {
  if (limit === undefined || limit === null) return 100
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return 100
  return Math.min(Math.floor(limit), 500)
}
function hydrateConversation(row: Record<string, unknown>): AgentConversationRecord {
  const projected = JSON.parse(String(row.turn_projection_json)) as { turns: Array<Record<string, unknown>> }
  const relativePath = String(row.relative_path)
  // DB-OPT-1: absolute_path column is no longer durable authority. Prefer empty or
  // relative_path-only; never require a host absolute path for hydrate/list.
  const storedAbsolute = typeof row.absolute_path === 'string' ? row.absolute_path : ''
  const absolutePath = storedAbsolute && !isProbablyHostAbsolutePath(storedAbsolute)
    ? storedAbsolute
    : relativePath
  return {
    id: String(row.conversation_id),
    ...(row.workspace_id ? { workspaceId: String(row.workspace_id) } : {}),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    relativePath,
    absolutePath,
    messageCount: Number(row.message_count),
    turns: projected.turns.map((turn) => ({
      id: String(turn.id),
      role: turn.role as AgentConversationRecord['turns'][number]['role'],
      content: '',
      createdAt: String(turn.createdAt),
      ...(Array.isArray(turn.toolCalls)
        ? {
            toolCalls: turn.toolCalls.map((tool) => ({
              id: `projected:${String((tool as { name?: unknown }).name ?? 'tool')}`,
              name: String((tool as { name?: unknown }).name ?? ''),
              arguments: '',
              ...((tool as { isError?: unknown }).isError ? { isError: true } : {})
            }))
          }
        : {}),
      ...(turn.metadata ? { metadata: hydrateMetadata(turn.metadata as Record<string, unknown>) } : {})
    }))
  }
}
function hydrateMetadata(value: Record<string, unknown>): AgentConversationRecord['turns'][number]['metadata'] { const governance = value.governance as Record<string, unknown> | undefined; return { version: 1, ...(value.runUsage ? { runUsage: value.runUsage as NonNullable<AgentConversationRecord['turns'][number]['metadata']>['runUsage'] } : {}), ...(governance ? { compactions: Array.from({ length: Number(governance.compactionEvents) || 0 }, () => ({ id: 'projected', createdAt: '1970-01-01T00:00:00.000Z', replacedTurnIds: [], sourceDigest: 'projected', reason: 'analytics', mode: 'normal', replacedTokens: Number(governance.replacedTokens) || 0 })), contextHygiene: Number(governance.hygieneSavedTokens) ? [{ changed: true, savedTokens: Number(governance.hygieneSavedTokens), compactedToolResults: 0, digestedToolResults: 0, compactedToolCallArgs: 0 }] : [] } : {}) } }
function sum(values: Array<number | undefined>): number { return values.reduce<number>((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0) }
function parseLedgerSnapshot(line: string): (LedgerSnapshot & { entryId: string }) | null { try { const value = JSON.parse(line) as Record<string, unknown>; const conversation = object(value.conversation); const evidence = object(value.evidence); const usage = object(evidence?.runUsage); const entryId = text(value.entryId); if (value.version !== 1 || value.type !== 'conversation_snapshot' || !conversation || !usage || !entryId) return null; const conversationId = text(conversation.id), occurredAt = instant(conversation.updatedAt), ledgerCreatedAt = instant(value.createdAt), messageCount = number(conversation.messageCount), normalized = normalizeUsage(usage); if (!conversationId || !occurredAt || !ledgerCreatedAt || messageCount === null || !normalized) return null; return { entryId, conversationId, title: sanitizePersistedConversationTitle(text(conversation.title) ?? conversationId), courseRelativePath: text(conversation.courseRelativePath), occurredAt, ledgerCreatedAt, messageCount, ...normalized } } catch { return null } }
function snapshotProjection(snapshot: ProjectedLedger): LedgerSnapshot { const { entryId: _entryId, workspaceId: _workspaceId, path: _path, sourceKey: _sourceKey, fingerprint: _fingerprint, ...value } = snapshot; return value }
function hydrateUsageProjectionRow(row: Record<string, unknown>): UsageLedgerEntry | null {
  // Rebuild through the ledger parser so projection rows stay secret-free and schema-stable.
  return parseUsageLedgerLine(JSON.stringify({
    version: 1,
    entryId: row.entry_id,
    kind: row.kind,
    timestamp: row.timestamp,
    ...(row.provider != null ? { provider: row.provider } : {}),
    ...(row.model != null ? { model: row.model } : {}),
    ...(row.status != null ? { status: row.status } : {}),
    ...(row.started_at != null ? { startedAt: row.started_at } : {}),
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
    ...(row.duration_ms != null ? { durationMs: row.duration_ms } : {}),
    ...(row.input_tokens != null ? { inputTokens: row.input_tokens } : {}),
    ...(row.output_tokens != null ? { outputTokens: row.output_tokens } : {}),
    ...(row.reasoning_tokens != null ? { reasoningTokens: row.reasoning_tokens } : {}),
    ...(row.cache_tokens != null ? { cacheTokens: row.cache_tokens } : {}),
    ...(row.tool_name != null ? { toolName: row.tool_name } : {}),
    ...(row.read_only === 0 || row.read_only === 1 ? { readOnly: row.read_only === 1 } : {}),
    ...(row.destructive === 0 || row.destructive === 1 ? { destructive: row.destructive === 1 } : {}),
    ...(row.approval_status != null ? { approvalStatus: row.approval_status } : {}),
    ...(row.trace_id != null ? { traceId: row.trace_id } : {}),
    ...(row.turn_id != null ? { turnId: row.turn_id } : {}),
    ...(row.conversation_id != null ? { conversationId: row.conversation_id } : {}),
    ...(row.ttft_ms != null ? { ttftMs: row.ttft_ms } : {}),
    ...(row.retry_count != null ? { retryCount: row.retry_count } : {}),
    ...(row.truncated === 0 || row.truncated === 1 ? { truncated: row.truncated === 1 } : {}),
    ...(row.error_type != null ? { errorType: row.error_type } : {})
  }))
}
/** Prefer app/workspace-relative placement labels; never re-emit host home paths when a prefix match exists. */
function relativeUsageSourcePath(absolutePath: string, appDataRoot: string, workspaceRoots: readonly string[]): string {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const pathNorm = normalize(absolutePath)
  const appNorm = normalize(appDataRoot)
  if (pathNorm === appNorm || pathNorm.startsWith(`${appNorm}/`)) {
    return pathNorm.slice(appNorm.length).replace(/^\//, '') || 'usage/usage.jsonl'
  }
  for (const root of workspaceRoots) {
    const rootNorm = normalize(root)
    if (pathNorm === rootNorm || pathNorm.startsWith(`${rootNorm}/`)) {
      return pathNorm.slice(rootNorm.length).replace(/^\//, '') || '.studiumx/usage.jsonl'
    }
  }
  // Last resort: basename only — still avoids full host path leakage in projection rows.
  const parts = pathNorm.split('/')
  return parts[parts.length - 1] || 'usage.jsonl'
}
function isProbablyHostAbsolutePath(value: string): boolean {
  if (!value) return false
  if (value.startsWith('/') || value.startsWith('\\')) return true
  return /^[A-Za-z]:[\\/]/.test(value)
}
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function instant(value: unknown): string | null { if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return null; return new Date(value).toISOString() }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null }
function normalizeUsage(value: Record<string, unknown>): Pick<LedgerSnapshot, 'usage' | 'componentsComplete' | 'totalInconsistent'> | null { const promptTokens = number(value.promptTokens), completionTokens = number(value.completionTokens), sourceTotal = number(value.totalTokens), totalTokens = sourceTotal ?? (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null); if (totalTokens === null) return null; const derived = promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null; return { usage: { ...(promptTokens !== null ? { promptTokens } : {}), ...(completionTokens !== null ? { completionTokens } : {}), totalTokens, providerCalls: number(value.providerCalls) ?? 0, toolCalls: number(value.toolCalls) ?? 0, toolErrors: number(value.toolErrors) ?? 0, iterations: number(value.iterations) ?? 0, childRuns: number(value.childRuns) ?? 0, durationMs: number(value.durationMs) ?? 0 }, componentsComplete: promptTokens !== null && completionTokens !== null, totalInconsistent: sourceTotal !== null && derived !== null && sourceTotal !== derived } }
