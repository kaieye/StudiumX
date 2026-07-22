/**
 * Pure model tests for study planning prefs UI (STC-404 restore).
 */
import { describe, expect, it } from 'vitest'
import {
  buildStudyPlanningPrefsModel,
  normalizeEmptyStartPolicy,
  projectClassificationPromptOptOutFromPreferences,
  projectEmptyStartPolicyFromPreferences
} from '../../src/renderer/src/study-space/planning-study-prefs-ui'

describe('normalizeEmptyStartPolicy (STC-404)', () => {
  it('accepts known policies and fail-closes to ask_every_time', () => {
    expect(normalizeEmptyStartPolicy('ask_every_time')).toBe('ask_every_time')
    expect(normalizeEmptyStartPolicy('remember_quick_start')).toBe('remember_quick_start')
    expect(normalizeEmptyStartPolicy('remember_unattributed')).toBe('remember_unattributed')
    expect(normalizeEmptyStartPolicy(null)).toBe('ask_every_time')
    expect(normalizeEmptyStartPolicy(undefined)).toBe('ask_every_time')
    expect(normalizeEmptyStartPolicy('')).toBe('ask_every_time')
    expect(normalizeEmptyStartPolicy('yolo')).toBe('ask_every_time')
    expect(normalizeEmptyStartPolicy('remember_first_open')).toBe('ask_every_time')
  })
})

describe('projectEmptyStartPolicyFromPreferences / classification opt-out', () => {
  it('projects emptyStartPolicy with fail-closed default ask', () => {
    expect(projectEmptyStartPolicyFromPreferences(undefined)).toBe('ask_every_time')
    expect(projectEmptyStartPolicyFromPreferences(null as never)).toBe('ask_every_time')
    expect(projectEmptyStartPolicyFromPreferences({})).toBe('ask_every_time')
    expect(
      projectEmptyStartPolicyFromPreferences({ emptyStartPolicy: 'remember_quick_start' })
    ).toBe('remember_quick_start')
    expect(
      projectEmptyStartPolicyFromPreferences({ emptyStartPolicy: 'remember_unattributed' })
    ).toBe('remember_unattributed')
    expect(
      projectEmptyStartPolicyFromPreferences({ emptyStartPolicy: 'bogus' as never })
    ).toBe('ask_every_time')
  })

  it('projects classificationPromptOptOut only when true (restorable)', () => {
    expect(projectClassificationPromptOptOutFromPreferences(undefined)).toBe(false)
    expect(projectClassificationPromptOptOutFromPreferences({})).toBe(false)
    expect(
      projectClassificationPromptOptOutFromPreferences({ classificationPromptOptOut: false })
    ).toBe(false)
    expect(
      projectClassificationPromptOptOutFromPreferences({ classificationPromptOptOut: true })
    ).toBe(true)
    expect(
      projectClassificationPromptOptOutFromPreferences({
        classificationPromptOptOut: null as never
      })
    ).toBe(false)
  })
})

describe('buildStudyPlanningPrefsModel', () => {
  it('defaults to ask_every_time and lists three empty-start options', () => {
    const model = buildStudyPlanningPrefsModel({})
    expect(model.emptyStartPolicy).toBe('ask_every_time')
    expect(model.classificationPromptOptOut).toBe(false)
    expect(model.options.map((o) => o.value)).toEqual([
      'ask_every_time',
      'remember_quick_start',
      'remember_unattributed'
    ])
    expect(model.copy.title).toContain('偏好')
    expect(model.copy.classificationOptOutDetail).toContain('取消勾选')
  })

  it('reflects remembered policy and opt-out for restore UI', () => {
    const model = buildStudyPlanningPrefsModel({
      emptyStartPolicy: 'remember_unattributed',
      classificationPromptOptOut: true
    })
    expect(model.emptyStartPolicy).toBe('remember_unattributed')
    expect(model.classificationPromptOptOut).toBe(true)
  })
})
