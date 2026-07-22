/**
 * IMPL-N: host wire — hydrate sole-read recurrenceRules export surface + dual-write re-read.
 * Proves preferences.recurrenceRules project into hydrate applied result for schedule host prop.
 * No auto-expand; no task clone; no schemaVersion bump.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  hydrateStudyTasksFromCanonical,
  projectRecurrenceRulesFromPreferences
} from '../../src/renderer/src/study-space/planning-hydrate'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  dualWriteSetPreferences
} from '../../src/renderer/src/study-space/planning-preferences-dual-write'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  type RecurrenceRule,
  type StudyPlanningSnapshotV1
} from '../../src/shared/study-planning'
import type { StudySnapshot, StudyTask } from '../../src/renderer/src/study-space/types'

const FIXED_NOW = Date.UTC(2026, 6, 21, 12, 0, 0)

const baseRule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  id: 'recurrence:task-a',
  taskId: 'task-a',
  kind: 'focus',
  frequency: 'weekly',
  byWeekday: [1, 3],
  dtStartMs: Date.UTC(2026, 0, 5),
  startMinutes: 9 * 60,
  endMinutes: 10 * 60,
  expandAsLocked: true,
  ...over
})

function emptyPlanning(revision = 2): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: FIXED_NOW,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
}

function hostSnapshot(tasks: StudyTask[] = []): StudySnapshot {
  return {
    clientId: 'c1',
    nickname: 'learner',
    spaceCode: 'ABCD',
    presenceRelayUrl: '',
    signalId: 'reading',
    modeId: 'free',
    contractText: '',
    contractLocked: false,
    roomId: 'silent',
    seatIndex: 0,
    seatClaimedAt: 0,
    timerMode: 'focus',
    timerState: 'idle',
    focusMinutes: 25,
    breakMinutes: 5,
    simulationStartTime: '',
    simulationEndTime: '',
    timerPlans: [],
    remainingSeconds: 0,
    todayFocusSeconds: 0,
    todaySessions: 0,
    totalFocusSeconds: 0,
    totalSessions: 0,
    streakDays: 0,
    xp: 0,
    lastStudyDate: '',
    tasks
  }
}

function mockApi(snapshot: StudyPlanningSnapshotV1): StudyPlanningApi {
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    })),
    applyStudyPlanning: vi.fn(async () => ({
      ok: false as const,
      revision: snapshot.revision,
      error: { code: 'not_used', message: 'n/a' }
    }))
  }
}

describe('IMPL-N host: hydrate → recurrenceRules export surface', () => {
  it('projectRecurrenceRulesFromPreferences is fail-closed empty when unset', () => {
    expect(projectRecurrenceRulesFromPreferences(undefined)).toEqual([])
    expect(projectRecurrenceRulesFromPreferences({})).toEqual([])
  })

  it('hydrate applied exports recurrenceRules for schedule host prop', async () => {
    const rule = baseRule()
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(5),
      tasks: [
        {
          id: 'task-a',
          title: 'Canon',
          status: 'open',
          categoryId: null,
          inbox: true,
          splittable: true,
          revision: 1,
          source: 'manual'
        }
      ],
      preferences: { recurrenceRules: [rule] }
    }
    const result = await hydrateStudyTasksFromCanonical(
      { api: mockApi(planning), workspaceRoot: 'D:/ws', nowMs: () => FIXED_NOW },
      hostSnapshot([{ id: 'stale', title: 'old', done: false }])
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    // Host can pass result.recurrenceRules into StudyTaskSchedulePage
    expect(result.recurrenceRules).toEqual([
      expect.objectContaining({
        id: rule.id,
        taskId: rule.taskId,
        frequency: 'weekly',
        startMinutes: 9 * 60,
        endMinutes: 10 * 60
      })
    ])
  })

  it('dualWriteSetPreferences full-replace returns snapshot rules for sole-read re-read', async () => {
    const rule = baseRule({ id: 'recurrence:saved' })
    let snap: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(7),
      tasks: [
        {
          id: 'task-a',
          title: 'Canon',
          status: 'open',
          categoryId: null,
          inbox: true,
          splittable: true,
          revision: 1,
          source: 'manual'
        }
      ],
      preferences: {}
    }
    const api: StudyPlanningApi = {
      readStudyPlanning: vi.fn(async () => ({
        ok: true as const,
        snapshot: snap,
        path: '/ws/snapshot.json',
        source: 'canonical' as const
      })),
      applyStudyPlanning: vi.fn(async (args) => {
        const payload = (args.command as { payload?: { recurrenceRules?: RecurrenceRule[] } }).payload
        const nextRules = Array.isArray(payload?.recurrenceRules) ? payload!.recurrenceRules! : []
        snap = {
          ...snap,
          revision: snap.revision + 1,
          preferences: { ...snap.preferences, recurrenceRules: nextRules }
        }
        return {
          ok: true as const,
          revision: snap.revision,
          snapshot: snap,
          effects: [],
          path: '/ws/snapshot.json'
        }
      })
    }

    const write = await dualWriteSetPreferences(
      { api, workspaceRoot: 'D:/ws' },
      { recurrenceRules: [rule] }
    )
    expect(write.kind).toBe('canonical_ok')
    if (write.kind !== 'canonical_ok') return
    const fromSnap = write.result.snapshot?.preferences?.recurrenceRules
    expect(fromSnap).toEqual([expect.objectContaining({ id: 'recurrence:saved' })])

    // Re-hydrate mirrors the same surface OfficeWorkbench would pass as prop
    const hydrate = await hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws', nowMs: () => FIXED_NOW },
      hostSnapshot([{ id: 'task-a', title: 'Canon', done: false }])
    )
    expect(hydrate.kind).toBe('applied')
    if (hydrate.kind !== 'applied') return
    expect(hydrate.recurrenceRules.map((r) => r.id)).toEqual(['recurrence:saved'])
  })
})
