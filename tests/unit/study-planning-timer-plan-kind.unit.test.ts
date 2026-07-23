import { describe, expect, it } from 'vitest'
import {
  createContinuousCountupPlan,
  createExamSimulationPlan,
  createOpenContinuousPlan,
  createTargetContinuousPlan,
  createClassicPomodoroPlan
} from '../../src/shared/study-planning'
import {
  continuousModeFromV1,
  formatTimerPlanKindSummary,
  isExamContinuousPlan,
  timerPlanKindToUi,
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
      continuousMode: 'open',
      continuousTarget: false,
      breakPolicy: 'reminder_only'
    }
    const v2 = projectV1TimerPlanToV2(v1)
    expect(v2.kind).toBe('continuous')
    expect(v2.clockMode).toBe('countup')
    expect(v2.continuousMode).toBe('open')
    expect(v2.focusMinutes).toBeUndefined()
    expect(v2.breakPolicy).toBe('reminder_only')
    expect(isOpenContinuousPlanV2(v2)).toBe(true)
    expect(resolveStartTargetSeconds(v2)).toBeNull()
  })

  it('projects target continuous with focusMinutes (not exam via continuousTarget alone)', () => {
    const v1: StudyTimerPlan = {
      id: 'cont-target',
      name: 'Target',
      focusMinutes: 90,
      breakMinutes: 0,
      ...window,
      kind: 'continuous',
      clockMode: 'countup',
      continuousMode: 'target',
      continuousTarget: false,
      breakPolicy: 'none'
    }
    const v2 = projectV1TimerPlanToV2(v1)
    expect(v2.focusMinutes).toBe(90)
    expect(v2.continuousMode).toBe('target')
    expect(v2.breakPolicy).toBe('none')
    expect(isOpenContinuousPlanV2(v2)).toBe(false)
    expect(resolveStartTargetSeconds(v2)).toBe(90 * 60)
  })

  it('legacy: continuous + countup + focus + continuousTarget false is target not open', () => {
    const v1: StudyTimerPlan = {
      id: 'legacy-target',
      name: 'Legacy target',
      focusMinutes: 90,
      breakMinutes: 0,
      ...window,
      kind: 'continuous',
      clockMode: 'countup',
      continuousTarget: false,
      breakPolicy: 'none'
    }
    const v2 = projectV1TimerPlanToV2(v1)
    expect(v2.continuousMode).toBe('target')
    expect(v2.focusMinutes).toBe(90)
    expect(isOpenContinuousPlanV2(v2)).toBe(false)
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
        continuousMode: 'open',
        continuousTarget: false,
        breakPolicy: policy
      })
      expect(v2.breakPolicy).toBe(policy)
      expect(v2.continuousMode).toBe('open')
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
      continuousMode: 'open',
      continuousTarget: false,
      breakPolicy: 'reminder_only'
    }
    const back = projectV2TimerPlanToV1(projectV1TimerPlanToV2(original), window)
    expect(back).toMatchObject({
      id: 'cont-rt',
      name: '连续',
      kind: 'continuous',
      clockMode: 'countup',
      continuousMode: 'open',
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
      continuousMode: 'target',
      continuousTarget: false,
      breakPolicy: 'ask'
    }
    const back = projectV2TimerPlanToV1(projectV1TimerPlanToV2(original), window)
    expect(back).toMatchObject({
      id: 'cont-rt-t',
      kind: 'continuous',
      continuousMode: 'target',
      continuousTarget: false,
      focusMinutes: 120,
      breakPolicy: 'ask'
    })
  })

  it('V2 target countup → V1 → V2 preserves continuousMode target and focusMinutes', () => {
    const v2 = createContinuousCountupPlan({
      id: 'v2-target',
      name: 'Target RT',
      continuousMode: 'target',
      focusMinutes: 75,
      clockMode: 'countup'
    })
    const v1 = projectV2TimerPlanToV1(v2, window)
    expect(v1).toMatchObject({
      continuousMode: 'target',
      continuousTarget: false,
      focusMinutes: 75
    })
    const back = projectV1TimerPlanToV2(v1)
    expect(back.continuousMode).toBe('target')
    expect(back.focusMinutes).toBe(75)
    expect(isOpenContinuousPlanV2(back)).toBe(false)
  })

  it('V2 open → V1 → V2 stays open without exam 180', () => {
    const v2 = createOpenContinuousPlan({ id: 'v2-open', name: 'Open RT' })
    const v1 = projectV2TimerPlanToV1(v2, window)
    expect(v1.continuousMode).toBe('open')
    expect(v1.continuousTarget).toBe(false)
    expect(v1.focusMinutes).not.toBe(180)
    const back = projectV1TimerPlanToV2(v1)
    expect(back.continuousMode).toBe('open')
    expect(back.focusMinutes).toBeUndefined()
    expect(isOpenContinuousPlanV2(back)).toBe(true)
  })

  it('V2 exam → V1 continuousTarget true → V2 exam', () => {
    const v2 = createExamSimulationPlan({ id: 'v2-exam', focusMinutes: 150 })
    const v1 = projectV2TimerPlanToV1(v2, window)
    expect(v1.continuousMode).toBe('exam')
    expect(v1.continuousTarget).toBe(true)
    expect(v1.focusMinutes).toBe(150)
    const back = projectV1TimerPlanToV2(v1)
    expect(back.continuousMode).toBe('exam')
    expect(back.focusMinutes).toBe(150)
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
      continuousMode: 'target',
      continuousTarget: false,
      breakPolicy: 'ask'
    }
    const v2 = projectV1TimerPlanToV2(original)
    expect(v2.kind).toBe('continuous')
    expect(v2.clockMode).toBe('countdown')
    expect(v2.continuousMode).toBe('target')
    expect(v2.focusMinutes).toBe(50)
    const back = projectV2TimerPlanToV1(v2, window)
    expect(back).toMatchObject({
      id: 'cont-cycle-cd',
      kind: 'continuous',
      clockMode: 'countdown',
      continuousMode: 'target',
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
})

describe('formatTimerPlanKindSummary', () => {
  it('labels open continuous', () => {
    expect(
      formatTimerPlanKindSummary({
        kind: 'continuous',
        clockMode: 'countup',
        focusMinutes: 25,
        breakMinutes: 0,
        continuousMode: 'open',
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
        continuousMode: 'target',
        continuousTarget: false
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
  it('resolves continuous_countup builtin as exam-style target (09:00–12:00 = 180)', () => {
    const plan = resolvePlanV2ForStart({ planId: 'continuous_countup' })
    expect(plan.id).toBe('continuous_countup')
    expect(plan.kind).toBe('continuous')
    expect(plan.clockMode).toBe('countup')
    expect(plan.continuousMode).toBe('exam')
    // Product: 考场模拟 freezes a morning-window target so the ring is 3h, not open-ended.
    expect(plan.focusMinutes).toBe(180)
    expect(resolveStartTargetSeconds(plan)).toBe(180 * 60)
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
          continuousMode: 'target',
          continuousTarget: false,
          breakPolicy: 'none'
        }
      ]
    })
    expect(plan.focusMinutes).toBe(60)
    expect(plan.continuousMode).toBe('target')
    expect(plan.breakPolicy).toBe('none')
  })

  it('createContinuousCountupPlan clones seed', () => {
    const plan = createContinuousCountupPlan({ id: 'x', name: 'X' })
    expect(plan.kind).toBe('continuous')
    expect(plan.clockMode).toBe('countup')
    expect(plan.id).toBe('x')
    expect(plan.name).toBe('X')
  })

  it('createExamSimulationPlan freezes exam continuousMode and 180 focus', () => {
    const plan = createExamSimulationPlan()
    expect(plan.continuousMode).toBe('exam')
    expect(plan.focusMinutes).toBe(180)
    expect(plan.id).toBe('continuous_countup')
  })

  it('createOpenContinuousPlan never inherits 180 focusMinutes', () => {
    const plan = createOpenContinuousPlan({ id: 'open-x', name: 'Open' })
    expect(plan.continuousMode).toBe('open')
    expect(plan.focusMinutes).toBeUndefined()
    expect(plan.id).toBe('open-x')
  })

  it('createTargetContinuousPlan defaults focus and never freezes exam 180', () => {
    const plan = createTargetContinuousPlan({ id: 'target-x', name: 'Target' })
    expect(plan.continuousMode).toBe('target')
    expect(plan.focusMinutes).toBe(25)
    expect(plan.id).toBe('target-x')
    expect(plan.focusMinutes).not.toBe(180)
  })

  it('createContinuousCountupPlan routes open / target / exam without inventing exam for random ids', () => {
    expect(createContinuousCountupPlan({ continuousMode: 'open', id: 'r-open' }).continuousMode).toBe('open')
    expect(
      createContinuousCountupPlan({ continuousMode: 'target', id: 'r-target', focusMinutes: 40 }).focusMinutes
    ).toBe(40)
    expect(createContinuousCountupPlan({ continuousMode: 'exam' }).id).toBe('continuous_countup')
    expect(createContinuousCountupPlan().continuousMode).toBe('exam')
    expect(createContinuousCountupPlan({ id: 'continuous_countup' }).continuousMode).toBe('exam')
    const randomTarget = createContinuousCountupPlan({ id: 'user-xyz', focusMinutes: 90 })
    expect(randomTarget.continuousMode).toBe('target')
    expect(randomTarget.focusMinutes).toBe(90)
    expect(createContinuousCountupPlan({ id: 'user-open' }).continuousMode).toBe('open')
  })


  it('V2→V1 exam uses continuousMode not catalog id heuristics for non-catalog ids', () => {
    const exam = createExamSimulationPlan({ id: 'user-exam', focusMinutes: 120 })
    const v1 = projectV2TimerPlanToV1(exam)
    expect(v1.continuousMode).toBe('exam')
    expect(v1.continuousTarget).toBe(true)
    expect(v1.focusMinutes).toBe(120)
    const target = createContinuousCountupPlan({
      id: 'user-target',
      continuousMode: 'target',
      focusMinutes: 90,
      clockMode: 'countup'
    })
    const v1t = projectV2TimerPlanToV1(target)
    expect(v1t.continuousMode).toBe('target')
    expect(v1t.continuousTarget).toBe(false)
    expect(v1t.focusMinutes).toBe(90)
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



describe('timerPlanKindToUi continuousMode authority', () => {
  it('maps continuous + continuousMode exam to exam UI', () => {
    expect(timerPlanKindToUi('continuous', false, 'exam')).toBe('exam')
  })

  it('maps legacy continuousTarget true to exam UI', () => {
    expect(timerPlanKindToUi('continuous', true, undefined)).toBe('exam')
  })

  it('does not map continuous target countup to exam UI', () => {
    expect(timerPlanKindToUi('continuous', false, 'target')).toBe('continuous')
  })
})

describe('isExamContinuousPlan / continuousModeFromV1 authority', () => {
  it('returns false for nullish input', () => {
    expect(isExamContinuousPlan(null)).toBe(false)
    expect(isExamContinuousPlan(undefined)).toBe(false)
  })

  it('prefers continuousMode exam over missing continuousTarget', () => {
    expect(
      isExamContinuousPlan({
        kind: 'continuous',
        clockMode: 'countup',
        continuousMode: 'exam',
        continuousTarget: false,
        focusMinutes: 90
      })
    ).toBe(true)
    expect(
      continuousModeFromV1({
        kind: 'continuous',
        clockMode: 'countup',
        continuousMode: 'exam',
        continuousTarget: false,
        focusMinutes: 90
      })
    ).toBe('exam')
  })

  it('legacy continuousTarget true maps to exam', () => {
    expect(
      isExamContinuousPlan({
        kind: 'continuous',
        clockMode: 'countup',
        continuousTarget: true,
        focusMinutes: 90
      })
    ).toBe(true)
  })

  it('does not treat continuous target countup as exam', () => {
    expect(
      isExamContinuousPlan({
        kind: 'continuous',
        clockMode: 'countup',
        continuousMode: 'target',
        continuousTarget: false,
        focusMinutes: 25
      })
    ).toBe(false)
  })

  it('does not treat open continuous as exam', () => {
    expect(
      isExamContinuousPlan({
        kind: 'continuous',
        clockMode: 'countup',
        continuousMode: 'open',
        continuousTarget: false,
        focusMinutes: 0
      })
    ).toBe(false)
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
