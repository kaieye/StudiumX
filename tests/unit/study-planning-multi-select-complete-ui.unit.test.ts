/**
 * Pure multi-select complete UI helpers (STC-408 remainder).
 */
import { describe, expect, it } from 'vitest'
import {
  buildMultiSelectCompleteToolbarModel,
  collectOpenTaskIdsForMultiSelectComplete,
  pruneMultiSelectTaskIds,
  resolveMultiSelectCompletePayload,
  selectAllVisibleOpenTaskIds,
  toggleMultiSelectTaskId
} from '../../src/renderer/src/study-space/planning-multi-select-complete-ui'

const tasks = [
  { id: 'a', done: false, title: 'A' },
  { id: 'b', done: true, title: 'B' },
  { id: 'c', done: false, title: 'C' },
  { id: 'd', done: false, title: 'D' }
]

describe('planning-multi-select-complete-ui (STC-408 remainder)', () => {
  it('collects all open tasks when selectedIds omitted/null', () => {
    expect(collectOpenTaskIdsForMultiSelectComplete({ tasks })).toEqual(['a', 'c', 'd'])
    expect(collectOpenTaskIdsForMultiSelectComplete({ tasks, selectedIds: null })).toEqual([
      'a',
      'c',
      'd'
    ])
  })

  it('empty selectedIds is fail-closed empty (not all open)', () => {
    expect(collectOpenTaskIdsForMultiSelectComplete({ tasks, selectedIds: [] })).toEqual([])
  })

  it('intersects selection with open only (fail-closed)', () => {
    expect(
      collectOpenTaskIdsForMultiSelectComplete({
        tasks,
        selectedIds: ['b', 'c', 'missing', '  d  ']
      })
    ).toEqual(['c', 'd'])
  })

  it('toggles open ids and refuses done/missing adds', () => {
    expect(
      toggleMultiSelectTaskId({
        selectedIds: ['a'],
        taskId: 'c',
        tasks
      })
    ).toEqual(['a', 'c'])

    expect(
      toggleMultiSelectTaskId({
        selectedIds: ['a', 'c'],
        taskId: 'a',
        tasks
      })
    ).toEqual(['c'])

    expect(
      toggleMultiSelectTaskId({
        selectedIds: ['a'],
        taskId: 'b',
        tasks
      })
    ).toEqual(['a'])

    expect(
      toggleMultiSelectTaskId({
        selectedIds: ['a'],
        taskId: 'missing',
        tasks
      })
    ).toEqual(['a'])
  })

  it('prunes completed and removed ids', () => {
    expect(
      pruneMultiSelectTaskIds({
        selectedIds: ['a', 'b', 'c', 'gone'],
        tasks
      })
    ).toEqual(['a', 'c'])
  })

  it('selectAllVisibleOpenTaskIds replace/union modes', () => {
    expect(
      selectAllVisibleOpenTaskIds({
        visibleTasks: [tasks[0]!, tasks[1]!, tasks[2]!],
        selectedIds: ['d'],
        mode: 'replace'
      })
    ).toEqual(['a', 'c'])

    expect(
      selectAllVisibleOpenTaskIds({
        visibleTasks: [tasks[0]!],
        selectedIds: ['d'],
        mode: 'union'
      })
    ).toEqual(['d', 'a'])
  })

  it('resolve payload preserves open order and drops done; empty stays empty', () => {
    expect(
      resolveMultiSelectCompletePayload({
        tasks,
        selectedIds: ['d', 'b', 'a', 'a']
      })
    ).toEqual(['a', 'd'])
    expect(
      resolveMultiSelectCompletePayload({
        tasks,
        selectedIds: []
      })
    ).toEqual([])
  })

  it('builds toolbar model with complete disabled when empty', () => {
    const empty = buildMultiSelectCompleteToolbarModel({
      tasks,
      selectedIds: []
    })
    expect(empty.canComplete).toBe(false)
    expect(empty.selectedCount).toBe(0)
    expect(empty.copy.completeLabel).toBe('完成')
    expect(empty.copy.emptySelectionHint).toContain('勾选')

    const ready = buildMultiSelectCompleteToolbarModel({
      tasks,
      selectedIds: ['a', 'b', 'c']
    })
    expect(ready.canComplete).toBe(true)
    expect(ready.selectedCount).toBe(2)
    expect(ready.completableIds).toEqual(['a', 'c'])
    expect(ready.copy.completeLabel).toContain('2')
  })
})
