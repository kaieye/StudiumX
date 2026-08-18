import { describe, expect, it } from 'vitest'
import type { MindMapLayoutNode } from '../../src/renderer/src/views/mindmap/mind-map-layout'
import {
  bightEdgePath,
  braceEdgePath,
  curveEdgePath,
  edgeStrokeWidth,
  elbowEdgePath,
  fishboneEdgePath,
  foldEdgePath,
  lineDashPattern,
  matrixEdgePath,
  resolveEdgePath,
  resolveLinePatternWithReport,
  roundedElbowEdgePath,
  roundedFoldEdgePath,
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
  branchIndex: 0,
  branchKey: 'from'
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

  it('joins horizontal branches to underline topic baselines', () => {
    const underlinedParent: MindMapLayoutNode = { ...from, shape: 'underline' }
    const underlinedChild: MindMapLayoutNode = { ...right, shape: 'underline' }

    // The visible underline spans y=86 on the parent and y=156 on the child.
    // Using those exact coordinates lets the node underline bridge incoming
    // and outgoing branch paths without a detached vertical gap.
    expect(straightEdgePath(underlinedParent, underlinedChild, 'horizontal'))
      .toBe('M 180 86 L 280 156')
    expect(curveEdgePath(from, underlinedChild, 'horizontal')).toBe(
      'M 180 68 C 216 68, 244 156, 280 156'
    )
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

describe('extended connector shapes', () => {
  it('produces a distinct rounded elbow sharing elbow endpoints', () => {
    const path = roundedElbowEdgePath(from, right)
    expect(path.startsWith('M 180 68 L ')).toBe(true)
    expect(path.endsWith('L 280 138')).toBe(true)
    expect(path).not.toBe(elbowEdgePath(from, right))
    expect(path).toContain('Q ')
  })

  it('renders a bight with a square pocket on the middle segment', () => {
    const path = bightEdgePath(from, right)
    expect(path.startsWith('M 180 68 L ')).toBe(true)
    expect(path.endsWith('L 280 138')).toBe(true)
    // The pocket detours off the horizontal mid line (midY=103, notch 10),
    // dropping a small square bump below the line.
    expect(path).toContain('L 220 103 L 220 113 L 240 113 L 240 103')
  })

  it('renders a two-step fold with a horizontal shelf', () => {
    const path = foldEdgePath(from, right)
    expect(path.startsWith('M 180 68 L ')).toBe(true)
    expect(path.endsWith('L 280 138')).toBe(true)
    expect(path).toContain('L 214 68 L 214 103 L 246 103 L 246 138')
  })

  it('renders a rounded fold with softened corners', () => {
    const path = roundedFoldEdgePath(from, right)
    expect(path.startsWith('M 180 68 L ')).toBe(true)
    expect(path.endsWith('L 280 138')).toBe(true)
    expect(path).toContain('Q ')
  })

  it('keeps bight/fold/rounded-fold visible for a child level with its parent', () => {
    // A level child (y2 === y1) used to collapse these to a plain straight
    // line; the notch/shelf must stay visible instead.
    const level: MindMapLayoutNode = { ...right, y: 50 } // child centre y = 68 == parent
    expect(bightEdgePath(from, level)).toContain('L 220 78 L 240 78')
    expect(foldEdgePath(from, level)).toContain('L 214 84 L 246 84')
    expect(roundedFoldEdgePath(from, level)).toContain('Q ')
  })

  it('resolves every extended connector style to its own generator', () => {
    expect(resolveEdgePath(from, right, 'rounded-elbow')).toBe(roundedElbowEdgePath(from, right))
    expect(resolveEdgePath(from, right, 'bight')).toBe(bightEdgePath(from, right))
    expect(resolveEdgePath(from, right, 'fold')).toBe(foldEdgePath(from, right))
    expect(resolveEdgePath(from, right, 'rounded-fold')).toBe(roundedFoldEdgePath(from, right))
  })
})

describe('mind map edge stroke width', () => {
  it('tapers from thick first-level to thin deep branches by default', () => {
    // native M01 original taper: 4 (root→L1), 3 (L1→L2), 2 deeper.
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

describe('resolveLinePatternWithReport (unknown line-pattern degradation)', () => {
  it('keeps lineDashPattern backward compatible for every accepted pattern', () => {
    expect(resolveLinePatternWithReport('solid').dash).toBe(lineDashPattern('solid'))
    expect(resolveLinePatternWithReport('dash').dash).toBe(lineDashPattern('dash'))
    expect(resolveLinePatternWithReport('hand-drawn-solid').dash).toBe(lineDashPattern('hand-drawn-solid'))
    expect(resolveLinePatternWithReport('hand-drawn-dash').dash).toBe(lineDashPattern('hand-drawn-dash'))
    expect(resolveLinePatternWithReport(undefined).dash).toBe(lineDashPattern(undefined))
  })

  it('resolves every accepted pattern without degradation', () => {
    expect(resolveLinePatternWithReport('solid')).toEqual({ dash: undefined, degraded: false })
    expect(resolveLinePatternWithReport('dash')).toEqual({ dash: '6 4', degraded: false })
    expect(resolveLinePatternWithReport('hand-drawn-solid')).toEqual({ dash: undefined, degraded: false })
    expect(resolveLinePatternWithReport('hand-drawn-dash')).toEqual({ dash: '6 4', degraded: false })
    expect(resolveLinePatternWithReport(undefined)).toEqual({ dash: undefined, degraded: false })
  })

  it('flags unknown line patterns as degraded with the stable solid fallback', () => {
    for (const pattern of ['dotted', 'zigzag', 'double-dash', 'wavy', 'external.linePattern.curly']) {
      const resolved = resolveLinePatternWithReport(pattern)
      expect(resolved.degraded, `expected ${JSON.stringify(pattern)} to degrade`).toBe(true)
      // The stable fallback renders the same solid dash as the `solid` token.
      expect(resolved.dash).toBe(undefined)
    }
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
