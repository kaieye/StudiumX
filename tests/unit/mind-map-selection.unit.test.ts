import { describe, expect, it } from 'vitest'

import {
  clearMindMapSelection,
  isMindMapNodeSelected,
  selectAllMindMapNodes,
  toggleMindMapNodeSelection
} from '../../src/shared/mindmap/domain/selection'

describe('mind-map selection helpers', () => {
  it('toggles a node immutably while preserving order', () => {
    const source = ['root', 'child-a'] as const

    const added = toggleMindMapNodeSelection(source, 'child-b')
    const removed = toggleMindMapNodeSelection(added, 'child-a')

    expect(added).toEqual(['root', 'child-a', 'child-b'])
    expect(removed).toEqual(['root', 'child-b'])
    expect(source).toEqual(['root', 'child-a'])
  })

  it('normalizes duplicate ids before toggling', () => {
    expect(toggleMindMapNodeSelection(['a', 'a', 'b'], 'a')).toEqual(['b'])
    expect(toggleMindMapNodeSelection(['a', 'a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('selects all supplied ids in first-seen order without mutating the input', () => {
    const nodeIds = ['root', 'child', 'root', 'leaf']

    expect(selectAllMindMapNodes(nodeIds)).toEqual(['root', 'child', 'leaf'])
    expect(nodeIds).toEqual(['root', 'child', 'root', 'leaf'])
  })

  it('clears to a fresh empty selection', () => {
    const first = clearMindMapSelection()
    const second = clearMindMapSelection()

    expect(first).toEqual([])
    expect(second).toEqual([])
    expect(first).not.toBe(second)
  })

  it('reports membership without changing selection state', () => {
    const selection = ['root', 'child'] as const

    expect(isMindMapNodeSelected(selection, 'child')).toBe(true)
    expect(isMindMapNodeSelected(selection, 'missing')).toBe(false)
    expect(selection).toEqual(['root', 'child'])
  })
})
