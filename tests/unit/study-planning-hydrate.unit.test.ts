import { describe, expect, it, vi } from 'vitest'
import {
  hydrateStudyTasksFromCanonical,
  mergeCanonicalTasksIntoStudySnapshot,
  pickPrimaryScheduleBlockForTask,
  projectCanonicalTasksForUi,
  scheduleBlockToV1Schedule,
  studyTasksEqual
} from '../../src/renderer/src/study-space/planning-hydrate'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import type { StudySnapshot, StudyTask } from '../../src/renderer/src/study-space/types'
import type { PlanningTask, ScheduleBlock, StudyPlanningSnapshotV1 } from '../../src/shared/study-planning'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION
} from '../../src/shared/study-planning'

const FIXED_NOW = Date.UTC(2026, 6, 21, 12, 0, 0) // Tue 2026-07-21 12:00 UTC

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

function planningTask(
  partial: Partial<PlanningTask> & Pick<PlanningTask, 'id' | 'title'>
): PlanningTask {
  return {
    status: 'open',
    categoryId: null,
    inbox: true,
    splittable: true,
    revision: 1,
    source: 'manual',
    ...partial
  }
}

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

function mockApi(snapshot: StudyPlanningSnapshotV1, source: 'canonical' | 'backup' = 'canonical'): StudyPlanningApi {
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source
    })),
    applyStudyPlanning: vi.fn(async () => ({
      ok: false as const,
      revision: snapshot.revision,
      error: { code: 'not_used', message: 'hydrate tests do not apply' }
    }))
  }
}

describe('scheduleBlockToV1Schedule', () => {
  it('maps same-day local interval to weekday + minutes', () => {
    // Local wall clock: use Date constructor with local components so test is TZ-stable.
    const start = new Date(2026, 6, 20, 9, 0, 0, 0) // Mon
    const end = new Date(2026, 6, 20, 10, 30, 0, 0)
    // Mon 2026-07-20: JS getDay()=1 → product Mon-first weekday=0
    expect(scheduleBlockToV1Schedule({ startAtMs: start.getTime(), endAtMs: end.getTime() })).toEqual({
      weekday: 0,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60 + 30
    })
  })

  it('rejects midnight-spanning intervals', () => {
    const start = new Date(2026, 6, 20, 23, 0, 0, 0)
    const end = new Date(2026, 6, 21, 1, 0, 0, 0)
    expect(scheduleBlockToV1Schedule({ startAtMs: start.getTime(), endAtMs: end.getTime() })).toBeNull()
  })

  it('rejects inverted intervals', () => {
    expect(scheduleBlockToV1Schedule({ startAtMs: 200, endAtMs: 100 })).toBeNull()
  })
})

describe('pickPrimaryScheduleBlockForTask', () => {
  const taskId = 't1'
  const past = focusBlock({
    id: 'b-past',
    taskId,
    startAtMs: FIXED_NOW - 3 * 60 * 60_000,
    endAtMs: FIXED_NOW - 2 * 60 * 60_000
  })
  const next = focusBlock({
    id: 'b-next',
    taskId,
    startAtMs: FIXED_NOW + 60_000,
    endAtMs: FIXED_NOW + 30 * 60_000
  })
  const later = focusBlock({
    id: 'b-later',
    taskId,
    startAtMs: FIXED_NOW + 2 * 60 * 60_000,
    endAtMs: FIXED_NOW + 3 * 60 * 60_000
  })
  const other = focusBlock({
    id: 'b-other',
    taskId: 't2',
    startAtMs: FIXED_NOW + 60_000,
    endAtMs: FIXED_NOW + 120_000
  })
  const cancelled = focusBlock({
    id: 'b-cancel',
    taskId,
    startAtMs: FIXED_NOW + 10_000,
    endAtMs: FIXED_NOW + 20_000,
    status: 'cancelled'
  })
  const breakBlock: ScheduleBlock = {
    ...focusBlock({
      id: 'b-break',
      taskId,
      startAtMs: FIXED_NOW + 5_000,
      endAtMs: FIXED_NOW + 15_000
    }),
    kind: 'short_break'
  }

  it('prefers next future focus block', () => {
    const picked = pickPrimaryScheduleBlockForTask(
      [later, past, next, other, cancelled, breakBlock],
      taskId,
      FIXED_NOW
    )
    expect(picked?.id).toBe('b-next')
  })

  it('falls back to latest past when no future', () => {
    const older = focusBlock({
      id: 'b-older',
      taskId,
      startAtMs: FIXED_NOW - 5 * 60 * 60_000,
      endAtMs: FIXED_NOW - 4 * 60 * 60_000
    })
    const picked = pickPrimaryScheduleBlockForTask([past, older], taskId, FIXED_NOW)
    expect(picked?.id).toBe('b-past')
  })

  it('returns null when no focus blocks for task', () => {
    expect(pickPrimaryScheduleBlockForTask([other, breakBlock], taskId, FIXED_NOW)).toBeNull()
  })
})

describe('projectCanonicalTasksForUi + merge', () => {
  it('projects done/status and primary schedule; preserves host timer shell', () => {
    const start = new Date(2026, 6, 21, 14, 0, 0, 0)
    const end = new Date(2026, 6, 21, 15, 0, 0, 0)
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(4),
      tasks: [
        planningTask({ id: 'a', title: '读论文', categoryId: 'study', inbox: false }),
        planningTask({ id: 'b', title: '完成项', status: 'done', categoryId: null, inbox: true })
      ],
      scheduleBlocks: [
        focusBlock({
          id: 'blk',
          taskId: 'a',
          startAtMs: start.getTime(),
          endAtMs: end.getTime()
        })
      ]
    }

    const { tasks, scheduleProjected } = projectCanonicalTasksForUi(planning, {
      nowMs: start.getTime() - 1000
    })
    expect(scheduleProjected).toBe(1)
    expect(tasks).toEqual([
      {
        id: 'a',
        title: '读论文',
        done: false,
        categoryId: 'study',
        schedule: {
          // Tue 2026-07-21: JS getDay()=2 → product Mon-first weekday=1
          weekday: (start.getDay() + 6) % 7,
          startMinutes: 14 * 60,
          endMinutes: 15 * 60
        }
      },
      { id: 'b', title: '完成项', done: true }
    ])

    const host = hostSnapshot([{ id: 'v1-only', title: '旧', done: false }])
    host.timerState = 'running'
    host.remainingSeconds = 900
    host.todayFocusSeconds = 1200

    const merged = mergeCanonicalTasksIntoStudySnapshot(host, planning, {
      nowMs: start.getTime() - 1000
    })
    expect(merged.snapshot.tasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(merged.snapshot.timerState).toBe('running')
    expect(merged.snapshot.remainingSeconds).toBe(900)
    expect(merged.snapshot.todayFocusSeconds).toBe(1200)
    expect(merged.scheduleProjected).toBe(1)
  })
})

describe('studyTasksEqual', () => {
  it('compares id/title/done/category/schedule only', () => {
    const a: StudyTask[] = [
      { id: '1', title: 'A', done: false, categoryId: 'study', schedule: { weekday: 1, startMinutes: 0, endMinutes: 60 } }
    ]
    const b: StudyTask[] = [
      { id: '1', title: 'A', done: false, categoryId: 'study', schedule: { weekday: 1, startMinutes: 0, endMinutes: 60 } }
    ]
    const c: StudyTask[] = [{ id: '1', title: 'A', done: true }]
    expect(studyTasksEqual(a, b)).toBe(true)
    expect(studyTasksEqual(a, c)).toBe(false)
  })
})

describe('hydrateStudyTasksFromCanonical', () => {
  it('kept_v1 when workspace missing', async () => {
    const host = hostSnapshot([{ id: 'v1', title: 'local', done: false }])
    const result = await hydrateStudyTasksFromCanonical(
      { api: mockApi(emptyPlanning()), workspaceRoot: '  ' },
      host
    )
    expect(result.kind).toBe('kept_v1')
    if (result.kind !== 'kept_v1') return
    expect(result.reason).toBe('missing_workspace')
    expect(result.migrationSuggested).toBe(true)
  })

  it('kept_v1 when api unavailable', async () => {
    const host = hostSnapshot([{ id: 'v1', title: 'local', done: false }])
    const result = await hydrateStudyTasksFromCanonical(
      { api: null, workspaceRoot: 'D:/ws' },
      host
    )
    expect(result.kind).toBe('kept_v1')
    if (result.kind !== 'kept_v1') return
    expect(result.reason).toBe('api_unavailable')
    expect(result.migrationSuggested).toBe(true)
  })

  it('kept_v1 + migrationSuggested when canonical empty and V1 has tasks', async () => {
    const host = hostSnapshot([{ id: 'v1', title: 'local', done: false }])
    const api = mockApi(emptyPlanning(7))
    const result = await hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws' },
      host
    )
    expect(result.kind).toBe('kept_v1')
    if (result.kind !== 'kept_v1') return
    expect(result.reason).toBe('canonical_empty')
    expect(result.migrationSuggested).toBe(true)
    expect(result.revision).toBe(7)
  })

  it('applied replaces UI tasks from canonical (sole-read)', async () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(9),
      tasks: [
        planningTask({ id: 'canon-1', title: 'Canonical A', categoryId: 'study', inbox: false }),
        planningTask({ id: 'canon-2', title: 'Canonical B', status: 'done' })
      ]
    }
    const host = hostSnapshot([
      { id: 'stale', title: 'V1 stale', done: false },
      { id: 'also', title: 'also', done: true }
    ])
    host.timerState = 'running'
    host.remainingSeconds = 400

    const api = mockApi(planning, 'canonical')
    const result = await hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws', nowMs: () => FIXED_NOW },
      host
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.revision).toBe(9)
    expect(result.taskCount).toBe(2)
    expect(result.source).toBe('canonical')
    expect(result.snapshot.tasks).toEqual([
      { id: 'canon-1', title: 'Canonical A', done: false, categoryId: 'study' },
      { id: 'canon-2', title: 'Canonical B', done: true }
    ])
    // Timer shell stays from host
    expect(result.snapshot.timerState).toBe('running')
    expect(result.snapshot.remainingSeconds).toBe(400)
  })

  it('skips apply when host tasks race during async read', async () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(3),
      tasks: [planningTask({ id: 'c1', title: 'from-canon' })]
    }
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const api: StudyPlanningApi = {
      readStudyPlanning: vi.fn(async () => {
        await gate
        return {
          ok: true as const,
          snapshot: planning,
          path: '/ws/.studiumx/study-planning/snapshot.json',
          source: 'canonical' as const
        }
      }),
      applyStudyPlanning: vi.fn(async () => ({
        ok: false as const,
        revision: 3,
        error: { code: 'not_used', message: 'n/a' }
      }))
    }

    const initialTasks: StudyTask[] = [{ id: 'v1', title: 'before', done: false }]
    const host = hostSnapshot(initialTasks)
    let liveTasks: StudyTask[] = initialTasks.slice()

    const pending = hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws' },
      host,
      {
        expectedHostTasks: initialTasks,
        getCurrentHostTasks: () => liveTasks
      }
    )

    // Mutate V1 while IPC is in flight
    liveTasks = [{ id: 'v1', title: 'edited-during-read', done: false }]
    release()

    const result = await pending
    expect(result.kind).toBe('kept_v1')
    if (result.kind !== 'kept_v1') return
    expect(result.message).toMatch(/changed during canonical read/i)
    expect(result.migrationSuggested).toBe(false)
  })

  it('kept_v1 on io_failed from IPC', async () => {
    const api: StudyPlanningApi = {
      readStudyPlanning: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'io_failed', message: 'disk error' }
      })),
      applyStudyPlanning: vi.fn(async () => ({
        ok: false as const,
        revision: 0,
        error: { code: 'not_used', message: 'n/a' }
      }))
    }
    const host = hostSnapshot([{ id: 'v1', title: 'x', done: false }])
    const result = await hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws' },
      host
    )
    expect(result.kind).toBe('kept_v1')
    if (result.kind !== 'kept_v1') return
    expect(result.reason).toBe('io_failed')
    expect(result.migrationSuggested).toBe(true)
  })
})
