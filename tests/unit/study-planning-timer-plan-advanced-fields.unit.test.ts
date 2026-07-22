import { describe, expect, it } from 'vitest'
import {
  applyAdvancedFieldsToV1Plan,
  defaultTimerPlanAdvancedFields,
  isValidTimerPlanAdvancedDraft,
  normalizeTimerPlanAdvancedFields,
  pickOptionalAdvancedFields
} from '../../src/renderer/src/study-space/planning-timer-plan-advanced-fields'

describe('timer plan advanced fields (STC-502)', () => {
  it('defaults to classic long break / ask policy', () => {
    const { fields, warnings } = normalizeTimerPlanAdvancedFields({})
    expect(fields).toEqual({
      longBreakMinutes: 15,
      longBreakEvery: 4,
      breakPolicy: 'ask'
    })
    expect(warnings).toEqual([])
    expect(defaultTimerPlanAdvancedFields()).toEqual(fields)
  })

  it('clamps long break minutes and every', () => {
    const { fields, warnings } = normalizeTimerPlanAdvancedFields({
      longBreakMinutes: 999,
      longBreakEvery: 1
    })
    expect(fields.longBreakMinutes).toBe(60)
    expect(fields.longBreakEvery).toBe(2)
    expect(warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['long_break_minutes_clamped', 'long_break_every_clamped'])
    )
  })

  it('coerces none/reminder_only to ask for pomodoro freeze #6', () => {
    const none = normalizeTimerPlanAdvancedFields({ breakPolicy: 'none' })
    expect(none.fields.breakPolicy).toBe('ask')
    expect(none.warnings.some((w) => w.code === 'pomodoro_break_policy_coerced')).toBe(true)

    const rem = normalizeTimerPlanAdvancedFields({ breakPolicy: 'reminder_only' })
    expect(rem.fields.breakPolicy).toBe('ask')
  })

  it('accepts automatic breakPolicy', () => {
    const { fields, warnings } = normalizeTimerPlanAdvancedFields({
      breakPolicy: 'automatic',
      longBreakMinutes: 20,
      longBreakEvery: 3
    })
    expect(fields).toEqual({
      longBreakMinutes: 20,
      longBreakEvery: 3,
      breakPolicy: 'automatic'
    })
    expect(warnings).toEqual([])
  })

  it('validates draft ranges and refuses continuous-only policies', () => {
    expect(isValidTimerPlanAdvancedDraft({ longBreakMinutes: 15, longBreakEvery: 4, breakPolicy: 'ask' })).toBe(true)
    expect(isValidTimerPlanAdvancedDraft({ longBreakMinutes: 3 })).toBe(false)
    expect(isValidTimerPlanAdvancedDraft({ longBreakEvery: 9 })).toBe(false)
    expect(isValidTimerPlanAdvancedDraft({ breakPolicy: 'none' })).toBe(false)
    expect(isValidTimerPlanAdvancedDraft({ breakPolicy: 'reminder_only' })).toBe(false)
    expect(isValidTimerPlanAdvancedDraft({ longBreakMinutes: 15.5 })).toBe(false)
  })

  it('applies advanced fields onto a V1 plan shell', () => {
    const next = applyAdvancedFieldsToV1Plan(
      {
        id: 'p1',
        name: 'X',
        focusMinutes: 25,
        breakMinutes: 5,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00'
      },
      { longBreakMinutes: 18, longBreakEvery: 5, breakPolicy: 'automatic' }
    )
    expect(next.longBreakMinutes).toBe(18)
    expect(next.longBreakEvery).toBe(5)
    expect(next.breakPolicy).toBe('automatic')
  })

  it('picks sparse optional fields from raw cache objects', () => {
    expect(pickOptionalAdvancedFields({})).toEqual({})
    expect(pickOptionalAdvancedFields({ longBreakMinutes: 20, breakPolicy: 'ask' })).toEqual({
      longBreakMinutes: 20,
      breakPolicy: 'ask'
    })
  })
})
