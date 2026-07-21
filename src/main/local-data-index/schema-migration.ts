import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import type Database from 'better-sqlite3'

export type SchemaMigration = { id: string; sql: string; checksum: string }

/** Applied migration metadata exposed to doctor / support tooling (no SQL bodies). */
export type AppliedSchemaMigration = {
  id: string
  checksum: string
  appliedAt: string
  appVersion: string | null
  appliedBy: string | null
  sqlBytes: number | null
}

export const SCHEMA_MIGRATION_APPLIED_BY = 'local-data-index'

function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex')
}

function packageAppVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('../../../package.json') as { version?: unknown }
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : 'unknown'
  } catch {
    return 'unknown'
  }
}

const migrationSql = [
  `
CREATE TABLE IF NOT EXISTS schema_migration (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS index_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_projection (workspace_id TEXT PRIMARY KEY, workspace_name TEXT NOT NULL, root_path TEXT NOT NULL, source_fingerprint TEXT NOT NULL, indexed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversation_projection (source_key TEXT PRIMARY KEY, workspace_id TEXT, conversation_id TEXT NOT NULL, scope TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, relative_path TEXT NOT NULL, absolute_path TEXT NOT NULL, message_count INTEGER NOT NULL, turn_projection_json TEXT NOT NULL, source_fingerprint TEXT NOT NULL, indexed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS conversation_projection_workspace_idx ON conversation_projection(workspace_id, conversation_id);
CREATE TABLE IF NOT EXISTS memory_projection (memory_id TEXT PRIMARY KEY, scope TEXT NOT NULL, workspace_path TEXT, project_path TEXT, source_lesson_id TEXT, tags_json TEXT NOT NULL, confidence REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, disabled_at TEXT, deleted_at TEXT, source_fingerprint TEXT NOT NULL, indexed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learning_work_projection (workspace_id TEXT NOT NULL, conversation_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, source_fingerprint TEXT NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY(workspace_id, conversation_id));
CREATE TABLE IF NOT EXISTS source_provenance (source_key TEXT PRIMARY KEY, source_kind TEXT NOT NULL, source_path TEXT NOT NULL, fingerprint TEXT NOT NULL, checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS index_issue (id INTEGER PRIMARY KEY AUTOINCREMENT, rebuild_id TEXT NOT NULL, source_key TEXT NOT NULL, source_path TEXT, code TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);`,
  `
DROP TABLE IF EXISTS learning_work_projection;
CREATE TABLE learning_work_projection (
  source_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  ledger_created_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX learning_work_projection_latest_idx ON learning_work_projection(workspace_id, conversation_id, occurred_at DESC, ledger_created_at DESC, entry_id DESC);`,
  `
ALTER TABLE memory_projection ADD COLUMN kind TEXT;
ALTER TABLE memory_projection ADD COLUMN status TEXT;
CREATE INDEX IF NOT EXISTS memory_projection_kind_status_idx ON memory_projection(kind, status);
CREATE INDEX IF NOT EXISTS memory_projection_status_idx ON memory_projection(status);
`,
  `
-- DB-P0-6: list-friendly conversation metadata + indexes (no FTS).
ALTER TABLE conversation_projection ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_projection ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS conversation_projection_scope_updated_idx ON conversation_projection(scope, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversation_projection_workspace_updated_idx ON conversation_projection(workspace_id, updated_at DESC);`,
  `
-- DB-P0-3: optional disposable usage projection (no secrets/prompts).
CREATE TABLE IF NOT EXISTS usage_projection (
  entry_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  status TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_tokens INTEGER,
  tool_name TEXT,
  read_only INTEGER,
  destructive INTEGER,
  approval_status TEXT,
  trace_id TEXT,
  turn_id TEXT,
  conversation_id TEXT,
  source_path TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_projection_timestamp_idx ON usage_projection(timestamp DESC, entry_id DESC);
CREATE INDEX IF NOT EXISTS usage_projection_conversation_idx ON usage_projection(conversation_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS usage_projection_kind_idx ON usage_projection(kind, timestamp DESC);`,
  `
-- DB-OPT-1: stop treating conversation absolute_path as durable projection authority.
-- Clear legacy host absolute paths; new rebuilds write empty absolute_path and resolve via relative_path + workspace root when needed.
UPDATE conversation_projection SET absolute_path = '' WHERE absolute_path IS NOT NULL AND absolute_path != '';
`,
  `
-- DB-OPT-3: optional latency / retry / truncate / error classification (secret-free).
ALTER TABLE usage_projection ADD COLUMN ttft_ms INTEGER;
ALTER TABLE usage_projection ADD COLUMN retry_count INTEGER;
ALTER TABLE usage_projection ADD COLUMN truncated INTEGER;
ALTER TABLE usage_projection ADD COLUMN error_type TEXT;
`,
  `
-- DB-OPT-5: CHECK constraints on stable enumerations (nullable columns still allow NULL for legacy/unknown).
-- Conversation scope is a closed set used by list/hydrate paths.
-- Usage kind/status and memory status are closed sets from the catalog/ledger writers.
CREATE TABLE conversation_projection_opt5 (
  source_key TEXT PRIMARY KEY,
  workspace_id TEXT,
  conversation_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'temporary')),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  turn_projection_json TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);
INSERT INTO conversation_projection_opt5 SELECT source_key, workspace_id, conversation_id, scope, title, created_at, updated_at, relative_path, absolute_path, message_count, turn_projection_json, source_fingerprint, indexed_at, pinned, archived FROM conversation_projection;
DROP TABLE conversation_projection;
ALTER TABLE conversation_projection_opt5 RENAME TO conversation_projection;
CREATE INDEX IF NOT EXISTS conversation_projection_workspace_idx ON conversation_projection(workspace_id, conversation_id);
CREATE INDEX IF NOT EXISTS conversation_projection_scope_updated_idx ON conversation_projection(scope, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversation_projection_workspace_updated_idx ON conversation_projection(workspace_id, updated_at DESC);

CREATE TABLE usage_projection_opt5 (
  entry_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('model_usage', 'tool_usage', 'turn_usage')),
  timestamp TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  status TEXT CHECK (status IS NULL OR status IN ('started', 'completed', 'failed', 'canceled', 'unknown')),
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_tokens INTEGER,
  tool_name TEXT,
  read_only INTEGER,
  destructive INTEGER,
  approval_status TEXT,
  trace_id TEXT,
  turn_id TEXT,
  conversation_id TEXT,
  source_path TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  ttft_ms INTEGER,
  retry_count INTEGER,
  truncated INTEGER,
  error_type TEXT
);
INSERT INTO usage_projection_opt5 SELECT entry_id, kind, timestamp, provider, model, status, started_at, completed_at, duration_ms, input_tokens, output_tokens, reasoning_tokens, cache_tokens, tool_name, read_only, destructive, approval_status, trace_id, turn_id, conversation_id, source_path, source_fingerprint, indexed_at, ttft_ms, retry_count, truncated, error_type FROM usage_projection;
DROP TABLE usage_projection;
ALTER TABLE usage_projection_opt5 RENAME TO usage_projection;
CREATE INDEX IF NOT EXISTS usage_projection_timestamp_idx ON usage_projection(timestamp DESC, entry_id DESC);
CREATE INDEX IF NOT EXISTS usage_projection_conversation_idx ON usage_projection(conversation_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS usage_projection_kind_idx ON usage_projection(kind, timestamp DESC);

CREATE TABLE memory_projection_opt5 (
  memory_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  workspace_path TEXT,
  project_path TEXT,
  source_lesson_id TEXT,
  tags_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  deleted_at TEXT,
  source_fingerprint TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  kind TEXT,
  status TEXT CHECK (status IS NULL OR status IN ('active', 'disabled', 'deleted'))
);
INSERT INTO memory_projection_opt5 SELECT memory_id, scope, workspace_path, project_path, source_lesson_id, tags_json, confidence, created_at, updated_at, disabled_at, deleted_at, source_fingerprint, indexed_at, kind, status FROM memory_projection;
DROP TABLE memory_projection;
ALTER TABLE memory_projection_opt5 RENAME TO memory_projection;
CREATE INDEX IF NOT EXISTS memory_projection_kind_status_idx ON memory_projection(kind, status);
CREATE INDEX IF NOT EXISTS memory_projection_status_idx ON memory_projection(status);
`
]

export const LOCAL_DATA_INDEX_MIGRATIONS: readonly SchemaMigration[] = migrationSql.map((sql, index) => ({
  id: String(index + 1).padStart(4, '0'),
  sql,
  checksum: checksum(sql)
}))

export class SchemaMigrationChecksumConflict extends Error {
  constructor(id: string) {
    super(`SQLite schema migration checksum conflict for migration ${id}.`)
    this.name = 'SchemaMigrationChecksumConflict'
  }
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

/** Ensures schema_migration has metadata columns without rewriting applied history. */
export function ensureSchemaMigrationMetadataColumns(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migration (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const columns = tableColumns(db, 'schema_migration')
  if (!columns.has('app_version')) db.exec('ALTER TABLE schema_migration ADD COLUMN app_version TEXT')
  if (!columns.has('applied_by')) db.exec('ALTER TABLE schema_migration ADD COLUMN applied_by TEXT')
  if (!columns.has('sql_bytes')) db.exec('ALTER TABLE schema_migration ADD COLUMN sql_bytes INTEGER')
}

/**
 * Applies migrations atomically; a partially applied migration is never recorded.
 * Historical SQL checksums remain immutable: conflicts hard-fail.
 */
export function migrateLocalDataIndex(
  db: Database.Database,
  migrations = LOCAL_DATA_INDEX_MIGRATIONS,
  options: { appVersion?: string; appliedBy?: string } = {}
): void {
  ensureSchemaMigrationMetadataColumns(db)
  const appVersion = options.appVersion ?? packageAppVersion()
  const appliedBy = options.appliedBy ?? SCHEMA_MIGRATION_APPLIED_BY
  const existing = db.prepare('SELECT checksum FROM schema_migration WHERE id = ?')
  const record = db.prepare(
    'INSERT INTO schema_migration (id, checksum, applied_at, app_version, applied_by, sql_bytes) VALUES (?, ?, ?, ?, ?, ?)'
  )
  db.transaction(() => {
    for (const migration of migrations) {
      const applied = existing.get(migration.id) as { checksum: string } | undefined
      if (applied) {
        if (applied.checksum !== migration.checksum) throw new SchemaMigrationChecksumConflict(migration.id)
        continue
      }
      db.exec(migration.sql)
      // Re-ensure metadata columns: migration 0001 recreates the legacy table shape.
      ensureSchemaMigrationMetadataColumns(db)
      const sqlBytes = Buffer.byteLength(migration.sql.replace(/\r\n/g, '\n').trim(), 'utf8')
      record.run(migration.id, migration.checksum, new Date().toISOString(), appVersion, appliedBy, sqlBytes)
    }
  })()
}

/** Returns applied migrations + checksum digests for doctor / support-bundle (no SQL bodies). */
export function listAppliedSchemaMigrations(db: Database.Database): AppliedSchemaMigration[] {
  ensureSchemaMigrationMetadataColumns(db)
  const rows = db.prepare(
    `SELECT id, checksum, applied_at AS appliedAt, app_version AS appVersion, applied_by AS appliedBy, sql_bytes AS sqlBytes
     FROM schema_migration
     ORDER BY id`
  ).all() as Array<{
    id: string
    checksum: string
    appliedAt: string
    appVersion: string | null
    appliedBy: string | null
    sqlBytes: number | null
  }>
  return rows.map((row) => ({
    id: row.id,
    checksum: row.checksum,
    appliedAt: row.appliedAt,
    appVersion: row.appVersion ?? null,
    appliedBy: row.appliedBy ?? null,
    sqlBytes: typeof row.sqlBytes === 'number' ? row.sqlBytes : null
  }))
}
