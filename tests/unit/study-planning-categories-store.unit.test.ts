/**
 * Store set_categories sole-authority catalog.
 */
import { describe, expect, it } from 'vitest'
import { StudyPlanningStore } from '../../src/shared/study-planning'

describe('StudyPlanningStore set_categories', () => {
  it('stores normalized catalog with builtins + custom', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const snap = store.readSnapshot()
    const result = store.applyCommand(
      {
        actionId: 'cat-1',
        type: 'set_categories',
        payload: {
          categories: [
            { id: 'study', name: '学习', color: '#123456', builtin: true },
            { id: 'custom-abc123', name: '论文', color: '#AABBCC', builtin: false }
          ]
        }
      },
      snap.revision
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.categories).toBeDefined()
    const cats = result.snapshot.categories!
    expect(cats.find((c) => c.id === 'study')?.color).toBe('#123456')
    expect(cats.find((c) => c.id === 'custom-abc123')?.name).toBe('论文')
    expect(cats.some((c) => c.id === 'entertainment')).toBe(true)
    expect(cats.some((c) => c.id === 'exercise')).toBe(true)
  })

  it('rejects missing categories array', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const result = store.applyCommand(
      {
        actionId: 'cat-2',
        type: 'set_categories',
        payload: {}
      },
      store.readSnapshot().revision
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_command')
  })

  it('dedupes custom ids and caps junk', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const result = store.applyCommand(
      {
        actionId: 'cat-3',
        type: 'set_categories',
        payload: {
          categories: [
            { id: 'custom-dup', name: 'A', color: '#111111', builtin: false },
            { id: 'custom-dup', name: 'B', color: '#222222', builtin: false },
            { id: 'not-valid', name: 'X', color: '#333333', builtin: false }
          ]
        }
      },
      store.readSnapshot().revision
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const custom = result.snapshot.categories!.filter((c) => !c.builtin)
    expect(custom).toHaveLength(1)
    expect(custom[0]?.id).toBe('custom-dup')
    expect(custom[0]?.name).toBe('A')
  })
})
