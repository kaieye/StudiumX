import { describe, expect, it } from 'vitest'
import {
  DurableStudyPlanningStore,
  isStudyPlanningSnapshotV1,
  loadStudyPlanningSnapshot,
  persistStudyPlanningSnapshot
} from '../../src/main/study-planning-durable-store'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  parseStudyPlanningSnapshotJson,
  studyPlanningSnapshotRelativePath,
  type StudyPlanningSnapshotV1
} from '../../src/shared/study-planning'
import type { DurableFileOperations } from '../../src/main/persistence/durable-file'

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function memoryOperations(options: { failWrite?: boolean } = {}): {
  operations: DurableFileOperations
  files: Map<string, string>
} {
  const files = new Map<string, string>()
  const operations: DurableFileOperations = {
    mkdir: async () => undefined as never,
    readFile: async (path) => {
      const value = files.get(path)
      if (value === undefined) throw errno('ENOENT')
      return value
    },
    open: async (path, flags) => {
      if (flags === 'r') {
        return {
          writeFile: async () => {
            throw new Error('directory handle is not writable')
          },
          sync: async () => undefined,
          close: async () => undefined
        }
      }
      let content = ''
      return {
        writeFile: async (value) => {
          if (options.failWrite) throw new Error('disk full')
          content = typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
        },
        sync: async () => undefined,
        close: async () => {
          files.set(path, content)
        }
      }
    },
    rename: async (from, to) => {
      const value = files.get(from)
      if (value === undefined) throw errno('ENOENT')
      files.delete(from)
      files.set(to, value)
    },
    rm: async (path) => {
      files.delete(path)
    }
  }
  return { operations, files }
}

describe('snapshot wire (ADR-0011)', () => {
  it('exports relative path layout', () => {
    expect(studyPlanningSnapshotRelativePath()).toBe('.studiumx/study-planning/snapshot.json')
  })

  it('validates schema and rejects junk', () => {
    expect(isStudyPlanningSnapshotV1(null)).toBe(false)
    expect(
      isStudyPlanningSnapshotV1({
        schema: STUDY_PLANNING_SCHEMA,
        schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
        revision: 1,
        updatedAtMs: 1,
        tasks: [],
        scheduleBlocks: [],
        timerPlans: [],
        timerSessions: [],
        preferences: {},
        localAnalyticsHints: {}
      })
    ).toBe(true)
    expect(parseStudyPlanningSnapshotJson('{').ok).toBe(false)
  })
})

describe('DurableStudyPlanningStore', () => {
  it('loads empty seed when no file, then persists create_task', async () => {
    const fake = memoryOperations()
    const root = '/ws'
    const host = new DurableStudyPlanningStore({
      workspaceRoot: root,
      nowMs: () => 1000,
      operations: fake.operations
    })
    const loaded = await host.ensureLoaded()
    expect(loaded.source).toBe('empty')
    expect(loaded.snapshot.schema).toBe(STUDY_PLANNING_SCHEMA)

    const applied = await host.applyCommand(
      {
        actionId: 'a1',
        type: 'create_task',
        payload: { id: 't1', title: '任务' }
      },
      1
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.snapshot.tasks).toHaveLength(1)

    const snapPath = host.getSnapshotPath().replace(/\\/g, '/')
    expect(snapPath.endsWith('.studiumx/study-planning/snapshot.json')).toBe(true)
    // Memory fake stores under absolute-like keys from join
    const written = [...fake.files.entries()].find(([k]) => k.replace(/\\/g, '/').endsWith('snapshot.json'))
    expect(written).toBeTruthy()
    if (!written) return
    const parsed = parseStudyPlanningSnapshotJson(written[1])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.snapshot.tasks[0].id).toBe('t1')
  })

  it('exact actionId retry does not double-write tasks', async () => {
    const fake = memoryOperations()
    const host = new DurableStudyPlanningStore({
      workspaceRoot: '/ws2',
      nowMs: () => 2000,
      operations: fake.operations
    })
    await host.ensureLoaded()
    const cmd = {
      actionId: 'same',
      type: 'create_task' as const,
      payload: { id: 'x', title: 'X' }
    }
    const first = await host.applyCommand(cmd, 1)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = await host.applyCommand(cmd, 1)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.replayed).toBe(true)
    const snap = await host.readSnapshot()
    expect(snap.tasks).toHaveLength(1)
  })

  it('IO failure leaves memory revision unchanged', async () => {
    const fake = memoryOperations({ failWrite: true })
    const host = new DurableStudyPlanningStore({
      workspaceRoot: '/ws3',
      nowMs: () => 3000,
      operations: fake.operations
    })
    await host.ensureLoaded()
    const before = await host.readSnapshot()
    const failed = await host.applyCommand(
      {
        actionId: 'io',
        type: 'create_task',
        payload: { id: 'y', title: 'Y' }
      },
      before.revision
    )
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.error.code).toBe('io_failed')
    const after = await host.readSnapshot()
    expect(after.revision).toBe(before.revision)
    expect(after.tasks).toHaveLength(0)
  })

  it('reload from persisted snapshot after new host', async () => {
    const fake = memoryOperations()
    const host1 = new DurableStudyPlanningStore({
      workspaceRoot: '/ws4',
      nowMs: () => 4000,
      operations: fake.operations
    })
    await host1.ensureLoaded()
    const r = await host1.applyCommand(
      {
        actionId: 'p',
        type: 'create_task',
        payload: { id: 'persist', title: 'P' }
      },
      1
    )
    expect(r.ok).toBe(true)

    const host2 = new DurableStudyPlanningStore({
      workspaceRoot: '/ws4',
      nowMs: () => 5000,
      operations: fake.operations
    })
    const loaded = await host2.ensureLoaded()
    expect(loaded.source).toBe('canonical')
    expect(loaded.snapshot.tasks.some((t) => t.id === 'persist')).toBe(true)
  })

  it('persistStudyPlanningSnapshot rejects invalid', async () => {
    const fake = memoryOperations()
    await expect(
      persistStudyPlanningSnapshot({
        workspaceRoot: '/ws5',
        snapshot: { revision: 1 } as unknown as StudyPlanningSnapshotV1,
        operations: fake.operations
      })
    ).rejects.toThrow(/invalid/i)
  })

  it('loadStudyPlanningSnapshot returns empty when missing', async () => {
    const fake = memoryOperations()
    const loaded = await loadStudyPlanningSnapshot({
      workspaceRoot: '/ws6',
      nowMs: () => 1,
      operations: fake.operations
    })
    expect(loaded.source).toBe('empty')
  })
})

describe('DurableStudyPlanningStore import_migration_commit sidecars', () => {
  it('writes migration-report-latest and timestamp backup when prior snapshot exists', async () => {
    const fake = memoryOperations()
    const root = '/ws-mig'
    const host = new DurableStudyPlanningStore({
      workspaceRoot: root,
      nowMs: () => Date.UTC(2026, 6, 21, 12, 0, 0),
      operations: fake.operations
    })
    // Seed via create_task so a prior snapshot exists on disk
    const seed = await host.applyCommand(
      {
        actionId: 'seed-1',
        type: 'create_task',
        payload: { id: 'existing', title: '已有任务' }
      },
      1
    )
    expect(seed.ok).toBe(true)
    if (!seed.ok) return

    const migrate = await host.applyCommand(
      {
        actionId: 'mig-1',
        type: 'import_migration_commit',
        payload: {
          userConfirmed: true,
          tasks: [
            {
              id: 'task-mig',
              title: '迁移任务',
              status: 'open',
              categoryId: null,
              inbox: true,
              splittable: true,
              revision: 1,
              source: 'migrated_v1'
            }
          ]
        }
      },
      seed.revision
    )
    expect(migrate.ok).toBe(true)
    if (!migrate.ok) return
    expect(migrate.snapshot.tasks.some((t) => t.id === 'task-mig')).toBe(true)
    expect(migrate.snapshot.tasks.some((t) => t.id === 'existing')).toBe(true)

    const reportKey = [...fake.files.keys()].find((k) => k.includes('migration-report-latest.json'))
    expect(reportKey).toBeTruthy()
    const backupKey = [...fake.files.keys()].find(
      (k) => k.includes('backups') && k.includes('snapshot-') && k.endsWith('.json')
    )
    expect(backupKey).toBeTruthy()
  })
})
