import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

export type SchemaMigration = { id: string; sql: string; checksum: string }

function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex')
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
CREATE INDEX learning_work_projection_latest_idx ON learning_work_projection(workspace_id, conversation_id, occurred_at DESC, ledger_created_at DESC, entry_id DESC);`
]

export const LOCAL_DATA_INDEX_MIGRATIONS: readonly SchemaMigration[] = migrationSql.map((sql, index) => ({ id: String(index + 1).padStart(4, '0'), sql, checksum: checksum(sql) }))

export class SchemaMigrationChecksumConflict extends Error {
  constructor(id: string) { super(`SQLite schema migration checksum conflict for migration ${id}.`); this.name = 'SchemaMigrationChecksumConflict' }
}

/** Applies migrations atomically; a partially applied migration is never recorded. */
export function migrateLocalDataIndex(db: Database.Database, migrations = LOCAL_DATA_INDEX_MIGRATIONS): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migration (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const existing = db.prepare('SELECT checksum FROM schema_migration WHERE id = ?')
  const record = db.prepare('INSERT INTO schema_migration (id, checksum, applied_at) VALUES (?, ?, ?)')
  db.transaction(() => {
    for (const migration of migrations) {
      const applied = existing.get(migration.id) as { checksum: string } | undefined
      if (applied) { if (applied.checksum !== migration.checksum) throw new SchemaMigrationChecksumConflict(migration.id); continue }
      db.exec(migration.sql)
      record.run(migration.id, migration.checksum, new Date().toISOString())
    }
  })()
}
