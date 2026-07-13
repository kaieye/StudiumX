import { describe, expect, it, beforeEach } from 'vitest'
import {
  addStudyTaskCategory,
  builtinStudyTaskCategories,
  normalizeStudyTaskCategories,
  normalizeStudyTaskCategoryId,
  persistStudyTaskCategories,
  readStudyTaskCategories,
  removeStudyTaskCategory,
  updateStudyTaskCategory
} from '../../src/renderer/src/study-space/taskCategories'
import { normalizeStudyTasks } from '../../src/renderer/src/study-space/domain'
import { updateStudyTask, addScheduledStudyTask } from '../../src/renderer/src/study-space/session/transitions'
import { defaultStudySnapshot } from '../../src/renderer/src/study-space/constants'

describe('study task categories', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('includes builtin 学习 / 娱乐 / 锻炼 categories', () => {
    expect(builtinStudyTaskCategories.map((item) => item.name)).toEqual(['学习', '娱乐', '锻炼'])
    expect(normalizeStudyTaskCategories([])).toHaveLength(3)
  })

  it('allows custom categories with bound colors', () => {
    const result = addStudyTaskCategory(normalizeStudyTaskCategories([]), {
      name: '科研',
      color: '#6f8fa8'
    })
    expect(result.category?.name).toBe('科研')
    expect(result.category?.color).toBe('#6f8fa8')
    expect(result.category?.builtin).toBe(false)
    expect(result.categories).toHaveLength(4)
  })

  it('does not remove builtin categories', () => {
    const categories = normalizeStudyTaskCategories([])
    expect(removeStudyTaskCategory(categories, 'study')).toEqual(categories)
  })

  it('updates and persists builtin category colors', () => {
    const categories = normalizeStudyTaskCategories([])
    const next = updateStudyTaskCategory(categories, 'study', { color: '#123456' })
    expect(next.find((item) => item.id === 'study')?.color).toBe('#123456')
    expect(normalizeStudyTaskCategories(next).find((item) => item.id === 'study')?.color).toBe('#123456')
    persistStudyTaskCategories(next)
    expect(readStudyTaskCategories().find((item) => item.id === 'study')?.color).toBe('#123456')
  })

  it('normalizes task category ids and updates tasks', () => {
    expect(normalizeStudyTaskCategoryId('study')).toBe('study')
    expect(normalizeStudyTaskCategoryId('custom-abc123')).toBe('custom-abc123')
    expect(normalizeStudyTaskCategoryId('nope')).toBeUndefined()

    const tasks = normalizeStudyTasks([
      { id: 'a', title: '读论文', done: false, categoryId: 'study' },
      { id: 'b', title: '无效', done: false, categoryId: 'bad' }
    ])
    expect(tasks[0]?.categoryId).toBe('study')
    expect(tasks[1]?.categoryId).toBe('study')

    const added = addScheduledStudyTask(
      defaultStudySnapshot,
      '晨跑',
      'task-run',
      { weekday: 0, startMinutes: 7 * 60, endMinutes: 8 * 60 },
      'exercise'
    )
    expect(added.added).toBe(true)
    expect(added.snapshot.tasks[0]?.categoryId).toBe('exercise')

    const updated = updateStudyTask(added.snapshot, 'task-run', { categoryId: 'entertainment' })
    expect(updated.updated).toBe(true)
    expect(updated.snapshot.tasks.find((task) => task.id === 'task-run')?.categoryId).toBe('entertainment')

    const cleared = updateStudyTask(updated.snapshot, 'task-run', { categoryId: null })
    expect(cleared.snapshot.tasks.find((task) => task.id === 'task-run')?.categoryId).toBe('study')
  })
})
