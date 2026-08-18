import { describe, expect, it } from 'vitest'

import {
  clearMindMapSelection,
  isMindMapNodeSelected,
  selectMindMapLinesInRectangle,
  selectMindMapNodesInRectangle,
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

  it('selects nodes intersecting a marquee in either drag direction', () => {
    const nodes = [
      { id: 'root', x: 10, y: 10, width: 40, height: 20 },
      { id: 'child-a', x: 80, y: 20, width: 30, height: 20 },
      { id: 'child-b', x: 150, y: 60, width: 30, height: 20 }
    ]

    expect(selectMindMapNodesInRectangle(nodes, {
      left: 180,
      top: 100,
      right: 0,
      bottom: 0
    })).toEqual(['root', 'child-a', 'child-b'])
  })

  it('uses rectangle intersection and keeps node order without duplicates', () => {
    const nodes = [
      { id: 'first', x: 0, y: 0, width: 20, height: 20 },
      { id: 'first', x: 2, y: 2, width: 4, height: 4 },
      { id: 'edge', x: 40, y: 40, width: 10, height: 10 },
      { id: 'outside', x: 100, y: 100, width: 10, height: 10 }
    ]

    expect(selectMindMapNodesInRectangle(nodes, {
      left: 20,
      top: 20,
      right: 45,
      bottom: 45
    })).toEqual(['first', 'edge'])
  })
})

describe('mind-map line marquee helpers', () => {
  it('selects lines whose segments cross the marquee in either drag direction', () => {
    const lines = [
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 'b', points: [{ x: 200, y: 200 }, { x: 300, y: 300 }] }
    ]

    // Drag right-to-left so left > right; the box still crosses line a.
    expect(selectMindMapLinesInRectangle(lines, {
      left: 60, top: -10, right: 40, bottom: 10
    })).toEqual(['a'])
  })

  it('selects a line whose bounding box sits fully inside the marquee', () => {
    const lines = [
      { id: 'short', points: [{ x: 50, y: 50 }, { x: 60, y: 60 }] }
    ]

    expect(selectMindMapLinesInRectangle(lines, {
      left: 0, top: 0, right: 100, bottom: 100
    })).toEqual(['short'])
  })

  it('selects a curved line sampled at its curve control point', () => {
    const lines = [
      // Endpoints both above the box, but the curve dips through it.
      { id: 'curve', points: [{ x: 0, y: -50 }, { x: 100, y: -50 }, { x: 50, y: 50 }] }
    ]

    expect(selectMindMapLinesInRectangle(lines, {
      left: 40, top: 40, right: 60, bottom: 60
    })).toEqual(['curve'])
  })

  it('rejects a line whose bounding box does not overlap the marquee', () => {
    const lines = [
      { id: 'far', points: [{ x: 1000, y: 1000 }, { x: 1100, y: 1100 }] }
    ]

    expect(selectMindMapLinesInRectangle(lines, {
      left: 0, top: 0, right: 100, bottom: 100
    })).toEqual([])
  })

  it('keeps line order and drops duplicates without mutating the input', () => {
    const lines = [
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 'b', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] }
    ]

    expect(selectMindMapLinesInRectangle(lines, {
      left: -10, top: -10, right: 110, bottom: 110
    })).toEqual(['a', 'b'])
  })
})
