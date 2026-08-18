import { describe, expect, it } from 'vitest'
import {
  buildMindMapCanvasLineDraft,
  canConnectMindMapLineEndpoints,
  mindMapLineCurveControlOffset,
  resolveMindMapLineEndpoint,
  resolveMindMapLineEndpointOutwardNormal,
  resolveMindMapLineCurvePoint,
  resolveMindMapLineStyle,
  snapMindMapLinePoint,
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

  it('anchors a bound endpoint to the target border facing the other endpoint', () => {
    const snap = snapMindMapLinePoint({ x: 120, y: 70 }, [topic])
    expect(resolveMindMapLineEndpoint(snap, { x: 300, y: 70 }, [topic])).toEqual({
      x: 180,
      y: 70,
      target: { id: 'topic-1', kind: 'topic' }
    })

    const leftFacing = snapMindMapLinePoint({ x: 120, y: 70 }, [topic])
    expect(resolveMindMapLineEndpoint(leftFacing, { x: 0, y: 70 }, [topic])).toEqual({
      x: 100,
      y: 70,
      target: { id: 'topic-1', kind: 'topic' }
    })
  })

  it('anchors connectors to the visible outline of non-rectangular free shapes', () => {
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

    const ellipseEndpoint = resolveMindMapLineEndpoint(snap, { x: 480, y: 190 }, [ellipse])
    expect(ellipseEndpoint.x).toBeCloseTo(402.426, 3)
    expect(ellipseEndpoint.y).toBeCloseTo(151.213, 3)

    const diamondEndpoint = resolveMindMapLineEndpoint(snap, { x: 480, y: 190 }, [diamond])
    expect(diamondEndpoint).toEqual({
      x: 390,
      y: 145,
      target: { id: 'shape-1', kind: 'shape' }
    })

    // A ray from the centre is not the surface normal for either an ellipse
    // or a polygon edge. Curved paths need the true normal so their arrow
    // marker reaches the shape head-on.
    expect(resolveMindMapLineEndpointOutwardNormal(ellipseEndpoint, [ellipse])).toEqual(
      expect.objectContaining({ x: expect.closeTo(0.447214, 5), y: expect.closeTo(0.894427, 5) })
    )
    expect(resolveMindMapLineEndpointOutwardNormal(diamondEndpoint, [diamond])).toEqual(
      expect.objectContaining({ x: expect.closeTo(0.447214, 5), y: expect.closeTo(0.894427, 5) })
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
    expect(endpoint.x).toBeCloseTo(166.34, 3)
    expect(endpoint.y).toBeCloseTo(85.052, 3)
    expect(resolveMindMapLineEndpointOutwardNormal(endpoint, [ellipseTopic])).toEqual(
      expect.objectContaining({ x: expect.closeTo(0.40082, 3), y: expect.closeTo(0.91616, 3) })
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
      target: { id: 'topic-1', kind: 'topic' }
    })
    expect(draft.from.y).toBeCloseTo(80.909, 3)
    expect(draft.to).toMatchObject({
      x: 300,
      target: { id: 'shape-1', kind: 'shape' }
    })
    expect(draft.to.y).toBeCloseTo(113.636, 3)
    expect(draft.style).toEqual({
      lineShape: 'angled',
      beginArrow: undefined,
      endArrow: 'diamond',
      linePattern: undefined
    })
  })

  it('requires two distinct topic or shape targets for every connector', () => {
    const topicSnap = snapMindMapLinePoint({ x: 140, y: 70 }, [topic, shape])
    const shapeSnap = snapMindMapLinePoint({ x: 360, y: 130 }, [topic, shape])
    const emptySnap = snapMindMapLinePoint({ x: 520, y: 260 }, [topic, shape])
    const otherEmptySnap = snapMindMapLinePoint({ x: 620, y: 320 }, [topic, shape])

    expect(canConnectMindMapLineEndpoints(topicSnap, shapeSnap, [topic, shape])).toBe(true)
    expect(canConnectMindMapLineEndpoints(topicSnap, topicSnap, [topic, shape])).toBe(false)
    expect(canConnectMindMapLineEndpoints(topicSnap, emptySnap, [topic, shape])).toBe(false)
    expect(canConnectMindMapLineEndpoints(emptySnap, otherEmptySnap, [topic, shape])).toBe(false)

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
    )).toBeNull()
    expect(buildMindMapCanvasLineDraft(
      emptySnap,
      otherEmptySnap,
      [topic, shape],
      { active: true }
    )).toBeNull()
    expect(buildMindMapCanvasLineDraft(
      topicSnap,
      topicSnap,
      [topic, shape],
      { active: true }
    )).toBeNull()
  })
})
