/**
 * Pure category catalog projection (sole-authority demotion).
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeStudyPlanningCategories,
  projectCategoriesFromSnapshot
} from '../../src/shared/study-planning'
import {
  normalizeCategoriesForCanonical,
  projectTaskCategoriesFromSnapshot,
  toUiStudyTaskCategories
} from '../../src/renderer/src/study-space/planning-categories-ui'

describe('study-planning-categories pure', () => {
  it('always includes builtins and lowercases colors', () => {
    const next = normalizeStudyPlanningCategories([
      { id: 'study', name: '学习', color: '#ABCDEF', builtin: true }
    ])
    expect(next.map((c) => c.id)).toEqual(['study', 'entertainment', 'exercise'])
    expect(next[0]?.color).toBe('#abcdef')
  })

  it('projectCategoriesFromSnapshot fails closed on omit/empty', () => {
    expect(projectCategoriesFromSnapshot(undefined)).toBeNull()
    expect(projectCategoriesFromSnapshot(null)).toBeNull()
    expect(projectCategoriesFromSnapshot([])).toBeNull()
    expect(projectCategoriesFromSnapshot('nope')).toBeNull()
    const projected = projectCategoriesFromSnapshot([
      { id: 'custom-x1', name: '自定义', color: '#112233', builtin: false }
    ])
    expect(projected).not.toBeNull()
    expect(projected!.some((c) => c.id === 'custom-x1')).toBe(true)
  })

  it('maps to UI StudyTaskCategory shape', () => {
    const shared = normalizeStudyPlanningCategories([
      { id: 'custom-zz', name: '写作', color: '#445566', builtin: false }
    ])
    const ui = toUiStudyTaskCategories(shared)
    expect(ui.find((c) => c.id === 'custom-zz')?.name).toBe('写作')
    expect(projectTaskCategoriesFromSnapshot(shared)?.length).toBeGreaterThan(0)
    expect(normalizeCategoriesForCanonical(ui).find((c) => c.id === 'custom-zz')?.color).toBe(
      '#445566'
    )
  })
})
