/**
 * Durable StudyPlanningStore host (ADR-0117).
 *
 * Wraps in-memory StudyPlanningStore with workspace-scoped snapshot.json + .bak.
 * Inject DurableFileOperations for unit tests (no real disk required).
 *
 * Apply order: reload disk → trial on clone → persist → commit memory.
 * IO failure leaves memory and disk unchanged (fail-closed).
 *
 * Cross-process sole-writer: re-load from disk before each CAS trial, and
 * (real disk only) take a workspace-scoped exclusive apply lock so two Electron
 * processes cannot both pass the same expectedRevision and silently clobber.
 */

import { open as fsOpen, mkdir as fsMkdir, unlink as fsUnlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  StudyPlanningStore,
  type ApplyResult,
  type StudyPlanningCommandEnvelope,
  type StudyPlanningSnapshotV1
} from '../shared/study-planning/study-planning-store'
import {
  STUDY_PLANNING_BACKUP_DIR,
  STUDY_PLANNING_DIR_SEGMENTS,
  STUDY_PLANNING_MIGRATION_REPORT_FILE,
  STUDY_PLANNING_SNAPSHOT_FILE,
  isStudyPlanningSnapshotV1,
  serializeStudyPlanningSnapshot
} from '../shared/study-planning/snapshot-wire'
import {
  readValidatedWithBackup,
  replaceDurably,
  replaceWithBackup,
  type DurableFileOperations
} from './persistence/durable-file'

export type DurableStudyPlanningHostOptions = {
  workspaceRoot: string
  nowMs?: () => number
  operations?: DurableFileOperations
}

export type DurableStudyPlanningLoadResult = {
  snapshot: StudyPlanningSnapshotV1
  source: 'canonical' | 'backup' | 'empty'
  path: string
}

function snapshotPath(workspaceRoot: string): string {
  return join(workspaceRoot, ...STUDY_PLANNING_DIR_SEGMENTS, STUDY_PLANNING_SNAPSHOT_FILE)
}

function applyLockPath(workspaceRoot: string): string {
  return join(workspaceRoot, ...STUDY_PLANNING_DIR_SEGMENTS, `${STUDY_PLANNING_SNAPSHOT_FILE}.apply.lock`)
}

function migrationBackupPath(workspaceRoot: string, nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return join(workspaceRoot, ...STUDY_PLANNING_DIR_SEGMENTS, STUDY_PLANNING_BACKUP_DIR, `snapshot-${stamp}.json`)
}

function migrationReportPath(workspaceRoot: string): string {
  return join(workspaceRoot, ...STUDY_PLANNING_DIR_SEGMENTS, STUDY_PLANNING_MIGRATION_REPORT_FILE)
}

function emptySeed(nowMs: number): StudyPlanningSnapshotV1 {
  const store = new StudyPlanningStore({ nowMs: () => nowMs })
  return store.readSnapshot()
}

/**
 * Load or seed planning snapshot from workspace. Never throws on missing file.
 */
export async function loadStudyPlanningSnapshot(
  options: DurableStudyPlanningHostOptions
): Promise<DurableStudyPlanningLoadResult> {
  const path = snapshotPath(options.workspaceRoot)
  const read = await readValidatedWithBackup<StudyPlanningSnapshotV1>({
    path,
    validate: isStudyPlanningSnapshotV1,
    ...(options.operations ? { operations: options.operations } : {})
  })
  if (read.value) {
    return {
      snapshot: read.value,
      source: read.source === 'backup' ? 'backup' : 'canonical',
      path
    }
  }
  const now = options.nowMs?.() ?? Date.now()
  return { snapshot: emptySeed(now), source: 'empty', path }
}

export async function persistStudyPlanningSnapshot(
  options: DurableStudyPlanningHostOptions & { snapshot: StudyPlanningSnapshotV1 }
): Promise<void> {
  const path = snapshotPath(options.workspaceRoot)
  if (!isStudyPlanningSnapshotV1(options.snapshot)) {
    throw new Error('Refusing to persist invalid StudyPlanningSnapshotV1')
  }
  const content = serializeStudyPlanningSnapshot(options.snapshot)
  await replaceWithBackup({
    path,
    content,
    validate: isStudyPlanningSnapshotV1,
    ...(options.operations ? { operations: options.operations } : {})
  })
}

/**
 * Exclusive apply lock for real disk (cross-process CAS).
 * Skipped when DurableFileOperations is injected (unit memory fakes).
 * Lock is best-effort short-lived; stale locks from killed processes are
 * recovered by max-age unlink (fail-open after timeout would clobber CAS —
 * we instead retry until maxWait then surface io_failed).
 */
async function withRealDiskApplyLock<T>(
  workspaceRoot: string,
  run: () => Promise<T>,
  options: { maxWaitMs?: number; staleMs?: number } = {}
): Promise<T> {
  const maxWaitMs = options.maxWaitMs ?? 8_000
  const staleMs = options.staleMs ?? 30_000
  const lockPath = applyLockPath(workspaceRoot)
  await fsMkdir(dirname(lockPath), { recursive: true })

  const started = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const handle = await fsOpen(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, atMs: Date.now() }),
          'utf8'
        )
      } catch {
        // Best-effort content; exclusivity of the handle is authoritative.
      }
      try {
        return await run()
      } finally {
        await handle.close().catch(() => undefined)
        await fsUnlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error

      // Stale lock recovery: if lock file is older than staleMs, unlink and retry.
      try {
        const { stat } = await import('node:fs/promises')
        const st = await stat(lockPath)
        const age = Date.now() - st.mtimeMs
        if (age > staleMs) {
          await fsUnlink(lockPath).catch(() => undefined)
          continue
        }
      } catch {
        // lock vanished between EEXIST and stat — retry acquire
      }

      if (Date.now() - started > maxWaitMs) {
        throw new Error(`study-planning apply lock timeout after ${maxWaitMs}ms`)
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 35)))
    }
  }
}

/**
 * Sole-writer façade: reload disk → trial apply → durable publish → commit memory.
 * Failed commands and IO errors do not advance revision in memory.
 * Exact actionId retry is process-local (same as in-memory store).
 *
 * Concurrent applyCommand calls are serialized per host (IPC thrash safety):
 * two writers with the same expectedRevision must not both pass trial CAS
 * before either commits — loser must see revision_conflict, not silent merge.
 *
 * Cross-process: re-load from disk under exclusive apply lock so two Electron
 * processes sharing workspace snapshot.json cannot silently last-writer-wins.
 */
export class DurableStudyPlanningStore {
  private store: StudyPlanningStore
  private readonly workspaceRoot: string
  private readonly nowMs: () => number
  private readonly operations?: DurableFileOperations
  private loaded = false
  private path = ''
  /** Process-local sole-writer chain: one apply at a time per workspace host. */
  private applyChain: Promise<void> = Promise.resolve()

  constructor(options: DurableStudyPlanningHostOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.nowMs = options.nowMs ?? (() => Date.now())
    this.operations = options.operations
    this.store = new StudyPlanningStore({ nowMs: this.nowMs })
  }

  async ensureLoaded(): Promise<DurableStudyPlanningLoadResult> {
    const loaded = await loadStudyPlanningSnapshot({
      workspaceRoot: this.workspaceRoot,
      nowMs: this.nowMs,
      ...(this.operations ? { operations: this.operations } : {})
    })
    this.store = new StudyPlanningStore({ nowMs: this.nowMs, initial: loaded.snapshot })
    this.loaded = true
    this.path = loaded.path
    return loaded
  }

  async readSnapshot(): Promise<StudyPlanningSnapshotV1> {
    if (!this.loaded) await this.ensureLoaded()
    return this.store.readSnapshot()
  }

  async applyCommand(
    command: StudyPlanningCommandEnvelope,
    expectedRevision: number
  ): Promise<ApplyResult> {
    const run = this.applyChain.then(() => this.applyCommandSerialized(command, expectedRevision))
    // Keep the chain alive on both success and failure so the next apply waits.
    this.applyChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async applyCommandSerialized(
    command: StudyPlanningCommandEnvelope,
    expectedRevision: number
  ): Promise<ApplyResult> {
    // Process-local actionId replay does not need disk or lock.
    if (this.loaded) {
      const prior = this.store.peekActionResult(command.actionId)
      if (prior) {
        return { ...prior, replayed: true }
      }
    }

    const runBody = async (): Promise<ApplyResult> => {
      // Cross-process honesty: always re-hydrate from disk before CAS trial so
      // another process's commit is visible. replaceSnapshot keeps process-local
      // actionLog for exact actionId retry within this host.
      const loaded = await loadStudyPlanningSnapshot({
        workspaceRoot: this.workspaceRoot,
        nowMs: this.nowMs,
        ...(this.operations ? { operations: this.operations } : {})
      })
      if (!this.loaded) {
        this.store = new StudyPlanningStore({ nowMs: this.nowMs, initial: loaded.snapshot })
        this.loaded = true
      } else {
        this.store.replaceSnapshot(loaded.snapshot)
      }
      this.path = loaded.path

      // Re-check process-local action log after hydrate (still process-local).
      const prior = this.store.peekActionResult(command.actionId)
      if (prior) {
        return { ...prior, replayed: true }
      }

      const before = this.store.readSnapshot()
      const trial = new StudyPlanningStore({ nowMs: this.nowMs, initial: before })
      const result = trial.applyCommand(command, expectedRevision)
      if (!result.ok) return result

      try {
        if (command.type === 'import_migration_commit') {
          await this.writeMigrationSidecars(command.actionId, result)
        }

        await persistStudyPlanningSnapshot({
          workspaceRoot: this.workspaceRoot,
          snapshot: result.snapshot,
          nowMs: this.nowMs,
          ...(this.operations ? { operations: this.operations } : {})
        })
      } catch (error) {
        return {
          ok: false,
          revision: before.revision,
          error: {
            code: 'io_failed',
            message: error instanceof Error ? error.message : String(error)
          }
        }
      }

      this.store.replaceSnapshot(result.snapshot)
      this.store.rememberActionResult(command.actionId, result)
      return result
    }

    // Real disk: exclusive lock across processes. Injected operations (unit):
    // process-local applyChain + reload is enough.
    if (!this.operations) {
      try {
        return await withRealDiskApplyLock(this.workspaceRoot, runBody)
      } catch (error) {
        const revision = this.loaded ? this.store.readSnapshot().revision : 0
        return {
          ok: false,
          revision,
          error: {
            code: 'io_failed',
            message: error instanceof Error ? error.message : String(error)
          }
        }
      }
    }

    return runBody()
  }

  /**
   * ADR-0117 §4: timestamp backup of existing canonical + migration-report-latest.
   * Fail-closed: throws so applyCommand returns io_failed without committing.
   */
  private async writeMigrationSidecars(
    actionId: string,
    result: Extract<ApplyResult, { ok: true }>
  ): Promise<void> {
    const ops = this.operations
    const path = snapshotPath(this.workspaceRoot)
    let existingContent: string | null = null
    try {
      existingContent = ops
        ? await ops.readFile(path, 'utf8')
        : await (await import('node:fs/promises')).readFile(path, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') throw err
    }

    if (existingContent) {
      let parsed: unknown
      try {
        parsed = JSON.parse(existingContent)
      } catch {
        parsed = null
      }
      if (isStudyPlanningSnapshotV1(parsed)) {
        await replaceDurably({
          path: migrationBackupPath(this.workspaceRoot, this.nowMs()),
          content: existingContent,
          ...(ops ? { operations: ops } : {})
        })
      }
    }

    const reportPayload = {
      schema: 'studiumx.study-planning.migration-report',
      schemaVersion: 1,
      atMs: this.nowMs(),
      actionId,
      revisionAfter: result.revision,
      effects: result.effects,
      lastMigration: result.snapshot.localAnalyticsHints?.lastMigration ?? null
    }
    await replaceDurably({
      path: migrationReportPath(this.workspaceRoot),
      content: `${JSON.stringify(reportPayload, null, 2)}\n`,
      ...(ops ? { operations: ops } : {})
    })
  }

  getSnapshotPath(): string {
    return this.path || snapshotPath(this.workspaceRoot)
  }
}

export { STUDY_PLANNING_SCHEMA, STUDY_PLANNING_SCHEMA_VERSION, isStudyPlanningSnapshotV1 }
