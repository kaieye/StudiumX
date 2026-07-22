import { describe, expect, it, vi } from 'vitest'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  buildCopyTimerPlanCommand,
  buildDeleteTimerPlanCommand,
  buildSaveTimerPlanCommand,
  dualWriteDeleteTimerPlan,
  dualWriteSaveTimerPlan,
  v1TimerPlanToV2,
  v2TimerPlanToV1
} from '../../src/renderer/src/study-space/planning-timer-plan-dual-write'
import { createClassicPomodoroPlan } from '../../src/shared/study-planning'
import type { StudyTimerPlan } from '../../src/renderer/src/study-space/types'

const sampleV1: StudyTimerPlan = {
  id: 'plan-user-1',
  name: 'My 30/8',
  focusMinutes: 30,
  breakMinutes: 8,
  simulationStartTime: '09:00',
  simulationEndTime: '12:00'
}

function mockApi(options?: {
  revision?: number
  onApply?: (payload: unknown) => void
}): StudyPlanningApi {
  let revision = options?.revision ?? 1
  let snapshot = {
    schemaVersion: 1 as const,
    revision,
    updatedAtMs: 0,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [] as ReturnType<typeof createClassicPomodoroPlan>[],
    timerSessions: [],
    preferences: {},
    localAnalyticsHints: {}
  }
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    })),
    applyStudyPlanning: vi.fn(async (payload) => {
      options?.onApply?.(payload)
      revision += 1
      snapshot = { ...snapshot, revision }
      return {
        ok: true as const,
        revision,
        snapshot,
        effects: []
      }
    })
  }
}

describe('timer plan dual-write mapping', () => {
  it('v1TimerPlanToV2 maps focus/break into TimerPlanV2 shell', () => {
    const v2 = v1TimerPlanToV2(sampleV1)
    expect(v2.id).toBe('plan-user-1')
    expect(v2.name).toBe('My 30/8')
    expect(v2.focusMinutes).toBe(30)
    expect(v2.shortBreakMinutes).toBe(8)
    expect(v2.kind).toBe('pomodoro')
    expect(v2.revision).toBeGreaterThanOrEqual(1)
  })

  it('v2TimerPlanToV1 keeps simulation window as UI cache fields', () => {
    const v2 = createClassicPomodoroPlan({
      id: 'x',
      name: 'X',
      focusMinutes: 40,
      shortBreakMinutes: 7
    })
    const v1 = v2TimerPlanToV1(v2, {
      simulationStartTime: '10:00',
      simulationEndTime: '13:00'
    })
    expect(v1).toMatchObject({
      id: 'x',
      name: 'X',
      focusMinutes: 40,
      breakMinutes: 7,
      simulationStartTime: '10:00',
      simulationEndTime: '13:00'
    })
  })

  it('v1TimerPlanToV2 maps long break and breakPolicy', () => {
    const v2 = v1TimerPlanToV2({
      ...sampleV1,
      longBreakMinutes: 20,
      longBreakEvery: 3,
      breakPolicy: 'automatic'
    })
    expect(v2.longBreakMinutes).toBe(20)
    expect(v2.longBreakEvery).toBe(3)
    expect(v2.breakPolicy).toBe('automatic')
  })

  it('v1TimerPlanToV2 coerces none breakPolicy to ask for pomodoro', () => {
    const v2 = v1TimerPlanToV2({
      ...sampleV1,
      breakPolicy: 'none'
    })
    expect(v2.breakPolicy).toBe('ask')
  })

  it('v2TimerPlanToV1 projects advanced fields for hydrate sole-read', () => {
    const v2 = createClassicPomodoroPlan({
      id: 'x',
      name: 'X',
      focusMinutes: 40,
      shortBreakMinutes: 7,
      longBreakMinutes: 18,
      longBreakEvery: 5,
      breakPolicy: 'automatic'
    })
    const v1 = v2TimerPlanToV1(v2, {
      simulationStartTime: '10:00',
      simulationEndTime: '13:00'
    })
    expect(v1).toMatchObject({
      longBreakMinutes: 18,
      longBreakEvery: 5,
      breakPolicy: 'automatic'
    })
  })

  it('round-trips advanced fields V1 → V2 → V1', () => {
    const original = {
      ...sampleV1,
      longBreakMinutes: 22,
      longBreakEvery: 6,
      breakPolicy: 'ask' as const
    }
    const back = v2TimerPlanToV1(v1TimerPlanToV2(original), {
      simulationStartTime: original.simulationStartTime,
      simulationEndTime: original.simulationEndTime
    })
    expect(back).toMatchObject({
      id: original.id,
      name: original.name,
      focusMinutes: 30,
      breakMinutes: 8,
      longBreakMinutes: 22,
      longBreakEvery: 6,
      breakPolicy: 'ask',
      simulationStartTime: '09:00',
      simulationEndTime: '12:00'
    })
  })


  it('v1TimerPlanToV2 projects continuous open countup and preserves freeze #6 policies', () => {
    const open: StudyTimerPlan = {
      id: 'cont-open',
      name: 'Open cont',
      focusMinutes: 25,
      breakMinutes: 0,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: false,
      breakPolicy: 'none'
    }
    const v2 = v1TimerPlanToV2(open)
    expect(v2.kind).toBe('continuous')
    expect(v2.clockMode).toBe('countup')
    expect(v2.focusMinutes).toBeUndefined()
    expect(v2.breakPolicy).toBe('none')

    const reminder = v1TimerPlanToV2({ ...open, breakPolicy: 'reminder_only' })
    expect(reminder.breakPolicy).toBe('reminder_only')
  })

  it('v1TimerPlanToV2 projects continuous target countup', () => {
    const v2 = v1TimerPlanToV2({
      id: 'cont-t',
      name: 'Target cont',
      focusMinutes: 120,
      breakMinutes: 0,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: true,
      breakPolicy: 'ask'
    })
    expect(v2.focusMinutes).toBe(120)
    expect(v2.kind).toBe('continuous')
  })

  it('round-trips continuous open V1 → V2 → V1', () => {
    const original: StudyTimerPlan = {
      id: 'cont-rt',
      name: '连续',
      focusMinutes: 25,
      breakMinutes: 0,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: false,
      breakPolicy: 'reminder_only'
    }
    const back = v2TimerPlanToV1(v1TimerPlanToV2(original), {
      simulationStartTime: original.simulationStartTime,
      simulationEndTime: original.simulationEndTime
    })
    expect(back).toMatchObject({
      id: 'cont-rt',
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: false,
      breakPolicy: 'reminder_only'
    })
  })

  it('builds save/delete/copy command envelopes', () => {
    const v2 = v1TimerPlanToV2(sampleV1)
    const save = buildSaveTimerPlanCommand(v2, 'a1', 1)
    expect(save.type).toBe('save_timer_plan')
    expect(save.payload).toEqual({ plan: v2 })
    const del = buildDeleteTimerPlanCommand('plan-user-1', 'a2', 2)
    expect(del).toMatchObject({
      type: 'delete_timer_plan',
      payload: { planId: 'plan-user-1' }
    })
    const copy = buildCopyTimerPlanCommand(
      { sourceId: 'classic_25_5', newId: 'c1', newName: 'Copy' },
      'a3',
      3
    )
    expect(copy).toMatchObject({
      type: 'copy_timer_plan',
      payload: { sourceId: 'classic_25_5', newId: 'c1', newName: 'Copy' }
    })
  })
})

describe('dualWriteSaveTimerPlan / dualWriteDeleteTimerPlan', () => {
  it('skips without workspace', async () => {
    const r = await dualWriteSaveTimerPlan({ workspaceRoot: null, api: null }, sampleV1)
    expect(r.kind).toBe('canonical_skipped')
  })

  it('saves with CAS expectedRevision', async () => {
    const seen: unknown[] = []
    const api = mockApi({ onApply: (p) => seen.push(p) })
    const r = await dualWriteSaveTimerPlan(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 1000 },
      sampleV1
    )
    expect(r.kind).toBe('canonical_ok')
    expect(seen[0]).toMatchObject({
      workspaceRoot: 'D:/ws',
      expectedRevision: 1,
      command: {
        type: 'save_timer_plan',
        payload: {
          plan: {
            id: 'plan-user-1',
            name: 'My 30/8',
            focusMinutes: 30,
            shortBreakMinutes: 8,
            longBreakMinutes: 15,
            longBreakEvery: 4,
            breakPolicy: 'ask'
          }
        }
      }
    })
  })

  it('deletes with planId payload', async () => {
    const seen: unknown[] = []
    const api = mockApi({ revision: 3, onApply: (p) => seen.push(p) })
    const r = await dualWriteDeleteTimerPlan(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 2000 },
      'plan-user-1'
    )
    expect(r.kind).toBe('canonical_ok')
    expect(seen[0]).toMatchObject({
      expectedRevision: 3,
      command: {
        type: 'delete_timer_plan',
        payload: { planId: 'plan-user-1' }
      }
    })
  })
})
