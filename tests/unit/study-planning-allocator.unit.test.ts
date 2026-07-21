import { describe, expect, it } from 'vitest'
import {
  ALLOCATOR_TEST_DAY_UTC,
  allocateTimeWindow,
  createClassicPomodoroPlan,
  isValidScheduleBlockInterval,
  migrateStudyV1ToPlanning,
  msFromLocalMinutes,
  normalizeTimerPlanV2,
  proposalBlocksToScheduleBlocks,
  TIMER_PLAN_SEED_DEFAULTS,
  v1ScheduleToIntervalMs,
  validateScheduleBlocks,
  type AllocatorTask,
  type ProposedBlock,
  type ScheduleBlock
} from '../../src/shared/study-planning'

const day = ALLOCATOR_TEST_DAY_UTC

function window0900to1200() {
  return {
    startAtMs: msFromLocalMinutes(day, 9 * 60),
    endAtMs: msFromLocalMinutes(day, 12 * 60),
    hardEnd: true,
    label: '09:00–12:00'
  }
}

function blockMinutes(block: ProposedBlock): number {
  return Math.round((block.endAtMs - block.startAtMs) / 60_000)
}

function formatHm(ms: number): string {
  const mins = Math.round((ms - day) / 60_000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function timeline(blocks: ProposedBlock[]): string[] {
  return blocks.map(
    (b) => `${formatHm(b.startAtMs)}-${formatHm(b.endAtMs)} ${b.kind}${b.taskId ? `:${b.taskId}` : ''}`
  )
}

describe('normalizeTimerPlanV2 (STC-101)', () => {
  it('normalizes classic pomodoro seed defaults', () => {
    const result = normalizeTimerPlanV2({
      id: 'p1',
      name: '经典',
      kind: 'pomodoro',
      clockMode: 'countdown'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.focusMinutes).toBe(25)
    expect(result.plan.shortBreakMinutes).toBe(5)
    expect(result.plan.longBreakMinutes).toBe(15)
    expect(result.plan.longBreakEvery).toBe(4)
    expect(result.plan.breakPolicy).toBe('ask')
    expect(result.plan.windowFillPolicy).toBe('adaptive_final_focus')
    expect(result.plan.minimumFinalFocusMinutes).toBe(15)
    expect(result.plan.wrapUpMinutes).toBe(5)
  })

  it('rejects missing id/name/kind', () => {
    const result = normalizeTimerPlanV2({ kind: 'pomodoro', clockMode: 'countdown' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.code === 'plan_id_required')).toBe(true)
    expect(result.issues.some((i) => i.code === 'plan_name_required')).toBe(true)
  })

  it('coerces pomodoro none/reminder_only breakPolicy to ask (freeze #6)', () => {
    const result = normalizeTimerPlanV2({
      id: 'p',
      name: 'x',
      kind: 'pomodoro',
      clockMode: 'countdown',
      breakPolicy: 'none'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.breakPolicy).toBe('ask')
    expect(result.warnings.some((w) => w.code === 'pomodoro_break_policy_coerced')).toBe(true)
  })

  it('allows continuous reminder_only / none', () => {
    const result = normalizeTimerPlanV2({
      id: 'c',
      name: 'flow',
      kind: 'continuous',
      clockMode: 'countup',
      breakPolicy: 'none'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.breakPolicy).toBe('none')
    expect(result.plan.focusMinutes).toBeUndefined()
  })

  it('clamps out-of-range focus minutes', () => {
    const result = normalizeTimerPlanV2({
      id: 'p',
      name: 'x',
      kind: 'pomodoro',
      clockMode: 'countdown',
      focusMinutes: 999
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.focusMinutes).toBe(TIMER_PLAN_SEED_DEFAULTS.focusMinutesMax)
  })

  it('createClassicPomodoroPlan returns catalog-aligned plan', () => {
    const plan = createClassicPomodoroPlan()
    expect(plan.id).toBe('classic_25_5')
    expect(plan.focusMinutes).toBe(25)
  })
})

describe('allocateTimeWindow (STC-102..107)', () => {
  it('fills 09:00–12:00 with 25/5 + long break every 4 + adaptive final focus (§5.1)', () => {
    const plan = createClassicPomodoroPlan()
    const tasks: AllocatorTask[] = [
      { id: 'A', estimateMinutes: 50, manualOrder: 0 },
      { id: 'B', estimateMinutes: 50, manualOrder: 1 },
      { id: 'C', estimateMinutes: 50, manualOrder: 2 }
    ]

    const proposal = allocateTimeWindow({
      window: window0900to1200(),
      plan,
      tasks,
      nowMs: msFromLocalMinutes(day, 9 * 60)
    })

    expect(proposal.warnings).not.toContain('window_invalid')
    expect(proposal.meta.policy).toBe('adaptive_final_focus')
    expect(proposal.meta.windowMinutes).toBe(180)
    expect(proposal.meta.focusMinutesTotal).toBe(145)
    expect(proposal.meta.breakMinutesTotal).toBe(35)

    const kinds = proposal.blocks.map((b) => b.kind)
    expect(kinds).toEqual([
      'focus',
      'short_break',
      'focus',
      'short_break',
      'focus',
      'short_break',
      'focus',
      'long_break',
      'focus',
      'short_break',
      'focus'
    ])

    const last = proposal.blocks[proposal.blocks.length - 1]
    expect(last.kind).toBe('focus')
    expect(blockMinutes(last)).toBe(20)
    expect(last.endAtMs).toBe(window0900to1200().endAtMs)

    // No block past hard end
    for (const block of proposal.blocks) {
      expect(block.endAtMs).toBeLessThanOrEqual(window0900to1200().endAtMs)
      expect(block.endAtMs).toBeGreaterThan(block.startAtMs)
    }

    // Ordered non-overlapping
    for (let i = 1; i < proposal.blocks.length; i += 1) {
      expect(proposal.blocks[i].startAtMs).toBeGreaterThanOrEqual(proposal.blocks[i - 1].endAtMs)
    }

    // Task attribution present on focus blocks
    const focusTaskIds = proposal.blocks.filter((b) => b.kind === 'focus').map((b) => b.taskId)
    expect(focusTaskIds.every((id) => id === 'A' || id === 'B' || id === 'C')).toBe(true)

    expect(timeline(proposal.blocks)[0]).toBe('09:00-09:25 focus:A')
    expect(timeline(proposal.blocks).at(-1)).toMatch(/^11:40-12:00 focus:/)
  })

  it('complete_cycles leaves remainder blank/wrap instead of shortening focus', () => {
    const plan = createClassicPomodoroPlan({
      windowFillPolicy: 'complete_cycles',
      id: 'cc'
    })
    const proposal = allocateTimeWindow({
      window: window0900to1200(),
      plan,
      tasks: [{ id: 'T', estimateMinutes: null, manualOrder: 0 }]
    })

    expect(proposal.meta.policy).toBe('complete_cycles')
    // No shortened focus: every focus is 25
    const focuses = proposal.blocks.filter((b) => b.kind === 'focus')
    expect(focuses.every((b) => blockMinutes(b) === 25)).toBe(true)
    expect(proposal.blocks.some((b) => b.kind === 'blank' || b.kind === 'wrap_up')).toBe(true)
    expect(proposal.warnings.some((w) => w.includes('remainder') || w.includes('complete_cycles'))).toBe(true)
  })

  it('respects locked blocks and does not overlap free allocation into them', () => {
    const plan = createClassicPomodoroPlan()
    const lockStart = msFromLocalMinutes(day, 10 * 60)
    const lockEnd = msFromLocalMinutes(day, 10 * 60 + 30)
    const proposal = allocateTimeWindow({
      window: window0900to1200(),
      plan,
      tasks: [{ id: 'A', manualOrder: 0 }],
      lockedBlocks: [
        {
          id: 'lock-1',
          taskId: 'LOCKED',
          kind: 'focus',
          startAtMs: lockStart,
          endAtMs: lockEnd
        }
      ]
    })

    const locked = proposal.blocks.filter((b) => b.locked)
    expect(locked).toHaveLength(1)
    expect(locked[0].taskId).toBe('LOCKED')

    for (const block of proposal.blocks) {
      if (block.locked) continue
      const overlap = block.startAtMs < lockEnd && lockStart < block.endAtMs
      expect(overlap).toBe(false)
    }
  })

  it('warns when window is too short for a focus segment', () => {
    const plan = createClassicPomodoroPlan()
    const proposal = allocateTimeWindow({
      window: {
        startAtMs: msFromLocalMinutes(day, 9 * 60),
        endAtMs: msFromLocalMinutes(day, 9 * 60 + 10),
        hardEnd: true
      },
      plan,
      tasks: [{ id: 'A' }]
    })
    expect(proposal.warnings).toContain('window_too_short_for_focus')
    // 10 < minFinal 15 → blank/wrap only
    expect(proposal.blocks.every((b) => b.kind === 'blank' || b.kind === 'wrap_up')).toBe(true)
  })

  it('does not invent estimateMinutes for tasks (freeze #8)', () => {
    const plan = createClassicPomodoroPlan()
    const proposal = allocateTimeWindow({
      window: {
        startAtMs: msFromLocalMinutes(day, 9 * 60),
        endAtMs: msFromLocalMinutes(day, 9 * 60 + 25),
        hardEnd: true
      },
      plan,
      tasks: [{ id: 'open', estimateMinutes: null }]
    })
    const focus = proposal.blocks.find((b) => b.kind === 'focus')
    expect(focus?.taskId).toBe('open')
    // Still unscheduled? remaining null with placement → not unscheduled
    expect(proposal.unscheduledTaskIds).not.toContain('open')
  })

  it('is deterministic for identical inputs', () => {
    const plan = createClassicPomodoroPlan()
    const input = {
      window: window0900to1200(),
      plan,
      tasks: [
        { id: 'A', estimateMinutes: 40, priority: 'high' as const },
        { id: 'B', estimateMinutes: 40, priority: 'normal' as const }
      ],
      nowMs: day
    }
    const a = allocateTimeWindow(input)
    const b = allocateTimeWindow(input)
    expect(a).toEqual(b)
  })

  it('reports invalid window without throwing', () => {
    const proposal = allocateTimeWindow({
      window: { startAtMs: 100, endAtMs: 50, hardEnd: true },
      plan: createClassicPomodoroPlan()
    })
    expect(proposal.blocks).toEqual([])
    expect(proposal.warnings).toContain('window_invalid')
  })

  it('fills deep 50/10 rhythm for a 3h window', () => {
    const plan = normalizeTimerPlanV2({
      id: 'deep_50_10',
      name: '深度 50/10',
      kind: 'pomodoro',
      clockMode: 'countdown',
      focusMinutes: 50,
      shortBreakMinutes: 10,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      breakPolicy: 'ask',
      windowFillPolicy: 'adaptive_final_focus'
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const proposal = allocateTimeWindow({
      window: window0900to1200(),
      plan: plan.plan,
      tasks: [{ id: 'D', estimateMinutes: null }]
    })

    const focuses = proposal.blocks.filter((b) => b.kind === 'focus')
    expect(focuses.length).toBeGreaterThanOrEqual(2)
    expect(focuses.every((b) => blockMinutes(b) === 50 || blockMinutes(b) >= 15)).toBe(true)
    expect(proposal.blocks.some((b) => b.kind === 'short_break' && blockMinutes(b) === 10)).toBe(true)
    for (const block of proposal.blocks) {
      expect(block.endAtMs).toBeLessThanOrEqual(window0900to1200().endAtMs)
    }
  })

  it('places long break every N focus rounds (2 and 3)', () => {
    for (const every of [2, 3] as const) {
      const plan = createClassicPomodoroPlan({
        id: `long-every-${every}`,
        longBreakEvery: every,
        windowFillPolicy: 'complete_cycles'
      })
      const proposal = allocateTimeWindow({
        window: window0900to1200(),
        plan,
        tasks: [{ id: 'T', estimateMinutes: null }]
      })
      const kinds = proposal.blocks.map((b) => b.kind)
      let focusCount = 0
      for (const kind of kinds) {
        if (kind === 'focus') {
          focusCount += 1
        } else if (kind === 'long_break') {
          expect(focusCount % every).toBe(0)
        }
      }
      expect(kinds.filter((k) => k === 'long_break').length).toBeGreaterThan(0)
    }
  })

  it('continuous kind fills free gaps as focus without pomodoro breaks', () => {
    const plan = normalizeTimerPlanV2({
      id: 'continuous_countup',
      name: '连续专注',
      kind: 'continuous',
      clockMode: 'countup',
      breakPolicy: 'reminder_only'
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const proposal = allocateTimeWindow({
      window: window0900to1200(),
      plan: plan.plan,
      tasks: [{ id: 'flow', estimateMinutes: 180 }]
    })

    expect(proposal.blocks.every((b) => b.kind === 'focus' || b.kind === 'blank')).toBe(true)
    expect(proposal.blocks.some((b) => b.kind === 'short_break' || b.kind === 'long_break')).toBe(false)
    expect(proposal.meta.focusMinutesTotal).toBe(180)
  })

  it('skips non-splittable task when focus segment cannot fit remaining estimate', () => {
    const plan = createClassicPomodoroPlan()
    const proposal = allocateTimeWindow({
      window: {
        startAtMs: msFromLocalMinutes(day, 9 * 60),
        endAtMs: msFromLocalMinutes(day, 9 * 60 + 25),
        hardEnd: true
      },
      plan,
      tasks: [
        {
          id: 'big',
          estimateMinutes: 40,
          splittable: false,
          manualOrder: 0
        },
        {
          id: 'small',
          estimateMinutes: 25,
          splittable: true,
          manualOrder: 1
        }
      ]
    })

    const focusIds = proposal.blocks.filter((b) => b.kind === 'focus').map((b) => b.taskId)
    expect(focusIds).toContain('small')
    expect(focusIds).not.toContain('big')
    expect(proposal.unscheduledTaskIds).toContain('big')
    expect(proposal.warnings.some((w) => w.startsWith('unscheduled_tasks:'))).toBe(true)
  })

  it('honors minimumBlockMinutes when remainder would be too small', () => {
    const plan = createClassicPomodoroPlan({ focusMinutes: 25 })
    // 40m window: 25 focus + 5 break + 10 left (< minBlock 15 for second placement of same task with estimate)
    const proposal = allocateTimeWindow({
      window: {
        startAtMs: msFromLocalMinutes(day, 9 * 60),
        endAtMs: msFromLocalMinutes(day, 9 * 60 + 40),
        hardEnd: true
      },
      plan,
      tasks: [
        {
          id: 'A',
          estimateMinutes: 50,
          minimumBlockMinutes: 15,
          splittable: true
        }
      ]
    })

    for (const block of proposal.blocks.filter((b) => b.kind === 'focus' && b.taskId === 'A')) {
      expect(blockMinutes(block)).toBeGreaterThanOrEqual(15)
    }
  })

  it('warns on overlapping locked blocks without throwing', () => {
    const plan = createClassicPomodoroPlan()
    const aStart = msFromLocalMinutes(day, 10 * 60)
    const aEnd = msFromLocalMinutes(day, 10 * 60 + 40)
    const bStart = msFromLocalMinutes(day, 10 * 60 + 20)
    const bEnd = msFromLocalMinutes(day, 11 * 60)
    const proposal = allocateTimeWindow({
      window: window0900to1200(),
      plan,
      lockedBlocks: [
        { id: 'L1', taskId: 'X', kind: 'focus', startAtMs: aStart, endAtMs: aEnd },
        { id: 'L2', taskId: 'Y', kind: 'focus', startAtMs: bStart, endAtMs: bEnd }
      ]
    })
    expect(proposal.warnings.some((w) => w.startsWith('locked_overlap:'))).toBe(true)
  })

  it('emits remainder_below_minimum_final_focus when tail is short', () => {
    const plan = createClassicPomodoroPlan({
      focusMinutes: 25,
      shortBreakMinutes: 10,
      longBreakEvery: 8,
      minimumFinalFocusMinutes: 15,
      wrapUpMinutes: 5
    })
    // 33m: one 25 focus, 8 left (< short break 10 and < minFinal 15) → wrap/blank + warning
    const proposal = allocateTimeWindow({
      window: {
        startAtMs: msFromLocalMinutes(day, 9 * 60),
        endAtMs: msFromLocalMinutes(day, 9 * 60 + 33),
        hardEnd: true
      },
      plan,
      tasks: [{ id: 'A', estimateMinutes: null }]
    })
    expect(proposal.warnings).toContain('remainder_below_minimum_final_focus')
    expect(proposal.blocks.some((b) => b.kind === 'wrap_up' || b.kind === 'blank')).toBe(true)
  })
})

describe('ScheduleBlock model (STC-108)', () => {
  it('validateScheduleBlocks accepts ordered non-overlapping locked blocks', () => {
    const blocks: ScheduleBlock[] = [
      {
        id: 'b1',
        taskId: 't1',
        kind: 'focus',
        startAtMs: day,
        endAtMs: day + 25 * 60_000,
        locked: true,
        source: 'manual',
        status: 'planned',
        revision: 1
      },
      {
        id: 'b2',
        taskId: null,
        kind: 'short_break',
        startAtMs: day + 25 * 60_000,
        endAtMs: day + 30 * 60_000,
        locked: false,
        source: 'allocator',
        status: 'planned',
        revision: 1
      }
    ]
    const result = validateScheduleBlocks(blocks)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('validateScheduleBlocks rejects invalid interval and locked overlap', () => {
    const badInterval: ScheduleBlock = {
      id: 'bad',
      taskId: 't',
      kind: 'focus',
      startAtMs: day + 10_000,
      endAtMs: day,
      locked: false,
      source: 'manual',
      status: 'planned',
      revision: 1
    }
    expect(isValidScheduleBlockInterval(badInterval)).toBe(false)
    const intervalResult = validateScheduleBlocks([badInterval])
    expect(intervalResult.ok).toBe(false)
    expect(intervalResult.issues.some((i) => i.code === 'block_interval_invalid')).toBe(true)

    const a: ScheduleBlock = {
      id: 'a',
      taskId: 't1',
      kind: 'focus',
      startAtMs: day,
      endAtMs: day + 40 * 60_000,
      locked: true,
      source: 'manual',
      status: 'planned',
      revision: 1
    }
    const b: ScheduleBlock = {
      id: 'b',
      taskId: 't2',
      kind: 'focus',
      startAtMs: day + 20 * 60_000,
      endAtMs: day + 50 * 60_000,
      locked: true,
      source: 'manual',
      status: 'planned',
      revision: 1
    }
    const overlapResult = validateScheduleBlocks([a, b])
    expect(overlapResult.ok).toBe(false)
    expect(overlapResult.issues.some((i) => i.code === 'locked_blocks_overlap')).toBe(true)
  })

  it('proposalBlocksToScheduleBlocks drops blank and maps focus/breaks (Task 1:N)', () => {
    const plan = createClassicPomodoroPlan()
    const proposal = allocateTimeWindow({
      window: {
        startAtMs: msFromLocalMinutes(day, 9 * 60),
        endAtMs: msFromLocalMinutes(day, 9 * 60 + 60),
        hardEnd: true
      },
      plan,
      tasks: [
        { id: 'T1', estimateMinutes: 25 },
        { id: 'T2', estimateMinutes: 25 }
      ]
    })
    const blocks = proposalBlocksToScheduleBlocks({
      blocks: proposal.blocks,
      planId: plan.id,
      planRevision: plan.revision,
      idPrefix: 'prop'
    })
    expect(blocks.every((b) => b.kind !== ('blank' as ScheduleBlock['kind']))).toBe(true)
    expect(blocks.every((b) => b.status === 'planned')).toBe(true)
    const taskIds = new Set(blocks.filter((b) => b.taskId).map((b) => b.taskId))
    // Same conversion can attach multiple blocks; task set size is from proposal attribution.
    expect(taskIds.size).toBeGreaterThanOrEqual(1)
    expect(blocks.every((b) => b.planId === plan.id)).toBe(true)
  })
})

describe('migrateStudyV1ToPlanning dry-run (STC-108)', () => {
  const weekAnchor = Date.UTC(2026, 6, 20) // Monday 2026-07-20 UTC midnight

  it('maps tasks, single schedule → one ScheduleBlock, plans with long-break default report', () => {
    const result = migrateStudyV1ToPlanning(
      {
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
            title: '无类别',
            done: true
          }
        ],
        timerPlans: [
          {
            id: 'v1-plan',
            name: '旧方案',
            focusMinutes: 25,
            breakMinutes: 5,
            simulationStartTime: '09:00',
            simulationEndTime: '12:00'
          }
        ],
        simulationStartTime: '14:00',
        simulationEndTime: '16:00'
      },
      { weekAnchorMidnightMs: weekAnchor }
    )

    expect(result.dryRun).toBe(true)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0]).toMatchObject({
      id: 'task-1',
      title: '读论文',
      status: 'open',
      categoryId: 'study',
      inbox: false,
      estimateMinutes: null,
      source: 'migrated_v1'
    })
    expect(result.tasks[1]).toMatchObject({
      id: 'task-2',
      status: 'done',
      categoryId: null,
      inbox: true
    })

    expect(result.scheduleBlocks).toHaveLength(1)
    expect(result.scheduleBlocks[0]).toMatchObject({
      taskId: 'task-1',
      kind: 'focus',
      locked: true,
      source: 'migrated_v1'
    })
    expect(result.scheduleBlocks[0].endAtMs).toBeGreaterThan(result.scheduleBlocks[0].startAtMs)

    expect(result.timerPlans).toHaveLength(1)
    expect(result.timerPlans[0].longBreakMinutes).toBe(15)
    expect(result.timerPlans[0].longBreakEvery).toBe(4)
    expect(result.report.some((e) => e.code === 'plan_long_break_defaulted')).toBe(true)
    expect(result.report.some((e) => e.code === 'task_inbox_projected')).toBe(true)
    expect(result.report.some((e) => e.code === 'migration_dry_run')).toBe(true)

    expect(result.suggestedWindows.some((w) => w.source === 'plan_simulation')).toBe(true)
    expect(result.suggestedWindows.some((w) => w.source === 'snapshot_simulation')).toBe(true)
  })

  it('reports schedule without materializing when week anchor missing', () => {
    const result = migrateStudyV1ToPlanning({
      tasks: [
        {
          id: 't',
          title: 'x',
          schedule: { weekday: 2, startMinutes: 60, endMinutes: 120 }
        }
      ]
    })
    expect(result.scheduleBlocks).toEqual([])
    expect(result.report.some((e) => e.code === 'schedule_needs_week_anchor')).toBe(true)
  })

  it('v1ScheduleToIntervalMs rejects inverted intervals', () => {
    expect(
      v1ScheduleToIntervalMs({
        weekday: 1,
        startMinutes: 120,
        endMinutes: 60,
        weekAnchorMidnightMs: weekAnchor
      })
    ).toBeNull()
  })

  it('fail-closed on non-object snapshot and drops bad tasks', () => {
    const bad = migrateStudyV1ToPlanning(null)
    expect(bad.tasks).toEqual([])
    expect(bad.report.some((e) => e.code === 'snapshot_not_object')).toBe(true)

    const partial = migrateStudyV1ToPlanning({
      tasks: [{ id: '', title: '' }, { id: 'ok', title: 'OK' }]
    })
    expect(partial.tasks.map((t) => t.id)).toEqual(['ok'])
    expect(partial.report.some((e) => e.code === 'task_identity_missing')).toBe(true)
  })
})
