import { describe, expect, it, vi } from 'vitest'
import {
  StudyPlanningStore,
  applyImportMigrationCommit,
  createClassicPomodoroPlan,
  migrateStudyV1ToPlanning,
  type StudyPlanningSnapshotV1,
  type TimerSessionRecord
} from '../../src/shared/study-planning'
import {
  buildImportMigrationCommitCommand,
  commitV1Migration,
  dryRunV1Migration,
  formatMigrationConfirmMessage
} from '../../src/renderer/src/study-space/planning-migration'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION
} from '../../src/shared/study-planning'
import { parseApplyStudyPlanningPayload } from '../../src/main/study-planning-ipc'

const weekAnchor = Date.UTC(2026, 6, 20)

function emptySnapshot(revision = 1): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: 1_000,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [createClassicPomodoroPlan()],
    timerSessions: [],
    preferences: {
      emptyStartPolicy: 'ask_every_time',
      classificationPromptOptOut: false,
      defaultTimerPlanId: 'classic_25_5'
    },
    localAnalyticsHints: {}
  }
}

function sampleV1() {
  return {
    tasks: [
      {
        id: 'task-1',
        title: '读论文',
        done: false,
        categoryId: 'study',
        schedule: { weekday: 1, startMinutes: 9 * 60, endMinutes: 10 * 60 }
      },
      {
        id: 'task-2',
        title: 'Inbox 杂项',
        done: true
      }
    ],
    timerPlans: [
      {
        id: 'plan-v1',
        name: '我的 30/5',
        focusMinutes: 30,
        breakMinutes: 5,
        simulationStartTime: '09:00',
        simulationEndTime: '11:00'
      }
    ],
    simulationStartTime: '14:00',
    simulationEndTime: '16:00'
  }
}

describe('applyImportMigrationCommit pure (Slice B)', () => {
  it('rejects without userConfirmed', () => {
    const dry = migrateStudyV1ToPlanning(sampleV1(), { weekAnchorMidnightMs: weekAnchor })
    const result = applyImportMigrationCommit({
      base: emptySnapshot(),
      payload: {
        tasks: dry.tasks,
        scheduleBlocks: dry.scheduleBlocks,
        timerPlans: dry.timerPlans
      },
      nowMs: 5_000
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_command')
    expect(result.error.message).toMatch(/userConfirmed/)
  })

  it('merges migrated tasks/blocks/plans and stores report as hints only', () => {
    const dry = migrateStudyV1ToPlanning(sampleV1(), { weekAnchorMidnightMs: weekAnchor })
    const result = applyImportMigrationCommit({
      base: emptySnapshot(),
      payload: {
        userConfirmed: true,
        tasks: dry.tasks,
        scheduleBlocks: dry.scheduleBlocks,
        timerPlans: dry.timerPlans,
        migrationReport: dry.report,
        suggestedWindows: dry.suggestedWindows,
        source: 'v1_local_storage'
      },
      nowMs: 9_000
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.tasksAdded).toBe(2)
    expect(result.summary.blocksAdded).toBe(1)
    expect(result.summary.plansAdded).toBe(1)
    expect(result.snapshot.tasks.map((t) => t.id).sort()).toEqual(['task-1', 'task-2'])
    expect(result.snapshot.tasks.find((t) => t.id === 'task-2')?.inbox).toBe(true)
    expect(result.snapshot.scheduleBlocks).toHaveLength(1)
    expect(result.snapshot.scheduleBlocks[0]?.locked).toBe(true)
    // suggested windows must not become schedule history
    expect(result.snapshot.scheduleBlocks.every((b) => b.source === 'migrated_v1')).toBe(true)
    const hints = result.snapshot.localAnalyticsHints.lastMigration as {
      suggestedWindows: unknown[]
      report: unknown[]
      source: string
    }
    expect(hints.source).toBe('v1_local_storage')
    expect(hints.suggestedWindows.length).toBeGreaterThan(0)
    expect(hints.report.length).toBeGreaterThan(0)
    expect(result.effects.some((e) => e.type === 'migration_committed')).toBe(true)
  })

  it('skips existing ids (idempotent-friendly merge)', () => {
    const dry = migrateStudyV1ToPlanning(sampleV1(), { weekAnchorMidnightMs: weekAnchor })
    const first = applyImportMigrationCommit({
      base: emptySnapshot(),
      payload: {
        userConfirmed: true,
        tasks: dry.tasks,
        scheduleBlocks: dry.scheduleBlocks,
        timerPlans: dry.timerPlans
      },
      nowMs: 1
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applyImportMigrationCommit({
      base: first.snapshot,
      payload: {
        userConfirmed: true,
        tasks: dry.tasks,
        scheduleBlocks: dry.scheduleBlocks,
        timerPlans: dry.timerPlans
      },
      nowMs: 2
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.summary.tasksAdded).toBe(0)
    expect(second.summary.tasksSkippedExisting).toBe(2)
    expect(second.snapshot.tasks).toHaveLength(2)
  })

  it('forces unreliable timer sessions to needs_reconcile', () => {
    const running: TimerSessionRecord = {
      id: 'sess-active',
      taskId: 'task-1',
      scheduleBlockId: null,
      phase: 'focus',
      clockMode: 'countdown',
      state: 'running',
      targetSeconds: 1500,
      startedAtMs: 1_000,
      lastSampleWallMs: 2_000,
      accumulatedActiveSeconds: 60,
      accumulatedFocusSeconds: 60,
      planSnapshot: null,
      attributionReason: 'explicit',
      focusRoundInPlan: 1
    }
    const result = applyImportMigrationCommit({
      base: emptySnapshot(),
      payload: {
        userConfirmed: true,
        tasks: [
          {
            id: 'task-1',
            title: '读论文',
            status: 'open',
            categoryId: 'study',
            inbox: false,
            splittable: true,
            revision: 1,
            source: 'migrated_v1'
          }
        ],
        timerSessions: [running]
      },
      nowMs: 10_000
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.timerSessions[0]?.state).toBe('needs_reconcile')
    expect(result.summary.sessionsNeedsReconcile).toBe(1)
    expect(result.effects.some((e) => e.type === 'reconcile_required')).toBe(true)
  })

  it('fails closed on unknown taskId in schedule block', () => {
    const result = applyImportMigrationCommit({
      base: emptySnapshot(),
      payload: {
        userConfirmed: true,
        scheduleBlocks: [
          {
            id: 'orphan',
            taskId: 'missing',
            kind: 'focus',
            startAtMs: 1,
            endAtMs: 2,
            locked: true,
            source: 'migrated_v1',
            status: 'planned',
            revision: 1
          }
        ]
      },
      nowMs: 1
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_command')
  })
})

describe('StudyPlanningStore import_migration_commit', () => {
  it('commits via store with CAS + actionId exact-retry', () => {
    const store = new StudyPlanningStore({ nowMs: () => 50_000 })
    const dry = migrateStudyV1ToPlanning(sampleV1(), { weekAnchorMidnightMs: weekAnchor })
    const cmd = {
      actionId: 'migrate-1',
      type: 'import_migration_commit' as const,
      payload: {
        userConfirmed: true as const,
        tasks: dry.tasks,
        scheduleBlocks: dry.scheduleBlocks,
        timerPlans: dry.timerPlans,
        migrationReport: dry.report,
        suggestedWindows: dry.suggestedWindows
      }
    }
    const first = store.applyCommand(cmd, 1)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.revision).toBe(2)
    expect(first.snapshot.tasks).toHaveLength(2)
    expect(first.effects.some((e) => e.type === 'migration_committed')).toBe(true)

    const retry = store.applyCommand(cmd, 1)
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.replayed).toBe(true)
    expect(retry.revision).toBe(2)
    expect(store.readSnapshot().tasks).toHaveLength(2)
  })

  it('revision_conflict leaves snapshot unchanged', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const dry = migrateStudyV1ToPlanning(sampleV1())
    const bad = store.applyCommand(
      {
        actionId: 'm-bad',
        type: 'import_migration_commit',
        payload: { userConfirmed: true, tasks: dry.tasks }
      },
      99
    )
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.error.code).toBe('revision_conflict')
    expect(store.readSnapshot().tasks).toHaveLength(0)
  })
})

describe('IPC allowlist includes import_migration_commit', () => {
  it('parses import_migration_commit apply payload', () => {
    const p = parseApplyStudyPlanningPayload({
      workspaceRoot: '/ws',
      expectedRevision: 1,
      command: {
        actionId: 'mig',
        type: 'import_migration_commit',
        payload: { userConfirmed: true, tasks: [] }
      }
    })
    expect(p.command.type).toBe('import_migration_commit')
  })
})

describe('renderer planning-migration helper', () => {
  it('dryRunV1Migration summarizes migratable entities', () => {
    const dry = dryRunV1Migration(sampleV1(), { weekAnchorMidnightMs: weekAnchor })
    expect(dry.ok).toBe(true)
    if (!dry.ok) return
    expect(dry.summary.taskCount).toBe(2)
    expect(dry.summary.scheduleBlockCount).toBe(1)
    expect(dry.summary.timerPlanCount).toBe(1)
    expect(formatMigrationConfirmMessage(dry)).toMatch(/任务 2/)
  })

  it('dryRun rejects empty migration', () => {
    const empty = dryRunV1Migration({ tasks: [] })
    expect(empty.ok).toBe(false)
    if (empty.ok) return
    expect(empty.code).toBe('empty_migration')
  })

  it('commitV1Migration applies import_migration_commit and retries on revision_conflict', async () => {
    let revision = 1
    let snapshot = emptySnapshot(revision)
    const applies: unknown[] = []
    const api: StudyPlanningApi = {
      readStudyPlanning: vi.fn(async () => ({
        ok: true as const,
        snapshot,
        path: '/ws/.studiumx/study-planning/snapshot.json',
        source: 'empty' as const
      })),
      applyStudyPlanning: vi.fn(async (payload) => {
        applies.push(payload)
        if (payload.expectedRevision !== revision) {
          return {
            ok: false as const,
            revision,
            error: {
              code: 'revision_conflict' as const,
              message: `expected ${payload.expectedRevision}, actual ${revision}`
            }
          }
        }
        const dry = migrateStudyV1ToPlanning(sampleV1(), { weekAnchorMidnightMs: weekAnchor })
        revision += 1
        snapshot = {
          ...snapshot,
          revision,
          tasks: dry.tasks,
          scheduleBlocks: dry.scheduleBlocks,
          timerPlans: [...snapshot.timerPlans, ...dry.timerPlans]
        }
        return {
          ok: true as const,
          revision,
          snapshot,
          effects: [
            {
              type: 'migration_committed' as const,
              source: 'v1_local_storage',
              tasksAdded: dry.tasks.length,
              blocksAdded: dry.scheduleBlocks.length,
              plansAdded: dry.timerPlans.length,
              sessionsImported: 0
            }
          ],
          path: '/ws/.studiumx/study-planning/snapshot.json'
        }
      })
    }

    // First force conflict once: start with stale expectedRevision
    revision = 2
    snapshot = emptySnapshot(2)
    const result = await commitV1Migration({
      api,
      workspaceRoot: '/ws',
      v1Snapshot: sampleV1(),
      userConfirmed: true,
      weekAnchorMidnightMs: weekAnchor,
      expectedRevision: 1,
      nowMs: () => 77_000
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dryRun.tasks).toHaveLength(2)
    expect(applies.length).toBeGreaterThanOrEqual(2)
    const last = applies[applies.length - 1] as {
      command: { type: string; payload: { userConfirmed: boolean } }
    }
    expect(last.command.type).toBe('import_migration_commit')
    expect(last.command.payload.userConfirmed).toBe(true)
  })

  it('buildImportMigrationCommitCommand keeps suggestedWindows out of schedule history fields', () => {
    const dry = migrateStudyV1ToPlanning(sampleV1(), { weekAnchorMidnightMs: weekAnchor })
    const cmd = buildImportMigrationCommitCommand(dry, 'a1')
    expect(cmd.type).toBe('import_migration_commit')
    const payload = cmd.payload as {
      userConfirmed: boolean
      suggestedWindows: unknown[]
      scheduleBlocks: unknown[]
    }
    expect(payload.userConfirmed).toBe(true)
    expect(payload.suggestedWindows.length).toBeGreaterThan(0)
    expect(payload.scheduleBlocks).toHaveLength(1)
  })

  it('commitV1Migration fails closed without workspace', async () => {
    const result = await commitV1Migration({
      api: {
        readStudyPlanning: vi.fn(),
        applyStudyPlanning: vi.fn()
      },
      workspaceRoot: null,
      v1Snapshot: sampleV1(),
      userConfirmed: true
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('missing_workspace')
  })
})
