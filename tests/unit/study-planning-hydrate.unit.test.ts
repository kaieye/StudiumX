import { describe, expect, it, vi } from 'vitest'
import {
  hydrateStudyTasksFromCanonical,
  mergeCanonicalTasksIntoStudySnapshot,
  pickPrimaryScheduleBlockForTask,
  projectCanonicalTasksForUi,
  projectCanonicalTimerPlansForUi,
  projectDefaultTimerPlanIdFromPreferences,
  projectRecurrenceRulesFromPreferences,
  scheduleBlockToV1Schedule,
  studyTasksEqual
} from '../../src/renderer/src/study-space/planning-hydrate'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import type { StudySnapshot, StudyTask } from '../../src/renderer/src/study-space/types'
import type { PlanningTask, ScheduleBlock, StudyPlanningSnapshotV1 } from '../../src/shared/study-planning'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  createClassicPomodoroPlan
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
    expect(result.defaultTimerPlanId).toBeNull()
    expect(result.timerPlansProjected).toBe(0)
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

describe('projectCanonicalTimerPlansForUi', () => {
  it('maps TimerPlanV2 catalog to V1 and preserves host simulation windows by id', () => {
    const plan = createClassicPomodoroPlan({
      id: 'plan-user-1',
      name: 'Custom',
      focusMinutes: 30,
      shortBreakMinutes: 8
    })
    const projected = projectCanonicalTimerPlansForUi(
      { timerPlans: [plan] },
      [
        {
          id: 'plan-user-1',
          name: 'old',
          focusMinutes: 25,
          breakMinutes: 5,
          simulationStartTime: '10:30',
          simulationEndTime: '14:00'
        }
      ]
    )
    expect(projected).toEqual([
      {
        id: 'plan-user-1',
        name: 'Custom',
        focusMinutes: 30,
        breakMinutes: 8,
        simulationStartTime: '10:30',
        simulationEndTime: '14:00',
        longBreakMinutes: 15,
        longBreakEvery: 4,
        breakPolicy: 'ask',
        kind: 'pomodoro',
        clockMode: 'countdown'
      }
    ])
  })

  it('merge overlays timerPlans when canonical has catalog rows', () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(5),
      tasks: [planningTask({ id: 'a', title: 'T' })],
      timerPlans: [
        createClassicPomodoroPlan({
          id: 'p1',
          name: 'Deep',
          focusMinutes: 50,
          shortBreakMinutes: 10
        })
      ]
    }
    const host = hostSnapshot([{ id: 'a', title: 'T', done: false }])
    host.timerPlans = [
      {
        id: 'v1-only',
        name: 'local',
        focusMinutes: 25,
        breakMinutes: 5,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00'
      }
    ]
    const merged = mergeCanonicalTasksIntoStudySnapshot(host, planning)
    expect(merged.timerPlansProjected).toBe(1)
    expect(merged.snapshot.timerPlans).toEqual([
      {
        id: 'p1',
        name: 'Deep',
        focusMinutes: 50,
        breakMinutes: 10,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00',
        longBreakMinutes: 15,
        longBreakEvery: 4,
        breakPolicy: 'ask',
        kind: 'pomodoro',
        clockMode: 'countdown'
      }
    ])
  })
})

describe('projectDefaultTimerPlanIdFromPreferences', () => {
  it('returns null when unset / empty / non-string', () => {
    expect(projectDefaultTimerPlanIdFromPreferences(undefined)).toBeNull()
    expect(projectDefaultTimerPlanIdFromPreferences(null as never)).toBeNull()
    expect(projectDefaultTimerPlanIdFromPreferences({})).toBeNull()
    expect(projectDefaultTimerPlanIdFromPreferences({ defaultTimerPlanId: null })).toBeNull()
    expect(projectDefaultTimerPlanIdFromPreferences({ defaultTimerPlanId: '' })).toBeNull()
    expect(projectDefaultTimerPlanIdFromPreferences({ defaultTimerPlanId: '   ' })).toBeNull()
  })

  it('trims and returns non-empty plan id', () => {
    expect(
      projectDefaultTimerPlanIdFromPreferences({ defaultTimerPlanId: '  deep_50_10  ' })
    ).toBe('deep_50_10')
    expect(
      projectDefaultTimerPlanIdFromPreferences({ defaultTimerPlanId: 'classic_25_5' })
    ).toBe('classic_25_5')
  })
})

describe('projectRecurrenceRulesFromPreferences', () => {
  it('returns empty when unset / non-array / invalid', () => {
    expect(projectRecurrenceRulesFromPreferences(undefined)).toEqual([])
    expect(projectRecurrenceRulesFromPreferences(null as never)).toEqual([])
    expect(projectRecurrenceRulesFromPreferences({})).toEqual([])
    expect(projectRecurrenceRulesFromPreferences({ recurrenceRules: null as never })).toEqual([])
    expect(projectRecurrenceRulesFromPreferences({ recurrenceRules: { id: 'x' } as never })).toEqual([])
  })

  it('normalizes valid durable rules (STC-703 sole-read)', () => {
    const out = projectRecurrenceRulesFromPreferences({
      recurrenceRules: [
        {
          id: 'recurrence:task-a',
          taskId: 'task-a',
          kind: 'focus',
          frequency: 'weekly',
          byWeekday: [1, 3],
          dtStartMs: Date.UTC(2026, 0, 5),
          startMinutes: 9 * 60,
          endMinutes: 10 * 60,
          expandAsLocked: true
        },
        {
          id: 'bad-minutes',
          taskId: 'task-b',
          kind: 'focus',
          frequency: 'daily',
          dtStartMs: Date.UTC(2026, 0, 5),
          startMinutes: 100,
          endMinutes: 50
        }
      ]
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('recurrence:task-a')
    expect(out[0]?.taskId).toBe('task-a')
    expect(out[0]?.byWeekday).toEqual([1, 3])
  })
})

describe('hydrateStudyTasksFromCanonical preferences + timerPlans sole-read', () => {
  it('applied surfaces defaultTimerPlanId and projected timerPlans', async () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(12),
      tasks: [planningTask({ id: 't1', title: 'Canon task', categoryId: 'study', inbox: false })],
      timerPlans: [
        createClassicPomodoroPlan({
          id: 'deep_50_10',
          name: 'Deep',
          focusMinutes: 50,
          shortBreakMinutes: 10
        })
      ],
      preferences: { defaultTimerPlanId: 'deep_50_10' }
    }
    const host = hostSnapshot([{ id: 'stale', title: 'old', done: false }])
    host.timerPlans = [
      {
        id: 'v1-local',
        name: 'Local only',
        focusMinutes: 25,
        breakMinutes: 5,
        simulationStartTime: '08:00',
        simulationEndTime: '11:00'
      }
    ]

    const api = mockApi(planning)
    const result = await hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws', nowMs: () => FIXED_NOW },
      host
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.defaultTimerPlanId).toBe('deep_50_10')
    expect(result.timerPlansProjected).toBe(1)
    expect(result.snapshot.timerPlans).toEqual([
      {
        id: 'deep_50_10',
        name: 'Deep',
        focusMinutes: 50,
        breakMinutes: 10,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00',
        longBreakMinutes: 15,
        longBreakEvery: 4,
        breakPolicy: 'ask',
        kind: 'pomodoro',
        clockMode: 'countdown'
      }
    ])
    expect(result.snapshot.tasks.map((t) => t.id)).toEqual(['t1'])
  })

  it('applied yields null defaultTimerPlanId when preferences omit it', async () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(4),
      tasks: [planningTask({ id: 'only', title: 'One' })],
      preferences: {}
    }
    const api = mockApi(planning)
    const result = await hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws' },
      hostSnapshot([{ id: 'v1', title: 'x', done: false }])
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.defaultTimerPlanId).toBeNull()
    expect(result.timerPlansProjected).toBe(0)
    // STC-404 fail-closed defaults when prefs omit empty-start / classification opt-out
    expect(result.emptyStartPolicy).toBe('remember_quick_start')
    expect(result.emptyStartCategoryId).toBe('other')
    expect(result.classificationPromptOptOut).toBe(false)
    // STC-703 host: empty sole-read list when prefs omit recurrenceRules
    expect(result.recurrenceRules).toEqual([])
  })

  it('applied surfaces emptyStartPolicy + classificationPromptOptOut sole-read (STC-404)', async () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(8),
      tasks: [planningTask({ id: 't1', title: 'Canon task' })],
      preferences: {
        emptyStartPolicy: 'remember_quick_start',
        classificationPromptOptOut: true
      }
    }
    const api = mockApi(planning)
    const result = await hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws', nowMs: () => FIXED_NOW },
      hostSnapshot([{ id: 'stale', title: 'old', done: false }])
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.emptyStartPolicy).toBe('remember_quick_start')
    expect(result.emptyStartCategoryId).toBe('other')
    expect(result.classificationPromptOptOut).toBe(true)
    expect(result.recurrenceRules).toEqual([])
  })

  it('applied surfaces preferences.recurrenceRules sole-read (STC-703 host)', async () => {
    const rule = {
      id: 'recurrence:t1',
      taskId: 't1',
      kind: 'focus' as const,
      frequency: 'weekly' as const,
      byWeekday: [1, 3] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[],
      dtStartMs: Date.UTC(2026, 0, 5),
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      expandAsLocked: true
    }
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(13),
      tasks: [planningTask({ id: 't1', title: 'Canon task' })],
      preferences: {
        recurrenceRules: [rule]
      }
    }
    const api = mockApi(planning)
    const result = await hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws', nowMs: () => FIXED_NOW },
      hostSnapshot([{ id: 'stale', title: 'old', done: false }])
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.recurrenceRules).toHaveLength(1)
    expect(result.recurrenceRules[0]?.id).toBe('recurrence:t1')
    expect(result.recurrenceRules[0]?.taskId).toBe('t1')
    expect(result.recurrenceRules[0]?.startMinutes).toBe(9 * 60)
  })

  it('applied surfaces timerSessions sole-read for task-detail actual (STC-304 remainder)', async () => {
    const session = {
      id: 'sess-1',
      taskId: 't1',
      scheduleBlockId: null,
      phase: 'focus' as const,
      clockMode: 'countdown' as const,
      state: 'completed' as const,
      targetSeconds: 1500,
      startedAtMs: FIXED_NOW - 1800_000,
      endedAtMs: FIXED_NOW - 300_000,
      lastSampleWallMs: FIXED_NOW - 300_000,
      accumulatedActiveSeconds: 1500,
      accumulatedFocusSeconds: 1500,
      planSnapshot: null,
      attributionReason: 'explicit' as const,
      focusRoundInPlan: 1
    }
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(9),
      tasks: [planningTask({ id: 't1', title: 'Canon task' })],
      timerSessions: [session]
    }
    const api = mockApi(planning)
    const result = await hydrateStudyTasksFromCanonical(
      { api, workspaceRoot: 'D:/ws', nowMs: () => FIXED_NOW },
      hostSnapshot([{ id: 'stale', title: 'old', done: false }])
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.timerSessions).toHaveLength(1)
    expect(result.timerSessions[0]?.id).toBe('sess-1')
    expect(result.timerSessions[0]?.accumulatedFocusSeconds).toBe(1500)
  })
})

describe('hydrate simulation window sole-read', () => {
  it('applied surfaces simulation labels from preferences and merges host snapshot', async () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(21),
      tasks: [planningTask({ id: 't1', title: 'Task' })],
      preferences: {
        simulationStartTime: '08:00',
        simulationEndTime: '11:30'
      }
    }
    const host = hostSnapshot()
    host.simulationStartTime = '09:00'
    host.simulationEndTime = '12:00'
    const result = await hydrateStudyTasksFromCanonical(
      { api: mockApi(planning), workspaceRoot: '/ws', nowMs: () => FIXED_NOW },
      host
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.simulationStartTime).toBe('08:00')
    expect(result.simulationEndTime).toBe('11:30')
    expect(result.snapshot.simulationStartTime).toBe('08:00')
    expect(result.snapshot.simulationEndTime).toBe('11:30')
  })

  it('applied yields null simulation when preferences omit window', async () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(22),
      tasks: [planningTask({ id: 't1', title: 'Task' })],
      preferences: { defaultTimerPlanId: 'classic_25_5' }
    }
    const host = hostSnapshot()
    host.simulationStartTime = '09:00'
    host.simulationEndTime = '12:00'
    const result = await hydrateStudyTasksFromCanonical(
      { api: mockApi(planning), workspaceRoot: '/ws', nowMs: () => FIXED_NOW },
      host
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.simulationStartTime).toBeNull()
    expect(result.simulationEndTime).toBeNull()
    // host labels preserved when prefs omit
    expect(result.snapshot.simulationStartTime).toBe('09:00')
    expect(result.snapshot.simulationEndTime).toBe('12:00')
  })
})



describe('hydrate categories sole-read', () => {
  it('applied surfaces categories from snapshot when present', async () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(31),
      tasks: [planningTask({ id: 't1', title: 'A', categoryId: 'custom-x', inbox: false })],
      categories: [
        { id: 'study', name: '学习', color: '#8197aa', builtin: true },
        { id: 'entertainment', name: '娱乐', color: '#9c8aa5', builtin: true },
        { id: 'exercise', name: '锻炼', color: '#829d91', builtin: true },
        { id: 'custom-x', name: '阅读', color: '#abcdef', builtin: false }
      ]
    }
    const host = hostSnapshot()
    const result = await hydrateStudyTasksFromCanonical(
      { api: mockApi(planning), workspaceRoot: '/ws', nowMs: () => FIXED_NOW },
      host
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.categories).not.toBeNull()
    expect(result.categories!.some((c) => c.id === 'custom-x')).toBe(true)
  })

  it('applied yields null categories when snapshot omits catalog', async () => {
    const planning: StudyPlanningSnapshotV1 = {
      ...emptyPlanning(32),
      tasks: [planningTask({ id: 't1', title: 'A', categoryId: 'study', inbox: false })]
    }
    const host = hostSnapshot()
    const result = await hydrateStudyTasksFromCanonical(
      { api: mockApi(planning), workspaceRoot: '/ws', nowMs: () => FIXED_NOW },
      host
    )
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') return
    expect(result.categories).toBeNull()
  })
})
