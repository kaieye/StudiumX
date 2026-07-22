/**
 * STC-703 recurrence UI/wire: preview glue + sequential upsert dual-write.
 * Pure expand lives in study-planning-recurrence.unit.test.ts — do not reimplement.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  type ScheduleBlock,
  type StudyPlanningSnapshotV1
} from '../../src/shared/study-planning'
import {
  buildRecurrenceRuleFromForm,
  buildUpsertScheduleBlockCommand,
  defaultWeekExpandWindow,
  dualWriteApplyExpandedRecurrenceBlocks,
  previewRecurrenceExpand,
  type RecurrenceRuleFormDraft
} from '../../src/renderer/src/study-space/planning-recurrence-expand'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import type { CanonicalPlanningContext } from '../../src/renderer/src/study-space/planning-dual-write'

/** Monday 2026-07-20 UTC midnight — weekday 1. */
const MON = Date.UTC(2026, 6, 20, 0, 0, 0, 0)
const DAY = 24 * 60 * 60_000
const MIN = 60_000
const NOW = Date.UTC(2026, 6, 21, 12, 0, 0)

function focusBlock(
  partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'taskId' | 'startAtMs' | 'endAtMs'>
): ScheduleBlock {
  return {
    kind: 'focus',
    locked: false,
    source: 'manual',
    status: 'planned',
    revision: 1,
    ...partial
  }
}

function emptySnapshot(revision: number, blocks: ScheduleBlock[] = []): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: NOW,
    tasks: [
      {
        id: 'task-read',
        title: '阅读',
        status: 'open',
        categoryId: 'study',
        inbox: false,
        splittable: true,
        revision: 1,
        source: 'manual'
      }
    ],
    scheduleBlocks: blocks,
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
}

function mockApi(snapshot: StudyPlanningSnapshotV1) {
  const applied: Array<{ expectedRevision: number; command: { type: string; payload: { block?: ScheduleBlock } } }> =
    []
  let current = snapshot
  const api: StudyPlanningApi = {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot: current,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    })),
    applyStudyPlanning: vi.fn(async (payload) => {
      applied.push(payload as (typeof applied)[number])
      const cmd = payload.command as {
        type: string
        payload: { block?: ScheduleBlock }
      }
      if (cmd.type === 'upsert_schedule_block' && cmd.payload.block) {
        const without = current.scheduleBlocks.filter((b) => b.id !== cmd.payload.block!.id)
        current = {
          ...current,
          revision: current.revision + 1,
          scheduleBlocks: [...without, cmd.payload.block]
        }
      }
      return {
        ok: true as const,
        revision: current.revision,
        snapshot: current,
        effects: []
      }
    })
  }
  return { api, applied, getSnapshot: () => current }
}

function dailyDraft(overrides: Partial<RecurrenceRuleFormDraft> = {}): RecurrenceRuleFormDraft {
  return {
    taskId: 'task-read',
    frequency: 'daily',
    byWeekday: [],
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    dtStartMs: MON,
    expandAsLocked: true,
    ...overrides
  }
}

function weeklyDraft(overrides: Partial<RecurrenceRuleFormDraft> = {}): RecurrenceRuleFormDraft {
  return {
    taskId: 'task-read',
    frequency: 'weekly',
    byWeekday: [1, 3, 5], // Mon Wed Fri
    startMinutes: 14 * 60,
    endMinutes: 15 * 60,
    dtStartMs: MON,
    expandAsLocked: true,
    ...overrides
  }
}

describe('buildRecurrenceRuleFromForm', () => {
  it('binds focus rule to existing taskId and does not invent a new task', () => {
    const rule = buildRecurrenceRuleFromForm(dailyDraft())
    expect(rule.taskId).toBe('task-read')
    expect(rule.kind).toBe('focus')
    expect(rule.frequency).toBe('daily')
    expect(rule.id).toBe('recurrence:task-read')
  })

  it('includes byWeekday only for weekly', () => {
    const weekly = buildRecurrenceRuleFromForm(weeklyDraft())
    expect(weekly.byWeekday).toEqual([1, 3, 5])
    const daily = buildRecurrenceRuleFromForm(dailyDraft())
    expect(daily.byWeekday).toBeUndefined()
  })
})

describe('previewRecurrenceExpand', () => {
  it('dry-runs daily expand for a week window without writing', () => {
    const window = defaultWeekExpandWindow(MON)
    const model = previewRecurrenceExpand({
      draft: dailyDraft(),
      existingBlocks: [],
      window
    })
    expect(model.canConfirm).toBe(true)
    expect(model.applyBlocks.length).toBe(7)
    for (const b of model.applyBlocks) {
      expect(b.taskId).toBe('task-read')
      expect(b.kind).toBe('focus')
      // Default expandAsLocked
      expect(b.locked).toBe(true)
    }
    expect(model.summaryLine).toContain('7')
    expect(model.copy.confirmLabel).toContain('7')
  })

  it('weekly byWeekday expands only matching days', () => {
    const window = defaultWeekExpandWindow(MON)
    const model = previewRecurrenceExpand({
      draft: weeklyDraft(),
      existingBlocks: [],
      window
    })
    // Mon Jul20, Wed Jul22, Fri Jul24 within [Mon, Mon+7)
    expect(model.applyBlocks).toHaveLength(3)
    const starts = model.applyBlocks.map((b) => b.startAtMs)
    expect(starts).toEqual([
      MON + 14 * 60 * MIN,
      MON + 2 * DAY + 14 * 60 * MIN,
      MON + 4 * DAY + 14 * 60 * MIN
    ])
  })

  it('skips already-materialised slots (idempotent re-preview)', () => {
    const window = defaultWeekExpandWindow(MON)
    const existing = [
      focusBlock({
        id: 'recurrence:task-read@' + (MON + 9 * 60 * MIN),
        taskId: 'task-read',
        startAtMs: MON + 9 * 60 * MIN,
        endAtMs: MON + 10 * 60 * MIN,
        locked: true
      })
    ]
    const model = previewRecurrenceExpand({
      draft: dailyDraft(),
      existingBlocks: existing,
      window
    })
    expect(model.result.skippedExisting).toBe(1)
    expect(model.applyBlocks).toHaveLength(6)
  })

  it('skips locked overlaps fail-closed and still allows remaining', () => {
    const window = defaultWeekExpandWindow(MON)
    const existing = [
      focusBlock({
        id: 'other-locked',
        taskId: 'other',
        startAtMs: MON + 9 * 60 * MIN + 30 * MIN,
        endAtMs: MON + 10 * 60 * MIN + 30 * MIN,
        locked: true
      })
    ]
    const model = previewRecurrenceExpand({
      draft: dailyDraft(),
      existingBlocks: existing,
      window
    })
    expect(model.result.skippedLockedOverlap).toBeGreaterThanOrEqual(1)
    // Monday occurrence overlaps locked peer → skipped; rest of week still expands
    expect(model.applyBlocks.every((b) => b.startAtMs !== MON + 9 * 60 * MIN)).toBe(true)
    expect(model.applyBlocks.length).toBe(6)
    expect(model.warnings.some((w) => w.includes('锁定') || w.includes('locked') || w.includes('Skipped'))).toBe(
      true
    )
  })

  it('rejects invalid focus draft without taskId (no silent task invent)', () => {
    const model = previewRecurrenceExpand({
      draft: dailyDraft({ taskId: '' }),
      existingBlocks: [],
      window: defaultWeekExpandWindow(MON)
    })
    expect(model.canConfirm).toBe(false)
    expect(model.applyBlocks).toHaveLength(0)
    expect(model.warnings.length).toBeGreaterThan(0)
  })

  it('rejects weekly without byWeekday', () => {
    const model = previewRecurrenceExpand({
      draft: weeklyDraft({ byWeekday: [] }),
      existingBlocks: [],
      window: defaultWeekExpandWindow(MON)
    })
    expect(model.canConfirm).toBe(false)
    expect(model.applyBlocks).toHaveLength(0)
  })
})

describe('buildUpsertScheduleBlockCommand', () => {
  it('wraps a block as upsert_schedule_block (no create_task)', () => {
    const block = focusBlock({
      id: 'recurrence:task-read@1',
      taskId: 'task-read',
      startAtMs: MON + 9 * 60 * MIN,
      endAtMs: MON + 10 * 60 * MIN,
      locked: true
    })
    const cmd = buildUpsertScheduleBlockCommand(block, 'action-1', NOW)
    expect(cmd.type).toBe('upsert_schedule_block')
    expect(cmd.payload).toEqual({ block })
    expect(cmd.actionId).toBe('action-1')
    expect(JSON.stringify(cmd)).not.toContain('create_task')
  })
})

describe('dualWriteApplyExpandedRecurrenceBlocks', () => {
  it('sequentially upserts with expectedRevision CAS and never clones task', async () => {
    const window = defaultWeekExpandWindow(MON)
    const preview = previewRecurrenceExpand({
      draft: weeklyDraft(),
      existingBlocks: [],
      window
    })
    expect(preview.applyBlocks).toHaveLength(3)

    const { api, applied, getSnapshot } = mockApi(emptySnapshot(3, []))
    const ctx: CanonicalPlanningContext = {
      api,
      workspaceRoot: 'D:/ws',
      nowMs: () => NOW
    }

    const result = await dualWriteApplyExpandedRecurrenceBlocks(ctx, preview.applyBlocks)
    expect(result.kind).toBe('canonical_ok')
    expect(result.applied).toBe(3)
    expect(result.failed).toBe(0)
    expect(applied).toHaveLength(3)

    // Each apply carried expectedRevision from prior read
    expect(applied[0]!.expectedRevision).toBe(3)
    expect(applied[1]!.expectedRevision).toBe(4)
    expect(applied[2]!.expectedRevision).toBe(5)

    for (const a of applied) {
      expect(a.command.type).toBe('upsert_schedule_block')
      expect(a.command.payload.block?.taskId).toBe('task-read')
    }

    // Snapshot has 3 blocks, still 1 task (no clone)
    const snap = getSnapshot()
    expect(snap.scheduleBlocks).toHaveLength(3)
    expect(snap.tasks).toHaveLength(1)
    expect(snap.tasks[0]!.id).toBe('task-read')
  })

  it('fails closed without workspace (no silent write)', async () => {
    const block = focusBlock({
      id: 'x',
      taskId: 'task-read',
      startAtMs: MON,
      endAtMs: MON + MIN
    })
    const result = await dualWriteApplyExpandedRecurrenceBlocks(
      { api: null, workspaceRoot: null },
      [block]
    )
    expect(result.kind).toBe('canonical_skipped')
    expect(result.applied).toBe(0)
    expect(result.reason).toBe('missing_workspace')
  })

  it('rejects focus blocks without taskId (no silent task clone)', async () => {
    const { api } = mockApi(emptySnapshot(1, []))
    const orphan: ScheduleBlock = {
      id: 'orphan',
      taskId: null,
      kind: 'focus',
      startAtMs: MON,
      endAtMs: MON + 60 * MIN,
      locked: true,
      source: 'manual',
      status: 'planned',
      revision: 1
    }
    const result = await dualWriteApplyExpandedRecurrenceBlocks(
      { api, workspaceRoot: 'D:/ws', nowMs: () => NOW },
      [orphan]
    )
    expect(result.kind).toBe('canonical_failed')
    expect(result.applied).toBe(0)
    expect(result.error?.message).toMatch(/taskId|clone/i)
  })

  it('empty blocks is a no-op success', async () => {
    const { api, applied } = mockApi(emptySnapshot(2, []))
    const result = await dualWriteApplyExpandedRecurrenceBlocks(
      { api, workspaceRoot: 'D:/ws', nowMs: () => NOW },
      []
    )
    expect(result.kind).toBe('canonical_ok')
    expect(result.applied).toBe(0)
    expect(applied).toHaveLength(0)
  })

  it('retries once on revision_conflict then succeeds', async () => {
    let revision = 5
    let applyCalls = 0
    const block = focusBlock({
      id: 'recurrence:task-read@retry',
      taskId: 'task-read',
      startAtMs: MON + 9 * 60 * MIN,
      endAtMs: MON + 10 * 60 * MIN,
      locked: true
    })
    const api: StudyPlanningApi = {
      readStudyPlanning: vi.fn(async () => ({
        ok: true as const,
        snapshot: emptySnapshot(revision, []),
        path: '/ws/.studiumx/study-planning/snapshot.json',
        source: 'canonical' as const
      })),
      applyStudyPlanning: vi.fn(async (payload) => {
        applyCalls += 1
        if (applyCalls === 1) {
          // Stale revision: bump store behind the read
          revision = 6
          return {
            ok: false as const,
            revision: 6,
            error: { code: 'revision_conflict' as const, message: 'stale' }
          }
        }
        expect(payload.expectedRevision).toBe(6)
        revision = 7
        return {
          ok: true as const,
          revision: 7,
          snapshot: emptySnapshot(7, [block]),
          effects: []
        }
      })
    }

    const result = await dualWriteApplyExpandedRecurrenceBlocks(
      { api, workspaceRoot: 'D:/ws', nowMs: () => NOW },
      [block]
    )
    expect(result.kind).toBe('canonical_ok')
    expect(result.applied).toBe(1)
    expect(applyCalls).toBe(2)
  })
})

describe('series UI presenter integration (STC-703 series sheet)', () => {
  it('buildRecurrenceRuleFromForm carries until/count for series sheet save path', () => {
    const rule = buildRecurrenceRuleFromForm(
      dailyDraft({ untilMs: MON + 5 * DAY, count: 4, ruleId: 'recurrence:task-read' })
    )
    expect(rule.taskId).toBe('task-read')
    expect(rule.untilMs).toBe(MON + 5 * DAY)
    expect(rule.count).toBe(4)
    expect(rule.id).toBe('recurrence:task-read')
    // no invent of a different task
    expect(rule.taskId).not.toBeNull()
  })
})