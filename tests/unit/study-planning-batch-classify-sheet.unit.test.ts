/**
 * Pure model tests for batch classify sheet (STC-408).
 */
import { describe, expect, it } from 'vitest'
import {
  buildBatchClassifySheetModel,
  collectInboxTaskIdsForBatchClassify,
  shouldSuppressClassificationPromptStorm
} from '../../src/shared/study-planning'

describe('batch classify sheet model (STC-408)', () => {
  it('collects all inbox tasks when no selection', () => {
    const ids = collectInboxTaskIdsForBatchClassify({
      tasks: [
        { id: 'a', categoryId: null },
        { id: 'b', categoryId: 'study' },
        { id: 'c', categoryId: '' },
        { id: 'd' }
      ]
    })
    expect(ids).toEqual(['a', 'c', 'd'])
  })

  it('intersects selection with inbox only (fail-closed)', () => {
    const ids = collectInboxTaskIdsForBatchClassify({
      tasks: [
        { id: 'a', categoryId: null },
        { id: 'b', categoryId: 'study' },
        { id: 'c', categoryId: null }
      ],
      selectedIds: ['b', 'c', 'missing']
    })
    expect(ids).toEqual(['c'])
  })

  it('suppresses prompt storm only for batch complete or import migration', () => {
    expect(shouldSuppressClassificationPromptStorm({})).toBe(false)
    expect(shouldSuppressClassificationPromptStorm({ isBatchComplete: false })).toBe(false)
    expect(shouldSuppressClassificationPromptStorm({ isBatchComplete: true })).toBe(true)
    expect(shouldSuppressClassificationPromptStorm({ isImportMigration: true })).toBe(true)
  })

  it('builds model with count copy and never invents categories', () => {
    const model = buildBatchClassifySheetModel({
      tasks: [
        { id: 'a', title: '  线性代数  ' },
        { id: 'b', title: '  ' },
        { id: 'c', title: 'skip' }
      ],
      taskIds: ['a', 'b'],
      categories: [
        { id: 'study', name: '学习', color: '#8197aa' },
        { id: '', name: 'x' }
      ]
    })
    expect(model.selectedCount).toBe(2)
    expect(model.taskIds).toEqual(['a', 'b'])
    expect(model.tasks[0]?.title).toBe('线性代数')
    expect(model.tasks[1]?.title).toBe('未命名任务')
    expect(model.categories).toEqual([{ id: 'study', name: '学习', color: '#8197aa' }])
    expect(model.copy.title).toContain('2')
    expect(model.copy.description).toContain('不会弹出逐条提示')
  })

  it('empty taskIds yields empty selection model', () => {
    const model = buildBatchClassifySheetModel({
      tasks: [{ id: 'a', title: 'x' }],
      taskIds: [],
      categories: [{ id: 'study', name: '学习' }]
    })
    expect(model.selectedCount).toBe(0)
    expect(model.copy.emptyTasksHint).toContain('没有')
  })
})
