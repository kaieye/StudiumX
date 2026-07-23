import { describe, expect, it } from 'vitest'
import {
  BUILTIN_TIMER_PLAN_CATALOG,
  advanceCustomRhythmOnPhaseComplete,
  advanceTimerSession,
  assertBuiltinPomodoroSemanticsIntact,
  createClassicPomodoroPlan,
  createContinuousCountupPlan,
  createOpenContinuousPlan,
  createCustomRhythmPlan,
  formatCustomRhythmIssueMessage,
  isActivePlanSnapshotFrozenAgainstCatalogEdit,
  isSaveableCustomRhythmSequence,
  listCustomRhythmEditorIssues,
  normalizeCustomRhythmSequence,
  normalizeTimerPlanV2,
  startNextPhaseFromCompleted,
  startTimerSession,
  CUSTOM_RHYTHM_STEP_KIND_LABELS,
  CUSTOM_RHYTHM_STEP_KIND_OPTIONS,
  type CustomRhythmStep
} from '../../src/shared/study-planning'
import {
  isValidCustomRhythmPlanDraft,
  projectV1TimerPlanToV2,
  projectV2TimerPlanToV1,
  resolvePlanV2ForStart
} from '../../src/renderer/src/study-space/planning-timer-plan-kind'
import type { StudyTimerPlan } from '../../src/renderer/src/study-space/types'

/**
 * STC-702 product-path suite (IMPL-R polish).
 * Covers: validation UX fail-closed, pomodoro coexistence, continuous coexistence,
 * active session freeze, step advance + wrap_up terminal — no freeform drag.
 */

const window = {
  simulationStartTime: '09:00',
  simulationEndTime: '12:00'
}

const examSequence: CustomRhythmStep[] = [
  { kind: 'focus', minutes: 45 },
  { kind: 'short_break', minutes: 10 },
  { kind: 'focus', minutes: 30 },
  { kind: 'long_break', minutes: 15 },
  { kind: 'wrap_up', minutes: 5 }
]

describe('STC-702 product-path: validation UX fail-closed', () => {
  it('empty sequence / unknown kind / non-positive minutes fail-closed with clear messages', () => {
    const empty = listCustomRhythmEditorIssues([])
    expect(empty.ok).toBe(false)
    expect(empty.hard.some((i) => i.code === 'sequence_empty')).toBe(true)
    expect(empty.hard[0]?.displayMessage).toMatch(/不能为空|至少/)

    const unknown = listCustomRhythmEditorIssues([{ kind: 'tomato', minutes: 3 }])
    expect(unknown.ok).toBe(false)
    expect(unknown.hard.some((i) => i.code === 'step_kind_invalid')).toBe(true)
    expect(formatCustomRhythmIssueMessage(unknown.hard[0]!)).toMatch(/类型无效|专注/)

    const zero = listCustomRhythmEditorIssues([{ kind: 'focus', minutes: 0 }])
    expect(zero.ok).toBe(false)
    expect(zero.hard.some((i) => i.code === 'step_minutes_out_of_range')).toBe(true)
    // No silent invent of a 3-min tomato / default classic
    expect(isSaveableCustomRhythmSequence([{ kind: 'focus', minutes: 0 }])).toBe(false)
    expect(isSaveableCustomRhythmSequence([])).toBe(false)
    expect(isSaveableCustomRhythmSequence([{ kind: 'blank', minutes: 25 }])).toBe(false)

    // Draft gate refuses empty / invalid
    expect(
      isValidCustomRhythmPlanDraft({
        name: 'Bad empty',
        rhythmSequence: [],
        ...window
      })
    ).toBe(false)
    expect(
      isValidCustomRhythmPlanDraft({
        name: 'Bad zero',
        rhythmSequence: [{ kind: 'focus', minutes: 0 }],
        ...window
      })
    ).toBe(false)
  })

  it('valid sequence remains saveable', () => {
    expect(isSaveableCustomRhythmSequence(examSequence)).toBe(true)
    expect(
      isValidCustomRhythmPlanDraft({
        name: 'Exam',
        rhythmSequence: examSequence,
        ...window
      })
    ).toBe(true)
  })
})

describe('STC-702 product-path: pomodoro coexistence', () => {
  it('selecting custom rhythm does not rewrite classic_25_5 / deep_50_10 semantics', () => {
    const classic = createClassicPomodoroPlan()
    const deep = createClassicPomodoroPlan({
      id: 'deep_50_10',
      name: '深度专注',
      focusMinutes: 50,
      shortBreakMinutes: 10
    })
    const custom = createCustomRhythmPlan({
      id: 'user-cr',
      name: '自定义',
      sequence: examSequence
    })
    expect(custom.ok).toBe(true)
    if (!custom.ok) return

    // Catalog-like set: builtins + custom
    const plans = [classic, deep, custom.plan]
    const check = assertBuiltinPomodoroSemanticsIntact(plans)
    expect(check.ok).toBe(true)

    // Builtin catalog seed identity
    const seedClassic = BUILTIN_TIMER_PLAN_CATALOG.find((p) => p.id === 'classic_25_5')
    const seedDeep = BUILTIN_TIMER_PLAN_CATALOG.find((p) => p.id === 'deep_50_10')
    expect(seedClassic?.focusMinutes).toBe(25)
    expect(seedClassic?.shortBreakMinutes).toBe(5)
    expect(seedClassic?.kind).toBe('pomodoro')
    expect(seedClassic?.rhythmSequence).toBeUndefined()
    expect(seedDeep?.focusMinutes).toBe(50)
    expect(seedDeep?.shortBreakMinutes).toBe(10)

    // resolvePlanV2ForStart restores catalog plan when switching back
    const restoredClassic = resolvePlanV2ForStart({ planId: 'classic_25_5' })
    expect(restoredClassic.id).toBe('classic_25_5')
    expect(restoredClassic.kind).toBe('pomodoro')
    expect(restoredClassic.focusMinutes).toBe(25)
    expect(restoredClassic.shortBreakMinutes).toBe(5)
    expect(restoredClassic.rhythmSequence).toBeUndefined()

    const restoredDeep = resolvePlanV2ForStart({ planId: 'deep_50_10' })
    expect(restoredDeep.id).toBe('deep_50_10')
    expect(restoredDeep.focusMinutes).toBe(50)
    expect(restoredDeep.shortBreakMinutes).toBe(10)

    // User custom plan does not bleed into classic project path
    const v1Custom: StudyTimerPlan = {
      id: 'user-cr',
      name: '自定义',
      focusMinutes: 45,
      breakMinutes: 10,
      ...window,
      kind: 'custom_rhythm',
      rhythmSequence: examSequence
    }
    const v2 = projectV1TimerPlanToV2(v1Custom)
    expect(v2.kind).toBe('custom_rhythm')
    // Classic V2 factory still pure
    expect(createClassicPomodoroPlan().focusMinutes).toBe(25)
  })

  it('rhythmSequence on pomodoro is ignored (no silent rewrite to custom)', () => {
    const r = normalizeTimerPlanV2({
      id: 'classic_25_5',
      name: '经典番茄',
      kind: 'pomodoro',
      clockMode: 'countdown',
      focusMinutes: 25,
      shortBreakMinutes: 5,
      rhythmSequence: examSequence
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.kind).toBe('pomodoro')
    expect(r.plan.rhythmSequence).toBeUndefined()
    expect(r.plan.focusMinutes).toBe(25)
  })
})

describe('STC-702 product-path: continuous coexistence', () => {
  it('continuous countup + breakPolicy still work when custom rhythm not selected', () => {
    const cont = createOpenContinuousPlan({ id: 'open-coexist' })
    expect(cont.kind).toBe('continuous')
    expect(cont.clockMode).toBe('countup')
    expect(cont.focusMinutes).toBeUndefined()
    expect(cont.breakPolicy).toBe('reminder_only')
    expect(cont.rhythmSequence).toBeUndefined()

    const t0 = 1_700_000_000_000
    const started = startTimerSession({
      id: 'c1',
      nowMs: t0,
      plan: cont,
      taskId: 't'
    })
    expect(started.session?.state).toBe('running')
    expect(started.session?.clockMode).toBe('countup')
    expect(started.session?.targetSeconds).toBeNull()
    expect(started.session?.rhythmStepIndex).toBeUndefined()
    expect(started.session?.planSnapshot?.kind).toBe('continuous')

    // Countdown continuous with target still works
    const contTarget = createContinuousCountupPlan({
      id: 'cont-target',
      clockMode: 'countdown',
      focusMinutes: 40,
      breakPolicy: 'ask'
    })
    const started2 = startTimerSession({
      id: 'c2',
      nowMs: t0,
      plan: contTarget,
      taskId: 't'
    })
    expect(started2.session?.targetSeconds).toBe(40 * 60)
    expect(started2.session?.planSnapshot?.breakPolicy).toBe('ask')
  })
})

describe('STC-702 product-path: active session freeze', () => {
  it('editing catalog sequence does not mutate live planSnapshot / rhythmStepIndex path', () => {
    const created = createCustomRhythmPlan({
      id: 'cr-live',
      name: 'Live',
      sequence: examSequence
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const t0 = 1_700_000_000_000
    const started = startTimerSession({
      id: 'live',
      nowMs: t0,
      plan: created.plan,
      taskId: 't'
    })
    const frozenSeq = structuredClone(started.session!.planSnapshot!.rhythmSequence)
    const frozenIndex = started.session!.rhythmStepIndex

    const editedCatalog = [
      { kind: 'focus' as const, minutes: 20 },
      { kind: 'short_break' as const, minutes: 5 }
    ]
    // Freeze helper: snapshot must not be rewritten by catalog edit
    expect(
      isActivePlanSnapshotFrozenAgainstCatalogEdit({
        activePlanSnapshot: started.session!.planSnapshot,
        frozenSequence: frozenSeq,
        catalogSequence: editedCatalog
      })
    ).toBe(true)
    // Mid-session mutation of snapshot would fail freeze (guardrail).
    expect(
      isActivePlanSnapshotFrozenAgainstCatalogEdit({
        activePlanSnapshot: {
          kind: 'custom_rhythm',
          rhythmSequence: editedCatalog
        },
        frozenSequence: frozenSeq,
        catalogSequence: editedCatalog
      })
    ).toBe(false)

    // Session object still holds original (simulate catalog dual-write elsewhere)
    expect(started.session!.planSnapshot!.rhythmSequence).toEqual(frozenSeq)
    expect(started.session!.rhythmStepIndex).toBe(frozenIndex)
    expect(started.session!.targetSeconds).toBe(45 * 60)

    // Completing phase still advances against *frozen* snapshot, not catalog edit
    const done = advanceTimerSession(started.session!, t0 + 45 * 60_000)
    const next = startNextPhaseFromCompleted({
      completed: done.session!,
      nowMs: t0 + 45 * 60_000,
      newSessionId: 'live-br',
      phase: 'short_break',
      userConfirmed: true
    })
    expect(next.session?.planSnapshot?.rhythmSequence).toEqual(frozenSeq)
    expect(next.session?.rhythmStepIndex).toBe(1)
    expect(next.session?.targetSeconds).toBe(10 * 60)
  })
})

describe('STC-702 product-path: step advance + wrap_up terminal', () => {
  it('on phase complete, step index advances; wrap_up terminal is explicit', () => {
    // focus0 → short_break1
    const a = advanceCustomRhythmOnPhaseComplete({
      sequence: examSequence,
      completedStepIndex: 0,
      nextPhase: 'short_break'
    })
    expect(a.ok).toBe(true)
    if (!a.ok) return
    expect(a.nextStepIndex).toBe(1)
    expect(a.nextStep.minutes).toBe(10)
    expect(a.wrapUpTerminal).toBe(false)

    // short_break1 → focus2 (30 min second focus)
    const b = advanceCustomRhythmOnPhaseComplete({
      sequence: examSequence,
      completedStepIndex: 1,
      nextPhase: 'focus'
    })
    expect(b.ok && b.nextStepIndex).toBe(2)
    if (!b.ok) return
    expect(b.nextStep.minutes).toBe(30)

    // long_break3 → wrap_up4
    const c = advanceCustomRhythmOnPhaseComplete({
      sequence: examSequence,
      completedStepIndex: 3,
      nextPhase: 'wrap_up'
    })
    expect(c.ok && c.nextStepIndex).toBe(4)

    // completing wrap_up (last) → next focus wraps; wrapUpTerminal true
    const d = advanceCustomRhythmOnPhaseComplete({
      sequence: examSequence,
      completedStepIndex: 4,
      nextPhase: 'focus'
    })
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.wrapUpTerminal).toBe(true)
    expect(d.wrapped).toBe(true)
    expect(d.nextStepIndex).toBe(0)
    expect(d.nextStep.kind).toBe('focus')
  })

  it('lifecycle startNextPhaseFromCompleted advances rhythmStepIndex end-to-end', () => {
    const created = createCustomRhythmPlan({
      id: 'cr-adv',
      name: 'Adv',
      sequence: examSequence
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const plan = created.plan
    const t0 = 1_700_000_000_000

    let session = startTimerSession({ id: 's0', nowMs: t0, plan, taskId: 't' }).session!
    expect(session.rhythmStepIndex).toBe(0)
    expect(session.targetSeconds).toBe(45 * 60)

    // complete focus → short_break
    session = advanceTimerSession(session, t0 + 45 * 60_000).session!
    let next = startNextPhaseFromCompleted({
      completed: session,
      nowMs: t0 + 45 * 60_000,
      newSessionId: 's1',
      phase: 'short_break',
      userConfirmed: true
    })
    expect(next.session?.rhythmStepIndex).toBe(1)
    expect(next.session?.targetSeconds).toBe(10 * 60)

    // complete break → second focus 30
    session = advanceTimerSession(next.session!, t0 + 55 * 60_000).session!
    next = startNextPhaseFromCompleted({
      completed: session,
      nowMs: t0 + 55 * 60_000,
      newSessionId: 's2',
      phase: 'focus',
      userConfirmed: true,
      taskId: 't'
    })
    expect(next.session?.rhythmStepIndex).toBe(2)
    expect(next.session?.targetSeconds).toBe(30 * 60)

    // jump to wrap_up terminal
    session = startTimerSession({
      id: 's-wrap',
      nowMs: t0,
      plan,
      phase: 'wrap_up',
      rhythmStepIndex: 4
    }).session!
    expect(session.targetSeconds).toBe(5 * 60)
    session = advanceTimerSession(session, t0 + 5 * 60_000).session!
    next = startNextPhaseFromCompleted({
      completed: session,
      nowMs: t0 + 5 * 60_000,
      newSessionId: 's-next-focus',
      phase: 'focus',
      userConfirmed: true,
      taskId: 't'
    })
    // wraps to first focus
    expect(next.session?.rhythmStepIndex).toBe(0)
    expect(next.session?.targetSeconds).toBe(45 * 60)
  })
})

describe('STC-702 product-path: a11y/copy step kind labels', () => {
  it('exposes distinct short labels for focus / short_break / long_break / wrap_up', () => {
    expect(CUSTOM_RHYTHM_STEP_KIND_LABELS.focus.shortLabel).toBe('专注')
    expect(CUSTOM_RHYTHM_STEP_KIND_LABELS.short_break.shortLabel).toBe('短休')
    expect(CUSTOM_RHYTHM_STEP_KIND_LABELS.long_break.shortLabel).toBe('长休')
    expect(CUSTOM_RHYTHM_STEP_KIND_LABELS.wrap_up.shortLabel).toBe('收尾')
    const labels = CUSTOM_RHYTHM_STEP_KIND_OPTIONS.map((o) => o.label)
    expect(new Set(labels).size).toBe(4)
    expect(labels).toEqual(['专注', '短休息', '长休息', '收尾'])
  })
})

describe('STC-702 product-path: no freeform / V1 dual-write still fail-closed', () => {
  it('V1→V2 refuses empty custom sequence (no silent tomato)', () => {
    expect(() =>
      projectV1TimerPlanToV2({
        id: 'bad',
        name: 'Bad',
        focusMinutes: 25,
        breakMinutes: 5,
        ...window,
        kind: 'custom_rhythm',
        rhythmSequence: []
      })
    ).toThrow(/invalid/i)
  })

  it('V2→V1 preserves sequence for roundtrip', () => {
    const created = createCustomRhythmPlan({
      id: 'rt',
      name: 'RT',
      sequence: examSequence
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const v1 = projectV2TimerPlanToV1(created.plan, window)
    expect(v1.kind).toBe('custom_rhythm')
    expect(v1.rhythmSequence).toEqual(examSequence)
  })

  it('normalize rejects non-array sequence without inventing steps', () => {
    const r = normalizeCustomRhythmSequence(null)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.sequence).toBeUndefined()
  })
})
