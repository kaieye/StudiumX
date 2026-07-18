import { createHash } from 'node:crypto'
import { renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { AgentConversationRecord, AgentConversationSummary, TeachingMemoryRecord } from '../../shared/teaching-types'
import { sanitizePersistedAgentConversationRecord, sanitizePersistedConversationTitle } from '../../shared/agent-persisted-history'
import { listPersistedAgentConversationRecords } from '../teaching-agent-conversations'
import type { TeachingMemoryCatalogIndexScan } from '../teaching-memory-catalog'
import type { AnalyticsWorkspaceScanResult } from '../teaching/services/learning-analytics'
import type { LedgerSnapshot, LearningWorkLedgerSnapshotsRead } from '../teaching/services/analytics/token-evidence'
import { readDurableJsonlSources } from '../durable-jsonl'
import { SchemaMigrationChecksumConflict, migrateLocalDataIndex } from './schema-migration'

export { LOCAL_DATA_INDEX_MIGRATIONS, migrateLocalDataIndex } from './schema-migration'

export type LocalDataIndexStatus = 'ready' | 'building' | 'incomplete' | 'unavailable' | 'closed'
export type LocalDataIndexIssue = { sourceKey: string; sourcePath?: string; code: string; message: string }
export type LocalDataIndexTestHooks = {
  /** Deterministic seams for C-1 source-currentness boundary tests. */
  beforeCurrentnessVerification?: () => void | Promise<void>
  afterPrecommitVerification?: () => void | Promise<void>
  beforeFinalReadyTransition?: () => void | Promise<void>
  /** Simulates the unavoidable external filesystem TOCTOU after the last rebuild check. */
  afterFinalReadyVerification?: () => void | Promise<void>
  /** Runs after analytics receives adapters but before an adapter revalidates sources and executes SQL. */
  beforeAdapterQueryCurrentnessVerification?: () => void | Promise<void>
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
type SqliteConstructor = new (path: string) => ProjectionDb

type LocalDataIndexConversationRead =
  | { state: 'readable'; record: AgentConversationRecord }
  | { state: 'unreadable' }
  | { state: 'unavailable' }
type LocalDataIndexLedgerRead = LearningWorkLedgerSnapshotsRead | { state: 'unavailable' }
export type LocalDataIndexTokenEvidenceAdapters = {
  conversations: { read: (workspaceId: string, conversationId: string) => Promise<LocalDataIndexConversationRead> }
  temporaryConversations: { read: (workspaceId: string | undefined, conversationId: string) => Promise<LocalDataIndexConversationRead> }
  ledger: { read: (workspace: { workspaceId: string }) => Promise<LocalDataIndexLedgerRead> }
}

const INDEX_FILE = 'studiumx-index.sqlite'
const INDEX_VERSION = '2'

/** A disposable, main-process-only SQLite projection of canonical local files. */
export class LocalDataIndex {
  private db: ProjectionDb | null = null
  private statusValue: LocalDataIndexStatus = 'unavailable'
  private buildPromise: Promise<void> | null = null
  private unavailableReason: string | null = null
  private readyInputFingerprint: string | null = null

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
      db.transaction(() => {
        db.exec('DELETE FROM workspace_projection; DELETE FROM conversation_projection; DELETE FROM memory_projection; DELETE FROM learning_work_projection; DELETE FROM source_provenance; DELETE FROM index_issue;')
        const workspace = db.prepare('INSERT INTO workspace_projection VALUES (?, ?, ?, ?, ?)')
        const conversation = db.prepare('INSERT INTO conversation_projection VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        const memory = db.prepare('INSERT INTO memory_projection VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        const ledger = db.prepare('INSERT INTO learning_work_projection VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        const provenance = db.prepare('INSERT INTO source_provenance VALUES (?, ?, ?, ?, ?)')
        const issue = db.prepare('INSERT INTO index_issue (rebuild_id, source_key, source_path, code, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        for (const item of projections.workspaces) workspace.run(item.workspaceId, item.workspaceName, item.rootPath, item.fingerprint, this.nowIso())
        for (const item of projections.conversations) {
          const sourceKey = `conversation:${item.scope}:${item.workspaceId ?? 'global'}:${item.summary.id}`
          conversation.run(sourceKey, item.workspaceId ?? null, item.summary.id, item.scope, item.summary.title, item.summary.createdAt, item.summary.updatedAt, item.summary.relativePath, item.path, item.summary.messageCount, JSON.stringify(projectConversation(item.record)), item.fingerprint, this.nowIso())
        }
        const memoryFingerprints = new Map(input.memory.recordFingerprints.map((item) => [item.memoryId, item.fingerprint]))
        for (const item of input.memory.records) memory.run(item.id, item.scope, item.workspace ?? null, item.project ?? null, item.sourceLessonId ?? null, JSON.stringify(item.tags), item.confidence, item.createdAt, item.updatedAt, item.disabledAt ?? null, item.deletedAt ?? null, memoryFingerprints.get(item.id) ?? fingerprintJson(memoryIdentity(item)), this.nowIso())
        for (const item of projections.ledgers) ledger.run(item.sourceKey, item.workspaceId, item.conversationId, item.entryId, item.occurredAt, item.ledgerCreatedAt, JSON.stringify(snapshotProjection(item)), item.path, item.fingerprint, this.nowIso())
        for (const item of projections.provenance) provenance.run(item.sourceKey, item.kind, item.path, item.fingerprint, this.nowIso())
        for (const item of issues) issue.run(rebuildId, item.sourceKey, item.sourcePath ?? null, item.code, item.message, this.nowIso())
        putState(db, 'version', INDEX_VERSION); putState(db, 'input_fingerprint', inputFingerprint); putState(db, 'complete', '0'); putState(db, 'rebuilt_at', this.nowIso())
      })()
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
  issues(): LocalDataIndexIssue[] { return this.db ? this.db.prepare('SELECT source_key sourceKey, source_path sourcePath, code, message FROM index_issue ORDER BY id').all() as LocalDataIndexIssue[] : [] }
  close(): void { this.closeDbOnly(); this.readyInputFingerprint = null; this.statusValue = 'closed' }

  private openDatabase(): void {
    const Sqlite = loadSqlite()
    this.db = new Sqlite(this.path)
    this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 3000')
    try { this.db.pragma('journal_mode = WAL') } catch { /* rollback journal is still safe */ }
    migrateLocalDataIndex(this.db)
    const integrity = this.db.pragma('integrity_check', { simple: true })
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
    return { workspaces: usableWorkspaces.map((item) => ({ workspaceId: item.workspaceId, workspaceName: item.workspaceName, rootPath: item.rootPath, fingerprint: fingerprintJson(workspaceIdentity(item)) })), conversations, ledgers, provenance }
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
function fingerprintJson(value: unknown): string { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex') }
function workspaceIdentity(item: AnalyticsWorkspaceScanResult) { return { workspaceId: item.workspaceId, workspaceName: item.workspaceName, rootPath: item.rootPath, summary: item.summary?.conversations.map((c) => ({ id: c.id, updatedAt: c.updatedAt, messageCount: c.messageCount, relativePath: c.relativePath })) ?? null, error: item.error } }
function memoryIdentity(item: TeachingMemoryRecord) { return { id: item.id, scope: item.scope, workspace: item.workspace, project: item.project, sourceLessonId: item.sourceLessonId, tags: item.tags, confidence: item.confidence, createdAt: item.createdAt, updatedAt: item.updatedAt, disabledAt: item.disabledAt, deletedAt: item.deletedAt } }
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
function hydrateConversation(row: Record<string, unknown>): AgentConversationRecord { const projected = JSON.parse(String(row.turn_projection_json)) as { turns: Array<Record<string, unknown>> }; return { id: String(row.conversation_id), ...(row.workspace_id ? { workspaceId: String(row.workspace_id) } : {}), title: String(row.title), createdAt: String(row.created_at), updatedAt: String(row.updated_at), relativePath: String(row.relative_path), absolutePath: String(row.absolute_path), messageCount: Number(row.message_count), turns: projected.turns.map((turn) => ({ id: String(turn.id), role: turn.role as AgentConversationRecord['turns'][number]['role'], content: '', createdAt: String(turn.createdAt), ...(Array.isArray(turn.toolCalls) ? { toolCalls: turn.toolCalls.map((tool) => ({ id: `projected:${String((tool as { name?: unknown }).name ?? 'tool')}`, name: String((tool as { name?: unknown }).name ?? ''), arguments: '', ...((tool as { isError?: unknown }).isError ? { isError: true } : {}) })) } : {}), ...(turn.metadata ? { metadata: hydrateMetadata(turn.metadata as Record<string, unknown>) } : {}) })) } }
function hydrateMetadata(value: Record<string, unknown>): AgentConversationRecord['turns'][number]['metadata'] { const governance = value.governance as Record<string, unknown> | undefined; return { version: 1, ...(value.runUsage ? { runUsage: value.runUsage as NonNullable<AgentConversationRecord['turns'][number]['metadata']>['runUsage'] } : {}), ...(governance ? { compactions: Array.from({ length: Number(governance.compactionEvents) || 0 }, () => ({ id: 'projected', createdAt: '1970-01-01T00:00:00.000Z', replacedTurnIds: [], sourceDigest: 'projected', reason: 'analytics', mode: 'normal', replacedTokens: Number(governance.replacedTokens) || 0 })), contextHygiene: Number(governance.hygieneSavedTokens) ? [{ changed: true, savedTokens: Number(governance.hygieneSavedTokens), compactedToolResults: 0, digestedToolResults: 0, compactedToolCallArgs: 0 }] : [] } : {}) } }
function sum(values: Array<number | undefined>): number { return values.reduce<number>((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0) }
function parseLedgerSnapshot(line: string): (LedgerSnapshot & { entryId: string }) | null { try { const value = JSON.parse(line) as Record<string, unknown>; const conversation = object(value.conversation); const evidence = object(value.evidence); const usage = object(evidence?.runUsage); const entryId = text(value.entryId); if (value.version !== 1 || value.type !== 'conversation_snapshot' || !conversation || !usage || !entryId) return null; const conversationId = text(conversation.id), occurredAt = instant(conversation.updatedAt), ledgerCreatedAt = instant(value.createdAt), messageCount = number(conversation.messageCount), normalized = normalizeUsage(usage); if (!conversationId || !occurredAt || !ledgerCreatedAt || messageCount === null || !normalized) return null; return { entryId, conversationId, title: sanitizePersistedConversationTitle(text(conversation.title) ?? conversationId), courseRelativePath: text(conversation.courseRelativePath), occurredAt, ledgerCreatedAt, messageCount, ...normalized } } catch { return null } }
function snapshotProjection(snapshot: ProjectedLedger): LedgerSnapshot { const { entryId: _entryId, workspaceId: _workspaceId, path: _path, sourceKey: _sourceKey, fingerprint: _fingerprint, ...value } = snapshot; return value }
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function instant(value: unknown): string | null { if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return null; return new Date(value).toISOString() }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null }
function normalizeUsage(value: Record<string, unknown>): Pick<LedgerSnapshot, 'usage' | 'componentsComplete' | 'totalInconsistent'> | null { const promptTokens = number(value.promptTokens), completionTokens = number(value.completionTokens), sourceTotal = number(value.totalTokens), totalTokens = sourceTotal ?? (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null); if (totalTokens === null) return null; const derived = promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null; return { usage: { ...(promptTokens !== null ? { promptTokens } : {}), ...(completionTokens !== null ? { completionTokens } : {}), totalTokens, providerCalls: number(value.providerCalls) ?? 0, toolCalls: number(value.toolCalls) ?? 0, toolErrors: number(value.toolErrors) ?? 0, iterations: number(value.iterations) ?? 0, childRuns: number(value.childRuns) ?? 0, durationMs: number(value.durationMs) ?? 0 }, componentsComplete: promptTokens !== null && completionTokens !== null, totalInconsistent: sourceTotal !== null && derived !== null && sourceTotal !== derived } }
