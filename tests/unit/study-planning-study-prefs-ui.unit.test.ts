/**
 * Pure model tests for study planning prefs UI.
 * Default empty-start category: other.
 */
import { describe, expect, it } from 'vitest'
import {
  buildStudyPlanningPrefsModel,
  normalizeEmptyStartCategoryId,
  normalizeEmptyStartPolicy,
  projectClassificationPromptOptOutFromPreferences,
  projectEmptyStartCategoryIdFromPreferences,
  projectEmptyStartPolicyFromPreferences
} from '../../src/renderer/src/study-space/planning-study-prefs-ui'

describe('normalizeEmptyStartPolicy (STC-404)', () => {
  it('accepts known policies and defaults to remember_quick_start', () => {
    expect(normalizeEmptyStartPolicy('ask_every_time')).toBe('ask_every_time')
    expect(normalizeEmptyStartPolicy('remember_quick_start')).toBe('remember_quick_start')
    expect(normalizeEmptyStartPolicy('remember_unattributed')).toBe('remember_unattributed')
    expect(normalizeEmptyStartPolicy(null)).toBe('remember_quick_start')
    expect(normalizeEmptyStartPolicy(undefined)).toBe('remember_quick_start')
    expect(normalizeEmptyStartPolicy('')).toBe('remember_quick_start')
    expect(normalizeEmptyStartPolicy('yolo')).toBe('remember_quick_start')
    expect(normalizeEmptyStartPolicy('remember_first_open')).toBe('remember_quick_start')
  })
})

describe('normalizeEmptyStartCategoryId / projectEmptyStartCategoryIdFromPreferences', () => {
  it('defaults to other and accepts builtin/custom ids', () => {
    expect(normalizeEmptyStartCategoryId(null)).toBe('other')
    expect(normalizeEmptyStartCategoryId(undefined)).toBe('other')
    expect(normalizeEmptyStartCategoryId('study')).toBe('study')
    expect(normalizeEmptyStartCategoryId('other')).toBe('other')
    expect(normalizeEmptyStartCategoryId('custom-abc123')).toBe('custom-abc123')
    expect(normalizeEmptyStartCategoryId('bogus')).toBe('other')
    expect(normalizeEmptyStartCategoryId('study', ['other'])).toBe('other')
    expect(projectEmptyStartCategoryIdFromPreferences(undefined)).toBe('other')
    expect(projectEmptyStartCategoryIdFromPreferences({})).toBe('other')
    expect(
      projectEmptyStartCategoryIdFromPreferences({ emptyStartCategoryId: 'exercise' })
    ).toBe('exercise')
  })
})

describe('projectEmptyStartPolicyFromPreferences / classification opt-out', () => {
  it('projects emptyStartPolicy with default remember_quick_start', () => {
    expect(projectEmptyStartPolicyFromPreferences(undefined)).toBe('remember_quick_start')
    expect(projectEmptyStartPolicyFromPreferences(null as never)).toBe('remember_quick_start')
    expect(projectEmptyStartPolicyFromPreferences({})).toBe('remember_quick_start')
    expect(
      projectEmptyStartPolicyFromPreferences({ emptyStartPolicy: 'remember_quick_start' })
    ).toBe('remember_quick_start')
    expect(
      projectEmptyStartPolicyFromPreferences({ emptyStartPolicy: 'remember_unattributed' })
    ).toBe('remember_unattributed')
    expect(
      projectEmptyStartPolicyFromPreferences({ emptyStartPolicy: 'ask_every_time' })
    ).toBe('ask_every_time')
    expect(
      projectEmptyStartPolicyFromPreferences({ emptyStartPolicy: 'bogus' as never })
    ).toBe('remember_quick_start')
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
  it('defaults to category other and still lists legacy policy options', () => {
    const model = buildStudyPlanningPrefsModel({})
    expect(model.emptyStartPolicy).toBe('remember_quick_start')
    expect(model.emptyStartCategoryId).toBe('other')
    expect(model.classificationPromptOptOut).toBe(false)
    expect(model.options.map((o) => o.value)).toEqual([
      'remember_quick_start',
      'ask_every_time',
      'remember_unattributed'
    ])
    expect(model.copy.title).toContain('空启动')
    expect(model.copy.emptyStartLabel).toContain('空启动')
  })

  it('reflects selected category for restore UI', () => {
    const model = buildStudyPlanningPrefsModel({
      emptyStartCategoryId: 'study',
      classificationPromptOptOut: true
    })
    expect(model.emptyStartCategoryId).toBe('study')
    expect(model.classificationPromptOptOut).toBe(true)
  })
})
