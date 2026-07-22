import { describe, expect, it } from 'vitest'
import {
  createClassicPomodoroPlan,
  createContinuousCountupPlan,
  createCustomRhythmPlan,
  customRhythmMinutesForPhase,
  expandCustomRhythmSequence,
  isCustomRhythmPlan,
  nextCustomRhythmStep,
  normalizeCustomRhythmSequence,
  normalizeTimerPlanV2,
  projectCustomRhythmPrimaryMinutes,
  resolveCustomRhythmStep,
  sumCustomRhythmMinutes,
  validateCustomRhythmSequence,
  type CustomRhythmStep
} from '../../src/shared/study-planning'


const examSequence: CustomRhythmStep[] = [
  { kind: 'focus', minutes: 45 },
  { kind: 'short_break', minutes: 10 },
  { kind: 'focus', minutes: 45 },
  { kind: 'long_break', minutes: 20 },
  { kind: 'wrap_up', minutes: 5 }
]

describe('normalizeCustomRhythmSequence (STC-702)', () => {
  it('accepts ordered focus/break/wrap steps', () => {
    const r = normalizeCustomRhythmSequence(examSequence)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sequence).toEqual(examSequence)
    expect(sumCustomRhythmMinutes(r.sequence).totalMinutes).toBe(125)
    expect(sumCustomRhythmMinutes(r.sequence).focusMinutes).toBe(90)
  })

  it('fail-closed on empty / non-array / invalid kind', () => {
    expect(normalizeCustomRhythmSequence([]).ok).toBe(false)
    expect(normalizeCustomRhythmSequence(null).ok).toBe(false)
    expect(
      normalizeCustomRhythmSequence([{ kind: 'blank', minutes: 10 } as unknown as CustomRhythmStep]).ok
    ).toBe(false)
    expect(normalizeCustomRhythmSequence([{ kind: 'focus', minutes: 0 }]).ok).toBe(false)
    expect(normalizeCustomRhythmSequence([{ kind: 'focus', minutes: 999 }]).ok).toBe(false)
  })

  it('requires at least one focus step', () => {
    const r = normalizeCustomRhythmSequence([
      { kind: 'short_break', minutes: 5 },
      { kind: 'wrap_up', minutes: 5 }
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.some((i) => i.code === 'sequence_requires_focus')).toBe(true)
  })

  it('refuses silent truncate when sequence too long', () => {
    const steps = Array.from({ length: 25 }, () => ({ kind: 'focus' as const, minutes: 5 }))
    const r = normalizeCustomRhythmSequence(steps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.some((i) => i.code === 'sequence_too_long')).toBe(true)
  })

  it('warns when wrap_up is not terminal', () => {
    const r = normalizeCustomRhythmSequence([
      { kind: 'focus', minutes: 25 },
      { kind: 'wrap_up', minutes: 5 },
      { kind: 'short_break', minutes: 5 }
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings.some((w) => w.code === 'wrap_up_not_terminal')).toBe(true)
  })
})

describe('createCustomRhythmPlan + normalizeTimerPlanV2', () => {
  it('creates custom_rhythm plan with projected primary minutes', () => {
    const r = createCustomRhythmPlan({
      id: 'exam-sim',
      name: '考试模拟',
      sequence: examSequence
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.kind).toBe('custom_rhythm')
    expect(r.plan.rhythmSequence).toEqual(examSequence)
    expect(r.plan.focusMinutes).toBe(45)
    expect(r.plan.shortBreakMinutes).toBe(10)
    expect(r.plan.longBreakMinutes).toBe(20)
    expect(r.plan.wrapUpMinutes).toBe(5)
    expect(r.plan.breakPolicy).toBe('ask')
    expect(isCustomRhythmPlan(r.plan)).toBe(true)
  })

  it('fail-closed when custom_rhythm lacks rhythmSequence', () => {
    const r = normalizeTimerPlanV2({
      id: 'x',
      name: 'x',
      kind: 'custom_rhythm',
      clockMode: 'countdown'
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.some((i) => i.code === 'rhythm_sequence_required')).toBe(true)
  })

  it('ignores rhythmSequence on pomodoro with warning', () => {
    const r = normalizeTimerPlanV2({
      id: 'p',
      name: 'p',
      kind: 'pomodoro',
      clockMode: 'countdown',
      rhythmSequence: examSequence
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.rhythmSequence).toBeUndefined()
    expect(r.warnings.some((w) => w.code === 'rhythm_sequence_ignored')).toBe(true)
  })

  it('coerces custom_rhythm none breakPolicy to ask', () => {
    const r = createCustomRhythmPlan({
      id: 'c',
      name: 'c',
      sequence: [{ kind: 'focus', minutes: 25 }],
      overrides: { breakPolicy: 'none' }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.breakPolicy).toBe('ask')
  })
})

describe('sequence helpers', () => {
  it('projects primary minutes and resolves/next steps', () => {
    expect(projectCustomRhythmPrimaryMinutes(examSequence)).toEqual({
      focusMinutes: 45,
      shortBreakMinutes: 10,
      longBreakMinutes: 20,
      wrapUpMinutes: 5
    })
    const step0 = resolveCustomRhythmStep(examSequence, 0)
    expect(step0.ok && step0.step.kind).toBe('focus')
    const next = nextCustomRhythmStep(examSequence, 0)
    expect(next.ok && next.step.kind).toBe('short_break')
    const wrap = resolveCustomRhythmStep(examSequence, 5, { wrap: true })
    expect(wrap.ok && wrap.index).toBe(0)
    expect(customRhythmMinutesForPhase(examSequence, 'long_break')).toBe(20)
  })

  it('expand cycles with safety cap', () => {
    const ok = expandCustomRhythmSequence(examSequence, { cycles: 2 })
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.steps).toHaveLength(10)
    const tooBig = expandCustomRhythmSequence(examSequence, { cycles: 20, maxSteps: 48 })
    expect(tooBig.ok).toBe(false)
  })

  it('validateCustomRhythmSequence mirrors normalize', () => {
    expect(validateCustomRhythmSequence(examSequence).ok).toBe(true)
  })
})
