import { describe, expect, it } from 'vitest'
import {
  buildMindMapCanvasLineDraft,
  canConnectMindMapLineEndpoints,
  mindMapLineCurveControlOffset,
  resolveMindMapLineEndpoint,
  resolveMindMapLineEndpoints,
  resolveMindMapLineEndpointOutwardNormal,
  resolveMindMapLineCurvePoint,
  resolveMindMapLineStyle,
  snapMindMapLinePoint,
  mindMapLineShapeSupportsCurvePoint,
  toFlexibleLineShape,
  type MindMapCanvasLineSnapTarget
} from '../../src/renderer/src/views/mindmap/mind-map-line-tool'

const topic: MindMapCanvasLineSnapTarget = {
  id: 'topic-1',
  kind: 'topic',
  x: 100,
  y: 50,
  width: 80,
  height: 40
}

const shape: MindMapCanvasLineSnapTarget = {
  id: 'shape-1',
  kind: 'shape',
  x: 300,
  y: 100,
  width: 120,
  height: 60
}

describe('mind map line tool geometry', () => {
  it('snaps a point inside a target and keeps the pointer coordinate as fallback', () => {
    const result = snapMindMapLinePoint({ x: 120, y: 70 }, [topic])

    expect(result).toEqual({
      point: { x: 120, y: 70 },
      target: { id: 'topic-1', kind: 'topic' }
    })
  })

  it('snaps a nearby point to the closest target border region', () => {
    const result = snapMindMapLinePoint({ x: 186, y: 70 }, [topic])

    expect(result).toEqual({
      point: { x: 186, y: 70 },
      target: { id: 'topic-1', kind: 'topic' }
    })
  })

  it('does not snap when the nearest border is outside the magnetic radius', () => {
    expect(snapMindMapLinePoint({ x: 210, y: 70 }, [topic])).toEqual({
      point: { x: 210, y: 70 }
    })
  })

  it('can resolve either topics or injected free-shape targets', () => {
    const result = snapMindMapLinePoint({ x: 302, y: 128 }, [topic, shape])

    expect(result.target).toEqual({ id: 'shape-1', kind: 'shape' })
  })

  it('anchors a bound endpoint to the border point closest to the pointer, not the opposite endpoint', () => {
    const snap = snapMindMapLinePoint({ x: 120, y: 70 }, [topic])
    const endpoint = resolveMindMapLineEndpoint(snap, { x: 300, y: 70 }, [topic])
    // The pointer at (120, 70) is equidistant from the top, bottom, and left
    // edges of the topic rect; the first candidate (top edge) wins. The
    // endpoint no longer jumps to the right edge just because the opposite
    // endpoint is to the right.
    expect(endpoint.target).toEqual({ id: 'topic-1', kind: 'topic' })
    expect(endpoint.x).toBe(120)
    expect(endpoint.y).toBe(50)
    expect(endpoint.borderParam).toBeCloseTo(Math.atan2(50 - 70, 120 - 140), 6)

    // Moving the opposite endpoint to the left does not change the resolved
    // border point — the endpoint stays where the user placed it.
    const leftFacing = snapMindMapLinePoint({ x: 120, y: 70 }, [topic])
    const leftEndpoint = resolveMindMapLineEndpoint(leftFacing, { x: 0, y: 70 }, [topic])
    expect(leftEndpoint.x).toBe(120)
    expect(leftEndpoint.y).toBe(50)
  })

  it('anchors connectors to the visible outline closest to the pointer, not the opposite endpoint', () => {
    const ellipse = {
      ...shape,
      shape: 'ellipse'
    } as MindMapCanvasLineSnapTarget
    const diamond = {
      ...shape,
      shape: 'diamond'
    } as MindMapCanvasLineSnapTarget
    const snap = {
      point: { x: 360, y: 130 },
      target: { id: shape.id, kind: shape.kind }
    } as const

    // The pointer sits at the shape centre, so the closest-border fallback
    // picks the right-most border point (deterministic). The endpoint no
    // longer aims toward the opposite endpoint at (480, 190).
    const ellipseEndpoint = resolveMindMapLineEndpoint(snap, { x: 480, y: 190 }, [ellipse])
    expect(ellipseEndpoint.x).toBeCloseTo(420, 3)
    expect(ellipseEndpoint.y).toBeCloseTo(130, 3)
    expect(ellipseEndpoint.target).toEqual({ id: 'shape-1', kind: 'shape' })
    expect(ellipseEndpoint.borderParam).toBeCloseTo(0, 6)

    // The diamond's closest polygon edge point to the centre is on the
    // upper-right edge; the endpoint follows the pointer, not the ray toward
    // (480, 190).
    const diamondEndpoint = resolveMindMapLineEndpoint(snap, { x: 480, y: 190 }, [diamond])
    expect(diamondEndpoint.x).toBeCloseTo(372, 3)
    expect(diamondEndpoint.y).toBeCloseTo(106, 3)
    expect(diamondEndpoint.target).toEqual({ id: 'shape-1', kind: 'shape' })

    // A ray from the centre is not the surface normal for either an ellipse
    // or a polygon edge. Curved paths need the true normal so their arrow
    // marker reaches the shape head-on.
    expect(resolveMindMapLineEndpointOutwardNormal(ellipseEndpoint, [ellipse])).toEqual(
      expect.objectContaining({ x: expect.closeTo(1, 5), y: expect.closeTo(0, 5) })
    )
    expect(resolveMindMapLineEndpointOutwardNormal(diamondEndpoint, [diamond])).toEqual(
      expect.objectContaining({ x: expect.closeTo(0.447214, 5), y: expect.closeTo(-0.894427, 5) })
    )
  })

  it('uses the effective topic outline for both boundary position and curve tangent', () => {
    const ellipseTopic: MindMapCanvasLineSnapTarget = {
      ...topic,
      shape: 'ellipse'
    }
    const snap = snapMindMapLinePoint({ x: 140, y: 70 }, [ellipseTopic])
    const endpoint = resolveMindMapLineEndpoint(snap, { x: 280, y: 150 }, [ellipseTopic])

    expect(endpoint).toMatchObject({ target: { id: 'topic-1', kind: 'topic' } })
    // Pointer at centre → deterministic right border point.
    expect(endpoint.x).toBeCloseTo(180, 3)
    expect(endpoint.y).toBeCloseTo(70, 3)
    expect(resolveMindMapLineEndpointOutwardNormal(endpoint, [ellipseTopic])).toEqual(
      expect.objectContaining({ x: expect.closeTo(1, 3), y: expect.closeTo(0, 3) })
    )
  })

  it('uses directed straight lines by default and preserves explicit style choices', () => {
    expect(resolveMindMapLineStyle({ active: true })).toEqual({
      lineShape: 'straight',
      beginArrow: undefined,
      endArrow: 'triangle',
      linePattern: undefined
    })

    expect(resolveMindMapLineStyle({
      active: true,
      lineShape: 'straight',
      beginArrow: 'dot',
      endArrow: 'none',
      linePattern: 'dash'
    })).toEqual({
      lineShape: 'straight',
      beginArrow: 'dot',
      endArrow: 'none',
      linePattern: 'dash'
    })
  })

  it('places a default curve point off the endpoint axis and preserves a dragged offset', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 200, y: 0 }

    expect(resolveMindMapLineCurvePoint(from, to)).toEqual({ x: 100, y: 36 })

    const dragged = { x: 118, y: -42 }
    const offset = mindMapLineCurveControlOffset(dragged, from, to)
    expect(offset).toEqual({ x: 18, y: -42 })
    expect(resolveMindMapLineCurvePoint(from, to, offset)).toEqual(dragged)
  })

  it('builds a draft with stable endpoint target references', () => {
    const draft = buildMindMapCanvasLineDraft(
      snapMindMapLinePoint({ x: 180, y: 70 }, [topic]),
      snapMindMapLinePoint({ x: 300, y: 130 }, [shape]),
      [topic, shape],
      { active: true, lineShape: 'angled', endArrow: 'diamond' }
    )

    expect(draft.from).toMatchObject({
      x: 180,
      y: 70,
      target: { id: 'topic-1', kind: 'topic' }
    })
    // The pointer at (180, 70) is on the topic's right edge; the endpoint
    // stays at the pointer's closest border point instead of re-aiming.
    expect(draft.from.borderParam).toBeCloseTo(0, 6)
    expect(draft.to).toMatchObject({
      x: 300,
      y: 130,
      target: { id: 'shape-1', kind: 'shape' }
    })
    expect(draft.to.borderParam).toBeCloseTo(Math.PI, 6)
    expect(draft.style).toEqual({
      lineShape: 'angled',
      beginArrow: undefined,
      endArrow: 'diamond',
      linePattern: undefined
    })
  })

  it('allows free standalone lines and distinct anchored connectors', () => {
    const topicSnap = snapMindMapLinePoint({ x: 140, y: 70 }, [topic, shape])
    const shapeSnap = snapMindMapLinePoint({ x: 360, y: 130 }, [topic, shape])
    const emptySnap = snapMindMapLinePoint({ x: 520, y: 260 }, [topic, shape])
    const otherEmptySnap = snapMindMapLinePoint({ x: 620, y: 320 }, [topic, shape])

    expect(canConnectMindMapLineEndpoints(topicSnap, shapeSnap, [topic, shape])).toBe(true)
    expect(canConnectMindMapLineEndpoints(topicSnap, topicSnap, [topic, shape])).toBe(false)
    // A connector anchored on one end may end on blank canvas.
    expect(canConnectMindMapLineEndpoints(topicSnap, emptySnap, [topic, shape])).toBe(true)
    // Two free points form a standalone line drawn on blank canvas.
    expect(canConnectMindMapLineEndpoints(emptySnap, otherEmptySnap, [topic, shape])).toBe(true)
    // A stale binding (target no longer present) is rejected.
    expect(canConnectMindMapLineEndpoints(
      { point: { x: 140, y: 70 }, target: { id: 'missing', kind: 'topic' } },
      shapeSnap,
      [topic, shape]
    )).toBe(false)

    expect(buildMindMapCanvasLineDraft(
      topicSnap,
      shapeSnap,
      [topic, shape],
      { active: true }
    )).toMatchObject({
      from: { target: { id: 'topic-1', kind: 'topic' } },
      to: { target: { id: 'shape-1', kind: 'shape' } }
    })
    expect(buildMindMapCanvasLineDraft(
      topicSnap,
      emptySnap,
      [topic, shape],
      { active: true }
    )).toMatchObject({
      from: { target: { id: 'topic-1', kind: 'topic' } },
      to: { x: 520, y: 260 }
    })
    expect(buildMindMapCanvasLineDraft(
      emptySnap,
      otherEmptySnap,
      [topic, shape],
      { active: true }
    )).toMatchObject({
      from: { x: 520, y: 260 },
      to: { x: 620, y: 320 }
    })
    expect(buildMindMapCanvasLineDraft(
      topicSnap,
      topicSnap,
      [topic, shape],
      { active: true }
    )).toBeNull()
  })

  it('keeps an anchored endpoint at a stable relative border position after the target moves', () => {
    // Draw a connector from the topic's right edge (pointer at 180, 70).
    const snap = snapMindMapLinePoint({ x: 180, y: 70 }, [topic])
    const initial = resolveMindMapLineEndpoint(snap, { x: 300, y: 70 }, [topic])
    expect(initial.x).toBe(180)
    expect(initial.y).toBe(70)
    expect(initial.borderParam).toBeCloseTo(0, 6) // ray angle 0 = right

    // Simulate the topic moving 50px to the right and 30px down.
    const movedTopic: MindMapCanvasLineSnapTarget = {
      ...topic,
      x: topic.x + 50,
      y: topic.y + 30
    }
    const resolved = resolveMindMapLineEndpoints(initial, { x: 300, y: 70 }, [movedTopic])
    // borderParam 0 (right) should re-trace to the new right edge, not the
    // old coordinate (180, 70) which is now inside the moved topic.
    expect(resolved.from.x).toBe(230) // movedTopic.x + width = 150 + 80
    expect(resolved.from.y).toBe(100) // movedTopic.y + height/2 = 80 + 20
    expect(resolved.from.borderParam).toBeCloseTo(0, 6)
  })

  it('does not re-aim an endpoint toward the opposite endpoint after a target moves', () => {
    // Topic at (100,50,80,40), shape at (300,100,120,60).
    // Draw from topic right edge (180,70) to shape left edge (300,130).
    const fromSnap = snapMindMapLinePoint({ x: 180, y: 70 }, [topic])
    const toSnap = snapMindMapLinePoint({ x: 300, y: 130 }, [shape])
    const draft = buildMindMapCanvasLineDraft(fromSnap, toSnap, [topic, shape], { active: true })!
    expect(draft.from.x).toBe(180)
    expect(draft.from.y).toBe(70)
    expect(draft.to.x).toBe(300)
    expect(draft.to.y).toBe(130)

    // Move the shape far to the right. Under the old "face opposite center"
    // model, the from-endpoint would re-aim toward the new shape center and
    // its coordinates would change. Under the parametric model it stays at
    // the same relative border spot (right edge of the topic).
    const movedShape: MindMapCanvasLineSnapTarget = {
      ...shape,
      x: 600,
      y: 200
    }
    const resolved = resolveMindMapLineEndpoints(draft.from, draft.to, [topic, movedShape])
    expect(resolved.from.x).toBe(180)
    expect(resolved.from.y).toBe(70)
  })
})

describe('toFlexibleLineShape', () => {
  it('maps base shapes to their flexible counterparts', () => {
    expect(toFlexibleLineShape('straight')).toBe('flexible-curved')
    expect(toFlexibleLineShape('angled')).toBe('flexible-angled')
    expect(toFlexibleLineShape('zigzag')).toBe('flexible-zigzag')
    expect(toFlexibleLineShape('curved')).toBe('flexible-curved')
  })

  it('passes through already-flexible shapes unchanged', () => {
    expect(toFlexibleLineShape('flexible-curved')).toBe('flexible-curved')
    expect(toFlexibleLineShape('flexible-angled')).toBe('flexible-angled')
    expect(toFlexibleLineShape('flexible-zigzag')).toBe('flexible-zigzag')
  })
})

describe('mindMapLineShapeSupportsCurvePoint', () => {
  it('returns true for curved and flexible-curved shapes', () => {
    expect(mindMapLineShapeSupportsCurvePoint('curved')).toBe(true)
    expect(mindMapLineShapeSupportsCurvePoint('flexible-curved')).toBe(true)
  })

  it('returns true for flexible-angled and flexible-zigzag so they carry a draggable midpoint', () => {
    expect(mindMapLineShapeSupportsCurvePoint('flexible-angled')).toBe(true)
    expect(mindMapLineShapeSupportsCurvePoint('flexible-zigzag')).toBe(true)
  })

  it('returns false for base non-curved shapes that have no curve point until promoted', () => {
    expect(mindMapLineShapeSupportsCurvePoint('straight')).toBe(false)
    expect(mindMapLineShapeSupportsCurvePoint('angled')).toBe(false)
    expect(mindMapLineShapeSupportsCurvePoint('zigzag')).toBe(false)
  })
})
