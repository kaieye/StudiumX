import type {
  MindMapElementArrowShape,
  MindMapElementLinePattern,
  MindMapElementLineShape,
  MindMapDrawingShape
} from '../../../../shared/mindmap/domain/types'
import type { NodeShape } from './mind-map-node-shapes'

/** A point in the canvas's untransformed document coordinate space. */
export type MindMapCanvasPoint = { x: number; y: number }

/**
 * A rectangle that a connector can bind to. Topics are supplied by the canvas
 * itself; independently drawn shapes are supplied by the shape layer.
 */
export type MindMapCanvasLineSnapTarget = {
  id: string
  kind: 'topic' | 'shape'
  x: number
  y: number
  width: number
  height: number
  /** Effective topic/free-shape outline used for endpoint geometry. */
  shape?: MindMapDrawingShape | NodeShape
}

/** Stable identity of the object to which a connector endpoint is bound. */
export type MindMapCanvasLineTargetRef = Pick<MindMapCanvasLineSnapTarget, 'id' | 'kind'>

/** A transient endpoint used while drawing or dragging a connector. */
export type MindMapCanvasLineEndpoint = MindMapCanvasPoint & {
  target?: MindMapCanvasLineTargetRef
}

/** The style choices owned by the line toolbar/menu. */
export type MindMapCanvasLineStyle = {
  lineShape: MindMapElementLineShape
  beginArrow?: MindMapElementArrowShape
  endArrow?: MindMapElementArrowShape
  linePattern?: MindMapElementLinePattern
  /** Optional visual overrides carried by persisted connectors. */
  stroke?: string
  strokeWidth?: number
}

/** Controlled state passed by the toolbar when the line drawing tool is active. */
export type MindMapCanvasLineTool = Partial<MindMapCanvasLineStyle> & {
  active: boolean
}

/** A connector emitted when the user finishes one drawing gesture. */
export type MindMapCanvasLineDraft = {
  from: MindMapCanvasLineEndpoint
  to: MindMapCanvasLineEndpoint
  style: MindMapCanvasLineStyle
}

/** A previously persisted connector supplied by the host/document model. */
export type MindMapCanvasLine = MindMapCanvasLineDraft & {
  id: string
  label?: string
  /** Persisted curve-point offset from the current endpoint midpoint. */
  curveControlOffset?: MindMapCanvasPoint
}

type MindMapCanvasLineSnap = {
  point: MindMapCanvasPoint
  target?: MindMapCanvasLineTargetRef
}

/** Default magnetic radius in document pixels at 100% zoom. */
export const MIND_MAP_LINE_SNAP_DISTANCE = 18
/** Ignore accidental click/release gestures that do not create a visible line. */
export const MIND_MAP_LINE_MINIMUM_LENGTH = 4

export function isMindMapCurvedLineShape(shape: MindMapElementLineShape): boolean {
  return shape === 'curved' || shape === 'flexible-curved'
}

/** Resolve the draggable point through which a curved connector must pass. */
export function resolveMindMapLineCurvePoint(
  from: MindMapCanvasPoint,
  to: MindMapCanvasPoint,
  controlOffset?: MindMapCanvasPoint
): MindMapCanvasPoint {
  const midpoint = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2
  }
  if (controlOffset) {
    return {
      x: midpoint.x + controlOffset.x,
      y: midpoint.y + controlOffset.y
    }
  }

  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length <= Number.EPSILON) return midpoint

  const bend = Math.min(72, Math.max(16, length * 0.18), length * 0.45)
  return {
    x: midpoint.x - (dy / length) * bend,
    y: midpoint.y + (dx / length) * bend
  }
}

/** Convert a dragged curve point back to its endpoint-midpoint-relative value. */
export function mindMapLineCurveControlOffset(
  controlPoint: MindMapCanvasPoint,
  from: MindMapCanvasPoint,
  to: MindMapCanvasPoint
): MindMapCanvasPoint {
  return {
    x: controlPoint.x - (from.x + to.x) / 2,
    y: controlPoint.y - (from.y + to.y) / 2
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function unitVector(vector: MindMapCanvasPoint, fallback: MindMapCanvasPoint = { x: 1, y: 0 }): MindMapCanvasPoint {
  const candidateLength = Math.hypot(vector.x, vector.y)
  if (candidateLength > Number.EPSILON) {
    return { x: vector.x / candidateLength, y: vector.y / candidateLength }
  }
  const fallbackLength = Math.hypot(fallback.x, fallback.y)
  return fallbackLength > Number.EPSILON
    ? { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength }
    : { x: 1, y: 0 }
}

function targetRef(target: MindMapCanvasLineSnapTarget): MindMapCanvasLineTargetRef {
  return { id: target.id, kind: target.kind }
}

function targetMatches(
  target: MindMapCanvasLineSnapTarget,
  ref: MindMapCanvasLineTargetRef | undefined
): boolean {
  return ref !== undefined && target.id === ref.id && target.kind === ref.kind
}

function closestPointOnRect(point: MindMapCanvasPoint, target: MindMapCanvasLineSnapTarget): MindMapCanvasPoint {
  return {
    x: clamp(point.x, target.x, target.x + target.width),
    y: clamp(point.y, target.y, target.y + target.height)
  }
}

function targetCenter(target: MindMapCanvasLineSnapTarget): MindMapCanvasPoint {
  return {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2
  }
}

function targetDirection(
  center: MindMapCanvasPoint,
  toward: MindMapCanvasPoint,
  fallback: MindMapCanvasPoint
): MindMapCanvasPoint {
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  if (Math.abs(dx) > Number.EPSILON || Math.abs(dy) > Number.EPSILON) {
    return { x: dx, y: dy }
  }

  const fallbackDx = fallback.x - center.x
  const fallbackDy = fallback.y - center.y
  if (Math.abs(fallbackDx) > Number.EPSILON || Math.abs(fallbackDy) > Number.EPSILON) {
    return { x: fallbackDx, y: fallbackDy }
  }

  // A connector whose two persisted points are exactly at the same centre is
  // unusual but valid. Pick a deterministic visible boundary instead of
  // returning a point inside the target.
  return { x: 1, y: 0 }
}

function rectangularBorderPoint(
  center: MindMapCanvasPoint,
  direction: MindMapCanvasPoint,
  halfWidth: number,
  halfHeight: number
): MindMapCanvasPoint {
  const scale = Math.min(
    Math.abs(direction.x) > Number.EPSILON
      ? halfWidth / Math.abs(direction.x)
      : Number.POSITIVE_INFINITY,
    Math.abs(direction.y) > Number.EPSILON
      ? halfHeight / Math.abs(direction.y)
      : Number.POSITIVE_INFINITY
  )
  return {
    x: center.x + direction.x * scale,
    y: center.y + direction.y * scale
  }
}

function roundedCornerCenter(
  target: MindMapCanvasLineSnapTarget,
  point: MindMapCanvasPoint,
  radius: number
): MindMapCanvasPoint | undefined {
  const right = target.x + target.width
  const bottom = target.y + target.height
  const cornerX = point.x < target.x + radius
    ? target.x + radius
    : point.x > right - radius
      ? right - radius
      : undefined
  const cornerY = point.y < target.y + radius
    ? target.y + radius
    : point.y > bottom - radius
      ? bottom - radius
      : undefined
  return cornerX !== undefined && cornerY !== undefined
    ? { x: cornerX, y: cornerY }
    : undefined
}

function roundedRectRadius(target: MindMapCanvasLineSnapTarget): number {
  return target.kind === 'shape'
    ? Math.min(target.width, target.height, 18) * 0.18
    : Math.min(12, target.height / 2)
}

function roundedRectBorderPoint(
  target: MindMapCanvasLineSnapTarget,
  center: MindMapCanvasPoint,
  direction: MindMapCanvasPoint,
  halfWidth: number,
  halfHeight: number
): MindMapCanvasPoint {
  const rectangularPoint = rectangularBorderPoint(center, direction, halfWidth, halfHeight)
  const radius = roundedRectRadius(target)
  const corner = roundedCornerCenter(target, rectangularPoint, radius)
  if (!corner || radius <= Number.EPSILON) return rectangularPoint

  const offset = { x: center.x - corner.x, y: center.y - corner.y }
  const a = direction.x * direction.x + direction.y * direction.y
  const b = 2 * (offset.x * direction.x + offset.y * direction.y)
  const c = offset.x * offset.x + offset.y * offset.y - radius * radius
  const discriminant = b * b - 4 * a * c
  if (a <= Number.EPSILON || discriminant < 0) return rectangularPoint

  // The ray begins in the rounded rectangle's central body. Its larger
  // positive circle intersection is the outside corner arc, not the inner
  // quadrant of the same circle.
  const root = Math.sqrt(discriminant)
  const distance = Math.max((-b - root) / (2 * a), (-b + root) / (2 * a))
  return distance >= 0
    ? { x: center.x + direction.x * distance, y: center.y + direction.y * distance }
    : rectangularPoint
}

function ellipseBorderPoint(
  center: MindMapCanvasPoint,
  direction: MindMapCanvasPoint,
  halfWidth: number,
  halfHeight: number
): MindMapCanvasPoint {
  const scale = 1 / Math.hypot(direction.x / halfWidth, direction.y / halfHeight)
  return {
    x: center.x + direction.x * scale,
    y: center.y + direction.y * scale
  }
}

function polygonBorderPoint(
  center: MindMapCanvasPoint,
  direction: MindMapCanvasPoint,
  vertices: readonly MindMapCanvasPoint[]
): MindMapCanvasPoint | undefined {
  const cross = (a: MindMapCanvasPoint, b: MindMapCanvasPoint): number => a.x * b.y - a.y * b.x
  let intersectionDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]!
    const end = vertices[(index + 1) % vertices.length]!
    const edge = { x: end.x - start.x, y: end.y - start.y }
    const determinant = cross(direction, edge)
    if (Math.abs(determinant) <= Number.EPSILON) continue

    const offset = { x: start.x - center.x, y: start.y - center.y }
    const rayDistance = cross(offset, edge) / determinant
    const edgeDistance = cross(offset, direction) / determinant
    if (
      rayDistance >= -Number.EPSILON
      && edgeDistance >= -Number.EPSILON
      && edgeDistance <= 1 + Number.EPSILON
    ) {
      intersectionDistance = Math.min(intersectionDistance, Math.max(0, rayDistance))
    }
  }

  return Number.isFinite(intersectionDistance)
    ? {
        x: center.x + direction.x * intersectionDistance,
        y: center.y + direction.y * intersectionDistance
      }
    : undefined
}

function shapePolygonVertices(target: MindMapCanvasLineSnapTarget): readonly MindMapCanvasPoint[] | undefined {
  const { x, y, width, height } = target
  const right = x + width
  const bottom = y + height
  const centerX = x + width / 2
  const centerY = y + height / 2

  switch (target.shape) {
    case 'diamond':
      return [
        { x: centerX, y },
        { x: right, y: centerY },
        { x: centerX, y: bottom },
        { x, y: centerY }
      ]
    case 'parallelogram': {
      const skew = Math.min(width * 0.22, Math.max(8, height * 0.45))
      return [
        { x: x + skew, y },
        { x: right, y },
        { x: right - skew, y: bottom },
        { x, y: bottom }
      ]
    }
    case 'hexagon': {
      const inset = Math.min(width * 0.22, Math.max(8, width / 4))
      return [
        { x: x + inset, y },
        { x: right - inset, y },
        { x: right, y: centerY },
        { x: right - inset, y: bottom },
        { x: x + inset, y: bottom },
        { x, y: centerY }
      ]
    }
    case 'arrow-right': {
      const head = Math.min(22, width / 2)
      return [
        { x, y },
        { x: right - head, y },
        { x: right, y: centerY },
        { x: right - head, y: bottom },
        { x, y: bottom }
      ]
    }
    case 'arrow-left': {
      const head = Math.min(22, width / 2)
      return [
        { x: right, y },
        { x: x + head, y },
        { x, y: centerY },
        { x: x + head, y: bottom },
        { x: right, y: bottom }
      ]
    }
    case 'star': {
      const outer = Math.min(width, height) / 2
      const inner = outer * 0.4
      return Array.from({ length: 10 }, (_, index) => {
        const radius = index % 2 === 0 ? outer : inner
        const angle = -Math.PI / 2 + (index * Math.PI) / 5
        return {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle)
        }
      })
    }
    default:
      return undefined
  }
}

function rectangularOutwardNormal(
  target: MindMapCanvasLineSnapTarget,
  point: MindMapCanvasPoint
): MindMapCanvasPoint {
  const right = target.x + target.width
  const bottom = target.y + target.height
  const candidates = [
    { distance: Math.abs(point.x - target.x), normal: { x: -1, y: 0 } },
    { distance: Math.abs(point.x - right), normal: { x: 1, y: 0 } },
    { distance: Math.abs(point.y - target.y), normal: { x: 0, y: -1 } },
    { distance: Math.abs(point.y - bottom), normal: { x: 0, y: 1 } }
  ]
  const nearestDistance = Math.min(...candidates.map((candidate) => candidate.distance))
  const nearest = candidates.filter((candidate) => candidate.distance <= nearestDistance + 0.01)
  if (nearest.length === 1) return nearest[0]!.normal

  // A true rectangle corner has no single normal. The radial direction is the
  // visually stable member of the corner's normal cone and avoids a sudden
  // horizontal/vertical arrow flip while dragging a connector.
  const center = targetCenter(target)
  return unitVector(
    {
      x: (point.x - center.x) / Math.max(target.width / 2, Number.EPSILON),
      y: (point.y - center.y) / Math.max(target.height / 2, Number.EPSILON)
    },
    nearest[0]!.normal
  )
}

function ellipseOutwardNormal(
  center: MindMapCanvasPoint,
  point: MindMapCanvasPoint,
  halfWidth: number,
  halfHeight: number
): MindMapCanvasPoint {
  return unitVector(
    {
      x: (point.x - center.x) / (halfWidth * halfWidth),
      y: (point.y - center.y) / (halfHeight * halfHeight)
    },
    { x: point.x - center.x, y: point.y - center.y }
  )
}

function polygonOutwardNormal(
  center: MindMapCanvasPoint,
  point: MindMapCanvasPoint,
  vertices: readonly MindMapCanvasPoint[]
): MindMapCanvasPoint | undefined {
  let nearestDistance = Number.POSITIVE_INFINITY
  let combinedNormal = { x: 0, y: 0 }
  const radial = { x: point.x - center.x, y: point.y - center.y }

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]!
    const end = vertices[(index + 1) % vertices.length]!
    const edge = { x: end.x - start.x, y: end.y - start.y }
    const edgeLengthSquared = edge.x * edge.x + edge.y * edge.y
    if (edgeLengthSquared <= Number.EPSILON) continue
    const progress = clamp(
      ((point.x - start.x) * edge.x + (point.y - start.y) * edge.y) / edgeLengthSquared,
      0,
      1
    )
    const closest = {
      x: start.x + edge.x * progress,
      y: start.y + edge.y * progress
    }
    const distance = (point.x - closest.x) ** 2 + (point.y - closest.y) ** 2
    let normal = { x: -edge.y, y: edge.x }
    if (normal.x * radial.x + normal.y * radial.y < 0) {
      normal = { x: -normal.x, y: -normal.y }
    }
    const unitNormal = unitVector(normal, radial)

    if (distance < nearestDistance - 0.01) {
      nearestDistance = distance
      combinedNormal = unitNormal
    } else if (distance <= nearestDistance + 0.01) {
      combinedNormal = {
        x: combinedNormal.x + unitNormal.x,
        y: combinedNormal.y + unitNormal.y
      }
    }
  }

  return Number.isFinite(nearestDistance)
    ? unitVector(combinedNormal, radial)
    : undefined
}

function targetOutlineOutwardNormal(
  target: MindMapCanvasLineSnapTarget,
  point: MindMapCanvasPoint
): MindMapCanvasPoint {
  const center = targetCenter(target)
  const halfWidth = Math.max(target.width / 2, Number.EPSILON)
  const halfHeight = Math.max(target.height / 2, Number.EPSILON)

  if (target.shape === 'ellipse') {
    return ellipseOutwardNormal(center, point, halfWidth, halfHeight)
  }

  if (target.shape === 'rounded-rect') {
    const corner = roundedCornerCenter(target, point, roundedRectRadius(target))
    if (corner) return unitVector({ x: point.x - corner.x, y: point.y - corner.y })
  }

  const vertices = shapePolygonVertices(target)
  const polygonNormal = vertices ? polygonOutwardNormal(center, point, vertices) : undefined
  return polygonNormal ?? rectangularOutwardNormal(target, point)
}

/**
 * Resolve the closest magnetic target. A pointer inside a target always binds;
 * otherwise it binds only when the target border is within `snapDistance`.
 */
export function snapMindMapLinePoint(
  point: MindMapCanvasPoint,
  targets: readonly MindMapCanvasLineSnapTarget[],
  snapDistance = MIND_MAP_LINE_SNAP_DISTANCE,
  preferredTarget?: MindMapCanvasLineTargetRef
): MindMapCanvasLineSnap {
  const preferred = targets.find((target) => targetMatches(target, preferredTarget))
  if (preferred) return { point, target: targetRef(preferred) }

  let nearest: MindMapCanvasLineSnapTarget | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const target of targets) {
    const closest = closestPointOnRect(point, target)
    const distance = Math.hypot(point.x - closest.x, point.y - closest.y)
    if (distance < nearestDistance) {
      nearest = target
      nearestDistance = distance
    }
  }

  return nearest && nearestDistance <= snapDistance
    ? { point, target: targetRef(nearest) }
    : { point }
}

function resolveTarget(
  ref: MindMapCanvasLineTargetRef | undefined,
  targets: readonly MindMapCanvasLineSnapTarget[]
): MindMapCanvasLineSnapTarget | undefined {
  return targets.find((target) => targetMatches(target, ref))
}

/**
 * Return the point on a target's border facing the other endpoint. This makes
 * an attached line remain visually anchored to a node/shape boundary instead
 * of cutting through the object from its centre.
 */
function borderPointFacing(
  target: MindMapCanvasLineSnapTarget,
  toward: MindMapCanvasPoint,
  fallback: MindMapCanvasPoint
): MindMapCanvasPoint {
  const center = targetCenter(target)
  const direction = targetDirection(center, toward, fallback)
  const halfWidth = Math.max(target.width / 2, Number.EPSILON)
  const halfHeight = Math.max(target.height / 2, Number.EPSILON)

  if (target.shape === 'ellipse') {
    return ellipseBorderPoint(center, direction, halfWidth, halfHeight)
  }

  if (target.shape === 'rounded-rect') {
    return roundedRectBorderPoint(target, center, direction, halfWidth, halfHeight)
  }

  const vertices = shapePolygonVertices(target)
  const polygonPoint = vertices ? polygonBorderPoint(center, direction, vertices) : undefined
  if (polygonPoint) return polygonPoint

  return rectangularBorderPoint(center, direction, halfWidth, halfHeight)
}

/** Resolve one raw snapped point to the actual line endpoint used for rendering/persistence. */
export function resolveMindMapLineEndpoint(
  snap: MindMapCanvasLineSnap,
  oppositePoint: MindMapCanvasPoint,
  targets: readonly MindMapCanvasLineSnapTarget[]
): MindMapCanvasLineEndpoint {
  const target = resolveTarget(snap.target, targets)
  if (!target) return { ...snap.point }
  return {
    ...borderPointFacing(target, oppositePoint, snap.point),
    target: targetRef(target)
  }
}

/**
 * Return the outward surface normal at an anchored endpoint. The canvas turns
 * this into the exact start/end path tangent, so arrowheads enter the visible
 * border rather than following an inaccurate centre-to-edge radial vector.
 */
export function resolveMindMapLineEndpointOutwardNormal(
  endpoint: MindMapCanvasLineEndpoint,
  targets: readonly MindMapCanvasLineSnapTarget[]
): MindMapCanvasPoint | undefined {
  const target = resolveTarget(endpoint.target, targets)
  return target ? targetOutlineOutwardNormal(target, endpoint) : undefined
}

/**
 * Resolve both endpoints together. When both ends are bound, each endpoint
 * faces the other target's current centre rather than an old persisted pointer
 * coordinate. That keeps a connector correctly aimed after either target is
 * moved or resized.
 */
export function resolveMindMapLineEndpoints(
  from: MindMapCanvasLineEndpoint,
  to: MindMapCanvasLineEndpoint,
  targets: readonly MindMapCanvasLineSnapTarget[]
): { from: MindMapCanvasLineEndpoint; to: MindMapCanvasLineEndpoint } {
  const fromTarget = resolveTarget(from.target, targets)
  const toTarget = resolveTarget(to.target, targets)
  const sameTarget = fromTarget !== undefined && toTarget !== undefined
    && fromTarget.id === toTarget.id
    && fromTarget.kind === toTarget.kind
  const fromToward = toTarget && !sameTarget ? targetCenter(toTarget) : to
  const toToward = fromTarget && !sameTarget ? targetCenter(fromTarget) : from

  return {
    from: fromTarget
      ? { ...borderPointFacing(fromTarget, fromToward, from), target: targetRef(fromTarget) }
      : { x: from.x, y: from.y },
    to: toTarget
      ? { ...borderPointFacing(toTarget, toToward, to), target: targetRef(toTarget) }
      : { x: to.x, y: to.y }
  }
}

/**
 * A connector is useful only when both ends are attached to real canvas
 * targets.  Keeping this check in the pure geometry layer means previews,
 * endpoint re-connects, and persistence all share the same rule.
 */
export function canConnectMindMapLineEndpoints(
  from: Pick<MindMapCanvasLineEndpoint, 'target'>,
  to: Pick<MindMapCanvasLineEndpoint, 'target'>,
  targets: readonly MindMapCanvasLineSnapTarget[]
): boolean {
  const fromTarget = resolveTarget(from.target, targets)
  const toTarget = resolveTarget(to.target, targets)
  if (!fromTarget || !toTarget) return false
  return fromTarget.id !== toTarget.id || fromTarget.kind !== toTarget.kind
}

/** Resolve a toolbar tool state to the concrete style used by a new line. */
export function resolveMindMapLineStyle(tool: MindMapCanvasLineTool): MindMapCanvasLineStyle {
  return {
    lineShape: tool.lineShape ?? 'straight',
    beginArrow: tool.beginArrow,
    // A line-tool gesture conventionally creates a directed connector unless
    // the caller explicitly selects `none` in its line-style menu.
    endArrow: tool.endArrow ?? 'triangle',
    linePattern: tool.linePattern
  }
}

/** Build a stable connector payload from its two raw pointer locations. */
export function buildMindMapCanvasLineDraft(
  from: MindMapCanvasLineSnap,
  to: MindMapCanvasLineSnap,
  targets: readonly MindMapCanvasLineSnapTarget[],
  tool: MindMapCanvasLineTool
): MindMapCanvasLineDraft | null {
  if (!canConnectMindMapLineEndpoints(from, to, targets)) return null

  const endpoints = resolveMindMapLineEndpoints(
    { ...from.point, ...(from.target ? { target: from.target } : {}) },
    { ...to.point, ...(to.target ? { target: to.target } : {}) },
    targets
  )
  return {
    ...endpoints,
    style: resolveMindMapLineStyle(tool)
  }
}

/** Exposed for the canvas interaction layer without leaking its internal snap state. */
export type MindMapCanvasLineSnapState = MindMapCanvasLineSnap
