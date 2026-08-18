import type {
  MindMapElementArrowShape,
  MindMapElementLinePattern,
  MindMapElementLineShape,
  MindMapElementOutlineShape
} from '../../../../shared/mindmap/domain/types'

/**
 * Renderer-side geometry helpers for advanced non-topic element styling.
 *
 * These are pure SVG string/fragment helpers mirroring the StudiumX vocabulary:
 * relationship connector shapes (`studiumx.relationship.*`), endpoint
 * arrows (`studiumx.arrow.*`), line patterns
 * (`solid/dash/dot/dash-dot/dash-dot-dot`) and container outlines
 * (boundary/summary/callout shapes). The canvas consumes these together with
 * `MindMapElementStyle` so every declared field has a visual consequence.
 */

export type ElementPathPoint = { x: number; y: number }

/** Optional endpoint tangents used by canvas connectors anchored to a shape. */
export type RelationshipElementPathOptions = Readonly<{
  /** Direction in which the path should leave its start point. */
  fromTangent?: ElementPathPoint
  /** Direction in which the path should arrive at its end point. */
  toTangent?: ElementPathPoint
  /** Draggable point through which a curved connector must pass. */
  curvePoint?: ElementPathPoint
  /** Marker rendered at the path start. */
  beginArrow?: MindMapElementArrowShape
  /** Marker rendered at the path end. */
  endArrow?: MindMapElementArrowShape
}>

function unitVector(vector: ElementPathPoint | undefined, fallback: ElementPathPoint): ElementPathPoint {
  const candidate = vector ?? fallback
  const length = Math.hypot(candidate.x, candidate.y)
  if (length <= Number.EPSILON) return { x: 1, y: 0 }
  return { x: candidate.x / length, y: candidate.y / length }
}

function controlOffset(shape: MindMapElementLineShape | undefined, dx: number): number {
  switch (shape) {
    case 'straight':
      return 0
    case 'angled':
    case 'flexible-angled':
      return Math.abs(dx) * 0.5
    case 'zigzag':
    case 'flexible-zigzag':
      return Math.abs(dx) * 0.28
    case 'flexible-curved':
      return Math.abs(dx) * 0.72
    case 'curved':
    default:
      return Math.abs(dx) * 0.5
  }
}

function offsetPoint(point: ElementPathPoint, direction: ElementPathPoint, distance: number): ElementPathPoint {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance
  }
}

function nonZeroUnitVector(
  vector: ElementPathPoint,
  fallback: ElementPathPoint
): ElementPathPoint {
  return Math.hypot(vector.x, vector.y) <= Number.EPSILON
    ? unitVector(fallback, { x: 1, y: 0 })
    : unitVector(vector, fallback)
}

/**
 * Return the directions used by SVG markers at the actual path endpoints.
 *
 * Anchored connector endpoints expose a target-border normal, but that normal
 * is not always the same as the terminal segment of the selected line shape.
 * In particular, a straight diagonal can end on a vertical target edge: the
 * path still points diagonally while the border normal points horizontally.
 * Marker insets must follow the rendered terminal segment, otherwise the
 * marker tip and the editable endpoint handle drift apart.
 */
function relationshipPathEndpointDirections(
  from: ElementPathPoint,
  to: ElementPathPoint,
  shape: MindMapElementLineShape,
  options: RelationshipElementPathOptions | undefined
): { from: ElementPathPoint; to: ElementPathPoint } {
  const delta = { x: to.x - from.x, y: to.y - from.y }

  // A straight path always uses its chord. Do not replace it with an anchor
  // normal: SVG marker orientation is derived from this exact segment.
  if (shape === 'straight') {
    const direction = nonZeroUnitVector(delta, { x: 1, y: 0 })
    return { from: direction, to: direction }
  }

  const explicitFrom = options?.fromTangent
  const explicitTo = options?.toTangent
  if (explicitFrom !== undefined || explicitTo !== undefined) {
    return {
      from: unitVector(explicitFrom, delta),
      to: unitVector(explicitTo, delta)
    }
  }

  const curvePoint = options?.curvePoint
  if (curvePoint !== undefined && (shape === 'curved' || shape === 'flexible-curved')) {
    // The quadratic route uses the solved control point below. Its endpoint
    // tangents are control - from and to - control respectively.
    const midpoint = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2
    }
    const control = {
      x: 2 * curvePoint.x - midpoint.x,
      y: 2 * curvePoint.y - midpoint.y
    }
    return {
      from: nonZeroUnitVector(
        { x: control.x - from.x, y: control.y - from.y },
        delta
      ),
      to: nonZeroUnitVector(
        { x: to.x - control.x, y: to.y - control.y },
        delta
      )
    }
  }

  if (curvePoint !== undefined && shape === 'flexible-angled') {
    return {
      from: nonZeroUnitVector({ x: curvePoint.x - from.x, y: 0 }, delta),
      to: nonZeroUnitVector({ x: to.x - curvePoint.x, y: 0 }, delta)
    }
  }

  if (curvePoint !== undefined && shape === 'flexible-zigzag') {
    const segments = 4
    const firstSaw = -Math.abs(to.y - from.y) * 0.22
    const lastSaw = -Math.abs(to.y - from.y) * 0.22
    const first = {
      x: from.x + (curvePoint.x - from.x) / segments,
      y: from.y + (curvePoint.y - from.y) / segments + firstSaw
    }
    const previous = {
      x: curvePoint.x + (to.x - curvePoint.x) * ((segments - 1) / segments),
      y: curvePoint.y + (to.y - curvePoint.y) * ((segments - 1) / segments) + lastSaw
    }
    return {
      from: nonZeroUnitVector({ x: first.x - from.x, y: first.y - from.y }, delta),
      to: nonZeroUnitVector({ x: to.x - previous.x, y: to.y - previous.y }, delta)
    }
  }

  // The default angled route ends with a horizontal segment.
  if (shape === 'angled' || shape === 'flexible-angled') {
    const halfDx = (to.x - from.x) / 2
    const direction = nonZeroUnitVector({ x: halfDx, y: 0 }, delta)
    return { from: direction, to: direction }
  }

  // The default cubic curved route has horizontal endpoint controls.
  if (shape === 'curved' || shape === 'flexible-curved') {
    const direction = nonZeroUnitVector({ x: to.x - from.x, y: 0 }, delta)
    return { from: direction, to: direction }
  }

  if (shape === 'zigzag' || shape === 'flexible-zigzag') {
    const dy = Math.abs(to.y - from.y)
    const segments = 4
    const first = {
      x: from.x + (to.x - from.x) / segments,
      y: from.y + (to.y - from.y) / segments - dy * 0.22
    }
    const previous = {
      x: from.x + (to.x - from.x) * ((segments - 1) / segments),
      y: from.y + (to.y - from.y) * ((segments - 1) / segments) - dy * 0.22
    }
    return {
      from: nonZeroUnitVector({ x: first.x - from.x, y: first.y - from.y }, delta),
      to: nonZeroUnitVector({ x: to.x - previous.x, y: to.y - previous.y }, delta)
    }
  }

  const direction = nonZeroUnitVector(delta, { x: 1, y: 0 })
  return { from: direction, to: direction }
}

function anchoredZigzagPath(
  from: ElementPathPoint,
  to: ElementPathPoint,
  fromDirection: ElementPathPoint,
  toDirection: ElementPathPoint
): string {
  const totalDistance = Math.hypot(to.x - from.x, to.y - from.y)
  const lead = Math.min(52, Math.max(14, totalDistance * 0.16))
  const startLead = offsetPoint(from, fromDirection, lead)
  const endLead = offsetPoint(to, { x: -toDirection.x, y: -toDirection.y }, lead)
  const span = { x: endLead.x - startLead.x, y: endLead.y - startLead.y }
  const spanLength = Math.hypot(span.x, span.y)
  if (spanLength <= 8) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`

  const normal = { x: -span.y / spanLength, y: span.x / spanLength }
  const amplitude = Math.min(16, Math.max(5, spanLength * 0.1))
  const points = [`M ${from.x} ${from.y}`, `L ${startLead.x} ${startLead.y}`]
  for (let index = 1; index <= 3; index += 1) {
    const progress = index / 4
    const direction = index % 2 === 0 ? -1 : 1
    const point = {
      x: startLead.x + span.x * progress + normal.x * amplitude * direction,
      y: startLead.y + span.y * progress + normal.y * amplitude * direction
    }
    points.push(`L ${point.x} ${point.y}`)
  }
  points.push(`L ${endLead.x} ${endLead.y}`, `L ${to.x} ${to.y}`)
  return points.join(' ')
}

function quadraticPathThroughPoint(
  from: ElementPathPoint,
  to: ElementPathPoint,
  curvePoint: ElementPathPoint
): string {
  // A quadratic Bezier reaches its control point only indirectly. Solve for
  // that control point so the visible curve passes through the draggable
  // point at t=0.5: curvePoint = (from + 2 * control + to) / 4.
  const endpointMidpoint = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2
  }
  const control = {
    x: 2 * curvePoint.x - endpointMidpoint.x,
    y: 2 * curvePoint.y - endpointMidpoint.y
  }
  return `M ${from.x} ${from.y} Q ${control.x} ${control.y}, ${to.x} ${to.y}`
}

/**
 * Route a curved connector through its draggable midpoint while retaining
 * explicit endpoint tangents. A single quadratic can pass through the point,
 * but cannot independently control its start/end direction; that made arrow
 * markers point sideways at snapped shapes. Two smooth cubic segments keep
 * both arrow directions tied to their target borders.
 *
 * The endpoint handle length is scaled by how closely the curve's actual
 * approach direction aligns with the desired tangent. When a dragged curve
 * point pulls the path sideways (perpendicular to the target-facing tangent),
 * a long forced handle creates an abrupt vertical "kink" just before the
 * arrowhead — the arrow looks like it ignores the line's approach direction.
 * A shorter handle in that case makes the tangent transition gradual and
 * keeps the arrow visibly continuous with the curve.
 */
function anchoredCurvedPathThroughPoint(
  from: ElementPathPoint,
  to: ElementPathPoint,
  curvePoint: ElementPathPoint,
  fromDirection: ElementPathPoint,
  toDirection: ElementPathPoint
): string {
  const fromDistance = Math.hypot(curvePoint.x - from.x, curvePoint.y - from.y)
  const toDistance = Math.hypot(to.x - curvePoint.x, to.y - curvePoint.y)
  const fromHandle = Math.min(72, Math.max(4, fromDistance * 0.34))
  const incomingDirection = unitVector(
    { x: curvePoint.x - from.x, y: curvePoint.y - from.y },
    { x: to.x - from.x, y: to.y - from.y }
  )
  const outgoingDirection = unitVector(
    { x: to.x - curvePoint.x, y: to.y - curvePoint.y },
    { x: to.x - from.x, y: to.y - from.y }
  )
  const joinDirection = unitVector(
    {
      x: incomingDirection.x + outgoingDirection.x,
      y: incomingDirection.y + outgoingDirection.y
    },
    { x: to.x - from.x, y: to.y - from.y }
  )
  const joinHandle = Math.min(32, Math.max(4, Math.min(fromDistance, toDistance) * 0.16))

  // Scale the endpoint handle by the dot product of the curve's actual approach
  // direction and the desired tangent. When the curve approaches head-on
  // (dot ≈ 1), the full handle length produces a smooth, natural entry. When
  // the curve approaches from the side (dot ≈ 0), the handle shrinks so the
  // forced tangent transition occupies only a few pixels. Use the square root
  // rather than a linear scale for the middle ground: a moderately diagonal
  // curve still needs a long enough handle to turn into the target tangent
  // gradually, otherwise the last part of the curve kinks underneath the
  // arrowhead and makes the arrow look detached from the line.
  const approachAlignment = Math.max(0,
    outgoingDirection.x * toDirection.x + outgoingDirection.y * toDirection.y)
  const toHandle = Math.min(72, Math.max(4, toDistance * 0.34))
    * (0.2 + 0.8 * Math.sqrt(approachAlignment))

  const c1 = offsetPoint(from, fromDirection, fromHandle)
  const c2 = offsetPoint(curvePoint, { x: -joinDirection.x, y: -joinDirection.y }, joinHandle)
  const c3 = offsetPoint(curvePoint, joinDirection, joinHandle)
  const c4 = offsetPoint(to, { x: -toDirection.x, y: -toDirection.y }, toHandle)
  return [
    `M ${from.x} ${from.y}`,
    `C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${curvePoint.x} ${curvePoint.y}`,
    `C ${c3.x} ${c3.y}, ${c4.x} ${c4.y}, ${to.x} ${to.y}`
  ].join(' ')
}

/**
 * Relationship connector path for one of the StudiumX relationship shapes.
 * Semantic endpoints stay on their targets; markers may inset the visible
 * shaft so the marker tip, rather than the path stroke, owns that endpoint.
 */
export function relationshipElementPath(
  from: ElementPathPoint,
  to: ElementPathPoint,
  shape: MindMapElementLineShape = 'curved',
  options?: RelationshipElementPathOptions
): string {
  const beginInset = relationshipArrowMarkerMetrics(options?.beginArrow)?.pathInset ?? 0
  const endInset = relationshipArrowMarkerMetrics(options?.endArrow)?.pathInset ?? 0
  if (beginInset > 0 || endInset > 0) {
    const delta = { x: to.x - from.x, y: to.y - from.y }
    const distance = Math.hypot(delta.x, delta.y)
    const totalInset = beginInset + endInset
    // Never let opposing markers cross on a very short connector.
    const insetScale = totalInset > 0
      ? Math.min(1, Math.max(0, distance - 0.01) / totalInset)
      : 1
    const { from: fromDirection, to: toDirection } = relationshipPathEndpointDirections(
      from,
      to,
      shape,
      options
    )
    const pathFrom = offsetPoint(from, fromDirection, beginInset * insetScale)
    const pathTo = offsetPoint(to, toDirection, -endInset * insetScale)
    const {
      beginArrow: _beginArrow,
      endArrow: _endArrow,
      ...pathOptions
    } = options ?? {}
    return relationshipElementPath(pathFrom, pathTo, shape, pathOptions)
  }

  const toRight = to.x >= from.x
  const midX = from.x + (to.x - from.x) / 2
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  const delta = { x: to.x - from.x, y: to.y - from.y }

  if (shape === 'straight') {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`
  }

  if ((shape === 'curved' || shape === 'flexible-curved') && options?.curvePoint !== undefined) {
    if (options.fromTangent !== undefined || options.toTangent !== undefined) {
      return anchoredCurvedPathThroughPoint(
        from,
        to,
        options.curvePoint,
        unitVector(options.fromTangent, delta),
        unitVector(options.toTangent, delta)
      )
    }
    return quadraticPathThroughPoint(from, to, options.curvePoint)
  }

  // Flexible angled/zigzag with a curve point: route through the dragged
  // point while keeping the shape's visual family. The angled variant uses
  // the curve point as its elbow pivot; the zigzag variant oscillates around
  // the line from the curve point to each endpoint.
  if (options?.curvePoint !== undefined && (shape === 'flexible-angled' || shape === 'flexible-zigzag')) {
    const cp = options.curvePoint
    if (shape === 'flexible-angled') {
      return [
        `M ${from.x} ${from.y}`,
        `L ${cp.x} ${from.y}`,
        `L ${cp.x} ${to.y}`,
        `L ${to.x} ${to.y}`
      ].join(' ')
    }
    // flexible-zigzag: oscillate perpendicular to the from->curvePoint and
    // curvePoint->to segments, keeping the family's sawtooth character.
    const segments = 4
    const points: string[] = [`M ${from.x} ${from.y}`]
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments
      const px = from.x + (cp.x - from.x) * t
      const saw = i % 2 === 0 ? dy * 0.22 : -dy * 0.22
      const py = i === segments ? cp.y : from.y + (cp.y - from.y) * t + saw
      points.push(`L ${px} ${py}`)
    }
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments
      const px = cp.x + (to.x - cp.x) * t
      const saw = i % 2 === 0 ? dy * 0.22 : -dy * 0.22
      const py = i === segments ? to.y : cp.y + (to.y - cp.y) * t + saw
      points.push(`L ${px} ${py}`)
    }
    points.push(`L ${to.x} ${to.y}`)
    return points.join(' ')
  }

  // A marker follows the path tangent, not the vector between its endpoints.
  // The historical curve controls always approached the endpoint horizontally,
  // which put an arrow aimed at the top/bottom edge of a shape sideways. When
  // either endpoint is anchored, keep the final tangent aligned with the
  // target-facing direction while retaining a gentle curve in the middle.
  if (options?.fromTangent !== undefined || options?.toTangent !== undefined) {
    const fromDirection = unitVector(options.fromTangent, delta)
    const toDirection = unitVector(options.toTangent, delta)
    if (shape === 'angled' || shape === 'flexible-angled') {
      const distance = Math.min(56, Math.max(14, Math.hypot(delta.x, delta.y) * 0.16))
      const startElbow = offsetPoint(from, fromDirection, distance)
      const endElbow = offsetPoint(to, { x: -toDirection.x, y: -toDirection.y }, distance)
      return [
        `M ${from.x} ${from.y}`,
        `L ${startElbow.x} ${startElbow.y}`,
        `L ${endElbow.x} ${endElbow.y}`,
        `L ${to.x} ${to.y}`
      ].join(' ')
    }
    if (shape === 'zigzag' || shape === 'flexible-zigzag') {
      return anchoredZigzagPath(from, to, fromDirection, toDirection)
    }
    if (shape === 'curved' || shape === 'flexible-curved') {
      // Keep endpoint handles proportional to the actual span. A hard 20 px
      // minimum made short connectors loop and left their arrowheads looking
      // detached from the target shape.
      const distance = Math.min(72, Math.max(4, Math.hypot(delta.x, delta.y) * 0.2))
      const c1 = {
        x: from.x + fromDirection.x * distance,
        y: from.y + fromDirection.y * distance
      }
      const c2 = {
        x: to.x - toDirection.x * distance,
        y: to.y - toDirection.y * distance
      }
      return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`
    }
  }
  const cx1 = shape === 'angled' || shape === 'flexible-angled'
    ? toRight ? from.x + dx * 0.5 : from.x - dx * 0.5
    : toRight ? from.x + controlOffset(shape, dx) : from.x - controlOffset(shape, dx)
  const cx2 = shape === 'angled' || shape === 'flexible-angled'
    ? toRight ? to.x - dx * 0.5 : to.x + dx * 0.5
    : toRight ? to.x - controlOffset(shape, dx) : to.x + controlOffset(shape, dx)

  if (shape === 'zigzag' || shape === 'flexible-zigzag') {
    const segments = 4
    const points: string[] = [`M ${from.x} ${from.y}`]
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments
      const px = from.x + (to.x - from.x) * t
      const saw = i % 2 === 0 ? dy * 0.22 : -dy * 0.22
      const py = shape === 'flexible-zigzag' && i < segments
        ? from.y + (to.y - from.y) * t + saw
        : i === segments ? to.y : from.y + (to.y - from.y) * t + saw
      points.push(`L ${px} ${py}`)
    }
    return `${points.join(' ')} L ${to.x} ${to.y}`
  }

  if (shape === 'angled' || shape === 'flexible-angled') {
    return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`
  }

  // Curved family: cubic bezier with symmetric controls.
  return `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`
}

/**
 * Marker path fragment for one endpoint arrow shape (10×10 marker coordinate
 * space). `herringbone` and `attached` intentionally extend past x=10; their
 * marker metrics opt into a visible viewport below. `none` returns undefined
 * so the canvas simply omits the marker.
 */
export function relationshipArrowMarkerPath(
  arrow: MindMapElementArrowShape | undefined
): string | undefined {
  switch (arrow) {
    case 'dot':
      return 'M 2 5 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0'
    case 'triangle':
      // A full, balanced triangle remains legible at the canvas's default
      // connector width. Its base and tip coordinates also define the matching
      // path inset returned by relationshipArrowMarkerMetrics below.
      return 'M 1 1.2 L 9.7 5 L 1 8.8 Z'
    case 'spearhead':
      return 'M 1.25 1.35 L 9.5 5 L 1.25 8.65'
    case 'square':
      return 'M 1 1 L 9 1 L 9 9 L 1 9 Z'
    case 'diamond':
      return 'M 5 0 L 10 5 L 5 10 L 0 5 Z'
    case 'herringbone':
      return 'M 1 1 L 8 5 L 1 9 M 4 1 L 11 5 L 4 9'
    case 'double-arrow':
      return 'M 0 0 L 6 5 L 0 10 M 10 0 L 4 5 L 10 10'
    case 'anti-triangle':
      return 'M 10 0 L 0 5 L 10 10 Z'
    case 'attached':
      return 'M 0 0 L 6 5 L 0 10 M 6 0 L 12 5 L 6 10'
    case 'hook':
      return 'M 1 1 C 6 1 9 3 8 8 L 8 5 M 8 5 L 5 8'
    case 'none':
    default:
      return undefined
  }
}

/**
 * SVG positioning metrics for endpoint markers.
 *
 * `pathInset` shortens the visible connector before marker placement. Filled
 * triangles anchor at their base instead of their tip, so the shaft cannot
 * occupy the taper and leave a rectangular stub after the apparent point. The
 * marker tip still lands on the original semantic endpoint because the path is
 * inset by the marker's base-to-tip distance.
 */
export function relationshipArrowMarkerMetrics(
  arrow: MindMapElementArrowShape | undefined
): Readonly<{
  refX: number
  markerWidth?: number
  markerHeight?: number
  /** User-space distance removed from the path before placing this marker. */
  pathInset?: number
  overflow?: 'visible'
  open?: true
}> | undefined {
  switch (arrow) {
    case 'dot':
      return { refX: 9 }
    case 'triangle':
      // Anchor at the triangle base (x=1) and pull the path endpoint back by
      // the scaled base-to-tip distance: (9.7 - 1) × 8 / 10 = 6.96. The marker
      // therefore owns the entire taper while its tip remains at the semantic
      // endpoint selected by the user or target-border snap.
      return { refX: 1, markerWidth: 8, markerHeight: 8, pathInset: 6.96 }
    case 'spearhead':
      return { refX: 9, open: true }
    case 'diamond':
    case 'double-arrow':
    case 'anti-triangle':
      return { refX: 11 }
    case 'square':
      return { refX: 10 }
    case 'hook':
      return { refX: 10, open: true }
    case 'herringbone':
      return { refX: 12, overflow: 'visible', open: true }
    case 'attached':
      return { refX: 13, overflow: 'visible', open: true }
    case 'none':
    default:
      return undefined
  }
}

/** Dash array for an element line pattern (SVG user units). */
export function elementLineDashArray(pattern: MindMapElementLinePattern | undefined): string | undefined {
  switch (pattern) {
    case 'dash':
      return '6 4'
    case 'dot':
      return '1 4'
    case 'dash-dot':
      return '6 3 1 3'
    case 'dash-dot-dot':
      return '6 3 1 3 1 3'
    case 'solid':
    default:
      return undefined
  }
}

export type ElementOutlineRect = { x: number; y: number; width: number; height: number }

/**
 * Boundary/summary/callout container outlines. The default remains the
 * rounded-rectangle/brace used before the typed field existed.
 */
export function elementOutlinePath(
  rect: ElementOutlineRect,
  shape: MindMapElementOutlineShape | undefined
): string {
  const { x, y, width, height } = rect
  const r = Math.min(12, Math.max(4, Math.min(width, height) * 0.12))
  switch (shape) {
    case 'rectangle':
      return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`
    case 'ellipse': {
      const cx = x + width / 2
      const cy = y + height / 2
      const rx = width / 2
      const ry = height / 2
      return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`
    }
    case 'polygon': {
      const inset = Math.min(10, Math.max(3, Math.min(width, height) * 0.1))
      return [
        `M ${x + inset} ${y}`,
        `L ${x + width - inset} ${y}`,
        `L ${x + width} ${y + height * 0.42}`,
        `L ${x + width - inset} ${y + height}`,
        `L ${x + inset} ${y + height}`,
        `L ${x} ${y + height * 0.42}`,
        'Z'
      ].join(' ')
    }
    case 'scallops': {
      const count = Math.max(2, Math.floor(width / 18))
      const step = width / count
      const h = Math.min(7, height * 0.09)
      const top = [`M ${x} ${y + h}`]
      for (let i = 0; i < count; i += 1) {
        const cx = x + step * i + step / 2
        top.push(`Q ${cx} ${y - h} ${x + step * (i + 1)} ${y + h}`)
      }
      top.push(`L ${x + width} ${y + height - h}`)
      for (let i = count - 1; i >= 0; i -= 1) {
        const cx = x + step * i + step / 2
        top.push(`Q ${cx} ${y + height + h} ${x + step * i} ${y + height - h}`)
      }
      top.push('Z')
      return top.join(' ')
    }
    case 'waves': {
      const count = Math.max(2, Math.floor(width / 16))
      const step = width / count
      const top = [`M ${x} ${y + 4}`]
      for (let i = 0; i < count; i += 1) {
        const cx = x + step * i + step / 2
        const sign = i % 2 === 0 ? -1 : 1
        top.push(`Q ${cx} ${y + 4 + sign * 6} ${x + step * (i + 1)} ${y + 4}`)
      }
      top.push(`L ${x + width} ${y + height - 4}`)
      for (let i = count - 1; i >= 0; i -= 1) {
        const cx = x + step * i + step / 2
        const sign = i % 2 === 0 ? -1 : 1
        top.push(`Q ${cx} ${y + height - 4 + sign * 6} ${x + step * i} ${y + height - 4}`)
      }
      top.push('Z')
      return top.join(' ')
    }
    case 'tension': {
      const inset = Math.min(14, Math.max(4, Math.min(width, height) * 0.14))
      return [
        `M ${x} ${y + inset}`,
        `Q ${x} ${y} ${x + inset} ${y}`,
        `L ${x + width - inset} ${y}`,
        `Q ${x + width} ${y} ${x + width} ${y + inset}`,
        `L ${x + width} ${y + height - inset}`,
        `Q ${x + width} ${y + height} ${x + width - inset} ${y + height}`,
        `L ${x + inset} ${y + height}`,
        `Q ${x} ${y + height} ${x} ${y + height - inset}`,
        'Z'
      ].join(' ')
    }
    case 'bracket': {
      const inset = Math.min(10, Math.max(4, Math.min(width, height) * 0.1))
      return [
        `M ${x} ${y + inset}`,
        `L ${x} ${y}`,
        `L ${x + inset} ${y}`,
        `M ${x + width - inset} ${y}`,
        `L ${x + width} ${y}`,
        `L ${x + width} ${y + inset}`,
        `M ${x + width} ${y + height - inset}`,
        `L ${x + width} ${y + height}`,
        `L ${x + width - inset} ${y + height}`,
        `M ${x + inset} ${y + height}`,
        `L ${x} ${y + height}`,
        `L ${x} ${y + height - inset}`
      ].join(' ')
    }
    case 'rounded-rectangle':
    default:
      return [
        `M ${x + r} ${y}`,
        `L ${x + width - r} ${y}`,
        `Q ${x + width} ${y} ${x + width} ${y + r}`,
        `L ${x + width} ${y + height - r}`,
        `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
        `L ${x + r} ${y + height}`,
        `Q ${x} ${y + height} ${x} ${y + height - r}`,
        `L ${x} ${y + r}`,
        `Q ${x} ${y} ${x + r} ${y}`,
        'Z'
      ].join(' ')
  }
}
