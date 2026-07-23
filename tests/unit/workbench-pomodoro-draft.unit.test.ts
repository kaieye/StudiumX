/**
 * Pure timer-plan draft helpers (WorkbenchPomodoro settings editor).
 * Round-trip and exam continuousMode authority without React.
 */
import { describe, expect, it } from 'vitest'
import {
  applyTimerPlanKindUi,
  buildPlanPayload,
  createTimerPlanDraft,
  decideApplyPlan,
  decideLiveDraftCommit,
  decideSavePlan,
  draftFromCatalogPlanSources,
  draftFromPlan,
  draftKindFromCatalogPlanKind,
  hasApplyableTimerFields,
  isDraftPayloadValid,
  type TimerPlanDraft
} from '../../src/renderer/src/views/workbench/workbench-pomodoro-draft'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'

/** createTimerPlanDraft only reads focus/break + simulation window from the snapshot. */
function baseSnapshot(
  overrides: Partial<
    Pick<
      StudySnapshot,
      'focusMinutes' | 'breakMinutes' | 'simulationStartTime' | 'simulationEndTime'
    >
  > = {}
): StudySnapshot {
  return {
    focusMinutes: 25,
    breakMinutes: 5,
    simulationStartTime: '09:00',
    simulationEndTime: '12:00',
    ...overrides
  } as StudySnapshot
}

function continuousExamDraft(overrides: Partial<TimerPlanDraft> = {}): TimerPlanDraft {
  return {
    name: '考场模拟',
    focusMinutes: 90,
    breakMinutes: 0,
    simulationStartTime: '09:00',
    simulationEndTime: '10:30',
    kind: 'continuous',
    clockMode: 'countup',
    continuousTarget: true,
    continuousMode: 'exam',
    breakPolicy: 'reminder_only',
    ...overrides
  }
}

describe('createTimerPlanDraft', () => {
  it('always starts as pomodoro shell (does not inherit continuous)', () => {
    const draft = createTimerPlanDraft(
      baseSnapshot({
        focusMinutes: 40,
        breakMinutes: 8
      })
    )
    expect(draft.kind).toBe('pomodoro')
    expect(draft.clockMode).toBe('countdown')
    expect(draft.continuousMode).toBeUndefined()
    expect(draft.focusMinutes).toBe(40)
    expect(draft.breakMinutes).toBe(8)
  })
})

describe('draftFromPlan / buildPlanPayload exam authority', () => {
  it('round-trips continuousMode exam with continuousTarget true', () => {
    const draft = draftFromPlan({
      name: '模考',
      focusMinutes: 120,
      breakMinutes: 0,
      simulationStartTime: '08:30',
      simulationEndTime: '10:30',
      kind: 'continuous',
      clockMode: 'countup',
      continuousMode: 'exam',
      continuousTarget: false,
      breakPolicy: 'none'
    })
    expect(draft.continuousMode).toBe('exam')
    expect(draft.continuousTarget).toBe(true)
    expect(draft.clockMode).toBe('countup')

    const payload = buildPlanPayload(draft)
    expect(payload.kind).toBe('continuous')
    expect(payload.continuousMode).toBe('exam')
    expect(payload.continuousTarget).toBe(true)
    expect(payload.clockMode).toBe('countup')
    // Exam encodes total minutes into focusMinutes from simulation window.
    expect(payload.focusMinutes).toBe(120)
    expect(payload.breakMinutes).toBe(0)
  })

  it('legacy continuousTarget true without continuousMode maps to exam', () => {
    const draft = draftFromPlan({
      name: '旧模考',
      focusMinutes: 90,
      breakMinutes: 0,
      simulationStartTime: '09:00',
      simulationEndTime: '10:30',
      kind: 'continuous',
      continuousTarget: true
    })
    expect(draft.continuousMode).toBe('exam')
    expect(draft.continuousTarget).toBe(true)
  })

  it('does not treat continuous target cycle as exam', () => {
    const draft = draftFromPlan({
      name: '连座',
      focusMinutes: 25,
      breakMinutes: 5,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      kind: 'continuous',
      clockMode: 'countdown',
      continuousMode: 'target',
      continuousTarget: false,
      breakPolicy: 'reminder_only'
    })
    expect(draft.continuousMode).toBe('target')
    expect(draft.continuousTarget).toBe(false)

    const payload = buildPlanPayload(draft)
    expect(payload.continuousMode).toBe('target')
    expect(payload.continuousTarget).toBe(false)
    expect(payload.focusMinutes).toBe(25)
  })

  it('preserves open continuous mode', () => {
    const draft = draftFromPlan({
      name: '开放',
      focusMinutes: 0,
      breakMinutes: 0,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      kind: 'continuous',
      clockMode: 'countup',
      continuousMode: 'open',
      continuousTarget: false,
      breakPolicy: 'none'
    })
    expect(draft.continuousMode).toBe('open')
    expect(buildPlanPayload(draft).continuousMode).toBe('open')
  })
})

describe('isDraftPayloadValid / hasApplyableTimerFields', () => {
  it('accepts exam with total window only', () => {
    const draft = continuousExamDraft()
    expect(isDraftPayloadValid(draft)).toBe(true)
    expect(hasApplyableTimerFields(draft)).toBe(true)
  })

  it('rejects continuous cycle without focus minutes for apply', () => {
    const draft: TimerPlanDraft = {
      name: '连座',
      focusMinutes: NaN as unknown as number,
      breakMinutes: 5,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      kind: 'continuous',
      clockMode: 'countdown',
      continuousMode: 'target',
      continuousTarget: false,
      breakPolicy: 'reminder_only'
    }
    expect(hasApplyableTimerFields(draft)).toBe(false)
  })

  it('custom_rhythm save requires valid sequence via isValidCustomRhythmPlanDraft', () => {
    const emptySeq: TimerPlanDraft = {
      name: '节奏',
      focusMinutes: 25,
      breakMinutes: 5,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      kind: 'custom_rhythm',
      clockMode: 'countdown',
      rhythmSequence: []
    }
    expect(isDraftPayloadValid(emptySeq)).toBe(false)
    expect(hasApplyableTimerFields(emptySeq)).toBe(false)

    const ok: TimerPlanDraft = {
      ...emptySeq,
      rhythmSequence: [
        { kind: 'focus', minutes: 25 },
        { kind: 'short_break', minutes: 5 }
      ]
    }
    expect(isDraftPayloadValid(ok)).toBe(true)
    expect(hasApplyableTimerFields(ok)).toBe(true)
  })
})

describe('draftKindFromCatalogPlanKind', () => {
  it('maps continuous catalog rows and mode hints', () => {
    expect(draftKindFromCatalogPlanKind('continuous')).toBe('continuous')
    expect(draftKindFromCatalogPlanKind('pomodoro', 'exam')).toBe('continuous')
    expect(draftKindFromCatalogPlanKind('pomodoro', undefined, true)).toBe('continuous')
    expect(draftKindFromCatalogPlanKind('pomodoro')).toBe('pomodoro')
    expect(draftKindFromCatalogPlanKind('custom_rhythm')).toBe('custom_rhythm')
  })
})

describe('applyTimerPlanKindUi', () => {
  it('switches to exam with default 09:00–11:30 when no usable window', () => {
    const base = draftFromPlan({
      name: '番茄',
      focusMinutes: 25,
      breakMinutes: 5,
      // Empty / zero window → no existingTotal, default exam span.
      simulationStartTime: '00:00',
      simulationEndTime: '00:00',
      kind: 'pomodoro',
      breakPolicy: 'ask'
    })
    const next = applyTimerPlanKindUi(base, 'exam')
    expect(next.kind).toBe('continuous')
    expect(next.continuousMode).toBe('exam')
    expect(next.continuousTarget).toBe(true)
    expect(next.clockMode).toBe('countup')
    expect(next.breakPolicy).toBe('none')
    expect(next.simulationStartTime).toBe('09:00')
    expect(next.simulationEndTime).toBe('11:30')
    expect(next.focusMinutes).toBe(150)
  })

  it('maps existing total minutes onto exam window when prior window is 00:00-based', () => {
    const base = draftFromPlan({
      name: '番茄',
      focusMinutes: 25,
      breakMinutes: 5,
      simulationStartTime: '00:00',
      simulationEndTime: '01:00',
      kind: 'pomodoro',
      breakPolicy: 'ask'
    })
    const next = applyTimerPlanKindUi(base, 'exam')
    expect(next.simulationStartTime).toBe('09:00')
    expect(next.simulationEndTime).toBe('10:00')
    expect(next.focusMinutes).toBe(60)
  })

  it('switches to continuous target and normalizes breakPolicy', () => {
    const base = continuousExamDraft({ breakPolicy: 'none' })
    const next = applyTimerPlanKindUi(base, 'continuous')
    expect(next.kind).toBe('continuous')
    expect(next.continuousMode).toBe('target')
    expect(next.continuousTarget).toBe(false)
    expect(next.breakPolicy).toBe('none')
  })

  it('switches back to pomodoro and coerces non-ask policies', () => {
    const base = continuousExamDraft({ breakPolicy: 'reminder_only' })
    const next = applyTimerPlanKindUi(base, 'pomodoro')
    expect(next.kind).toBe('pomodoro')
    expect(next.continuousMode).toBeUndefined()
    expect(next.clockMode).toBe('countdown')
    expect(next.breakPolicy).toBe('ask')
  })
})

describe('decideLiveDraftCommit', () => {
  it('skips while adding a new plan', () => {
    const decision = decideLiveDraftCommit({
      draft: continuousExamDraft(),
      isAddingPlanMode: true,
      isEditingCustomPlan: false,
      selectedCatalogRow: null,
      appliedShell: null
    })
    expect(decision).toEqual({ action: 'skip' })
  })

  it('saves custom catalog plan when draft is fully valid', () => {
    const draft = continuousExamDraft({ name: '我的模考' })
    const decision = decideLiveDraftCommit({
      draft,
      isAddingPlanMode: false,
      isEditingCustomPlan: true,
      selectedCatalogRow: {
        id: 'custom_1',
        planKind: 'continuous',
        focusMinutes: 90,
        breakMinutes: 0,
        simulationStartTime: '09:00',
        simulationEndTime: '10:30',
        name: '我的模考'
      },
      appliedShell: null
    })
    expect(decision.action).toBe('save')
    if (decision.action === 'save') {
      expect(decision.id).toBe('custom_1')
      expect(decision.payload.continuousMode).toBe('exam')
    }
  })

  it('skips applyOnly when timer fields match selected row + shell', () => {
    const draft = draftFromPlan({
      name: '经典',
      focusMinutes: 25,
      breakMinutes: 5,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      kind: 'pomodoro',
      clockMode: 'countdown'
    })
    const decision = decideLiveDraftCommit({
      draft,
      isAddingPlanMode: false,
      isEditingCustomPlan: false,
      selectedCatalogRow: {
        id: 'classic_25_5',
        planKind: 'pomodoro',
        focusMinutes: 25,
        breakMinutes: 5,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00',
        name: '经典'
      },
      appliedShell: {
        kind: 'pomodoro',
        clockMode: 'countdown',
        continuousMode: undefined
      }
    })
    expect(decision).toEqual({ action: 'skip' })
  })

  it('applyOnly when clock mode differs from applied shell', () => {
    const draft = draftFromPlan({
      name: '经典',
      focusMinutes: 25,
      breakMinutes: 5,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      kind: 'pomodoro',
      clockMode: 'countup'
    })
    const decision = decideLiveDraftCommit({
      draft,
      isAddingPlanMode: false,
      isEditingCustomPlan: false,
      selectedCatalogRow: {
        id: 'classic_25_5',
        planKind: 'pomodoro',
        focusMinutes: 25,
        breakMinutes: 5,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00',
        name: '经典'
      },
      appliedShell: {
        kind: 'pomodoro',
        clockMode: 'countdown'
      }
    })
    expect(decision.action).toBe('applyOnly')
    if (decision.action === 'applyOnly') {
      expect(decision.payload.clockMode).toBe('countup')
    }
  })
})

describe('draftFromCatalogPlanSources', () => {
  it('prefers full shell over catalog row', () => {
    const draft = draftFromCatalogPlanSources({
      shell: {
        name: '完整',
        focusMinutes: 40,
        breakMinutes: 8,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00',
        kind: 'pomodoro'
      },
      row: {
        id: 'r1',
        name: '行名',
        planKind: 'continuous',
        focusMinutes: 25,
        breakMinutes: 5,
        simulationStartTime: '00:00',
        simulationEndTime: '01:00'
      }
    })
    expect(draft?.name).toBe('完整')
    expect(draft?.kind).toBe('pomodoro')
    expect(draft?.focusMinutes).toBe(40)
  })

  it('falls back to continuous → target when only row is present', () => {
    const draft = draftFromCatalogPlanSources({
      shell: null,
      row: {
        id: 'c1',
        name: '连续',
        planKind: 'continuous',
        focusMinutes: 50,
        breakMinutes: 10,
        simulationStartTime: '00:00',
        simulationEndTime: '01:50'
      }
    })
    expect(draft?.kind).toBe('continuous')
    expect(draft?.continuousMode).toBe('target')
    expect(draft?.name).toBe('连续')
  })
})

describe('decideSavePlan / decideApplyPlan', () => {
  const validPomodoro = draftFromPlan({
    name: '我的番茄',
    focusMinutes: 25,
    breakMinutes: 5,
    simulationStartTime: '09:00',
    simulationEndTime: '12:00',
    kind: 'pomodoro'
  })

  it('save: create while adding', () => {
    const d = decideSavePlan({
      draft: validPomodoro,
      hasValidDraft: true,
      isAddingPlanMode: true,
      isEditingCustomPlan: false,
      selectedCatalogRowId: null
    })
    expect(d.action).toBe('create')
    if (d.action === 'create') expect(d.payload.name).toBe('我的番茄')
  })

  it('save: update selected custom plan', () => {
    const d = decideSavePlan({
      draft: validPomodoro,
      hasValidDraft: true,
      isAddingPlanMode: false,
      isEditingCustomPlan: true,
      selectedCatalogRowId: 'custom_9'
    })
    expect(d).toMatchObject({ action: 'update', id: 'custom_9' })
  })

  it('save: skip when invalid', () => {
    expect(
      decideSavePlan({
        draft: validPomodoro,
        hasValidDraft: false,
        isAddingPlanMode: true,
        isEditingCustomPlan: false,
        selectedCatalogRowId: null
      })
    ).toEqual({ action: 'skip' })
  })

  it('apply: create_and_apply while adding', () => {
    const d = decideApplyPlan({
      draft: validPomodoro,
      hasValidDraft: true,
      isAddingPlanMode: true,
      isEditingCustomPlan: false,
      isViewingAppliedPlan: false,
      selectedCatalogRowId: null
    })
    expect(d.action).toBe('create_and_apply')
  })

  it('apply: update_and_apply for custom edit', () => {
    const d = decideApplyPlan({
      draft: validPomodoro,
      hasValidDraft: true,
      isAddingPlanMode: false,
      isEditingCustomPlan: true,
      isViewingAppliedPlan: false,
      selectedCatalogRowId: 'custom_2'
    })
    expect(d).toMatchObject({ action: 'update_and_apply', id: 'custom_2' })
  })

  it('apply: skip when already viewing applied plan', () => {
    expect(
      decideApplyPlan({
        draft: validPomodoro,
        hasValidDraft: true,
        isAddingPlanMode: false,
        isEditingCustomPlan: true,
        isViewingAppliedPlan: true,
        selectedCatalogRowId: 'custom_2'
      })
    ).toEqual({ action: 'skip' })
  })
})
