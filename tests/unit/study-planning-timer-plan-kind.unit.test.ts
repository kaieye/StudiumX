import { describe, expect, it } from 'vitest'
import {
  createContinuousCountupPlan,
  createClassicPomodoroPlan
} from '../../src/shared/study-planning'
import {
  formatTimerPlanKindSummary,
  isOpenContinuousPlanV2,
  isValidContinuousPlanDraft,
  normalizeTimerPlanKindFields,
  projectV1TimerPlanToV2,
  projectV2TimerPlanToV1,
  resolvePlanV2ForStart,
  resolveStartTargetSeconds
} from '../../src/renderer/src/study-space/planning-timer-plan-kind'
import type { StudyTimerPlan } from '../../src/renderer/src/study-space/types'

const window = {
  simulationStartTime: '09:00',
  simulationEndTime: '12:00'
}

describe('normalizeTimerPlanKindFields', () => {
  it('defaults missing to pomodoro countdown', () => {
    expect(normalizeTimerPlanKindFields({})).toMatchObject({
      kind: 'pomodoro',
      clockMode: 'countdown'
    })
  })

  it('defaults continuous without clock to countup', () => {
    expect(normalizeTimerPlanKindFields({ kind: 'continuous' })).toMatchObject({
      kind: 'continuous',
      clockMode: 'countup'
    })
  })

  it('allows pomodoro + countup (product 正计时 toggle)', () => {
    const r = normalizeTimerPlanKindFields({ kind: 'pomodoro', clockMode: 'countup' })
    expect(r.clockMode).toBe('countup')
    expect(r.warnings).toHaveLength(0)
  })

  it('coerces custom_rhythm + countup to countdown', () => {
    const r = normalizeTimerPlanKindFields({ kind: 'custom_rhythm', clockMode: 'countup' })
    expect(r.clockMode).toBe('countdown')
    expect(r.warnings.some((w) => w.code === 'custom_rhythm_clock_mode_coerced')).toBe(true)
  })
})

describe('project continuous open / target', () => {
  it('projects open continuous countup without focusMinutes', () => {
    const v1: StudyTimerPlan = {
      id: 'cont-open',
      name: 'Open',
      focusMinutes: 25,
      breakMinutes: 0,
      ...window,
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: false,
      breakPolicy: 'reminder_only'
    }
    const v2 = projectV1TimerPlanToV2(v1)
    expect(v2.kind).toBe('continuous')
    expect(v2.clockMode).toBe('countup')
    expect(v2.focusMinutes).toBeUndefined()
    expect(v2.breakPolicy).toBe('reminder_only')
    expect(isOpenContinuousPlanV2(v2)).toBe(true)
    expect(resolveStartTargetSeconds(v2)).toBeNull()
  })

  it('projects target continuous with focusMinutes', () => {
    const v1: StudyTimerPlan = {
      id: 'cont-target',
      name: 'Target',
      focusMinutes: 90,
      breakMinutes: 0,
      ...window,
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: true,
      breakPolicy: 'none'
    }
    const v2 = projectV1TimerPlanToV2(v1)
    expect(v2.focusMinutes).toBe(90)
    expect(v2.breakPolicy).toBe('none')
    expect(isOpenContinuousPlanV2(v2)).toBe(false)
    expect(resolveStartTargetSeconds(v2)).toBe(90 * 60)
  })

  it('preserves freeze #6 continuous none and reminder_only (no pomodoro coerce)', () => {
    for (const policy of ['none', 'reminder_only', 'ask', 'automatic'] as const) {
      const v2 = projectV1TimerPlanToV2({
        id: `c-${policy}`,
        name: policy,
        focusMinutes: 25,
        breakMinutes: 0,
        ...window,
        kind: 'continuous',
        clockMode: 'countup',
        continuousTarget: false,
        breakPolicy: policy
      })
      expect(v2.breakPolicy).toBe(policy)
    }
  })

  it('round-trips open continuous V1 → V2 → V1', () => {
    const original: StudyTimerPlan = {
      id: 'cont-rt',
      name: '连续',
      focusMinutes: 25,
      breakMinutes: 0,
      ...window,
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: false,
      breakPolicy: 'reminder_only'
    }
    const back = projectV2TimerPlanToV1(projectV1TimerPlanToV2(original), window)
    expect(back).toMatchObject({
      id: 'cont-rt',
      name: '连续',
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: false,
      breakPolicy: 'reminder_only'
    })
  })

  it('round-trips target continuous V1 → V2 → V1', () => {
    const original: StudyTimerPlan = {
      id: 'cont-rt-t',
      name: '目标',
      focusMinutes: 120,
      breakMinutes: 5,
      ...window,
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: true,
      breakPolicy: 'ask'
    }
    const back = projectV2TimerPlanToV1(projectV1TimerPlanToV2(original), window)
    expect(back).toMatchObject({
      id: 'cont-rt-t',
      kind: 'continuous',
      continuousTarget: true,
      focusMinutes: 120,
      breakPolicy: 'ask'
    })
  })
})


  it('does not label continuous cycle countdown as exam (countup toggle off)', () => {
    const original: StudyTimerPlan = {
      id: 'cont-cycle-cd',
      name: 'cycle-cd',
      focusMinutes: 50,
      breakMinutes: 10,
      ...window,
      kind: 'continuous',
      clockMode: 'countdown',
      continuousTarget: false,
      breakPolicy: 'ask'
    }
    const v2 = projectV1TimerPlanToV2(original)
    expect(v2.kind).toBe('continuous')
    expect(v2.clockMode).toBe('countdown')
    expect(v2.focusMinutes).toBe(50)
    const back = projectV2TimerPlanToV1(v2, window)
    expect(back).toMatchObject({
      id: 'cont-cycle-cd',
      kind: 'continuous',
      clockMode: 'countdown',
      continuousTarget: false,
      focusMinutes: 50,
      breakMinutes: 10
    })
    expect(resolvePlanV2ForStart({ planId: original.id, userPlans: [original] }).clockMode).toBe(
      'countdown'
    )
  })

  it('keeps pomodoro countdown after countup toggle off (resolve for start)', () => {
    const original: StudyTimerPlan = {
      id: 'pomo-cd',
      name: 'pomo-cd',
      focusMinutes: 25,
      breakMinutes: 5,
      ...window,
      kind: 'pomodoro',
      clockMode: 'countdown'
    }
    const v2 = projectV1TimerPlanToV2(original)
    expect(v2.clockMode).toBe('countdown')
    expect(projectV2TimerPlanToV1(v2, window).clockMode).toBe('countdown')
    expect(resolvePlanV2ForStart({ planId: original.id, userPlans: [original] }).clockMode).toBe(
      'countdown'
    )
  })

describe('formatTimerPlanKindSummary', () => {
  it('labels open continuous', () => {
    expect(
      formatTimerPlanKindSummary({
        kind: 'continuous',
        clockMode: 'countup',
        focusMinutes: 25,
        breakMinutes: 0,
        continuousTarget: false
      })
    ).toBe('连续专注 · 正计时')
  })

  it('labels target continuous', () => {
    expect(
      formatTimerPlanKindSummary({
        kind: 'continuous',
        clockMode: 'countup',
        focusMinutes: 90,
        breakMinutes: 0,
        continuousTarget: true
      })
    ).toBe('连续专注 · 目标 90 分钟')
  })

  it('labels pomodoro focus/break', () => {
    expect(
      formatTimerPlanKindSummary({
        focusMinutes: 25,
        breakMinutes: 5
      })
    ).toBe('25 / 5 分钟')
  })
})

describe('resolvePlanV2ForStart / createContinuousCountupPlan', () => {
  it('resolves continuous_countup builtin', () => {
    const plan = resolvePlanV2ForStart({ planId: 'continuous_countup' })
    expect(plan.id).toBe('continuous_countup')
    expect(plan.kind).toBe('continuous')
    expect(plan.clockMode).toBe('countup')
    expect(plan.focusMinutes).toBeUndefined()
    expect(resolveStartTargetSeconds(plan)).toBeNull()
  })

  it('resolves user continuous plan from V1 cache', () => {
    const plan = resolvePlanV2ForStart({
      planId: 'u1',
      userPlans: [
        {
          id: 'u1',
          name: 'U',
          focusMinutes: 60,
          breakMinutes: 0,
          ...window,
          kind: 'continuous',
          clockMode: 'countup',
          continuousTarget: true,
          breakPolicy: 'none'
        }
      ]
    })
    expect(plan.focusMinutes).toBe(60)
    expect(plan.breakPolicy).toBe('none')
  })

  it('createContinuousCountupPlan clones seed', () => {
    const plan = createContinuousCountupPlan({ id: 'x', name: 'X' })
    expect(plan.kind).toBe('continuous')
    expect(plan.clockMode).toBe('countup')
    expect(plan.id).toBe('x')
    expect(plan.name).toBe('X')
  })

  it('pomodoro path still coerces none via project', () => {
    const v2 = projectV1TimerPlanToV2({
      id: 'p1',
      name: 'P',
      focusMinutes: 25,
      breakMinutes: 5,
      ...window,
      breakPolicy: 'none'
    })
    expect(v2.kind).toBe('pomodoro')
    expect(v2.breakPolicy).toBe('ask')
    expect(createClassicPomodoroPlan().kind).toBe('pomodoro')
  })
})

describe('isValidContinuousPlanDraft', () => {
  it('requires focus + total minutes for continuous cycle', () => {
    expect(
      isValidContinuousPlanDraft({
        name: 'A',
        continuousTarget: false,
        breakPolicy: 'reminder_only',
        focusMinutes: 25,
        breakMinutes: 5,
        totalMinutes: 120
      })
    ).toBe(true)
    expect(
      isValidContinuousPlanDraft({
        name: 'A',
        continuousTarget: false,
        breakPolicy: 'reminder_only',
        simulationStartTime: '09:00',
        simulationEndTime: '12:00'
      })
    ).toBe(false)
  })

  it('requires total minutes for exam continuous (no separate focus field)', () => {
    expect(
      isValidContinuousPlanDraft({
        name: 'A',
        continuousTarget: true,
        focusMinutes: null,
        breakPolicy: 'none'
      })
    ).toBe(false)
    expect(
      isValidContinuousPlanDraft({
        name: 'A',
        continuousTarget: true,
        breakPolicy: 'none',
        totalMinutes: 180
      })
    ).toBe(true)
    expect(
      isValidContinuousPlanDraft({
        name: 'A',
        continuousTarget: true,
        breakPolicy: 'none',
        simulationStartTime: '09:00',
        simulationEndTime: '12:00'
      })
    ).toBe(true)
  })
})
