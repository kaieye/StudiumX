import { describe, expect, it } from 'vitest'
import {
  advanceTimerSession,
  createCustomRhythmPlan,
  startNextPhaseFromCompleted,
  startTimerSession,
  StudyPlanningStore,
  type CustomRhythmStep
} from '../../src/shared/study-planning'
import {
  formatTimerPlanKindSummary,
  normalizeTimerPlanKindFields,
  projectV1TimerPlanToV2,
  projectV2TimerPlanToV1
} from '../../src/renderer/src/study-space/planning-timer-plan-kind'
import { v1TimerPlanToV2, v2TimerPlanToV1 } from '../../src/renderer/src/study-space/planning-timer-plan-dual-write'
import type { StudyTimerPlan } from '../../src/renderer/src/study-space/types'
import { listTimerPlanCatalogRows } from '../../src/renderer/src/study-space/planning-timer-plan-catalog-ui'

const window = {
  simulationStartTime: '09:00',
  simulationEndTime: '12:00'
}

const unequalSequence: CustomRhythmStep[] = [
  { kind: 'focus', minutes: 45 },
  { kind: 'short_break', minutes: 10 },
  { kind: 'focus', minutes: 30 },
  { kind: 'long_break', minutes: 15 }
]

describe('STC-702 wire: KIND_SET + dual-write map', () => {
  it('does not demote custom_rhythm to pomodoro', () => {
    const r = normalizeTimerPlanKindFields({ kind: 'custom_rhythm' })
    expect(r.kind).toBe('custom_rhythm')
    expect(r.clockMode).toBe('countdown')
    expect(r.warnings.some((w) => w.code === 'plan_kind_fallback')).toBe(false)
  })

  it('V1↔V2 roundtrip preserves rhythmSequence', () => {
    const v1: StudyTimerPlan = {
      id: 'cr-1',
      name: 'Exam rhythm',
      focusMinutes: 45,
      breakMinutes: 10,
      ...window,
      kind: 'custom_rhythm',
      clockMode: 'countdown',
      breakPolicy: 'ask',
      rhythmSequence: unequalSequence
    }
    const v2 = projectV1TimerPlanToV2(v1)
    expect(v2.kind).toBe('custom_rhythm')
    expect(v2.rhythmSequence).toEqual(unequalSequence)
    expect(v2.focusMinutes).toBe(45)
    expect(v2.shortBreakMinutes).toBe(10)

    const back = projectV2TimerPlanToV1(v2, window)
    expect(back.kind).toBe('custom_rhythm')
    expect(back.rhythmSequence).toEqual(unequalSequence)

    // dual-write aliases
    expect(v1TimerPlanToV2(v1).rhythmSequence).toEqual(unequalSequence)
    expect(v2TimerPlanToV1(v2, window).rhythmSequence).toEqual(unequalSequence)
  })

  it('fail-closed when custom_rhythm lacks a valid sequence (no silent pomodoro)', () => {
    expect(() =>
      projectV1TimerPlanToV2({
        id: 'cr-bad',
        name: 'Bad',
        focusMinutes: 25,
        breakMinutes: 5,
        ...window,
        kind: 'custom_rhythm',
        rhythmSequence: []
      })
    ).toThrow(/custom_rhythm sequence invalid/i)
  })

  it('format + catalog summarize custom_rhythm', () => {
    const plan: StudyTimerPlan = {
      id: 'cr-sum',
      name: 'Sum',
      focusMinutes: 45,
      breakMinutes: 10,
      ...window,
      kind: 'custom_rhythm',
      rhythmSequence: unequalSequence
    }
    expect(formatTimerPlanKindSummary(plan)).toBe('自定义 · 4 步 · 100 分')
    const rows = listTimerPlanCatalogRows({ userPlans: [plan], includeBuiltins: false })
    expect(rows[0]?.planKind).toBe('custom_rhythm')
    expect(rows[0]?.summary).toContain('自定义')
  })
})

describe('STC-702 wire: rhythmStepIndex + per-step minutes', () => {
  const planResult = createCustomRhythmPlan({
    id: 'cr-life',
    name: 'Unequal',
    sequence: unequalSequence
  })
  if (!planResult.ok) throw new Error('fixture plan invalid')
  const plan = planResult.plan
  const t0 = 1_700_000_000_000

  it('start focus uses first focus step minutes (45) not later 30', () => {
    const started = startTimerSession({ id: 's1', nowMs: t0, plan, taskId: 't' })
    expect(started.session?.rhythmStepIndex).toBe(0)
    expect(started.session?.targetSeconds).toBe(45 * 60)
    // Frozen snapshot identity
    expect(started.session?.planSnapshot?.rhythmSequence).toEqual(unequalSequence)
  })

  it('next focus after break uses second focus step minutes (30)', () => {
    const focus1 = startTimerSession({ id: 'f1', nowMs: t0, plan, taskId: 't' })
    const doneFocus1 = advanceTimerSession(focus1.session!, t0 + 45 * 60_000)
    expect(doneFocus1.session?.state).toBe('completed')

    const br = startNextPhaseFromCompleted({
      completed: doneFocus1.session!,
      nowMs: t0 + 45 * 60_000,
      newSessionId: 'b1',
      phase: 'short_break',
      userConfirmed: true
    })
    expect(br.session?.phase).toBe('short_break')
    expect(br.session?.rhythmStepIndex).toBe(1)
    expect(br.session?.targetSeconds).toBe(10 * 60)
    // planSnapshot not rewritten
    expect(br.session?.planSnapshot).toEqual(doneFocus1.session?.planSnapshot)

    const doneBr = advanceTimerSession(br.session!, t0 + 45 * 60_000 + 10 * 60_000)
    const focus2 = startNextPhaseFromCompleted({
      completed: doneBr.session!,
      nowMs: t0 + 55 * 60_000,
      newSessionId: 'f2',
      phase: 'focus',
      userConfirmed: true,
      taskId: 't'
    })
    expect(focus2.session?.phase).toBe('focus')
    expect(focus2.session?.rhythmStepIndex).toBe(2)
    expect(focus2.session?.targetSeconds).toBe(30 * 60)
    expect(focus2.session?.focusRoundInPlan).toBe(2)
  })

  it('catalog plan edit must not mutate open session planSnapshot', () => {
    const started = startTimerSession({ id: 'live', nowMs: t0, plan, taskId: 't' })
    const frozen = structuredClone(started.session!.planSnapshot)
    // Simulate catalog save producing a different V2 shell (new sequence).
    const edited = createCustomRhythmPlan({
      id: 'cr-life',
      name: 'Unequal edited',
      sequence: [
        { kind: 'focus', minutes: 20 },
        { kind: 'short_break', minutes: 5 }
      ]
    })
    expect(edited.ok).toBe(true)
    // Live session still holds original freeze
    expect(started.session!.planSnapshot).toEqual(frozen)
    expect(started.session!.planSnapshot?.rhythmSequence?.[0]?.minutes).toBe(45)
  })
})

describe('STC-702 wire: save_timer_plan fail-closed normalize', () => {
  it('accepts valid custom_rhythm and stores normalized sequence', () => {
    const store = new StudyPlanningStore()
    const created = createCustomRhythmPlan({
      id: 'user-cr',
      name: 'User CR',
      sequence: unequalSequence
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const result = store.applyCommand(
      {
        actionId: 'save-cr-1',
        type: 'save_timer_plan',
        payload: { plan: created.plan }
      },
      store.readSnapshot().revision
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const saved = result.snapshot.timerPlans.find((p) => p.id === 'user-cr')
    expect(saved?.kind).toBe('custom_rhythm')
    expect(saved?.rhythmSequence).toEqual(unequalSequence)
  })

  it('rejects custom_rhythm without sequence (no silent invent)', () => {
    const store = new StudyPlanningStore()
    const result = store.applyCommand(
      {
        actionId: 'save-cr-bad',
        type: 'save_timer_plan',
        payload: {
          plan: {
            id: 'user-cr-bad',
            name: 'Bad',
            kind: 'custom_rhythm',
            clockMode: 'countdown',
            breakPolicy: 'ask',
            windowFillPolicy: 'adaptive_final_focus',
            minimumFinalFocusMinutes: 10,
            wrapUpMinutes: 5,
            notificationPolicy: {
              sound: true,
              systemNotification: true,
              focusEnd: true,
              breakEnd: true
            },
            revision: 1
          }
        }
      },
      store.readSnapshot().revision
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_command')
  })
})
