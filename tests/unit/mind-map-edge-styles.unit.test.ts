import { describe, expect, it } from 'vitest'
import type { MindMapLayoutNode } from '../../src/renderer/src/views/mindmap/mind-map-layout'
import {
  braceEdgePath,
  curveEdgePath,
  edgeStrokeWidth,
  elbowEdgePath,
  fishboneEdgePath,
  matrixEdgePath,
  resolveEdgePath,
  straightEdgePath,
  timelineEdgePath
} from '../../src/renderer/src/views/mindmap/mind-map-edge-styles'

const from: MindMapLayoutNode = {
  id: 'from',
  title: 'From',
  x: 100,
  y: 50,
  width: 80,
  height: 36,
  depth: 0,
  collapsed: false,
  branchIndex: 0
}

const right: MindMapLayoutNode = {
  ...from,
  id: 'right',
  x: 280,
  y: 120
}

const left: MindMapLayoutNode = {
  ...from,
  id: 'left',
  x: -100,
  y: 120
}

describe('mind map edge styles', () => {
  it('keeps far horizontal branches attached to the left/right node edges', () => {
    const farAbove: MindMapLayoutNode = { ...right, id: 'far-above', y: -420 }

    expect(curveEdgePath(from, farAbove, 'horizontal')).toMatch(/^M 180 68 C /)
    expect(resolveEdgePath(from, farAbove, 'curve', 'horizontal')).toBe(
      curveEdgePath(from, farAbove, 'horizontal')
    )
  })

  it('connects right-facing branches from parent right edge to child left edge', () => {
    expect(curveEdgePath(from, right)).toContain('M 180 68')
    expect(curveEdgePath(from, right)).toContain('280 138')
    expect(straightEdgePath(from, right)).toBe('M 180 68 L 280 138')
  })

  it('fans horizontal branches out from the nearest point on the parent edge', () => {
    expect(curveEdgePath(from, right)).toBe('M 180 68 C 216 68, 244 138, 280 138')
    expect(straightEdgePath(from, right)).toBe('M 180 68 L 280 138')
  })

  it('reverses horizontal endpoints for left-facing branches', () => {
    expect(curveEdgePath(from, left)).toContain('M 100 68')
    expect(curveEdgePath(from, left)).toContain('-20 138')
    expect(straightEdgePath(from, left)).toBe('M 100 68 L -20 138')
  })

  it('keeps elbow connectors directional on both sides', () => {
    const rightPath = elbowEdgePath(from, right)
    const leftPath = elbowEdgePath(from, left)
    expect(rightPath.startsWith('M 180 68 L ')).toBe(true)
    expect(leftPath.startsWith('M 100 68 L ')).toBe(true)
    expect(rightPath.endsWith('L 280 138')).toBe(true)
    expect(leftPath.endsWith('L -20 138')).toBe(true)
  })
})

const below: MindMapLayoutNode = {
  ...from,
  id: 'below',
  x: 120,
  y: 180
}

const above: MindMapLayoutNode = {
  ...from,
  id: 'above',
  x: 120,
  y: -80
}

describe('vertical mind map edge styles', () => {
  it('connects down-facing branches from parent bottom to child top', () => {
    expect(straightEdgePath(from, below)).toBe('M 140 86 L 160 180')
    expect(curveEdgePath(from, below)).toContain('M 140 86 C 140 ')
    expect(curveEdgePath(from, below)).toContain('160 180')
    expect(elbowEdgePath(from, below).startsWith('M 140 86 L 140 ')).toBe(true)
    expect(elbowEdgePath(from, below).endsWith('L 160 180')).toBe(true)
  })

  it('reverses vertical endpoints for up-facing branches', () => {
    expect(straightEdgePath(from, above)).toBe('M 140 50 L 160 -44')
    expect(curveEdgePath(from, above)).toContain('M 140 50 C 140 ')
    expect(curveEdgePath(from, above)).toContain('160 -44')
    expect(elbowEdgePath(from, above).startsWith('M 140 50 L 140 ')).toBe(true)
    expect(elbowEdgePath(from, above).endsWith('L 160 -44')).toBe(true)
  })
})

describe('mind map edge stroke width', () => {
  it('tapers from thick first-level to thin deep branches by default', () => {
    // Xmind M01 original taper: 4 (root→L1), 3 (L1→L2), 2 deeper.
    expect(edgeStrokeWidth(1)).toBe(4)
    expect(edgeStrokeWidth(2)).toBe(3)
    expect(edgeStrokeWidth(3)).toBe(2)
  })

  it('multiplies the base width by the per-sheet scale', () => {
    expect(edgeStrokeWidth(1, 1.5)).toBe(6)
    expect(edgeStrokeWidth(2, 0.75)).toBe(2.25)
    expect(edgeStrokeWidth(3, 1)).toBe(2)
  })

  it('ignores non-finite or non-positive scales', () => {
    expect(edgeStrokeWidth(1, Number.NaN)).toBe(4)
    expect(edgeStrokeWidth(1, 0)).toBe(4)
    expect(edgeStrokeWidth(1, -1)).toBe(4)
  })
})

describe('structure connector languages', () => {
  it('resolves family-specific connector styles without falling back to a curve', () => {
    expect(resolveEdgePath(from, right, 'timeline')).toBe(timelineEdgePath(from, right))
    expect(resolveEdgePath(from, right, 'fishbone')).toBe(fishboneEdgePath(from, right))
    expect(resolveEdgePath(from, right, 'matrix')).toBe(matrixEdgePath(from, right))
    expect(resolveEdgePath(from, right, 'brace')).toBe(braceEdgePath(from, right))
    expect(resolveEdgePath(from, right, 'fishbone')).toBe(straightEdgePath(from, right))
    expect(resolveEdgePath(from, right, 'timeline')).not.toBe(curveEdgePath(from, right))
  })
})
