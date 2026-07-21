import { describe, expect, it } from 'vitest'
import {
  BUILTIN_TIME_WINDOW_TEMPLATES,
  StudyPlanningStore,
  allocateMultiWindowDay,
  batchClassifyTasks,
  compareAllocationUtilization,
  copyTimerPlanAsCustom,
  createClassicPomodoroPlan,
  detectPlanDeviations,
  findScheduleConflicts,
  listBuiltinTimerPlans,
  materializeTimeWindowTemplate,
  msFromLocalMinutes,
  projectActiveVsNextTimerPlan,
  projectLocalReviewStats,
  resolveNotificationChannels,
  startTimerSession,
  suggestEstimateMinutesFromHistory,
  timerStatusAriaLabel,
  validateContinuousCountdownMinutes,
  ALLOCATOR_TEST_DAY_UTC
} from '../../src/shared/study-planning'

const day = ALLOCATOR_TEST_DAY_UTC

describe('Phase 5 timer plan catalog (STC-501..508 pure)', () => {
  it('lists builtins and copies as custom', () => {
    const builtins = listBuiltinTimerPlans()
    expect(builtins.some((p) => p.id === 'classic_25_5')).toBe(true)
    const copy = copyTimerPlanAsCustom({
      source: builtins[0],
      newId: 'custom-1',
      newName: '我的番茄'
    })
    expect(copy.ok).toBe(true)
    if (!copy.ok) return
    expect(copy.plan.id).toBe('custom-1')
    expect(copy.plan.name).toBe('我的番茄')
  })

  it('active vs next plan diverges when catalog edited', () => {
    const plan = createClassicPomodoroPlan()
    const started = startTimerSession({ id: 's', nowMs: 0, plan, taskId: 't' })
    const next = createClassicPomodoroPlan({ id: plan.id, focusMinutes: 50, revision: 2 })
    const proj = projectActiveVsNextTimerPlan({
      activeSession: started.session,
      nextPlanId: plan.id,
      catalog: [next]
    })
    expect(proj.diverges).toBe(true)
    expect(proj.activeSnapshot?.focusMinutes).toBe(25)
  })

  it('materializes window templates separate from plans', () => {
    const tpl = BUILTIN_TIME_WINDOW_TEMPLATES.find((t) => t.id === 'morning_0900_1200')!
    const w = materializeTimeWindowTemplate({ template: tpl, dayEpochMs: day })
    expect(w.endAtMs - w.startAtMs).toBe(3 * 60 * 60_000)
  })

  it('validates continuous countdown 30–240', () => {
    expect(validateContinuousCountdownMinutes(29).ok).toBe(false)
    expect(validateContinuousCountdownMinutes(30).ok).toBe(true)
    expect(validateContinuousCountdownMinutes(240).ok).toBe(true)
    expect(validateContinuousCountdownMinutes(241).ok).toBe(false)
  })

  it('store copy_timer_plan and delete refuses builtin id semantics', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const copied = store.applyCommand(
      {
        actionId: 'cp',
        type: 'copy_timer_plan',
        payload: { sourceId: 'classic_25_5', newId: 'u1', newName: '副本' }
      },
      1
    )
    expect(copied.ok).toBe(true)
    if (!copied.ok) return
    expect(copied.snapshot.timerPlans.some((p) => p.id === 'u1')).toBe(true)

    const delBuiltin = store.applyCommand(
      {
        actionId: 'db',
        type: 'delete_timer_plan',
        payload: { planId: 'classic_25_5' }
      },
      copied.revision
    )
    // classic may be in seed list — removeTimerPlanFromCatalog treats builtin id as readonly
    expect(delBuiltin.ok).toBe(false)
  })
})

describe('Phase 4 batch classify (STC-408)', () => {
  it('batchClassifyTasks patches many without per-task prompts', () => {
    const patches = batchClassifyTasks({
      tasks: [
        { id: 'a', categoryId: null, inbox: true },
        { id: 'b', categoryId: null, inbox: true },
        { id: 'c', categoryId: 'study', inbox: false }
      ],
      taskIds: ['a', 'b'],
      categoryId: 'exercise'
    })
    expect(patches).toEqual([
      { id: 'a', categoryId: 'exercise', inbox: false },
      { id: 'b', categoryId: 'exercise', inbox: false }
    ])
  })

  it('store batch_classify_tasks', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    let rev = 1
    for (const id of ['a', 'b']) {
      const r = store.applyCommand(
        { actionId: `c-${id}`, type: 'create_task', payload: { id, title: id } },
        rev
      )
      expect(r.ok).toBe(true)
      if (!r.ok) return
      rev = r.revision
    }
    const batch = store.applyCommand(
      {
        actionId: 'bc',
        type: 'batch_classify_tasks',
        payload: { taskIds: ['a', 'b'], categoryId: 'study' }
      },
      rev
    )
    expect(batch.ok).toBe(true)
    if (!batch.ok) return
    expect(batch.snapshot.tasks.every((t) => t.inbox === false && t.categoryId === 'study')).toBe(true)
  })
})

describe('Phase 6 notification + review (STC-601..607 pure)', () => {
  it('falls back to in-app when system denied', () => {
    const d = resolveNotificationChannels({
      policy: {
        sound: true,
        systemNotification: true,
        focusEnd: true,
        breakEnd: true
      },
      event: 'focus_end',
      systemPermission: 'denied'
    })
    expect(d.showInApp).toBe(true)
    expect(d.trySystemNotification).toBe(false)
  })

  it('DND suppresses sound and system', () => {
    const d = resolveNotificationChannels({
      policy: {
        sound: true,
        systemNotification: true,
        focusEnd: true,
        breakEnd: true
      },
      event: 'focus_end',
      systemPermission: 'granted',
      doNotDisturb: true
    })
    expect(d.playSound).toBe(false)
    expect(d.trySystemNotification).toBe(false)
    expect(d.showInApp).toBe(true)
  })

  it('aria label omits ticking seconds', () => {
    const label = timerStatusAriaLabel({
      state: 'running',
      phase: 'focus',
      clockMode: 'countdown',
      taskTitle: '读论文'
    })
    expect(label).toContain('读论文')
    expect(label).not.toMatch(/\d+:\d+/)
  })

  it('local review stats separate plan/actual/unattributed', () => {
    const stats = projectLocalReviewStats({
      rangeStartMs: 0,
      rangeEndMs: 1e15,
      scheduleBlocks: [
        {
          id: 'b',
          taskId: 't',
          kind: 'focus',
          startAtMs: 0,
          endAtMs: 1500_000,
          locked: false,
          source: 'manual',
          status: 'planned',
          revision: 1
        }
      ],
      timerSessions: [
        {
          id: 's',
          taskId: 't',
          scheduleBlockId: null,
          phase: 'focus',
          clockMode: 'countdown',
          state: 'completed',
          targetSeconds: 1500,
          startedAtMs: 0,
          lastSampleWallMs: 0,
          accumulatedActiveSeconds: 1000,
          accumulatedFocusSeconds: 1000,
          planSnapshot: null,
          attributionReason: 'explicit',
          focusRoundInPlan: 1
        }
      ]
    })
    expect(stats.plannedFocusSeconds).toBe(1500)
    expect(stats.actualFocusSeconds).toBe(1000)
  })

  it('detects early finish deviation', () => {
    const dev = detectPlanDeviations({
      sessions: [
        {
          id: 's',
          taskId: 't',
          scheduleBlockId: null,
          phase: 'focus',
          clockMode: 'countdown',
          state: 'completed',
          targetSeconds: 1500,
          startedAtMs: 0,
          lastSampleWallMs: 0,
          accumulatedActiveSeconds: 600,
          accumulatedFocusSeconds: 600,
          planSnapshot: null,
          attributionReason: 'explicit',
          focusRoundInPlan: 1
        }
      ],
      scheduleBlocks: []
    })
    expect(dev.some((d) => d.kind === 'early_finish')).toBe(true)
  })
})

describe('Phase 7 advanced pure (STC-701/705/706/707)', () => {
  it('compares utilization across plans', () => {
    const window = {
      startAtMs: msFromLocalMinutes(day, 9 * 60),
      endAtMs: msFromLocalMinutes(day, 12 * 60),
      hardEnd: true
    }
    const rows = compareAllocationUtilization({
      window,
      plans: [createClassicPomodoroPlan(), createClassicPomodoroPlan({ id: 'd', focusMinutes: 50, shortBreakMinutes: 10 })]
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].utilizationRatio).toBeGreaterThan(0)
  })

  it('multi-window day returns one proposal per window', () => {
    const plan = createClassicPomodoroPlan()
    const proposals = allocateMultiWindowDay({
      plan,
      windows: [
        {
          startAtMs: msFromLocalMinutes(day, 9 * 60),
          endAtMs: msFromLocalMinutes(day, 11 * 60),
          hardEnd: true
        },
        {
          startAtMs: msFromLocalMinutes(day, 14 * 60),
          endAtMs: msFromLocalMinutes(day, 16 * 60),
          hardEnd: true
        }
      ]
    })
    expect(proposals).toHaveLength(2)
  })

  it('suggests estimate without writing tasks', () => {
    const s = suggestEstimateMinutesFromHistory({
      focusSecondsSamples: [20 * 60, 30 * 60, 40 * 60]
    })
    expect(s.suggestedMinutes).toBe(30)
    expect(s.sampleCount).toBe(3)
  })

  it('finds schedule conflicts', () => {
    const c = findScheduleConflicts([
      {
        id: 'a',
        taskId: 't',
        kind: 'focus',
        startAtMs: 0,
        endAtMs: 100,
        locked: false,
        source: 'manual',
        status: 'planned',
        revision: 1
      },
      {
        id: 'b',
        taskId: 'u',
        kind: 'focus',
        startAtMs: 50,
        endAtMs: 150,
        locked: false,
        source: 'manual',
        status: 'planned',
        revision: 1
      }
    ])
    expect(c).toHaveLength(1)
  })
})
