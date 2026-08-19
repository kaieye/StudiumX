import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent
} from 'react'
import { StickyNote, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  MindMapConnector,
  MindMapDocumentV2,
  MindMapDrawingShape,
  MindMapElementType,
  MindMapImageElement,
  MindMapImagePlacement,
  MindMapMarker,
  MindMapSheetV2,
  MindMapTextSpan,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'
import type { MindMapCommand } from '../../../../shared/mindmap/commands'
import { classifyExternalDestination } from '../../../../shared/external-destination'
import { hasTextSpans, normalizeTextSpans } from '../../../../shared/mindmap/text-spans'
import { MARKER_DEFS } from './mind-map-marker-icons'
import {
  clampMindMapNodeWidth,
  computeMindMapLayout,
  computeMovedTopicPreview,
  computeTopicImageAndTextRegions,
  MIND_MAP_TOPIC_ACTION_BUTTON_RESERVED_WIDTH,
  MIND_MAP_SUMMARY_BRACE_WIDTH,
  MIND_MAP_SUMMARY_RANGE_GAP,
  MIND_MAP_TOPIC_IMAGE_GAP,
  MIND_MAP_TOPIC_IMAGE_SIDE_PADDING,
  mindMapTopicLineHeight,
  type MindMapLayoutCallout,
  type MindMapLayoutNode,
  type MindMapLayoutRelationship,
  type MindMapLayoutSummary,
  type MindMapMovedTopicPreview,
  wrapMindMapTopicTitle
} from './mind-map-layout'
import { branchColor, branchColorForKey } from './mind-map-branch-colors'
import { defaultTopicTextAlign, resolveEffectiveTopicStyle } from './mind-map-topic-style'
import {
  resolveMindMapTopicTextColor,
  resolveMindMapTopicTextStyle
} from './mind-map-topic-text-style'
import { resolveEdgePath, edgeStrokeWidth, lineDashPattern, taperedEdgePath } from './mind-map-edge-styles'
import { fontEntryLabel, SAFE_FONTS } from './mind-map-font-list'
import { DEFAULT_TOPIC_FONT_FAMILY } from './mind-map-topic-display-style'
import {
  elementLineDashArray,
  elementOutlinePath,
  relationshipArrowMarkerMetrics,
  relationshipArrowMarkerPath,
  relationshipElementPath
} from './mind-map-element-styles'
import {
  buildMindMapCanvasLineDraft,
  canConnectMindMapLineEndpoints,
  isMindMapCurvedLineShape,
  mindMapLineShapeSupportsCurvePoint,
  mindMapLineCurveControlOffset,
  MIND_MAP_LINE_MINIMUM_LENGTH,
  resolveMindMapLineEndpoints,
  resolveMindMapLineCurvePoint,
  resolveMindMapLineEndpointOutwardNormal,
  snapMindMapLinePoint,
  type MindMapCanvasLine,
  type MindMapCanvasLineDraft,
  type MindMapCanvasLineEndpoint,
  type MindMapCanvasLineSnapState,
  type MindMapCanvasLineSnapTarget,
  type MindMapCanvasLineTool,
  type MindMapCanvasLineStyle
} from './mind-map-line-tool'
import {
  mindMapDrawingShapePath,
  mindMapShapeBounds,
  MIND_MAP_SHAPE_MINIMUM_SIZE,
  normalizeMindMapDrawRect,
  resizeMindMapDrawRect,
  translateMindMapDrawRect,
  type MindMapDrawRect,
  type MindMapShapeResizeHandle
} from './mind-map-drawing-geometry'
import { resolveShape, shapeElement } from './mind-map-node-shapes'
import {
  centerMindMapViewport,
  fitMindMapViewport,
  MAX_MIND_MAP_ZOOM,
  MIN_MIND_MAP_ZOOM,
  zoomMindMapViewport
} from './mind-map-viewport'
import { useMindMapViewStore } from './mind-map-view-store'
import { useAppStore } from '../../app-shell/appStore'
import { hasMindMapTopicMarkdown, renderMarkdownInlineHtml } from '../../markdown-preview'
import { MindMapRichTextEditor, type MindMapRichTextEditorHandle } from './MindMapRichTextEditor'
import { MindMapTextFormatToolbar } from './MindMapTextFormatToolbar'
import { MindMapRichTextLabel } from './MindMapRichTextLabel'
import type { RichTextSelectionState } from './mind-map-rich-text-dom'
import { computeAllTopicNumbers } from './mind-map-numbering'
import {
  selectMindMapLinesInRectangle,
  selectMindMapNodesInRectangle
} from '../../../../shared/mindmap/domain/selection'
import {
  MIND_MAP_NODE_ACTION_OFFSET,
  MIND_MAP_NODE_ACTION_RADIUS,
  resolveMindMapNodeActionDirections,
  resolveMindMapNodeActionPosition
} from './mind-map-node-actions'

/**
 * Custom SVG mind-map canvas (docs/mindmap/design.md §6.3).
 *
 * No heavy graph/react-flow dependency — the tree is laid out by the pure
 * `computeMindMapLayout` module and painted as smoothed bezier edges + rounded
 * rect nodes. Colors come from the app's CSS design tokens so the dark theme
 * stays neutral. Pan (drag background) and zoom (wheel) drive a view transform.
 */

type Vec2 = { x: number; y: number }

/**
 * Rounded SVG caps extend half the stroke width beyond a path endpoint. That
 * overhang is desirable for plain connectors, but it becomes a visible stub
 * in front of an arrow marker whose tip is aligned with the same endpoint.
 */
function arrowedLineCapStyle(
  style: Pick<MindMapCanvasLineStyle, 'beginArrow' | 'endArrow'>
): CSSProperties {
  const hasArrow = (style.beginArrow !== undefined && style.beginArrow !== 'none')
    || (style.endArrow !== undefined && style.endArrow !== 'none')
  return hasArrow ? { strokeLinecap: 'butt' } : {}
}

/** Convert the shared connector element into the renderer's line-tool shape.
 * Anchors are resolved against the current layout on every render, so moving a
 * topic or shape keeps the line attached to its visible border. */
function connectorToCanvasLine(connector: MindMapConnector): MindMapCanvasLine {
  const style: MindMapCanvasLineStyle = {
    lineShape: connector.style?.lineShape ?? 'straight',
    beginArrow: connector.style?.beginArrow,
    endArrow: connector.style?.endArrow ?? 'triangle',
    linePattern: connector.style?.linePattern,
    stroke: connector.style?.stroke,
    strokeWidth: connector.style?.strokeWidth
  }
  return {
    id: connector.id,
    ...(connector.label ? { label: connector.label } : {}),
    ...(connector.curveControlOffset
      ? { curveControlOffset: { ...connector.curveControlOffset } }
      : {}),
    from: {
      x: connector.start.x,
      y: connector.start.y,
      ...(connector.start.anchor
        ? { target: { id: connector.start.anchor.targetId, kind: connector.start.anchor.targetType } }
        : {}),
      ...(connector.start.borderParam !== undefined
        ? { borderParam: connector.start.borderParam }
        : {})
    },
    to: {
      x: connector.end.x,
      y: connector.end.y,
      ...(connector.end.anchor
        ? { target: { id: connector.end.anchor.targetId, kind: connector.end.anchor.targetType } }
        : {}),
      ...(connector.end.borderParam !== undefined
        ? { borderParam: connector.end.borderParam }
        : {})
    },
    style
  }
}

/** A single endpoint update produced by dragging a persisted connector. */
export type MindMapCanvasLineUpdate = {
  from?: MindMapCanvasLineEndpoint
  to?: MindMapCanvasLineEndpoint
  curveControlOffset?: Vec2
  style?: Pick<NonNullable<MindMapConnector['style']>, 'lineShape'>
}

function lineEndpointToSnapState(endpoint: MindMapCanvasLineEndpoint): MindMapCanvasLineSnapState {
  return {
    point: { x: endpoint.x, y: endpoint.y },
    ...(endpoint.target ? { target: endpoint.target } : {})
  }
}

function lineSnapStateToEndpoint(state: MindMapCanvasLineSnapState): MindMapCanvasLineEndpoint {
  return {
    x: state.point.x,
    y: state.point.y,
    ...(state.target ? { target: state.target } : {})
  }
}

function lineEndpointEquals(a: MindMapCanvasLineEndpoint, b: MindMapCanvasLineEndpoint): boolean {
  return Math.abs(a.x - b.x) < 0.01
    && Math.abs(a.y - b.y) < 0.01
    && a.target?.id === b.target?.id
    && a.target?.kind === b.target?.kind
}

export type MindMapCanvasViewportAction = {
  id: number
  type: 'fit' | 'actual' | 'center' | 'zoom-in' | 'zoom-out'
} | {
  id: number
  type: 'navigate'
  /** Content-space point that should be centered in the viewport. */
  x: number
  y: number
}

export type MindMapCanvasShapeDraft = {
  shape: MindMapDrawingShape
  position: Vec2
  width: number
  height: number
}

/** A single persisted update produced by a direct free-shape interaction. */
export type MindMapCanvasShapeUpdate = {
  position?: Vec2
  width?: number
  height?: number
  label?: string | null
  /** Per-character formatting over `label` (Xmind-style rich text spans). */
  labelFormatting?: MindMapTextSpan[] | null
}

type CanvasProps = {
  document: MindMapDocumentV2
  activeSheetIndex: number
  onActiveSheetChange: (index: number) => void
  /** Temporary AI projection: navigation remains available but edits are blocked. */
  readOnly?: boolean
  /** Monotonic temporary-preview revision used to minimally reveal the newest topic. */
  generationPreviewRevision?: number
  /** Topics inserted by the latest temporary-preview step. */
  newlyRevealedNodeIds?: readonly string[]
  /** A primary background drag pans the viewport instead of marquee-selecting. Defaults to true. */
  panMode?: boolean
  /** Controlled shape-drawing mode chosen by the toolbar. */
  drawingShape?: MindMapDrawingShape | null
  /** Receives a completed shape gesture; the host owns IDs and persistence. */
  onCreateShape?: (draft: {
    shape: MindMapDrawingShape
    position: { x: number; y: number }
    width: number
    height: number
  }) => void
  /** Receives one committed shape move, resize, or text edit. */
  onUpdateShape?: (shapeId: string, patch: MindMapCanvasShapeUpdate) => void
  /** Controlled line-drawing mode chosen by the toolbar. */
  lineTool?: MindMapCanvasLineTool | null
  /** Additional targets (normally free shapes) that endpoints can magnetically bind to. */
  lineSnapTargets?: readonly MindMapCanvasLineSnapTarget[]
  /** Persisted free-form connectors supplied by the document host. */
  lines?: readonly MindMapCanvasLine[]
  /** Receives a completed connector gesture; the host owns IDs and persistence. */
  onCreateLine?: (draft: MindMapCanvasLineDraft) => void
  /** Receives one committed connector endpoint move. */
  onUpdateLine?: (lineId: string, patch: MindMapCanvasLineUpdate) => void
  /** Receives a connector deletion requested from the canvas. */
  onDeleteLine?: (lineId: string) => void
  viewportAction?: MindMapCanvasViewportAction | null
  onZoomChange?: (zoom: number) => void
  onViewportChange?: (viewport: { x: number; y: number; width: number; height: number }) => void
  onContextMenu?: (nodeId: string, x: number, y: number) => void
  onLineContextMenu?: (lineId: string, x: number, y: number) => void
  onShapeContextMenu?: (shapeId: string, x: number, y: number) => void
  onMoveNode?: (topicId: string, toParentId: string) => void
  onOpenNote?: (nodeId: string) => void
}

const VIEW_PADDING = 48
const CALLOUT_WIDTH = 192
const CALLOUT_HEIGHT = 52
const CALLOUT_GAP = 28
const MARKER_BADGE_SIZE = 18
const MARKER_BADGE_GAP = 3
/** Size of the SVG icons drawn by `mind-map-marker-icons` (their default). */
const MARKER_ICON_SIZE = 14
const SUMMARY_LABEL_GAP = 12
const SUMMARY_LABEL_WIDTH = 160
const TOPIC_LABEL_HORIZONTAL_PADDING = 10
/** Visual breathing room between an underline topic's text and its baseline. */
const UNDERLINE_TOPIC_LABEL_GAP = 3
// Starting a node drag changes the SVG hit target before pointer-up, so some
// Chromium/Electron builds never synthesize the subsequent `dblclick`. Detect
// the same gesture at the pointer-down seam that always receives both presses.
const NODE_DOUBLE_POINTER_INTERVAL_MS = 450
const NODE_DOUBLE_POINTER_DISTANCE_PX = 8
/** Below this pointer travel a press/release is a plain click, not a drag. */
const IMAGE_DRAG_THRESHOLD_PX = 4
/** Invisible horizontal edge hit target for direct node-width resizing. */
const MIND_MAP_NODE_RESIZE_EDGE_HIT_SIZE = 8
const MIND_MAP_SHAPE_LABEL_PADDING = 8
const MIND_MAP_SHAPE_RESIZE_HANDLES: readonly MindMapShapeResizeHandle[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
]
/** Invisible hit-zone thickness for shape edge resizing (document pixels). */
const MIND_MAP_SHAPE_RESIZE_EDGE_HIT_SIZE = 10

/**
 * Default visual properties for a free-drawn shape that carries no explicit
 * style override. These follow the tldraw geo-shape default philosophy — a
 * transparent fill so the canvas shows through (the learner adds a fill via
 * the element-style inspector when they want one) and a clearly visible,
 * theme-aware stroke at a comfortable weight.
 *
 *  - fill:   transparent (tldraw `fill: 'none'`)
 *  - stroke: the mind-map theme line colour, falling back to `--text` — a
 *            high-contrast ink colour (near-black in light theme, near-white
 *            in dark) mirroring tldraw's default `color: 'black'` rather
 *            than the accent blue or the near-invisible `--line-muted`
 *            divider token
 *  - width:  2 px — between tldraw's medium (`2 × 1.75 = 3.5` after theme
 *            scaling) and StudiumX's old 1.4 px, readable without dominating
 */
const DEFAULT_SHAPE_STROKE = 'var(--mindmap-theme-line, var(--text))'
const DEFAULT_SHAPE_FILL = 'transparent'
const DEFAULT_SHAPE_STROKE_WIDTH = 2
/**
 * Screen-space gap between a selected element's bounds and its dashed
 * selection ring (drawn shapes and topic nodes). Keeping the ring outside the
 * border (instead of on top of it) leaves the element's real stroke colour
 * and width fully visible while the element/topic-style inspector edits them.
 */
const MIND_MAP_SELECTION_RING_GAP = 5

/**
 * Return a transparent, screen-sized hit zone for one side/corner of a shape.
 * The zone deliberately spans the complete edge rather than just placing a
 * handle at its midpoint, so the resize cursor appears wherever the pointer
 * reaches the boundary. Corners win over sides where their zones overlap.
 */
function shapeResizeHitRect(
  rect: MindMapDrawRect,
  handle: MindMapShapeResizeHandle,
  size: number
): MindMapDrawRect {
  const half = size / 2
  const width = Math.max(size, rect.width)
  const height = Math.max(size, rect.height)
  const horizontalSpan = Math.max(1, rect.width - size)
  const verticalSpan = Math.max(1, rect.height - size)

  switch (handle) {
    case 'nw': return { x: rect.x - half, y: rect.y - half, width: size, height: size }
    case 'n': return { x: rect.x + half, y: rect.y - half, width: horizontalSpan, height: size }
    case 'ne': return { x: rect.x + rect.width - half, y: rect.y - half, width: size, height: size }
    case 'e': return { x: rect.x + rect.width - half, y: rect.y + half, width: size, height: verticalSpan }
    case 'se': return { x: rect.x + rect.width - half, y: rect.y + rect.height - half, width: size, height: size }
    case 's': return { x: rect.x + half, y: rect.y + rect.height - half, width: horizontalSpan, height: size }
    case 'sw': return { x: rect.x - half, y: rect.y + rect.height - half, width: size, height: size }
    case 'w': return { x: rect.x - half, y: rect.y + half, width: size, height: verticalSpan }
    default: return { x: rect.x, y: rect.y, width, height }
  }
}

function sameDrawRect(left: MindMapDrawRect, right: MindMapDrawRect): boolean {
  return left.x === right.x && left.y === right.y &&
    left.width === right.width && left.height === right.height
}
function topicLabelGeometry(
  regionX: number,
  regionWidth: number,
  textAlign: NonNullable<NonNullable<MindMapTopicV2['style']>['textAlign']>
): { x: number; textAnchor: 'start' | 'middle' | 'end' } {
  if (textAlign === 'left') {
    return { x: regionX + TOPIC_LABEL_HORIZONTAL_PADDING, textAnchor: 'start' }
  }
  if (textAlign === 'right') {
    return { x: regionX + regionWidth - TOPIC_LABEL_HORIZONTAL_PADDING, textAnchor: 'end' }
  }
  return { x: regionX + regionWidth / 2, textAnchor: 'middle' }
}

function relationshipLabelPosition(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode
): { x: number; y: number } {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  return {
    x: (fromCenter.x + toCenter.x) / 2,
    y: (fromCenter.y + toCenter.y) / 2 - 6
  }
}

/**
 * Smooth dashed connector from the hovered target node to the drop ghost,
 * mirroring the default curve edge style so the preview reads as a new child.
 */
function ghostConnectorPath(
  from: MindMapLayoutNode,
  ghost: MindMapMovedTopicPreview
): string {
  const fx = from.x + from.width / 2
  const fy = from.y + from.height / 2
  const tx = ghost.x + ghost.width / 2
  const ty = ghost.y + ghost.height / 2
  const midX = (fx + tx) / 2
  return `M ${fx} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${tx} ${ty}`
}

type MindMapCalloutRect = {
  callout: MindMapLayoutCallout
  topic: MindMapLayoutNode
  x: number
  y: number
  width: number
  height: number
}

function calloutRect(
  callout: MindMapLayoutCallout,
  topic: MindMapLayoutNode,
  topicCalloutIndex: number
): MindMapCalloutRect {
  const explicitPosition = callout.position
  const x = explicitPosition && Number.isFinite(explicitPosition.x)
    ? explicitPosition.x
    : topic.x + topic.width + CALLOUT_GAP
  const y = explicitPosition && Number.isFinite(explicitPosition.y)
    ? explicitPosition.y
    : topic.y + topicCalloutIndex * (CALLOUT_HEIGHT + 12)

  return {
    callout,
    topic,
    x,
    y,
    width: CALLOUT_WIDTH,
    height: CALLOUT_HEIGHT
  }
}

function calloutLeaderPath(rect: MindMapCalloutRect): string {
  const topicCenterX = rect.topic.x + rect.topic.width / 2
  const topicCenterY = rect.topic.y + rect.topic.height / 2
  const calloutCenterX = rect.x + rect.width / 2
  const calloutCenterY = rect.y + rect.height / 2
  const calloutIsRight = calloutCenterX >= topicCenterX
  const topicX = calloutIsRight ? rect.topic.x + rect.topic.width : rect.topic.x
  const calloutX = calloutIsRight ? rect.x : rect.x + rect.width
  const topicY = Math.min(
    rect.topic.y + rect.topic.height - 8,
    Math.max(rect.topic.y + 8, calloutCenterY)
  )
  const calloutY = Math.min(rect.y + rect.height - 10, Math.max(rect.y + 10, topicCenterY))
  return `M ${topicX} ${topicY} L ${calloutX} ${calloutY}`
}

function markerBadgePosition(
  node: MindMapLayoutNode,
  index: number
): { x: number; y: number } {
  return {
    x: node.x + node.width - MARKER_BADGE_SIZE / 2 - index * (MARKER_BADGE_SIZE + MARKER_BADGE_GAP),
    y: node.y + MARKER_BADGE_SIZE / 2 + 2
  }
}

const MARKER_ICON_BY_ID = new Map(MARKER_DEFS.map((def) => [def.id, def]))

/**
 * Resolve a topic marker to its concrete SVG icon.
 *
 * Markers picked from the markers panel store the marker id (e.g. `priority-3`,
 * `task-done`) in both `id` and `symbol`; legacy/imported markers may carry a
 * raw glyph (e.g. `★`) instead. Return the icon for known markers, or `null`
 * so the caller can fall back to the generic badge+text rendering.
 */
function markerIconFor(marker: MindMapMarker): ReactElement | null {
  const def = MARKER_ICON_BY_ID.get(marker.id) ?? MARKER_ICON_BY_ID.get(marker.symbol)
  return def ? def.render() : null
}

type MindMapSummaryBracket = {
  summary: MindMapLayoutSummary
  side: MindMapLayoutSummary['side']
  from: MindMapLayoutNode
  to: MindMapLayoutNode
  sourceTopics: readonly MindMapLayoutNode[]
  /** The real topic output for newly created summaries. */
  outputTopic?: MindMapLayoutNode
  x: number
  y: number
  bottom: number
  labelX: number
  labelY: number
}

function summaryBracket(
  summary: MindMapLayoutSummary,
  sourceTopics: readonly MindMapLayoutNode[],
  outputTopic?: MindMapLayoutNode
): MindMapSummaryBracket {
  const from = sourceTopics[0]!
  const to = sourceTopics.at(-1)!
  // The brace encloses the full visible covered range: its tips align with the
  // topmost and bottommost topic edges, including descendants added later.
  const y = summary.coveredTopY ?? Math.min(...sourceTopics.map((topic) => topic.y))
  const bottom = summary.coveredBottomY
    ?? Math.max(...sourceTopics.map((topic) => topic.y + topic.height))
  const coveredEdgeX = summary.coveredEdgeX ?? (summary.side === 'left'
    ? Math.min(...sourceTopics.map((topic) => topic.x))
    : Math.max(...sourceTopics.map((topic) => topic.x + topic.width)))
  const x = summary.side === 'left'
    ? coveredEdgeX - MIND_MAP_SUMMARY_RANGE_GAP
    : coveredEdgeX + MIND_MAP_SUMMARY_RANGE_GAP
  return {
    summary,
    side: summary.side,
    from,
    to,
    sourceTopics,
    outputTopic,
    x,
    y,
    bottom,
    labelX: summary.side === 'left' ? x - SUMMARY_LABEL_GAP : x + SUMMARY_LABEL_GAP,
    labelY: (y + bottom) / 2
  }
}

function summaryBraceGeometry(bracket: MindMapSummaryBracket): {
  height: number
  middle: number
  shoulderX: number
  pointX: number
  upperY: number
  lowerY: number
} {
  const height = Math.max(16, bracket.bottom - bracket.y)
  const horizontalDirection = bracket.side === 'left' ? -1 : 1
  const shoulderX = bracket.x + horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.62
  return {
    height,
    middle: bracket.y + height / 2,
    shoulderX,
    // Keep the acute point inside the brace envelope. It should read as a
    // compact flower-brace point, never as a separate oversized connector.
    pointX: bracket.x + horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH,
    upperY: bracket.y + height * 0.24,
    lowerY: bracket.bottom - height * 0.24
  }
}

function summaryPath(bracket: MindMapSummaryBracket): string {
  const { height, middle, shoulderX, pointX, upperY, lowerY } = summaryBraceGeometry(bracket)
  const pointControlY = Math.max(6, height * 0.13)
  const horizontalDirection = bracket.side === 'left' ? -1 : 1
  return [
    `M ${bracket.x} ${bracket.y}`,
    `C ${bracket.x + horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.5} ${bracket.y}, ${shoulderX} ${bracket.y + height * 0.08}, ${shoulderX} ${upperY}`,
    // Different incoming/outgoing tangents make the centre a deliberate sharp
    // point while keeping the two brace arms gently curved.
    `C ${shoulderX} ${bracket.y + height * 0.4}, ${pointX - horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.35} ${middle - pointControlY}, ${pointX} ${middle}`,
    `C ${pointX - horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.35} ${middle + pointControlY}, ${shoulderX} ${bracket.bottom - height * 0.4}, ${shoulderX} ${lowerY}`,
    `C ${shoulderX} ${bracket.bottom - height * 0.08}, ${bracket.x + horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.5} ${bracket.bottom}, ${bracket.x} ${bracket.bottom}`
  ].join(' ')
}

function updateTopicWidth(
  topic: MindMapTopicV2,
  topicId: string,
  width: number
): MindMapTopicV2 {
  if (topic.id === topicId) {
    return {
      ...topic,
      style: {
        ...(topic.style ?? {}),
        widthMode: 'fixed',
        width: clampMindMapNodeWidth(width)
      }
    }
  }

  let changed = false
  const children = topic.children.map((child) => {
    const next = updateTopicWidth(child, topicId, width)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...topic, children } : topic
}

function updateTopicTitlePreview(
  topic: MindMapTopicV2,
  topicId: string,
  title: string
): MindMapTopicV2 {
  if (topic.id === topicId) {
    return topic.title === title ? topic : { ...topic, title }
  }

  let changed = false
  const children = topic.children.map((child) => {
    const next = updateTopicTitlePreview(child, topicId, title)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...topic, children } : topic
}

function findTopicNode(node: MindMapTopicV2, id: string): MindMapTopicV2 | undefined {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findTopicNode(child, id)
    if (found) return found
  }
  return undefined
}

function findTopicDepth(node: MindMapTopicV2, id: string, depth = 0): number | null {
  if (node.id === id) return depth
  for (const child of node.children) {
    const found = findTopicDepth(child, id, depth + 1)
    if (found !== null) return found
  }
  return null
}

/** Human label for the primary family of a CSS font stack ("Inter, …" → "Inter"). */
function primaryFontFamilyLabel(stack: string): string {
  const primary = stack.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? ''
  return primary || stack
}

/**
 * Whether a DOM focus target lives inside the right-side inspector panel. When
 * the inline editor blurs into this panel we keep the edit session (and the
 * text selection) alive so the panel's text-property controls target the
 * selected span instead of the whole node/shape label.
 */
function isMindMapInspectorTarget(target: Node | null): boolean {
  return target instanceof Element && target.closest('.mindmap-ai-panel') !== null
}

/** Counts how many sheet elements still reference an asset (for cleanup). */
function countImageAssetReferences(document: MindMapDocumentV2, assetId: string): number {
  let count = 0
  for (const sheet of document.sheets) {
    for (const image of sheet.images ?? []) {
      if (image.assetId === assetId) count += 1
    }
  }
  return count
}

/** Projected rectangle for every sheet image (attached and free). */
function computeImageRects(
  sheet: MindMapSheetV2 | null,
  nodeById: Map<string, MindMapLayoutNode>
): Array<{
  id: string
  assetId: string
  x: number
  y: number
  width: number
  height: number
  attached: boolean
  topicId?: string
}> {
  const rects: ReturnType<typeof computeImageRects> = []
  const images = sheet?.images ?? []
  const byTopic = new Map<string, MindMapImageElement[]>()
  for (const image of images) {
    if (image.topicId !== undefined) {
      const list = byTopic.get(image.topicId) ?? []
      list.push(image)
      byTopic.set(image.topicId, list)
    }
  }
  for (const [topicId, list] of byTopic) {
    const node = nodeById.get(topicId)
    if (!node) continue
    const placement = (node.imagePlacement ?? 'bottom') as MindMapImagePlacement
    const regions = computeTopicImageAndTextRegions(node, list, placement)
    if (!regions.image) continue
    const block = regions.image
    const side = placement === 'left' || placement === 'right'
    const totalHeight =
      list.reduce((sum, img) => sum + img.height, 0)
      + Math.max(0, list.length - 1) * MIND_MAP_TOPIC_IMAGE_GAP
    const startY = block.y + (block.height - totalHeight) / 2
    let acc = 0
    for (const image of list) {
      let x: number
      if (side) {
        x =
          placement === 'left'
            ? block.x + MIND_MAP_TOPIC_IMAGE_SIDE_PADDING
            : block.x + block.width - MIND_MAP_TOPIC_IMAGE_SIDE_PADDING - image.width
      } else {
        x = block.x + (block.width - image.width) / 2
      }
      rects.push({
        id: image.id,
        assetId: image.assetId,
        x,
        y: startY + acc,
        width: image.width,
        height: image.height,
        attached: true,
        topicId
      })
      acc += image.height + MIND_MAP_TOPIC_IMAGE_GAP
    }
  }
  for (const image of images) {
    if (image.topicId === undefined && image.position !== undefined) {
      rects.push({
        id: image.id,
        assetId: image.assetId,
        x: image.position.x,
        y: image.position.y,
        width: image.width,
        height: image.height,
        attached: false
      })
    }
  }
  return rects
}

export function MindMapCanvas({
  document,
  activeSheetIndex,
  readOnly = false,
  generationPreviewRevision,
  newlyRevealedNodeIds = [],
  panMode = true,
  drawingShape = null,
  onCreateShape,
  onUpdateShape,
  lineTool = null,
  lineSnapTargets: externalLineSnapTargets = [],
  lines,
  onCreateLine,
  onUpdateLine,
  onDeleteLine,
  viewportAction,
  onZoomChange,
  onViewportChange,
  onContextMenu,
  onLineContextMenu,
  onShapeContextMenu,
  onMoveNode,
  onOpenNote
}: CanvasProps) {
  const { t } = useTranslation()
  const openExternal = useAppStore((state) => state.openExternal)
  const workspaceId = useAppStore((state) => state.appState?.activeWorkspace?.id ?? null)
  const selection = useMindMapViewStore((s) => s.selection)
  const selectedNodeId = useMindMapViewStore((s) => s.selectedNodeId)
  const selectTopic = useMindMapViewStore((s) => s.selectTopic)
  const selectElement = useMindMapViewStore((s) => s.selectElement)
  const setHybridSelection = useMindMapViewStore((s) => s.setHybridSelection)
  const selectCanvas = useMindMapViewStore((s) => s.selectCanvas)
  const editingNodeId = useMindMapViewStore((s) => s.editingNodeId)
  const setEditingNodeId = useMindMapViewStore((s) => s.setEditingNodeId)
  const richTextSelection = useMindMapViewStore((s) => s.richTextSelection)
  const setRichTextSelection = useMindMapViewStore((s) => s.setRichTextSelection)
  const setRichTextSelectionActive = useMindMapViewStore((s) => s.setRichTextSelectionActive)
  const setRichTextTarget = useMindMapViewStore((s) => s.setRichTextTarget)
  const richTextStyleRequest = useMindMapViewStore((s) => s.richTextStyleRequest)
  const updateNode = useMindMapViewStore((s) => s.updateNode)
  const addChild = useMindMapViewStore((s) => s.addChild)
  const toggleCollapse = useMindMapViewStore((s) => s.toggleCollapse)
  const selectImage = useMindMapViewStore((s) => s.selectImage)
  const moveImage = useMindMapViewStore((s) => s.moveImage)
  const resizeImage = useMindMapViewStore((s) => s.resizeImage)
  const dispatchCommand = useMindMapViewStore((s) => s.dispatchCommand)

  const sheetCount = document.sheets.length
  const safeSheetIndex = Math.min(Math.max(activeSheetIndex, 0), sheetCount - 1)
  const sheet = document.sheets[safeSheetIndex]
  const [editValue, setEditValue] = useState('')
  const [editSpans, setEditSpans] = useState<MindMapTextSpan[]>([])

  const nodeEditorRef = useRef<MindMapRichTextEditorHandle | null>(null)
  const shapeEditorRef = useRef<MindMapRichTextEditorHandle | null>(null)

  const [nodeResizeState, setNodeResizeState] = useState<{
    nodeId: string
    edge: 'left' | 'right'
    startPointer: Vec2
    startWidth: number
    width: number
  } | null>(null)

  // Image drag: moving an image between nodes or to a free position. The
  // dragged image follows the pointer as a local ghost and commits on release.
  const [imageDragState, setImageDragState] = useState<{
    imageId: string
    startPointer: Vec2
    /** Live pointer position in content coordinates while dragging. */
    current: Vec2
    /** Offset from the grab pointer to the image's top-left corner, so the
     *  grabbed point stays under the cursor instead of recentring the image. */
    grabOffset: Vec2
    /** The 4-region node we are currently hovering (for the drop highlight). */
    dropRegion: { topicId: string; region: MindMapImagePlacement } | null
  } | null>(null)
  const [imageResizeState, setImageResizeState] = useState<{
    imageId: string
    startPointer: Vec2
    startWidth: number
    startHeight: number
  } | null>(null)
  // Free-shape gestures are intentionally local previews. Like tldraw's
  // translating/resizing states, this avoids appending a history command for
  // every pointermove and lets all anchored connectors follow the same draft.
  const [shapeInteraction, setShapeInteraction] = useState<{
    kind: 'move' | 'resize'
    shapeId: string
    startPointer: Vec2
    initialRect: MindMapDrawRect
    currentRect: MindMapDrawRect
    handle?: MindMapShapeResizeHandle
  } | null>(null)
  const [shapeTextEditing, setShapeTextEditing] = useState<{
    shapeId: string
    value: string
    spans: MindMapTextSpan[]
  } | null>(null)
  // A blur follows a keyboard submit when React removes the editor. Retain a
  // tiny explicit session guard so that blur cannot turn one edit into two
  // undoable commands.
  const shapeTextEditingSessionRef = useRef<string | null>(null)
  // Keep shape pointer capture on the originating SVG element. Capturing it on
  // the root SVG retargets the browser's follow-up click/dblclick events and
  // prevents the shape group's in-place text editor from opening.
  const shapeInteractionCaptureRef = useRef<SVGElement | null>(null)

  // Edit and resize previews stay local until commit so typing does not create
  // one undoable topic.update command per keypress. The pure layout still sees
  // the draft title/width, keeping the topic and its connectors in sync.
  const layoutSheet = useMemo(() => {
    if (!sheet) return sheet
    let root = sheet.root
    if (editingNodeId !== null) {
      root = updateTopicTitlePreview(root, editingNodeId, editValue)
    }
    if (nodeResizeState) {
      root = updateTopicWidth(root, nodeResizeState.nodeId, nodeResizeState.width)
    }
    return root === sheet.root ? sheet : { ...sheet, root }
  }, [editValue, editingNodeId, nodeResizeState, sheet])

  const layout = useMemo(
    () => (layoutSheet
      // G3: untitled topics are measured as the placeholder label so they
      // render as a normal-sized chip instead of a blank stub.
      ? computeMindMapLayout(layoutSheet, {
          emptyTitleFallback: t('mindmap.untitledTopic'),
          reserveTopicActionButtonSpace: true
        })
      : { nodes: [], edges: [], relationships: [], callouts: [], summaries: [], boundaries: [], images: [] }),
    [layoutSheet, t]
  )

  const visibleAssetIds = useMemo(
    () => [...new Set((sheet?.images ?? []).map((image) => image.assetId))],
    [sheet]
  )
  const [assetDataUrls, setAssetDataUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    if (!workspaceId || visibleAssetIds.length === 0) {
      setAssetDataUrls({})
      return () => {
        cancelled = true
      }
    }

    void Promise.all(visibleAssetIds.map(async (assetId) => {
      try {
        const result = await window.teachingSystem?.readMindMapAsset({
          workspaceId,
          id: document.id,
          assetId
        })
        return result ? [assetId, result.dataUrl] as const : null
      } catch {
        return null
      }
    })).then((entries) => {
      if (cancelled) return
      setAssetDataUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)))
    })

    return () => {
      cancelled = true
    }
  }, [document.id, visibleAssetIds, workspaceId])

  const nodeById = useMemo(() => {
    const map = new Map<string, MindMapLayoutNode>()
    for (const node of layout.nodes) map.set(node.id, node)
    return map
  }, [layout.nodes])

  const drawnShapes = useMemo(
    () => (sheet?.elements ?? []).filter((element): element is Extract<typeof element, { type: 'shape' }> => element.type === 'shape'),
    [sheet]
  )

  // One transient shape rectangle is shared by rendering, bounds, snapping, and
  // connector endpoint resolution. This is the important tldraw-style detail:
  // a line anchored to a shape moves with its local drag preview, rather than
  // visibly lagging until the pointer is released and the document updates.
  const renderedShapes = useMemo(() => drawnShapes.map((shape) => ({
    shape,
    rect: shapeInteraction?.shapeId === shape.id
      ? shapeInteraction.currentRect
      : mindMapShapeBounds(shape.position, shape.width, shape.height)
  })), [drawnShapes, shapeInteraction])

  // A contentEditable editor has no native vertical-align property. Keep its
  // intrinsic content height centered inside the shape while it grows for
  // multi-line input, so the first caret starts in the same visual centre as
  // the label.
  useLayoutEffect(() => {
    const editor = shapeEditorRef.current?.root
    if (!editor || !shapeTextEditing) return
    const host = editor.parentElement
    if (!host) return
    editor.style.height = 'auto'
    const hostHeight = host.getBoundingClientRect().height
    const contentHeight = Math.min(
      Math.max(editor.scrollHeight, 1),
      hostHeight > 0 ? hostHeight : Number.POSITIVE_INFINITY
    )
    editor.style.height = `${contentHeight}px`
  }, [shapeTextEditing, renderedShapes])

  const documentLines = useMemo(
    () => (sheet?.elements ?? [])
      .filter((element): element is MindMapConnector => element.type === 'connector')
      .map(connectorToCanvasLine),
    [sheet]
  )
  // Hosts may provide a projected line list (for example while a command is
  // optimistic). When omitted, render the persisted connector elements from the
  // active sheet directly so the canvas remains useful as a standalone view.
  const renderedLines = lines ?? documentLines

  // Topic bounds are always available from the layout. The independent shape
  // tool supplies its own bounds through `lineSnapTargets`, letting the line
  // interaction bind to either kind without taking ownership of shape storage.
  const availableLineSnapTargets = useMemo(() => {
    const targets: MindMapCanvasLineSnapTarget[] = []
    const keys = new Set<string>()
    const addTarget = (target: MindMapCanvasLineSnapTarget): void => {
      if (!Number.isFinite(target.x) || !Number.isFinite(target.y) ||
        !Number.isFinite(target.width) || !Number.isFinite(target.height) ||
        target.width <= 0 || target.height <= 0) return
      const key = `${target.kind}:${target.id}`
      if (keys.has(key)) return
      keys.add(key)
      targets.push(target)
    }
    for (const node of layout.nodes) {
      addTarget({
        id: node.id,
        kind: 'topic',
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        shape: resolveShape(node.shape)
      })
    }
    for (const { shape, rect } of renderedShapes) {
      addTarget({
        id: shape.id,
        kind: 'shape',
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        shape: shape.shape
      })
    }
    for (const target of externalLineSnapTargets) addTarget(target)
    return targets
  }, [externalLineSnapTargets, layout.nodes, renderedShapes])

  const lineSnapTargetByKey = useMemo(
    () => new Map(availableLineSnapTargets.map((target) => [`${target.kind}:${target.id}`, target])),
    [availableLineSnapTargets]
  )

  // StudiumX numbering prefixes (2.1.3). Purely derived from the sheet tree and
  // recomputed when the tree changes; only the static label shows the number,
  // the inline editor and accessible name keep the raw title.
  const topicNumbers = useMemo(
    () => (sheet ? computeAllTopicNumbers(sheet.root) : new Map<string, string>()),
    [sheet]
  )

  const calloutRects = useMemo(() => {
    const topicCalloutIndexes = new Map<string, number>()
    const rects: MindMapCalloutRect[] = []
    for (const callout of layout.callouts) {
      const topic = nodeById.get(callout.topicId)
      // Descendants of collapsed topics are not in nodeById, so their
      // annotations disappear with the hidden subtree as well.
      if (!topic) continue
      const topicCalloutIndex = topicCalloutIndexes.get(callout.topicId) ?? 0
      topicCalloutIndexes.set(callout.topicId, topicCalloutIndex + 1)
      rects.push(calloutRect(callout, topic, topicCalloutIndex))
    }
    return rects
  }, [layout.callouts, nodeById])

  const summaryBrackets = useMemo(() => {
    const brackets: MindMapSummaryBracket[] = []
    for (const summary of layout.summaries) {
      const sourceTopicIds = summary.sourceTopicIds ?? [summary.from, summary.to]
      const sourceTopics = sourceTopicIds.map((topicId) => nodeById.get(topicId))
      // A collapsed subtree removes its descendants from nodeById; hide the
      // summary rather than leaving a dangling structural annotation.
      if (sourceTopics.some((topic) => topic === undefined)) continue
      const outputTopic = summary.summaryTopicId === undefined
        ? undefined
        : nodeById.get(summary.summaryTopicId)
      if (summary.summaryTopicId !== undefined && outputTopic === undefined) continue
      brackets.push(summaryBracket(summary, sourceTopics as MindMapLayoutNode[], outputTopic))
    }
    return brackets
  }, [layout.summaries, nodeById])

  // Container-pixel coordinate system: 1 SVG unit = 1 CSS pixel.
  // ResizeObserver tracks the actual rendered container so the viewBox always
  // matches the on-screen pixel dimensions (StudiumX model).  This prevents the
  // old behaviour where a single-node map was stretched to fill the viewport.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [containerSize, setContainerSize] = useState<{ cw: number; ch: number }>({ cw: 800, ch: 600 })
  const [hasMeasuredContainer, setHasMeasuredContainer] = useState(false)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const svg = el.querySelector<SVGSVGElement>('.mindmap-svg')

    // Keep the SVG's coordinate system in the same ResizeObserver delivery as
    // the CSS box; waiting for the React state update can leave one frame where
    // the old viewBox is fitted into the new width, making the map shrink or
    // slide during a layout resize.
    const syncSvgViewBox = (width: number, height: number): void => {
      if (!svg) return
      const nextViewBox = `0 0 ${width} ${height}`
      if (svg.getAttribute('viewBox') !== nextViewBox) {
        svg.setAttribute('viewBox', nextViewBox)
      }
    }

    const updateContainerSize = (width: number, height: number): void => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
      const next = { cw: Math.max(1, width), ch: Math.max(1, height) }
      syncSvgViewBox(next.cw, next.ch)
      setContainerSize((current) =>
        current.cw === next.cw && current.ch === next.ch ? current : next
      )
      setHasMeasuredContainer(true)
    }

    const rect = el.getBoundingClientRect()
    updateContainerSize(rect.width, rect.height)

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateContainerSize(entry.contentRect.width, entry.contentRect.height)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const dragRef = useRef<{
    kind: 'pan' | 'box'
    startPointer: Vec2
    startSvg: Vec2
    startPan: Vec2
    moved: boolean
    additive: boolean
  } | null>(null)
  const [selectionBox, setSelectionBox] = useState<{
    start: Vec2
    current: Vec2
  } | null>(null)
  const lastNodePointerDownRef = useRef<{
    nodeId: string
    at: number
    pointer: Vec2
  } | null>(null)
  const handledViewportActionIdRef = useRef<number | null>(null)
  // Node drag-and-drop reparenting state
  const [nodeDragState, setNodeDragState] = useState<{
    draggingId: string
    startPointer: Vec2
    dropTargetId: string | null
    /** Dashed ghost rect where the dragged topic will land (content space). */
    ghost: MindMapMovedTopicPreview | null
  } | null>(null)
  const [lineDrawState, setLineDrawState] = useState<{
    start: MindMapCanvasLineSnapState
    current: MindMapCanvasLineSnapState
    startPointer: Vec2
  } | null>(null)
  /** Local endpoint preview for a selected connector. Persist only on release. */
  const [lineInteraction, setLineInteraction] = useState<{
    lineId: string
    endpoint: 'from' | 'to'
    initial: MindMapCanvasLineEndpoint
    current: MindMapCanvasLineSnapState
  } | null>(null)
 /** Local curve-point preview for a selected curved connector. */
 const [lineControlInteraction, setLineControlInteraction] = useState<{
   lineId: string
   initial: Vec2
   current: Vec2
   /** Keeps the grabbed point under the pointer when dragging the line body. */
   pointerOffset: Vec2
 } | null>(null)
 /** Body-drag state: moves both endpoints together without changing shape. */
 const [lineBodyInteraction, setLineBodyInteraction] = useState<{
   lineId: string
   /** Pointer offset from the initial grab to the midpoint of from/to. */
   pointerOffset: Vec2
   /** Endpoint positions at drag start. */
   initialFrom: MindMapCanvasLineEndpoint
   initialTo: MindMapCanvasLineEndpoint
   /** Current pointer-derived midpoint (updated on every move). */
   currentMidpoint: Vec2
   /** Whether the pointer has actually moved since the drag started. */
   moved: boolean
 } | null>(null)
  const lineInteractionCaptureRef = useRef<SVGElement | null>(null)
  const [shapeDrawState, setShapeDrawState] = useState<{
    shape: MindMapDrawingShape
    start: Vec2
    current: Vec2
    startPointer: Vec2
  } | null>(null)

  // A preview can begin while a node or free-shape editor still owns focus.
  // Drop every local edit gesture before the read-only shield takes over so a
  // subsequent blur or keypress cannot commit to the canonical document.
  useEffect(() => {
    if (!readOnly) return
    dragRef.current = null
    lastNodePointerDownRef.current = null
    shapeTextEditingSessionRef.current = null
    setEditingNodeId(null)
    setNodeResizeState(null)
    setNodeDragState(null)
    setImageDragState(null)
    setImageResizeState(null)
    setShapeInteraction(null)
    setShapeTextEditing(null)
    setLineDrawState(null)
    setLineInteraction(null)
    setLineControlInteraction(null)
    lineInteractionCaptureRef.current = null
    setShapeDrawState(null)
    setSelectionBox(null)
  }, [readOnly, setEditingNodeId])

  // When the store's editing node changes (e.g. F2 from the keyboard), seed the
  // local edit buffer with that node's current title.
  useEffect(() => {
    if (editingNodeId === null || !sheet) return
    const topic = findTopicNode(sheet.root, editingNodeId)
    if (topic === undefined) return
    setEditValue(topic.title)
    setEditSpans(topic.titleFormatting ? normalizeTextSpans(topic.titleFormatting, topic.title.length) : [])
  }, [editingNodeId, sheet])

  // The right-side inspector issues one-shot rich text style requests (span
  // formatting applied to the selected text). Forward them to the active
  // editor so the editor DOM/model stays the single source of truth, deduped
  // by the monotonically increasing request id.
  const richTextStyleRequestAppliedRef = useRef<number | null>(null)
  useEffect(() => {
    if (!richTextStyleRequest || richTextStyleRequestAppliedRef.current === richTextStyleRequest.id) {
      return
    }
    richTextStyleRequestAppliedRef.current = richTextStyleRequest.id
    const editor = editingNodeId ? nodeEditorRef.current : shapeEditorRef.current
    editor?.applyStyle(richTextStyleRequest.style, richTextStyleRequest.toggle)
  }, [richTextStyleRequest, editingNodeId])

  const bounds = useMemo(() => {
    if (layout.nodes.length === 0) {
      return { left: 0, top: 0, right: 800, bottom: 600 }
    }
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const node of layout.nodes) {
      left = Math.min(left, node.x)
      top = Math.min(top, node.y)
      right = Math.max(right, node.x + node.width)
      bottom = Math.max(bottom, node.y + node.height)
    }
    for (const { rect } of renderedShapes) {
      left = Math.min(left, rect.x)
      top = Math.min(top, rect.y)
      right = Math.max(right, rect.x + rect.width)
      bottom = Math.max(bottom, rect.y + rect.height)
    }
    for (const line of renderedLines) {
      left = Math.min(left, line.from.x, line.to.x)
      top = Math.min(top, line.from.y, line.to.y)
      right = Math.max(right, line.from.x, line.to.x)
      bottom = Math.max(bottom, line.from.y, line.to.y)
    }
    for (const callout of calloutRects) {
      left = Math.min(left, callout.x)
      top = Math.min(top, callout.y)
      right = Math.max(right, callout.x + callout.width)
      bottom = Math.max(bottom, callout.y + callout.height)
    }
    for (const summary of summaryBrackets) {
      const { pointX } = summaryBraceGeometry(summary)
      left = Math.min(left, summary.x, pointX)
      top = Math.min(top, summary.y)
      right = Math.max(right, summary.x, pointX)
      bottom = Math.max(bottom, summary.bottom)
      if (!summary.outputTopic) {
        if (summary.side === 'left') {
          left = Math.min(left, summary.labelX - SUMMARY_LABEL_WIDTH)
        } else {
          right = Math.max(right, summary.labelX + SUMMARY_LABEL_WIDTH)
        }
      }
    }
    return { left, top, right, bottom }
  }, [calloutRects, layout.nodes, renderedLines, renderedShapes, summaryBrackets])

  // viewBox follows the container's pixel dimensions so 1 SVG unit = 1 CSS px.
  const viewBox = `0 0 ${containerSize.cw} ${containerSize.ch}`

  // viewportSize is the actual container size, not the content bounding box.
  const viewportSize = useMemo(
    () => ({
      width: Math.max(1, containerSize.cw),
      height: Math.max(1, containerSize.ch)
    }),
    [containerSize]
  )

  // StudiumX keeps a freshly created / edited topic on screen: when inline editing
  // starts on a node that sits outside the viewport, pan minimally to reveal it.
  const revealedEditRef = useRef<string | null>(null)
  useEffect(() => {
    if (editingNodeId === null) {
      revealedEditRef.current = null
      return
    }
    if (revealedEditRef.current === editingNodeId) return
    revealedEditRef.current = editingNodeId
    const node = layout.nodes.find((n) => n.id === editingNodeId)
    if (!node) return
    const margin = 48
    setPan((prev) => {
      const screenX = prev.x + node.x * zoom
      const screenY = prev.y + node.y * zoom
      const screenW = node.width * zoom
      const screenH = node.height * zoom
      let dx = 0
      let dy = 0
      if (screenX < margin) dx = margin - screenX
      else if (screenX + screenW > viewportSize.width - margin)
        dx = viewportSize.width - margin - (screenX + screenW)
      if (screenY < margin) dy = margin - screenY
      else if (screenY + screenH > viewportSize.height - margin)
        dy = viewportSize.height - margin - (screenY + screenH)
      if (dx === 0 && dy === 0) return prev
      return { x: prev.x + dx, y: prev.y + dy }
    })
  }, [editingNodeId, layout.nodes, viewportSize, zoom])

  useEffect(() => {
    if (!viewportAction || handledViewportActionIdRef.current === viewportAction.id) return
    handledViewportActionIdRef.current = viewportAction.id

    if (viewportAction.type === 'fit') {
      const next = fitMindMapViewport(bounds, viewportSize, VIEW_PADDING)
      setPan(next.pan)
      setZoom(next.zoom)
      return
    }

    if (viewportAction.type === 'zoom-in' || viewportAction.type === 'zoom-out') {
      // Toolbar zoom has no pointer location to preserve, so use the canvas
      // centre as its anchor. Updating zoom alone scales the SVG around (0, 0)
      // and visibly pulls the whole map toward the upper-left at low zoom.
      const next = zoomMindMapViewport(
        { pan, zoom },
        { x: viewportSize.width / 2, y: viewportSize.height / 2 },
        viewportAction.type === 'zoom-in' ? 1.2 : 1 / 1.2
      )
      setPan(next.pan)
      setZoom(next.zoom)
      return
    }

    if (viewportAction.type === 'navigate') {
      setPan({
        x: viewportSize.width / 2 - viewportAction.x * zoom,
        y: viewportSize.height / 2 - viewportAction.y * zoom
      })
      return
    }

    const next = centerMindMapViewport(
      bounds,
      viewportSize,
      viewportAction.type === 'actual' ? 1 : zoom
    )
    setPan(next.pan)
    setZoom(next.zoom)
  }, [bounds, pan, viewportAction, viewportSize, zoom])

  // Fit the content on mount and when the document changes.
  // StudiumX opens a map with its content visible and centred; fit only ever
  // shrinks (zoom caps at 100%), so a fresh single-node map still opens at 1:1.
  const documentId = document.id
  const centeredDocRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!hasMeasuredContainer || !sheet || centeredDocRef.current === documentId) return
    if (layout.nodes.length === 0) return
    centeredDocRef.current = documentId
    const next = fitMindMapViewport(bounds, viewportSize)
    setPan(next.pan)
    setZoom(next.zoom)
  }, [documentId, hasMeasuredContainer, sheet, layout.nodes, bounds, viewportSize])

  // A preview uses the canonical document id, so the initial-document fit
  // effect above must not run for every inserted branch. Instead, move only as
  // far as necessary to keep the newest node inside a comfortable viewport
  // margin. This preserves a learner's orientation while the tree grows.
  const revealedPreviewRevisionRef = useRef<number | null>(null)
  useEffect(() => {
    if (!readOnly || generationPreviewRevision === undefined) return
    if (revealedPreviewRevisionRef.current === generationPreviewRevision) return
    revealedPreviewRevisionRef.current = generationPreviewRevision
    const newestId = newlyRevealedNodeIds.at(-1)
    if (!newestId) return
    const node = layout.nodes.find((candidate) => candidate.id === newestId)
    if (!node) return
    const margin = 64
    setPan((previous) => {
      const left = previous.x + node.x * zoom
      const top = previous.y + node.y * zoom
      const right = left + node.width * zoom
      const bottom = top + node.height * zoom
      let dx = 0
      let dy = 0
      if (left < margin) dx = margin - left
      else if (right > viewportSize.width - margin) dx = viewportSize.width - margin - right
      if (top < margin) dy = margin - top
      else if (bottom > viewportSize.height - margin) dy = viewportSize.height - margin - bottom
      return dx === 0 && dy === 0 ? previous : { x: previous.x + dx, y: previous.y + dy }
    })
  }, [generationPreviewRevision, layout.nodes, newlyRevealedNodeIds, readOnly, viewportSize, zoom])

  useEffect(() => {
    if (!onViewportChange || zoom <= 0) return
    onViewportChange({
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      width: viewportSize.width / zoom,
      height: viewportSize.height / zoom
    })
  }, [onViewportChange, pan, viewportSize, zoom])

  // Report zoom changes to parent for the floating zoom controls
  useEffect(() => {
    onZoomChange?.(zoom)
  }, [zoom, onZoomChange])

  const svgPointFromClientPosition = (clientX: number, clientY: number): Vec2 => {
    const rect = svgRef.current?.getBoundingClientRect()
    return rect
      ? { x: clientX - rect.left, y: clientY - rect.top }
      : { x: clientX, y: clientY }
  }

  const svgPointFromPointer = (event: ReactPointerEvent<SVGSVGElement>): Vec2 => {
    return svgPointFromClientPosition(event.clientX, event.clientY)
  }

  const contentPointFromClientPosition = (clientX: number, clientY: number): Vec2 => {
    const point = svgPointFromClientPosition(clientX, clientY)
    return {
      x: (point.x - pan.x) / Math.max(zoom, 0.01),
      y: (point.y - pan.y) / Math.max(zoom, 0.01)
    }
  }

  const contentPointFromSvgPointer = (event: ReactPointerEvent<SVGSVGElement>): Vec2 => {
    return contentPointFromClientPosition(event.clientX, event.clientY)
  }

  const lineTargetFromPointerEvent = (
    event: ReactPointerEvent<SVGSVGElement>
  ): MindMapCanvasLineSnapTarget | undefined => {
    const target = event.target as Element | null
    const key = target?.closest?.('[data-mindmap-line-snap-target]')?.getAttribute('data-mindmap-line-snap-target')
    if (key) return lineSnapTargetByKey.get(key)

    // Endpoint handles use pointer capture, so the browser keeps dispatching
    // events to the circle even after the pointer has entered a topic/shape.
    // Fall back to a geometric hit test in that case instead of relying only
    // on the transparent snap-target rectangles being the event target.
    const point = contentPointFromSvgPointer(event)
    return availableLineSnapTargets.find((candidate) =>
      point.x >= candidate.x
      && point.x <= candidate.x + candidate.width
      && point.y >= candidate.y
      && point.y <= candidate.y + candidate.height
    )
  }

  const snapLinePointFromPointer = (
    event: ReactPointerEvent<SVGSVGElement>
  ): MindMapCanvasLineSnapState => {
    const preferredTarget = lineTargetFromPointerEvent(event)
    return snapMindMapLinePoint(
      contentPointFromSvgPointer(event),
      availableLineSnapTargets,
      undefined,
      preferredTarget && { id: preferredTarget.id, kind: preferredTarget.kind }
    )
  }

  const resolveLineEndpointsForInteraction = (
    line: MindMapCanvasLine,
    endpoint: 'from' | 'to',
    current: MindMapCanvasLineSnapState
  ): { from: MindMapCanvasLineEndpoint; to: MindMapCanvasLineEndpoint } => {
    const nextEndpoint = lineSnapStateToEndpoint(current)
    return resolveMindMapLineEndpoints(
      endpoint === 'from' ? nextEndpoint : line.from,
      endpoint === 'to' ? nextEndpoint : line.to,
      availableLineSnapTargets
    )
  }

  const persistLineUpdate = (
    lineId: string,
    update: MindMapCanvasLineUpdate,
    label = 'Move connector endpoint'
  ): void => {
    if (readOnly) return
    const line = renderedLines.find((candidate) => candidate.id === lineId)
    if (!line) return
    const from = update.from ?? line.from
    const to = update.to ?? line.to
    if (!canConnectMindMapLineEndpoints(from, to, availableLineSnapTargets)) return

    if (onUpdateLine) {
      onUpdateLine(lineId, update)
      return
    }

    const endpoint = (value: MindMapCanvasLineEndpoint) => ({
      x: value.x,
      y: value.y,
      ...(value.target
        ? {
            anchor: {
              targetType: value.target.kind,
              targetId: value.target.id
            }
          }
        : {}),
      ...(value.borderParam !== undefined ? { borderParam: value.borderParam } : {})
    })
    const nextStart = update.from ? endpoint(update.from) : null
    const nextEnd = update.to ? endpoint(update.to) : null
    if ((update.from && !nextStart) || (update.to && !nextEnd)) return
    const patch = {
      ...(nextStart ? { start: nextStart } : {}),
      ...(nextEnd ? { end: nextEnd } : {}),
      ...(update.curveControlOffset
        ? { curveControlOffset: { ...update.curveControlOffset } }
        : {}),
      ...(update.style ? { style: { ...update.style } } : {})
    }
    if (Object.keys(patch).length === 0 || !sheet) return
    dispatchCommand(
      { type: 'element.update', sheetId: sheet.id, elementId: lineId, patch },
      { label }
    )
  }

  const releaseLineInteractionCapture = (pointerId: number): void => {
    const capturedElement = lineInteractionCaptureRef.current
    lineInteractionCaptureRef.current = null
    try {
      if (capturedElement?.hasPointerCapture(pointerId)) {
        capturedElement.releasePointerCapture(pointerId)
      }
    } catch {
      // Pointer capture is best-effort in test/webview shims and is released
      // automatically by the browser after pointerup in normal operation.
    }
  }

  const startLineEndpointInteraction = (
    line: MindMapCanvasLine,
    endpoint: 'from' | 'to',
    event: ReactPointerEvent<SVGElement>
  ): void => {
    if (readOnly || drawingShape || lineTool?.active || editingNodeId || nodeResizeState || shapeTextEditing) return
    // Keep a secondary click (context menu) from bubbling to the SVG root,
    // whose right-button pan gesture captures the pointer and swallows the
    // subsequent contextmenu event.
    event.stopPropagation()
    if (event.button !== 0 && event.button !== undefined) return
    event.preventDefault()
    dragRef.current = null
    lastNodePointerDownRef.current = null
    selectElement(line.id, 'connector')

    const resolved = resolveMindMapLineEndpoints(
      line.from,
      line.to,
      availableLineSnapTargets
    )
    const initial = endpoint === 'from' ? resolved.from : resolved.to
    setLineControlInteraction(null)
    setLineBodyInteraction(null)
    setLineInteraction({
      lineId: line.id,
      endpoint,
      initial,
      current: lineEndpointToSnapState(initial)
    })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
      lineInteractionCaptureRef.current = event.currentTarget
    } catch {
      // Pointer capture is not available in a few test/webview shims.
    }
  }

  const startLineControlInteraction = (
    line: MindMapCanvasLine,
    controlPoint: Vec2,
    event: ReactPointerEvent<SVGElement>
  ): void => {
    if (readOnly || drawingShape || lineTool?.active || editingNodeId || nodeResizeState || shapeTextEditing) return
    event.stopPropagation()
    if (event.button !== 0 && event.button !== undefined) return
    event.preventDefault()
    dragRef.current = null
    lastNodePointerDownRef.current = null
    selectElement(line.id, 'connector')
    setLineInteraction(null)
    setLineBodyInteraction(null)
    setLineControlInteraction({
      lineId: line.id,
      initial: controlPoint,
      current: controlPoint,
      pointerOffset: { x: 0, y: 0 }
    })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
      lineInteractionCaptureRef.current = event.currentTarget
    } catch {
      // Pointer capture is not available in a few test/webview shims.
    }
  }

  /**
   * Dragging a connector body moves both endpoints together so the whole line
   * translates without changing its shape or detaching either end. The line
   * shape is never promoted — only the curve control point (for curved lines)
   * can adjust the route.
   */
  const startLineBodyInteraction = (
    line: MindMapCanvasLine,
    event: ReactPointerEvent<SVGElement>
  ): void => {
    if (readOnly || drawingShape || lineTool?.active || editingNodeId || nodeResizeState || shapeTextEditing) return
    event.stopPropagation()
    if (event.button !== 0 && event.button !== undefined) return
    event.preventDefault()
    dragRef.current = null
    lastNodePointerDownRef.current = null
    selectElement(line.id, 'connector')

    const { from, to } = resolveMindMapLineEndpoints(
      line.from,
      line.to,
      availableLineSnapTargets
    )
    const pointer = contentPointFromClientPosition(event.clientX, event.clientY)
    const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
    setLineInteraction(null)
    setLineControlInteraction(null)
    setLineBodyInteraction({
      lineId: line.id,
      pointerOffset: {
        x: midpoint.x - pointer.x,
        y: midpoint.y - pointer.y
      },
      initialFrom: from,
      initialTo: to,
      currentMidpoint: midpoint,
      moved: false
    })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
      lineInteractionCaptureRef.current = event.currentTarget
    } catch {
      // Pointer capture is not available in a few test/webview shims.
    }
  }

  const openLineContextMenu = (
    lineId: string,
    event: ReactMouseEvent<SVGElement>
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    if (readOnly || lineTool?.active || drawingShape) return
    selectElement(lineId, 'connector')
    onLineContextMenu?.(lineId, event.clientX, event.clientY)
  }

  const openShapeContextMenu = (
    shapeId: string,
    event: ReactMouseEvent<SVGElement>
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    if (readOnly || lineTool?.active || drawingShape || shapeTextEditing) return
    selectElement(shapeId, 'shape')
    onShapeContextMenu?.(shapeId, event.clientX, event.clientY)
  }

  const cancelLineInteraction = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!lineInteraction && !lineControlInteraction && !lineBodyInteraction) return
    setLineInteraction(null)
    setLineControlInteraction(null)
    setLineBodyInteraction(null)
    releaseLineInteractionCapture(event.pointerId)
  }

  const persistShapeUpdate = (
    shapeId: string,
    patch: MindMapCanvasShapeUpdate,
    label: string
  ): void => {
    if (readOnly) return
    if (onUpdateShape) {
      onUpdateShape(shapeId, patch)
      return
    }
    // The canvas is also used by a few standalone previews. Keep their direct
    // store fallback functional, while the editor host remains the normal
    // owner of persisted shape updates through `onUpdateShape`.
    if (!sheet) return
    dispatchCommand(
      { type: 'element.update', sheetId: sheet.id, elementId: shapeId, patch },
      { label }
    )
  }

  const shapeInteractionRectAtPointer = (
    interaction: NonNullable<typeof shapeInteraction>,
    event: ReactPointerEvent<SVGSVGElement>
  ): MindMapDrawRect => {
    const delta = {
      x: (event.clientX - interaction.startPointer.x) / Math.max(zoom, 0.01),
      y: (event.clientY - interaction.startPointer.y) / Math.max(zoom, 0.01)
    }
    return interaction.kind === 'move'
      ? translateMindMapDrawRect(interaction.initialRect, delta)
      : resizeMindMapDrawRect(interaction.initialRect, interaction.handle ?? 'se', delta)
  }

  const startShapeTextEditing = (shapeId: string, initialValue: string, initialSpans: MindMapTextSpan[] = []): void => {
    if (readOnly) return
    selectElement(shapeId, 'shape')
    setShapeInteraction(null)
    setRichTextSelection(null)
    setRichTextTarget({ kind: 'shape', shapeId })
    shapeTextEditingSessionRef.current = shapeId
    setShapeTextEditing({
      shapeId,
      value: initialValue,
      spans: normalizeTextSpans(initialSpans, initialValue.length)
    })
  }

  const commitShapeTextEditing = (shapeId: string, value: string, spans: MindMapTextSpan[]): void => {
    if (shapeTextEditingSessionRef.current !== shapeId) return
    if (readOnly) {
      shapeTextEditingSessionRef.current = null
      setShapeTextEditing(null)
      setRichTextSelection(null)
      setRichTextSelectionActive(false)
      setRichTextTarget(null)
      return
    }
    shapeTextEditingSessionRef.current = null
    const normalizedSpans = normalizeTextSpans(spans, value.length)
    const nextLabel = value === '' ? null : value
    const currentShape = drawnShapes.find((shape) => shape.id === shapeId)
    const currentLabel = currentShape?.label ?? null
    const currentFormatting = currentShape?.labelFormatting ?? []
    const formattingChanged = JSON.stringify(normalizedSpans) !== JSON.stringify(currentFormatting)
    if (nextLabel !== currentLabel || formattingChanged) {
      persistShapeUpdate(
        shapeId,
        {
          label: nextLabel,
          ...(formattingChanged
            ? { labelFormatting: normalizedSpans.length > 0 ? normalizedSpans : null }
            : {})
        },
        'Edit shape text'
      )
    }
    setShapeTextEditing(null)
    setRichTextSelection(null)
    setRichTextSelectionActive(false)
    setRichTextTarget(null)
  }

  const cancelShapeTextEditing = (shapeId: string): void => {
    if (shapeTextEditingSessionRef.current !== shapeId) return
    shapeTextEditingSessionRef.current = null
    setShapeTextEditing(null)
    setRichTextSelection(null)
    setRichTextSelectionActive(false)
    setRichTextTarget(null)
  }

  const releaseShapeInteractionCapture = (pointerId: number): void => {
    const capturedElement = shapeInteractionCaptureRef.current
    shapeInteractionCaptureRef.current = null
    try {
      if (capturedElement?.hasPointerCapture(pointerId)) {
        capturedElement.releasePointerCapture(pointerId)
      }
    } catch {
      // Pointer capture is best-effort in test/webview shims and is released
      // automatically by the browser after pointerup in normal operation.
    }
  }

  const startShapeInteraction = (
    shapeId: string,
    initialRect: MindMapDrawRect,
    kind: 'move' | 'resize',
    event: ReactPointerEvent<SVGElement>,
    handle?: MindMapShapeResizeHandle
  ): void => {
    if (readOnly || drawingShape || lineTool?.active || editingNodeId || nodeResizeState || shapeTextEditing) return
    if (event.button !== 0 && event.button !== undefined) return
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = null
    lastNodePointerDownRef.current = null
    selectElement(shapeId, 'shape')
    setShapeInteraction({
      kind,
      shapeId,
      startPointer: { x: event.clientX, y: event.clientY },
      initialRect,
      currentRect: initialRect,
      ...(handle ? { handle } : {})
    })
    try {
      // Keep the captured pointer on this group/handle rather than the root
      // SVG. Chromium dispatches the compatible click/dblclick events to the
      // capture target, so root capture would make a free shape impossible to
      // double-click into text-editing mode.
      event.currentTarget.setPointerCapture(event.pointerId)
      shapeInteractionCaptureRef.current = event.currentTarget
    } catch {
      // Pointer capture is not available in a few test/webview shims.
    }
  }

  const startPointerDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (editingNodeId || nodeResizeState) return
    lastNodePointerDownRef.current = null
    const isPrimaryButton = event.button === 0 || event.button === undefined
    if (drawingShape && isPrimaryButton) {
      const start = contentPointFromSvgPointer(event)
      dragRef.current = null
      setSelectionBox(null)
      setShapeDrawState({
        shape: drawingShape,
        start,
        current: start,
        startPointer: { x: event.clientX, y: event.clientY }
      })
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is not available in a few test/webview shims.
      }
      return
    }
    if (lineTool?.active && isPrimaryButton) {
      const start = snapLinePointFromPointer(event)
      // A free line may begin on blank canvas and only snap when the pointer
      // starts near a node/shape. The live preview follows every move, and the
      // gesture is committed (or rejected for too-short travel) on release.
      dragRef.current = null
      setSelectionBox(null)
      setLineDrawState({
        start,
        current: start,
        startPointer: { x: event.clientX, y: event.clientY }
      })
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is not available in a few test/webview shims.
      }
      return
    }
    const startSvg = svgPointFromPointer(event)
    // A primary background drag pans the viewport by default. The toolbar's
    // box-selection mode opts into marquee selection instead. Non-primary
    // pointers always remain a pan gesture in either mode.
    const kind = panMode || !isPrimaryButton ? 'pan' : 'box'
    dragRef.current = {
      kind,
      startPointer: { x: event.clientX, y: event.clientY },
      startSvg,
      startPan: pan,
      moved: false,
      additive: event.metaKey || event.ctrlKey || event.shiftKey
    }
    if (kind === 'box') setSelectionBox({ start: startSvg, current: startSvg })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is not available in a few test/webview shims. The
      // normal bubbling handlers still provide a safe fallback there.
    }
  }

  /** Capture-phase entry point used to prevent node controls from stealing a
   * drawing gesture when the pointer starts over an existing topic/shape. */
  const startDrawingPointerCapture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if ((!drawingShape && !lineTool?.active) || (event.button !== 0 && event.button !== undefined)) return
    event.preventDefault()
    event.stopPropagation()
    startPointerDrag(event)
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (lineControlInteraction) {
      const pointer = contentPointFromSvgPointer(event)
      const current = {
        x: pointer.x + lineControlInteraction.pointerOffset.x,
        y: pointer.y + lineControlInteraction.pointerOffset.y
      }
      if (
        current.x !== lineControlInteraction.current.x
        || current.y !== lineControlInteraction.current.y
      ) {
        setLineControlInteraction({ ...lineControlInteraction, current })
      }
      return
    }
    if (lineBodyInteraction) {
      const pointer = contentPointFromSvgPointer(event)
      const midpoint = {
        x: pointer.x + lineBodyInteraction.pointerOffset.x,
        y: pointer.y + lineBodyInteraction.pointerOffset.y
      }
      const initialMidpoint = {
        x: (lineBodyInteraction.initialFrom.x + lineBodyInteraction.initialTo.x) / 2,
        y: (lineBodyInteraction.initialFrom.y + lineBodyInteraction.initialTo.y) / 2
      }
      const moved = Math.abs(midpoint.x - initialMidpoint.x) >= 0.01
        || Math.abs(midpoint.y - initialMidpoint.y) >= 0.01
      if (midpoint.x !== lineBodyInteraction.currentMidpoint.x
        || midpoint.y !== lineBodyInteraction.currentMidpoint.y
        || moved !== lineBodyInteraction.moved
      ) {
        setLineBodyInteraction({ ...lineBodyInteraction, currentMidpoint: midpoint, moved })
      }
      return
    }
    if (lineInteraction) {
      const current = snapLinePointFromPointer(event)
      const line = renderedLines.find((candidate) => candidate.id === lineInteraction.lineId)
      if (!line) return
      const canConnect = lineInteraction.endpoint === 'from'
        ? canConnectMindMapLineEndpoints(current, line.to, availableLineSnapTargets)
        : canConnectMindMapLineEndpoints(line.from, current, availableLineSnapTargets)
      if (!canConnect) return
      if (
        current.point.x !== lineInteraction.current.point.x
        || current.point.y !== lineInteraction.current.point.y
        || current.target?.id !== lineInteraction.current.target?.id
        || current.target?.kind !== lineInteraction.current.target?.kind
      ) {
        setLineInteraction({ ...lineInteraction, current })
      }
      return
    }
    if (shapeInteraction) {
      const currentRect = shapeInteractionRectAtPointer(shapeInteraction, event)
      if (!sameDrawRect(currentRect, shapeInteraction.currentRect)) {
        setShapeInteraction({ ...shapeInteraction, currentRect })
      }
      return
    }
    if (shapeDrawState) {
      const current = contentPointFromSvgPointer(event)
      if (current.x !== shapeDrawState.current.x || current.y !== shapeDrawState.current.y) {
        setShapeDrawState({ ...shapeDrawState, current })
      }
      return
    }
    if (lineDrawState) {
      const current = snapLinePointFromPointer(event)
      if (
        current.point.x !== lineDrawState.current.point.x ||
        current.point.y !== lineDrawState.current.point.y ||
        current.target?.id !== lineDrawState.current.target?.id ||
        current.target?.kind !== lineDrawState.current.target?.kind
      ) {
        setLineDrawState({ ...lineDrawState, current })
      }
      return
    }
    if (nodeResizeState) return
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startPointer.x
    const dy = event.clientY - drag.startPointer.y
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    if (drag.kind === 'box') {
      setSelectionBox({ start: drag.startSvg, current: svgPointFromPointer(event) })
      return
    }
    setPan({ x: drag.startPan.x + dx, y: drag.startPan.y + dy })
  }

  const endPointerDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (lineBodyInteraction) {
      const line = renderedLines.find((candidate) => candidate.id === lineBodyInteraction.lineId)
      const initialMidpoint = {
        x: (lineBodyInteraction.initialFrom.x + lineBodyInteraction.initialTo.x) / 2,
        y: (lineBodyInteraction.initialFrom.y + lineBodyInteraction.initialTo.y) / 2
      }
      if (
        line
        && (Math.abs(lineBodyInteraction.currentMidpoint.x - initialMidpoint.x) >= 0.01
          || Math.abs(lineBodyInteraction.currentMidpoint.y - initialMidpoint.y) >= 0.01)
      ) {
        const dx = lineBodyInteraction.currentMidpoint.x - initialMidpoint.x
        const dy = lineBodyInteraction.currentMidpoint.y - initialMidpoint.y
        // Detach both endpoints from their targets so the line moves freely
        // as a whole. A body drag is a translation, not a re-anchoring.
        const nextFrom: MindMapCanvasLineEndpoint = {
          x: lineBodyInteraction.initialFrom.x + dx,
          y: lineBodyInteraction.initialFrom.y + dy
        }
        const nextTo: MindMapCanvasLineEndpoint = {
          x: lineBodyInteraction.initialTo.x + dx,
          y: lineBodyInteraction.initialTo.y + dy
        }
        persistLineUpdate(line.id, { from: nextFrom, to: nextTo }, 'Move connector')
      }
      setLineBodyInteraction(null)
      releaseLineInteractionCapture(event.pointerId)
      return
    }
    if (lineControlInteraction) {
      const line = renderedLines.find((candidate) => candidate.id === lineControlInteraction.lineId)
      const pointer = contentPointFromSvgPointer(event)
      const current = {
        x: pointer.x + lineControlInteraction.pointerOffset.x,
        y: pointer.y + lineControlInteraction.pointerOffset.y
      }
      if (
        line
        && (Math.abs(current.x - lineControlInteraction.initial.x) >= 0.01
          || Math.abs(current.y - lineControlInteraction.initial.y) >= 0.01)
      ) {
        const { from, to } = resolveMindMapLineEndpoints(
          line.from,
          line.to,
          availableLineSnapTargets
        )
        persistLineUpdate(
          line.id,
          {
            curveControlOffset: mindMapLineCurveControlOffset(current, from, to)
          },
          'Adjust connector curve'
        )
      }
      setLineControlInteraction(null)
      releaseLineInteractionCapture(event.pointerId)
      return
    }
    if (lineInteraction) {
      const line = renderedLines.find((candidate) => candidate.id === lineInteraction.lineId)
      const current = snapLinePointFromPointer(event)
      if (line) {
        const canConnect = lineInteraction.endpoint === 'from'
          ? canConnectMindMapLineEndpoints(current, line.to, availableLineSnapTargets)
          : canConnectMindMapLineEndpoints(line.from, current, availableLineSnapTargets)
        if (canConnect) {
          const resolved = resolveLineEndpointsForInteraction(
            line,
            lineInteraction.endpoint,
            current
          )
          const next = lineInteraction.endpoint === 'from' ? resolved.from : resolved.to
          if (!lineEndpointEquals(next, lineInteraction.initial)) {
            persistLineUpdate(
              line.id,
              lineInteraction.endpoint === 'from' ? { from: next } : { to: next }
            )
          }
        }
      }
      setLineInteraction(null)
      releaseLineInteractionCapture(event.pointerId)
      return
    }
    if (shapeInteraction) {
      const finalRect = shapeInteractionRectAtPointer(shapeInteraction, event)
      if (!sameDrawRect(finalRect, shapeInteraction.initialRect)) {
        persistShapeUpdate(
          shapeInteraction.shapeId,
          {
            position: { x: finalRect.x, y: finalRect.y },
            width: finalRect.width,
            height: finalRect.height
          },
          shapeInteraction.kind === 'move' ? 'Move shape' : 'Resize shape'
        )
      }
      setShapeInteraction(null)
      releaseShapeInteractionCapture(event.pointerId)
      return
    }
    if (shapeDrawState) {
      const current = contentPointFromSvgPointer(event)
      const travelled = Math.hypot(
        event.clientX - shapeDrawState.startPointer.x,
        event.clientY - shapeDrawState.startPointer.y
      ) / Math.max(zoom, 0.01)
      if (travelled >= MIND_MAP_SHAPE_MINIMUM_SIZE) {
        const rect = normalizeMindMapDrawRect(shapeDrawState.start, current)
        if (rect.width >= MIND_MAP_SHAPE_MINIMUM_SIZE && rect.height >= MIND_MAP_SHAPE_MINIMUM_SIZE) {
          onCreateShape?.({
            shape: shapeDrawState.shape,
            position: { x: rect.x, y: rect.y },
            width: rect.width,
            height: rect.height
          })
        }
      }
      setShapeDrawState(null)
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // See matching pointer-capture guard above.
      }
      return
    }
    if (lineDrawState) {
      const current = snapLinePointFromPointer(event)
      const travelled = Math.hypot(
        event.clientX - lineDrawState.startPointer.x,
        event.clientY - lineDrawState.startPointer.y
      ) / Math.max(zoom, 0.01)
      if (travelled >= MIND_MAP_LINE_MINIMUM_LENGTH) {
        const draft = buildMindMapCanvasLineDraft(
          lineDrawState.start,
          current,
          availableLineSnapTargets,
          lineTool ?? { active: true }
        )
        if (draft) onCreateLine?.(draft)
      }
      setLineDrawState(null)
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // See matching pointer-capture guard above.
      }
      return
    }
    const drag = dragRef.current
    const isBackground = event.target === event.currentTarget
    if (drag?.kind === 'box' && drag.moved) {
      const endSvg = svgPointFromPointer(event)
      const left = Math.min(drag.startSvg.x, endSvg.x)
      const top = Math.min(drag.startSvg.y, endSvg.y)
      const right = Math.max(drag.startSvg.x, endSvg.x)
      const bottom = Math.max(drag.startSvg.y, endSvg.y)
      const rect = { left, top, right, bottom }
      const topicIds = selectMindMapNodesInRectangle(
        layout.nodes.map((node) => ({
          id: node.id,
          x: pan.x + node.x * zoom,
          y: pan.y + node.y * zoom,
          width: node.width * zoom,
          height: node.height * zoom
        })),
        rect
      )
      // The marquee also sweeps freely drawn shapes. Shapes share the same
      // screen-space transform as topics (translate(pan) scale(zoom)), so
      // reuse the marquee hit test against their rendered rectangles.
      const shapeIds = selectMindMapNodesInRectangle(
        renderedShapes.map(({ shape, rect: shapeRect }) => ({
          id: shape.id,
          x: pan.x + shapeRect.x * zoom,
          y: pan.y + shapeRect.y * zoom,
          width: shapeRect.width * zoom,
          height: shapeRect.height * zoom
        })),
        rect
      )
      // The marquee also sweeps freely drawn lines (connectors). A connector's
      // rendered path is sampled at its endpoints and curve control point
      // (when present), then transformed into the same screen space as topics
      // and shapes. Any segment crossing the box, or a path whose bounding box
      // sits fully inside the box, marks the line as swept. This lets a single
      // drag catch nodes, shapes, and lines together as one hybrid selection.
      const lineIds = selectMindMapLinesInRectangle(
        renderedLineGeometries.map(({ line, from, to, curvePoint }) => ({
          id: line.id,
          points: [
            { x: pan.x + from.x * zoom, y: pan.y + from.y * zoom },
            { x: pan.x + to.x * zoom, y: pan.y + to.y * zoom },
            ...(curvePoint ? [{ x: pan.x + curvePoint.x * zoom, y: pan.y + curvePoint.y * zoom }] : [])
          ]
        })),
        rect
      )
      const elementEntries = [
        ...shapeIds.map((id) => ({ id, type: 'shape' as MindMapElementType })),
        ...lineIds.map((id) => ({ id, type: 'connector' as MindMapElementType }))
      ]
      // Topics, shapes, and lines can all be swept by the same marquee. A
      // drag that catches more than one kind becomes a hybrid selection so
      // the inspector, context menu, and keyboard delete treat them as one
      // group. Degenerate single-kind results collapse back to the existing
      // topic / element / elements shapes inside the store action.
      if (drag.additive) {
        if (topicIds.length > 0 || elementEntries.length > 0) {
          setHybridSelection(topicIds, elementEntries, true)
        } else {
          selectCanvas()
        }
      } else if (topicIds.length > 0 || elementEntries.length > 0) {
        setHybridSelection(topicIds, elementEntries, false)
      } else {
        selectCanvas()
      }
    } else if (drag && !drag.moved && isBackground) {
      // Treat a click on the background as a selection clear.
      selectCanvas()
    }
    setSelectionBox(null)
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // See the matching setPointerCapture guard above.
    }
  }

  const cancelLineDraw = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!lineDrawState && !shapeDrawState) return
    setLineDrawState(null)
    setShapeDrawState(null)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // The capture may already have been released by the browser.
    }
  }

  const cancelShapeInteraction = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!shapeInteraction) return
    setShapeInteraction(null)
    releaseShapeInteractionCapture(event.pointerId)
  }

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault()
    // Ctrl/Cmd + wheel (trackpad pinch) still zooms; a plain wheel scrolls the
    // canvas instead. This matches the requested StudiumX-style interaction where
    // a vertical wheel pans up/down and a horizontal wheel (tilt wheel / shift
    // + scroll) pans left/right through the map.
    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
      const rect = event.currentTarget.getBoundingClientRect()
      // Container-pixel coordinates: pointer maps 1:1 to SVG user space.
      const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      }
      const next = zoomMindMapViewport({ pan, zoom }, pointer, factor)
      setPan(next.pan)
      setZoom(Math.min(MAX_MIND_MAP_ZOOM, Math.max(MIN_MIND_MAP_ZOOM, next.zoom)))
      return
    }

    // Normalize the wheel delta across pixel / line / page modes so scrolling
    // feels like a normal page scroll regardless of the pointing device.
    let dx = event.deltaX
    let dy = event.deltaY
    if (event.deltaMode === 1) {
      // WheelEvent.DOM_DELTA_LINE: most mice report lines; treat each as ~16px.
      dx *= 16
      dy *= 16
    } else if (event.deltaMode === 2) {
      // WheelEvent.DOM_DELTA_PAGE: treat a page as a full viewport dimension.
      dx *= viewportSize.width
      dy *= viewportSize.height
    }
    // Scrolling up reveals content above (pan.y increases); scrolling down
    // reveals content below (pan.y decreases). A horizontal tilt wheel scrolls
    // left/right through the map.
    setPan((prev) => ({ x: prev.x - dx, y: prev.y - dy }))
  }

  const beginEdit = (nodeId: string, initial: string, initialSpans: MindMapTextSpan[] = []): void => {
    if (readOnly) return
    selectTopic(nodeId, false)
    setRichTextSelection(null)
    setRichTextSelectionActive(false)
    setRichTextTarget({ kind: 'node', nodeId })
    setEditingNodeId(nodeId)
    setEditValue(initial)
    setEditSpans(normalizeTextSpans(initialSpans, initial.length))
  }

  const commitEdit = (text = editValue, spans = editSpans): void => {
    if (readOnly) {
      setEditingNodeId(null)
      setRichTextSelection(null)
      setRichTextSelectionActive(false)
      setRichTextTarget(null)
      return
    }
    if (editingNodeId !== null && sheet) {
      const normalizedSpans = normalizeTextSpans(spans, text.length)
      const currentTopic = findTopicNode(sheet.root, editingNodeId)
      const currentFormatting = currentTopic?.titleFormatting ?? []
      const formattingChanged = JSON.stringify(normalizedSpans) !== JSON.stringify(currentFormatting)
      updateNode(editingNodeId, {
        title: text,
        ...(formattingChanged
          ? { titleFormatting: normalizedSpans.length > 0 ? normalizedSpans : null }
          : {})
      })
    }
    setEditingNodeId(null)
    setRichTextSelection(null)
    setRichTextSelectionActive(false)
    setRichTextTarget(null)
  }

  // When the editor blurs into the right-side panel we keep the edit session
  // open (so panel edits target the selected span). The next pointerdown on
  // the canvas — background, another node, a control — commits the pending
  // edit, mirroring the normal "click away to commit" behaviour.
  const panelDeferredCommitRef = useRef(false)

  const commitPendingEditOnCanvasPointerDown = (): void => {
    if (!panelDeferredCommitRef.current) return
    panelDeferredCommitRef.current = false
    if (editingNodeId !== null) {
      commitEdit()
    } else if (shapeTextEditing) {
      commitShapeTextEditing(shapeTextEditing.shapeId, shapeTextEditing.value, shapeTextEditing.spans)
    }
  }

  // The live selection drives the floating toolbar; the "active" flag is kept
  // for the right panel even after the editor blurs (see onBlur handling).
  const handleRichTextSelectionChange = useCallback(
    (state: RichTextSelectionState): void => {
      setRichTextSelection(state)
      if (state.active) setRichTextSelectionActive(true)
    },
    [setRichTextSelection, setRichTextSelectionActive]
  )

  const beginNodeAction = useCallback(
    (nodeId: string, additive: boolean) => {
      if (readOnly) return
      selectTopic(nodeId, additive)
    },
    [readOnly, selectTopic]
  )

  // --- Node resize interaction ---

  const startNodeResize = (
    node: MindMapLayoutNode,
    edge: 'left' | 'right',
    event: ReactPointerEvent<SVGGElement>
  ): void => {
    if (readOnly || editingNodeId || nodeDragState) return
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = null
    lastNodePointerDownRef.current = null
    setNodeResizeState({
      nodeId: node.id,
      edge,
      startPointer: { x: event.clientX, y: event.clientY },
      startWidth: node.width,
      width: node.width
    })
    try {
      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is not available in a few test/webview shims.
    }
  }

  const updateNodeResize = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const resize = nodeResizeState
    if (!resize) return
    const horizontalDelta = (event.clientX - resize.startPointer.x) / Math.max(zoom, 0.01)
    const nextWidth = clampMindMapNodeWidth(
      resize.startWidth + (resize.edge === 'right' ? horizontalDelta : -horizontalDelta)
    )
    if (nextWidth === resize.width) return
    setNodeResizeState({ ...resize, width: nextWidth })
  }

  const endNodeResize = (event?: ReactPointerEvent<SVGSVGElement>): void => {
    const resize = nodeResizeState
    if (!resize) return
    if (readOnly) {
      setNodeResizeState(null)
      return
    }
    const topic = sheet ? findTopicNode(sheet.root, resize.nodeId) : undefined
    if (topic && Math.abs(resize.width - resize.startWidth) >= 0.5) {
      updateNode(resize.nodeId, {
        style: {
          ...(topic.style ?? {}),
          widthMode: 'fixed',
          width: resize.width
        }
      })
    }
    setNodeResizeState(null)
    if (event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // See the matching setPointerCapture guard above.
      }
    }
  }

  // --- Node drag-and-drop reparenting ---

  const startNodeDrag = (nodeId: string, event: ReactPointerEvent<SVGGElement>): void => {
    if (readOnly || editingNodeId) return
    dragRef.current = null
    setNodeDragState({
      draggingId: nodeId,
      startPointer: { x: event.clientX, y: event.clientY },
      dropTargetId: null,
      ghost: null
    })
  }

  const updateNodeDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!nodeDragState) return
    const lastNodePointerDown = lastNodePointerDownRef.current
    if (
      lastNodePointerDown &&
      Math.hypot(
        event.clientX - lastNodePointerDown.pointer.x,
        event.clientY - lastNodePointerDown.pointer.y
      ) > NODE_DOUBLE_POINTER_DISTANCE_PX
    ) {
      lastNodePointerDownRef.current = null
    }
    // Hit-test: find which node is under the pointer
    // Container-pixel coordinates: SVG user space = CSS pixel space.
    const svg = event.currentTarget
    const rect = svg.getBoundingClientRect()
    const svgX = event.clientX - rect.left
    const svgY = event.clientY - rect.top
    // Convert SVG coordinates to content coordinates (inverse of pan/zoom transform)
    const contentX = (svgX - pan.x) / zoom
    const contentY = (svgY - pan.y) / zoom

    let targetId: string | null = null
    for (const node of layout.nodes) {
      if (node.id === nodeDragState.draggingId) continue
      if (
        contentX >= node.x &&
        contentX <= node.x + node.width &&
        contentY >= node.y &&
        contentY <= node.y + node.height
      ) {
        targetId = node.id
        break
      }
    }
    if (targetId !== nodeDragState.dropTargetId) {
      // Recompute the drop ghost only when the hovered target changes; the
      // ghost position is determined by the tree, not the pointer, so this
      // avoids re-running the layout on every pointer move.
      const ghost =
        targetId && sheet
          ? computeMovedTopicPreview(sheet, nodeDragState.draggingId, targetId)
          : null
      setNodeDragState({ ...nodeDragState, dropTargetId: targetId, ghost })
    }
  }

  const endNodeDrag = (): void => {
    if (!nodeDragState) return
    if (readOnly) {
      setNodeDragState(null)
      return
    }
    const { draggingId, dropTargetId } = nodeDragState
    if (dropTargetId && dropTargetId !== draggingId && onMoveNode) {
      onMoveNode(draggingId, dropTargetId)
    } else if (dispatchCommand && sheet && dropTargetId && dropTargetId !== draggingId) {
      dispatchCommand(
        { type: 'topic.move', sheetId: sheet.id, topicId: draggingId, toParentId: dropTargetId },
        { label: 'Drag-reparent topic' }
      )
    }
    setNodeDragState(null)
  }

  // --- Image drag / resize interactions ---

  const contentPointFromPointer = (clientX: number, clientY: number): Vec2 => {
    // clientX/clientY are viewport-relative; subtract the canvas's on-screen
    // origin (the same offset the node drag path uses) so the pointer maps to
    // the correct content coordinate instead of drifting by the sidebar/toolbar.
    const origin = containerRef.current?.getBoundingClientRect()
    const originX = origin?.left ?? 0
    const originY = origin?.top ?? 0
    return {
      x: (clientX - originX - pan.x) / Math.max(zoom, 0.01),
      y: (clientY - originY - pan.y) / Math.max(zoom, 0.01)
    }
  }

  /** Which 4-region slot the pointer is over for a given node. */
  const regionForPointer = (
    node: MindMapLayoutNode,
    point: Vec2
  ): MindMapImagePlacement => {
    const midX = node.x + node.width / 2
    const midY = node.y + node.height / 2
    if (Math.abs(point.y - midY) > Math.abs(point.x - midX)) {
      return point.y < midY ? 'top' : 'bottom'
    }
    return point.x < midX ? 'left' : 'right'
  }

  const startImageDrag = (
    imageId: string,
    event: ReactPointerEvent<SVGSVGElement | SVGGElement>
  ): void => {
    if (readOnly) return
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = null
    lastNodePointerDownRef.current = null
    selectImage(imageId)
    const pointer = contentPointFromPointer(event.clientX, event.clientY)
    const sourceRect = imageRects.find((rect) => rect.id === imageId)
    setImageDragState({
      imageId,
      startPointer: { x: event.clientX, y: event.clientY },
      current: pointer,
      grabOffset: {
        x: pointer.x - (sourceRect?.x ?? 0),
        y: pointer.y - (sourceRect?.y ?? 0)
      },
      dropRegion: null
    })
  }

  const updateImageDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!imageDragState) return
    const point = contentPointFromPointer(event.clientX, event.clientY)
    let dropRegion: { topicId: string; region: MindMapImagePlacement } | null = null
    for (const node of layout.nodes) {
      if (
        point.x >= node.x &&
        point.x <= node.x + node.width &&
        point.y >= node.y &&
        point.y <= node.y + node.height
      ) {
        dropRegion = { topicId: node.id, region: regionForPointer(node, point) }
        break
      }
    }
    if (
      (dropRegion?.topicId ?? null) !== (imageDragState.dropRegion?.topicId ?? null) ||
      (dropRegion?.region ?? null) !== (imageDragState.dropRegion?.region ?? null)
    ) {
      setImageDragState({ ...imageDragState, current: point, dropRegion })
    } else if (
      imageDragState.current.x !== point.x ||
      imageDragState.current.y !== point.y
    ) {
      setImageDragState({ ...imageDragState, current: point })
    }
  }

  const endImageDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!imageDragState) return
    if (readOnly) {
      setImageDragState(null)
      return
    }
    // A press/release without real pointer travel is just a click (selection);
    // do not detach the image from its topic or move it.
    const travelled = Math.hypot(
      event.clientX - imageDragState.startPointer.x,
      event.clientY - imageDragState.startPointer.y
    )
    if (travelled <= IMAGE_DRAG_THRESHOLD_PX) {
      setImageDragState(null)
      return
    }
    const point = contentPointFromPointer(event.clientX, event.clientY)
    const { imageId, grabOffset } = imageDragState
    if (imageDragState.dropRegion) {
      const { topicId, region } = imageDragState.dropRegion
      if (sheet) {
        dispatchCommand(
          {
            type: 'transaction',
            commands: [
              {
                type: 'image.update',
                sheetId: sheet.id,
                imageId,
                patch: { topicId, position: null }
              },
              {
                type: 'topic.update',
                sheetId: sheet.id,
                topicId,
                patch: { imagePlacement: region }
              }
            ]
          },
          { label: 'Attach image to topic' }
        )
      }
    } else {
      moveImage(imageId, {
        topicId: null,
        position: { x: point.x - grabOffset.x, y: point.y - grabOffset.y }
      })
    }
    setImageDragState(null)
  }

  const startImageResize = (
    imageId: string,
    event: ReactPointerEvent<SVGSVGElement | SVGGElement>
  ): void => {
    if (readOnly) return
    event.stopPropagation()
    event.preventDefault()
    const rect = imageRects.find((candidate) => candidate.id === imageId)
    selectImage(imageId)
    setImageResizeState({
      imageId,
      startPointer: { x: event.clientX, y: event.clientY },
      startWidth: rect?.width ?? 160,
      startHeight: rect?.height ?? 88
    })
  }

  const updateImageResize = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const resize = imageResizeState
    if (!resize) return
    const dx = (event.clientX - resize.startPointer.x) / Math.max(zoom, 0.01)
    const dy = (event.clientY - resize.startPointer.y) / Math.max(zoom, 0.01)
    const nextWidth = Math.max(24, Math.round(resize.startWidth + dx))
    const nextHeight = Math.max(24, Math.round(resize.startHeight + dy))
    if (nextWidth !== resize.startWidth || nextHeight !== resize.startHeight) {
      resizeImage(resize.imageId, nextWidth, nextHeight)
    }
  }

  const endImageResize = (): void => {
    setImageResizeState(null)
  }

  const deleteImage = (imageId: string): void => {
    if (readOnly) return
    if (!sheet) return
    const image = sheet.images?.find((candidate) => candidate.id === imageId)
    const commands: MindMapCommand[] = [
      { type: 'image.remove', sheetId: sheet.id, imageId }
    ]
    // Drop the backing asset too when no other element references it, so
    // removing an image does not leave orphaned asset files behind.
    if (image && countImageAssetReferences(document, image.assetId) <= 1) {
      commands.push({ type: 'asset.remove', assetId: image.assetId })
    }
    dispatchCommand({ type: 'transaction', commands }, { label: 'Remove image' })
    selectCanvas()
  }

  const imageRects = useMemo(
    () => computeImageRects(sheet, nodeById),
    [sheet, nodeById]
  )

  // Keep the live preview and persisted-line rendering on the same geometry
  // path. Bound endpoints recompute from current target bounds, so a line
  // follows a topic or the local free-shape move/resize preview immediately.
  const connectorPathOptions = (
    from: MindMapCanvasLineEndpoint,
    to: MindMapCanvasLineEndpoint,
    curvePoint?: Vec2,
    style?: Pick<MindMapCanvasLineStyle, 'beginArrow' | 'endArrow'>
  ) => {
    const fromNormal = resolveMindMapLineEndpointOutwardNormal(from, availableLineSnapTargets)
    const toNormal = resolveMindMapLineEndpointOutwardNormal(to, availableLineSnapTargets)
    return {
      ...(fromNormal ? { fromTangent: fromNormal } : {}),
      // The target normal points outward. A path ending at that border must
      // arrive in the opposite direction so its marker points into the target.
      ...(toNormal ? { toTangent: { x: -toNormal.x, y: -toNormal.y } } : {}),
      ...(curvePoint ? { curvePoint } : {}),
      ...(style?.beginArrow ? { beginArrow: style.beginArrow } : {}),
      ...(style?.endArrow ? { endArrow: style.endArrow } : {})
    }
  }
  const renderedLineGeometries = renderedLines.map((line) => {
    const interaction = lineInteraction?.lineId === line.id ? lineInteraction : null
    const controlInteraction = lineControlInteraction?.lineId === line.id
      ? lineControlInteraction
      : null
    const bodyInteraction = lineBodyInteraction?.lineId === line.id
      ? lineBodyInteraction
      : null
    // Body drag: translate both endpoints by the same delta, detaching from
    // their targets so the whole line moves together.
    const bodyDelta = bodyInteraction?.moved
      ? (() => {
          const initialMidpoint = {
            x: (bodyInteraction.initialFrom.x + bodyInteraction.initialTo.x) / 2,
            y: (bodyInteraction.initialFrom.y + bodyInteraction.initialTo.y) / 2
          }
          return {
            x: bodyInteraction.currentMidpoint.x - initialMidpoint.x,
            y: bodyInteraction.currentMidpoint.y - initialMidpoint.y
          }
        })()
      : undefined
    const interactiveLine = {
      ...line,
      ...(interaction
        ? (interaction.endpoint === 'from'
          ? { from: lineSnapStateToEndpoint(interaction.current) }
          : { to: lineSnapStateToEndpoint(interaction.current) })
        : {}),
      ...(bodyDelta
        ? {
            from: { x: bodyInteraction!.initialFrom.x + bodyDelta.x, y: bodyInteraction!.initialFrom.y + bodyDelta.y },
            to: { x: bodyInteraction!.initialTo.x + bodyDelta.x, y: bodyInteraction!.initialTo.y + bodyDelta.y }
          }
        : {})
    }
    // Endpoints are already resolved if body-dragging (detached); otherwise
    // resolve from targets as before.
    const { from, to } = bodyDelta
      ? { from: interactiveLine.from, to: interactiveLine.to }
      : resolveMindMapLineEndpoints(
          interactiveLine.from,
          interactiveLine.to,
          availableLineSnapTargets
        )
    const curvePoint = mindMapLineShapeSupportsCurvePoint(interactiveLine.style.lineShape)
      ? controlInteraction?.current
        ?? resolveMindMapLineCurvePoint(from, to, interactiveLine.curveControlOffset)
      : undefined
    return {
      line,
      interaction,
      controlInteraction,
      bodyInteraction,
      interactiveLine,
      from,
      to,
      curvePoint,
      path: relationshipElementPath(
        from,
        to,
        interactiveLine.style.lineShape,
        connectorPathOptions(
          from,
          to,
          curvePoint,
          interactiveLine.style
        )
      )
    }
  })
  const linePreview = lineDrawState
    ? buildMindMapCanvasLineDraft(
        lineDrawState.start,
        lineDrawState.current,
        availableLineSnapTargets,
        lineTool ?? { active: true }
      )
      : null
  const linePreviewCurvePoint = linePreview && isMindMapCurvedLineShape(linePreview.style.lineShape)
    ? resolveMindMapLineCurvePoint(linePreview.from, linePreview.to)
    : undefined
  const shapePreview: { shape: MindMapDrawingShape; rect: MindMapDrawRect } | null = shapeDrawState
    ? {
        shape: shapeDrawState.shape,
        rect: normalizeMindMapDrawRect(shapeDrawState.start, shapeDrawState.current)
      }
    : null

  if (!sheet || layout.nodes.length === 0) {
    return (
      <div className="mindmap-canvas mindmap-canvas--empty" role="status">
        <p>—</p>
      </div>
    )
  }

  const canvasStyle: CSSProperties = {
    ...(document.theme.background && document.theme.background !== 'transparent'
      ? { background: document.theme.background }
      : {}),
    ...(document.theme.textColor
      ? { '--mindmap-theme-text': document.theme.textColor }
      : {}),
    ...(document.theme.lineColor
      ? { '--mindmap-theme-line': document.theme.lineColor }
      : {}),
    ...(document.theme.fontFamily
      ? { '--mindmap-theme-font': document.theme.fontFamily }
      : {})
  }

  // Real default font family/size for the current inline-editing target, shown
  // in the floating toolbar's "inherit" entries instead of a generic
  // "App default" placeholder (the value the selected span falls back to).
  const toolbarTextDefaults = useMemo<{ fontLabel: string; fontSize: number }>(() => {
    const resolveStackLabel = (stack: string): string => {
      const entry = SAFE_FONTS.find((candidate) => candidate.stack === stack)
      return entry
        ? fontEntryLabel(entry, (key) => (key ? t(key) : key))
        : primaryFontFamilyLabel(stack)
    }
    if (editingNodeId !== null && sheet) {
      const node = findTopicNode(sheet.root, editingNodeId)
      const depth = node ? findTopicDepth(sheet.root, editingNodeId) : null
      if (node && depth !== null) {
        const textStyle = resolveMindMapTopicTextStyle(depth, node.style)
        const parsedSize = Number.parseFloat(String(textStyle.fontSize))
        const fontStack = node.style?.fontFamily
          ?? document.theme.fontFamily
          ?? DEFAULT_TOPIC_FONT_FAMILY
        return {
          fontLabel: resolveStackLabel(fontStack),
          fontSize: Number.isFinite(parsedSize) ? parsedSize : 16
        }
      }
    }
    if (shapeTextEditing && sheet) {
      const element = sheet.elements.find((candidate) => candidate.id === shapeTextEditing.shapeId)
      const fontStack = element?.style?.fontFamily
        ?? document.theme.fontFamily
        ?? DEFAULT_TOPIC_FONT_FAMILY
      return {
        fontLabel: resolveStackLabel(fontStack),
        fontSize: element?.style?.fontSize ?? 13
      }
    }
    return {
      fontLabel: primaryFontFamilyLabel(DEFAULT_TOPIC_FONT_FAMILY),
      fontSize: 16
    }
  }, [editingNodeId, shapeTextEditing, sheet, document.theme.fontFamily, t])

  return (
    <div
      ref={containerRef}
      className={`mindmap-canvas${!hasMeasuredContainer ? ' mindmap-canvas--unmeasured' : ''}${panMode ? ' mindmap-canvas--pan-mode' : ''}${lineTool?.active ? ' mindmap-canvas--line-tool' : ''}${drawingShape ? ' mindmap-canvas--shape-tool' : ''}${nodeDragState ? ' is-dragging-node' : ''}${readOnly ? ' mindmap-canvas--generation-preview' : ''}`}
      data-theme-id={document.theme.id}
      style={canvasStyle}
      onPointerDownCapture={readOnly ? undefined : (event) => {
        // A pointerdown inside the canvas (background, another node, a control)
        // commits a panel-deferred edit, unless it lands back inside the editor
        // itself (the user is continuing to type).
        if (panelDeferredCommitRef.current) {
          const target = event.target as Element
          if (!target.closest('.mindmap-richtext')) commitPendingEditOnCanvasPointerDown()
        }
      }}
    >
      <svg
        ref={svgRef}
        className="mindmap-svg"
        viewBox={viewBox}
        role="img"
        aria-label={sheet.title}
        aria-busy={readOnly || undefined}
        onKeyDownCapture={(event) => {
          if (!readOnly) return
          // Keep keyboard focus navigable, but prevent an already-focused
          // topic/control from activating a write while the AI projection is
          // being revealed.
          event.stopPropagation()
          if (event.key !== 'Tab') event.preventDefault()
        }}
        onPointerDownCapture={readOnly ? undefined : startDrawingPointerCapture}
        onPointerDown={readOnly ? undefined : startPointerDrag}
        onPointerMove={readOnly ? undefined : (e) => { onPointerMove(e); updateNodeDrag(e); updateNodeResize(e); updateImageDrag(e); updateImageResize(e) }}
        onPointerUp={readOnly ? undefined : (e) => { endPointerDrag(e); endNodeDrag(); endNodeResize(e); endImageDrag(e); endImageResize() }}
        onPointerLeave={readOnly ? undefined : (e) => {
          // A captured pointer is allowed to leave the SVG while the user is
          // still drawing/panning. Wait for pointerup/pointercancel instead of
          // committing or cancelling the gesture on this transient boundary.
          const rootCaptured = typeof e.currentTarget.hasPointerCapture === 'function'
            && e.currentTarget.hasPointerCapture(e.pointerId)
          const shapeCaptured = typeof shapeInteractionCaptureRef.current?.hasPointerCapture === 'function'
            && shapeInteractionCaptureRef.current.hasPointerCapture(e.pointerId)
          const lineCaptured = typeof lineInteractionCaptureRef.current?.hasPointerCapture === 'function'
            && lineInteractionCaptureRef.current.hasPointerCapture(e.pointerId)
          const captured = rootCaptured || shapeCaptured || lineCaptured
          if (captured) return
          if (lineInteraction || lineControlInteraction || lineBodyInteraction) cancelLineInteraction(e)
          else if (lineDrawState || shapeDrawState) cancelLineDraw(e)
          else if (shapeInteraction) cancelShapeInteraction(e)
          else endPointerDrag(e)
          endNodeDrag()
          endNodeResize(e)
          endImageDrag(e)
          endImageResize()
        }}
        onPointerCancel={readOnly ? undefined : (e) => {
          if (lineInteraction || lineControlInteraction || lineBodyInteraction) cancelLineInteraction(e)
          else if (lineDrawState || shapeDrawState) cancelLineDraw(e)
          else if (shapeInteraction) cancelShapeInteraction(e)
          else endPointerDrag(e)
          endNodeDrag()
          endNodeResize(e)
          endImageDrag(e)
          endImageResize()
        }}
        onWheel={onWheel}
      >
        {selectionBox ? (
          <rect
            className="mindmap-selection-box"
            pointerEvents="none"
            x={Math.min(selectionBox.start.x, selectionBox.current.x)}
            y={Math.min(selectionBox.start.y, selectionBox.current.y)}
            width={Math.abs(selectionBox.current.x - selectionBox.start.x)}
            height={Math.abs(selectionBox.current.y - selectionBox.start.y)}
          />
        ) : null}
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          <defs>
            <filter id="mindmap-topic-hand-drawn" x="-8%" y="-12%" width="116%" height="124%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.018 0.12"
                numOctaves="1"
                seed="17"
                result="topic-noise"
              />
              <feDisplacementMap in="SourceGraphic" in2="topic-noise" scale="0.8" />
            </filter>
            <pattern id="mindmap-pattern-diagonal" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1" opacity="0.32" />
            </pattern>
            <pattern id="mindmap-pattern-horizontal" width="6" height="6" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="6" y2="0" stroke="currentColor" strokeWidth="1" opacity="0.32" />
            </pattern>
            <pattern id="mindmap-pattern-hand-drawn" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M 0 0 L 8 8 M 8 0 L 0 8" stroke="currentColor" strokeWidth="1.2" opacity="0.3" strokeLinecap="round" />
            </pattern>
            {([
              'none', 'dot', 'triangle', 'spearhead', 'square', 'diamond',
              'herringbone', 'double-arrow', 'anti-triangle', 'attached', 'hook'
            ] as const).map((arrow) => {
              const markerPath = relationshipArrowMarkerPath(arrow)
              const markerMetrics = relationshipArrowMarkerMetrics(arrow)
              if (!markerPath || !markerMetrics) return null
              return (
                <marker
                  key={arrow}
                  id={`mindmap-rel-arrow-${arrow}`}
                  viewBox="0 0 10 10"
                  refX={markerMetrics.refX}
                  refY="5"
                  markerUnits="userSpaceOnUse"
                  markerWidth={markerMetrics.markerWidth ?? 8}
                  markerHeight={markerMetrics.markerHeight ?? 8}
                  orient="auto-start-reverse"
                  fill="context-stroke"
                  overflow={markerMetrics.overflow}
                  opacity="1"
                >
                  <path
                    d={markerPath}
                    {...(markerMetrics.open
                      ? {
                          fill: 'none',
                          stroke: 'context-stroke',
                          strokeWidth: 1.5,
                          strokeLinecap: 'round',
                          strokeLinejoin: 'round'
                        }
                      : {})}
                  />
                </marker>
              )
            })}
          </defs>
          {layout.edges.map((edge) => {
            const from = nodeById.get(edge.from)
            const to = nodeById.get(edge.to)
            if (!from || !to) return null
            const color = branchColorForKey(document.theme, edge.branchKey)
            // A user-selected line style is an explicit override. Otherwise
            // use the connector language attached by the structure layout so
            // a timeline/fishbone/matrix does not look like a generic map.
            const lineStyle = sheet?.layout?.lineStyle ?? edge.connectorStyle
            const strokeWidth = edgeStrokeWidth(to.depth, sheet?.layout?.lineWidthScale)
            const pattern = sheet?.layout?.linePattern
            const dash = lineDashPattern(pattern)
            const tapered = sheet?.layout?.tapered === true
            const isNewEdge = newlyRevealedNodeIds.includes(edge.to)
            const edgeStyle: CSSProperties = color
              ? { stroke: color, strokeWidth, ...(dash ? { strokeDasharray: dash } : {}) }
              : { strokeWidth, ...(dash ? { strokeDasharray: dash } : {}) }
            if (tapered) {
              const childWidth = Math.max(1, strokeWidth * 0.45)
              return (
                <path
                  key={edge.to}
                  className={`mindmap-edge--tapered${isNewEdge ? ' is-generation-new' : ''}`}
                  d={taperedEdgePath(from, to, strokeWidth, childWidth, edge.axis)}
                  // The taper is a filled polygon. A stroke would draw a
                  // coloured halo around the polygon outline, so it is left
                  // unset (fill-only) — distinct from the stroked `.mindmap-edge`
                  // tree branches, which carry the line colour on their stroke.
                  style={{
                    fill: color ?? 'var(--mindmap-theme-line, var(--accent))',
                    stroke: 'none'
                  }}
                />
              )
            }
            return (
              <path
                key={edge.to}
                className={`mindmap-edge${isNewEdge ? ' is-generation-new' : ''}`}
                d={resolveEdgePath(from, to, lineStyle, edge.axis)}
                style={edgeStyle}
              />
            )
          })}

          {renderedLineGeometries.map(({ line, interaction, controlInteraction, interactiveLine, path }) => {
            const isSelected = (selection.kind === 'element' && selection.elementId === line.id)
              || (selection.kind === 'hybrid' && selection.elementIds.includes(line.id))
            const canEdit = !readOnly && !lineTool?.active && !drawingShape
            const endpointLabel = line.label || t('mindmap.elementStyle.types.connector', { defaultValue: 'Connector' })
            return (
              <g
                key={line.id}
                className={`mindmap-drawn-line-group${isSelected ? ' is-selected' : ''}${interaction || controlInteraction ? ' is-interacting' : ''}`}
                role="button"
                tabIndex={readOnly ? -1 : (isSelected ? 0 : -1)}
                style={{ outline: 'none' }}
                aria-disabled={readOnly || undefined}
                aria-pressed={isSelected}
                aria-label={endpointLabel}
                onPointerDown={(event) => {
                  if (!canEdit) return
                  startLineBodyInteraction(line, event)
                }}
                onContextMenu={(event) => openLineContextMenu(line.id, event)}
                onKeyDown={(event) => {
                  if (!canEdit || !isSelected || !onDeleteLine) return
                  if (event.key !== 'Delete' && event.key !== 'Backspace') return
                  event.preventDefault()
                  event.stopPropagation()
                  onDeleteLine(line.id)
                }}
              >
                <path
                  className="mindmap-drawn-line"
                  d={path}
                  markerStart={interactiveLine.style.beginArrow && interactiveLine.style.beginArrow !== 'none'
                    ? `url(#mindmap-rel-arrow-${interactiveLine.style.beginArrow})`
                    : undefined}
                  markerEnd={interactiveLine.style.endArrow && interactiveLine.style.endArrow !== 'none'
                    ? `url(#mindmap-rel-arrow-${interactiveLine.style.endArrow})`
                    : undefined}
                  style={{
                    ...arrowedLineCapStyle(interactiveLine.style),
                    ...(interactiveLine.style.stroke ? { stroke: interactiveLine.style.stroke } : {}),
                    ...(interactiveLine.style.strokeWidth !== undefined ? { strokeWidth: interactiveLine.style.strokeWidth } : {}),
                    ...(interactiveLine.style.linePattern !== undefined
                      ? { strokeDasharray: elementLineDashArray(interactiveLine.style.linePattern) ?? 'none' }
                      : {})
                  }}
                  aria-hidden="true"
                >
                  <title>{endpointLabel}</title>
                </path>
                <path
                  className="mindmap-drawn-line-hit"
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(12, (interactiveLine.style.strokeWidth ?? 1.6) + 12)}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="stroke"
                  aria-hidden="true"
                />
              </g>
            )
          })}

          {renderedShapes.map(({ shape, rect }) => {
            const isSelected = (selection.kind === 'element' && selection.elementId === shape.id)
              || (selection.kind === 'elements' && selection.elementIds.includes(shape.id))
              || (selection.kind === 'hybrid' && selection.elementIds.includes(shape.id))
            const isTextEditing = shapeTextEditing?.shapeId === shape.id
            const shapeLabel = shape.label || t(`mindmap.topicStyle.${shape.shape === 'rounded-rect' ? 'shapeRoundedRect' : shape.shape === 'rect' ? 'shapeRect' : shape.shape === 'ellipse' ? 'shapeEllipse' : shape.shape === 'diamond' ? 'shapeDiamond' : shape.shape === 'parallelogram' ? 'shapeParallelogram' : 'shapeHexagon'}`, { defaultValue: t('mindmap.topicStyle.shapeLabel') })
            const stroke = shape.style?.stroke ?? DEFAULT_SHAPE_STROKE
            const fill = shape.style?.fill ?? DEFAULT_SHAPE_FILL
            const labelInset = Math.min(
              MIND_MAP_SHAPE_LABEL_PADDING,
              Math.max(1, Math.min(rect.width, rect.height) / 4)
            )
            const labelRect = {
              x: rect.x + labelInset,
              y: rect.y + labelInset,
              width: Math.max(1, rect.width - labelInset * 2),
              height: Math.max(1, rect.height - labelInset * 2)
            }
            const shapeTextStyle: CSSProperties = {
              color: shape.style?.textColor ?? 'var(--mindmap-theme-text, var(--text))',
              fontFamily: shape.style?.fontFamily ?? 'var(--mindmap-theme-font, inherit)',
              fontSize: shape.style?.fontSize ?? 14,
              textAlign: 'center'
            }
            const resizeHitSize = MIND_MAP_SHAPE_RESIZE_EDGE_HIT_SIZE / Math.max(zoom, 0.01)
            const selectionGap = MIND_MAP_SELECTION_RING_GAP / Math.max(zoom, 0.01)
            return (
              <g
                key={shape.id}
                className={`mindmap-drawn-shape-group${isSelected ? ' is-selected' : ''}${shapeInteraction?.shapeId === shape.id ? shapeInteraction.kind === 'move' ? ' is-moving' : ' is-resizing' : ''}${isTextEditing ? ' is-editing' : ''}`}
                data-mindmap-line-snap-target={`shape:${shape.id}`}
                role="button"
                tabIndex={readOnly ? -1 : (isSelected ? 0 : -1)}
                style={{ outline: 'none' }}
                aria-disabled={readOnly || undefined}
                aria-pressed={isSelected}
                aria-label={shapeLabel}
                onPointerDown={(event) => {
                  if (readOnly) return
                  if (isTextEditing) return
                  // Keep a secondary click (context menu) from bubbling to the
                  // SVG root, whose right-button pan gesture captures the
                  // pointer and swallows the subsequent contextmenu event.
                  event.stopPropagation()
                  startShapeInteraction(shape.id, rect, 'move', event)
                }}
                onDoubleClick={(event) => {
                  if (readOnly) return
                  if (lineTool?.active || drawingShape) return
                  event.stopPropagation()
                  event.preventDefault()
                  startShapeTextEditing(shape.id, shape.label ?? '', shape.labelFormatting ?? [])
                }}
                onKeyDown={(event) => {
                  if (readOnly) return
                  if ((event.key !== 'Enter' && event.key !== 'F2') || lineTool?.active || drawingShape) return
                  event.preventDefault()
                  event.stopPropagation()
                  startShapeTextEditing(shape.id, shape.label ?? '', shape.labelFormatting ?? [])
                }}
                onContextMenu={(event) => openShapeContextMenu(shape.id, event)}
              >
                <path
                  className="mindmap-drawn-shape"
                  d={mindMapDrawingShapePath(shape.shape, rect)}
                  style={{
                    fill,
                    stroke,
                    strokeWidth: shape.style?.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH,
                    ...(shape.style?.linePattern !== undefined
                      ? { strokeDasharray: elementLineDashArray(shape.style.linePattern) ?? 'none' }
                      : shape.style?.dashed === false
                        ? { strokeDasharray: 'none' }
                        : shape.style?.dashed
                          ? { strokeDasharray: '6 4' }
                          : {})
                  }}
                  aria-hidden="true"
                >
                  <title>{shapeLabel}</title>
                </path>

                {shape.label || isTextEditing ? (
                  <foreignObject
                    className="mindmap-drawn-shape-label-foreign"
                    x={labelRect.x}
                    y={labelRect.y}
                    width={labelRect.width}
                    height={labelRect.height}
                  >
                    {isTextEditing ? (
                      <div className="mindmap-drawn-shape-label-editor-shell">
                        <MindMapRichTextEditor
                          ref={shapeEditorRef}
                          text={shapeTextEditing?.value ?? ''}
                          spans={shapeTextEditing?.spans ?? []}
                          className="mindmap-drawn-shape-label-editor"
                          ariaLabel={`${t('mindmap.elementStyle.text')}: ${shapeLabel}`}
                          baseStyle={shapeTextStyle}
                          multiline
                          autoFocus
                          placeholder={t('mindmap.untitledTopic')}
                          onModelChange={(value, spans) => {
                            setShapeTextEditing((current) => current?.shapeId === shape.id
                              ? { ...current, value, spans }
                              : current)
                          }}
                          onSelectionChange={handleRichTextSelectionChange}
                          onBlur={(event, value, spans) => {
                            // Keep the edit + selection alive when the user
                            // moves into the right-side inspector so its text
                            // controls target the selected span.
                            if (isMindMapInspectorTarget(event.relatedTarget)) {
                              panelDeferredCommitRef.current = true
                              return
                            }
                            commitShapeTextEditing(shape.id, value, spans)
                          }}
                          onKeyDown={(event) => {
                            if (readOnly) return
                            // The shape group also uses Enter/F2 to begin an
                            // edit. Do not let an editor Enter bubble back to
                            // that handler: it would recreate the session with
                            // the old label instead of inserting a newline.
                            event.stopPropagation()
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                              event.preventDefault()
                              commitShapeTextEditing(shape.id, shapeTextEditing?.value ?? '', shapeTextEditing?.spans ?? [])
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelShapeTextEditing(shape.id)
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="mindmap-drawn-shape-label" aria-hidden="true">
                        <MindMapRichTextLabel
                          text={shape.label ?? ''}
                          spans={shape.labelFormatting ?? []}
                          style={shapeTextStyle}
                        />
                      </div>
                    )}
                  </foreignObject>
                ) : null}

                {!isTextEditing && !lineTool?.active && !drawingShape ? (
                  <>
                    {isSelected ? (
                      <rect
                        className="mindmap-shape-selection"
                        x={rect.x - selectionGap}
                        y={rect.y - selectionGap}
                        width={rect.width + selectionGap * 2}
                        height={rect.height + selectionGap * 2}
                        pointerEvents="none"
                        aria-hidden="true"
                      />
                    ) : null}
                    {MIND_MAP_SHAPE_RESIZE_HANDLES.map((handle) => {
                      const hitRect = shapeResizeHitRect(rect, handle, resizeHitSize)
                      return (
                        <rect
                          key={handle}
                          className={`mindmap-shape-resize-handle mindmap-shape-resize-handle--${handle}`}
                          data-mindmap-shape-resize-handle={handle}
                          data-mindmap-shape-resize-edge={handle}
                          x={hitRect.x}
                          y={hitRect.y}
                          width={hitRect.width}
                          height={hitRect.height}
                          fill="transparent"
                          stroke="none"
                          onPointerDown={(event) => startShapeInteraction(shape.id, rect, 'resize', event, handle)}
                        />
                      )
                    })}
                  </>
                ) : null}
              </g>
            )
          })}

          {layout.relationships.map((relationship: MindMapLayoutRelationship) => {
            const from = nodeById.get(relationship.from)
            const to = nodeById.get(relationship.to)
            if (!from || !to) return null
            const labelPosition = relationshipLabelPosition(from, to)
            const endpointLabel = `${from.title || t('mindmap.untitledTopic')} → ${to.title || t('mindmap.untitledTopic')}`
            return (
              <g
                key={relationship.id}
                className={`mindmap-relationship-group${(selection.kind === 'element' && selection.elementId === relationship.id) || (selection.kind === 'hybrid' && selection.elementIds.includes(relationship.id)) ? ' is-selected' : ''}`}
                role="button"
                tabIndex={readOnly ? -1 : (selection.kind === 'element' && selection.elementId === relationship.id ? 0 : -1)}
                aria-disabled={readOnly || undefined}
                aria-pressed={(selection.kind === 'element' && selection.elementId === relationship.id) || (selection.kind === 'hybrid' && selection.elementIds.includes(relationship.id))}
                aria-label={relationship.label || endpointLabel}
                onPointerDown={(event) => {
                  if (readOnly) return
                  event.stopPropagation()
                  event.preventDefault()
                  dragRef.current = null
                  selectElement(relationship.id, 'relationship')
                }}
              >
                <path
                  className="mindmap-relationship"
                  d={relationshipElementPath(
                    from,
                    to,
                    relationship.style?.lineShape,
                    {
                      ...(relationship.style?.beginArrow
                        ? { beginArrow: relationship.style.beginArrow }
                        : {}),
                      ...(relationship.style?.endArrow
                        ? { endArrow: relationship.style.endArrow }
                        : {})
                    }
                  )}
                  markerStart={relationship.style?.beginArrow && relationship.style.beginArrow !== 'none'
                    ? `url(#mindmap-rel-arrow-${relationship.style.beginArrow})`
                    : undefined}
                  markerEnd={relationship.style?.endArrow && relationship.style.endArrow !== 'none'
                    ? `url(#mindmap-rel-arrow-${relationship.style.endArrow})`
                    : undefined}
                  style={{
                    ...arrowedLineCapStyle(relationship.style ?? {}),
                    ...(relationship.style?.stroke ? { stroke: relationship.style.stroke } : {}),
                    ...(relationship.style?.strokeWidth !== undefined ? { strokeWidth: relationship.style.strokeWidth } : {}),
                    ...(relationship.style?.linePattern !== undefined
                      ? { strokeDasharray: elementLineDashArray(relationship.style.linePattern) ?? 'none' }
                      : relationship.style?.dashed === false
                        ? { strokeDasharray: 'none' }
                        : relationship.style?.dashed
                          ? { strokeDasharray: '6 4' }
                          : {})
                  }}
                  aria-hidden="true"
                >
                  <title>{relationship.label || endpointLabel}</title>
                </path>
                {relationship.label ? (
                  <>
                    <rect
                      className="mindmap-relationship-label-bg"
                      x={labelPosition.x - (relationship.label.length * 3.2) - 6}
                      y={labelPosition.y - 8}
                      width={relationship.label.length * 6.4 + 12}
                      height={16}
                      rx={4}
                      style={relationship.style?.fill ? { fill: relationship.style.fill } : undefined}
                      aria-hidden="true"
                    />
                    <text
                      className="mindmap-relationship-label"
                      x={labelPosition.x}
                      y={labelPosition.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{
                        ...(relationship.style?.textColor ? { fill: relationship.style.textColor } : {}),
                        ...(relationship.style?.fontFamily ? { fontFamily: relationship.style.fontFamily } : {}),
                        ...(relationship.style?.fontSize ? { fontSize: `${relationship.style.fontSize}px` } : {})
                      }}
                    >
                      {relationship.label}
                    </text>
                  </>
                ) : null}
              </g>
            )
          })}

          {calloutRects.map((rect) => (
            <g
              key={rect.callout.id}
              className={`mindmap-callout-group${(selection.kind === 'element' && selection.elementId === rect.callout.id) || (selection.kind === 'hybrid' && selection.elementIds.includes(rect.callout.id)) ? ' is-selected' : ''}`}
              role="button"
              tabIndex={readOnly ? -1 : (selection.kind === 'element' && selection.elementId === rect.callout.id ? 0 : -1)}
              aria-disabled={readOnly || undefined}
              aria-pressed={(selection.kind === 'element' && selection.elementId === rect.callout.id) || (selection.kind === 'hybrid' && selection.elementIds.includes(rect.callout.id))}
              onPointerDown={(event) => {
                if (readOnly) return
                event.stopPropagation()
                event.preventDefault()
                dragRef.current = null
                selectElement(rect.callout.id, 'callout')
              }}
              aria-label={rect.callout.text}
            >
              <path
                className="mindmap-callout-leader"
                d={calloutLeaderPath(rect)}
                style={{
                  ...(rect.callout.style?.stroke ? { stroke: rect.callout.style.stroke } : {}),
                  ...(rect.callout.style?.strokeWidth !== undefined ? { strokeWidth: rect.callout.style.strokeWidth } : {}),
                  ...(rect.callout.style?.linePattern !== undefined
                    ? { strokeDasharray: elementLineDashArray(rect.callout.style.linePattern) ?? 'none' }
                    : rect.callout.style?.dashed === false
                      ? { strokeDasharray: 'none' }
                      : rect.callout.style?.dashed
                        ? { strokeDasharray: '5 4' }
                        : {})
                }}
                aria-hidden="true"
              />
              <path
                className="mindmap-callout"
                d={elementOutlinePath({
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height
                }, rect.callout.style?.outlineShape)}
                style={{
                  ...(rect.callout.style?.fill ? { fill: rect.callout.style.fill } : {}),
                  ...(rect.callout.style?.stroke ? { stroke: rect.callout.style.stroke } : {}),
                  ...(rect.callout.style?.strokeWidth !== undefined ? { strokeWidth: rect.callout.style.strokeWidth } : {}),
                  ...(rect.callout.style?.linePattern !== undefined
                    ? { strokeDasharray: elementLineDashArray(rect.callout.style.linePattern) ?? 'none' }
                    : rect.callout.style?.dashed === false
                      ? { strokeDasharray: 'none' }
                      : rect.callout.style?.dashed
                        ? { strokeDasharray: '5 4' }
                        : {})
                }}
              />
              <text
                className="mindmap-callout-text"
                x={rect.x + rect.width / 2}
                y={rect.y + rect.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  ...(rect.callout.style?.textColor ? { fill: rect.callout.style.textColor } : {}),
                  ...(rect.callout.style?.fontFamily ? { fontFamily: rect.callout.style.fontFamily } : {}),
                  ...(rect.callout.style?.fontSize ? { fontSize: `${rect.callout.style.fontSize}px` } : {})
                }}
              >
                {rect.callout.text || ' '}
              </text>
            </g>
          ))}

          {summaryBrackets.map((bracket) => {
            const endpointLabel =
              `${bracket.from.title || t('mindmap.untitledTopic')} → ` +
              `${bracket.to.title || t('mindmap.untitledTopic')}`
            const label = bracket.outputTopic?.title || bracket.summary.label || endpointLabel
            // The brace follows the covered branch. The output topic itself is
            // painted in the ordinary node loop below, with its own style.
            const summaryColor = branchColorForKey(document.theme, bracket.from.branchKey)
            const strokeColor = bracket.summary.style?.stroke ?? summaryColor ?? undefined
            const branchStrokeWidth = edgeStrokeWidth(
              bracket.to.depth,
              sheet?.layout?.lineWidthScale
            )
            const lineStyleProps = {
              strokeWidth: bracket.summary.style?.strokeWidth ?? branchStrokeWidth,
              ...(bracket.summary.style?.linePattern !== undefined
                ? { strokeDasharray: elementLineDashArray(bracket.summary.style.linePattern) ?? 'none' }
                : bracket.summary.style?.dashed === false
                  ? { strokeDasharray: 'none' }
                  : bracket.summary.style?.dashed
                    ? { strokeDasharray: '5 4' }
                    : {})
            }

            return (
              <g
                key={bracket.summary.id}
                className={`mindmap-summary-group${(selection.kind === 'element' && selection.elementId === bracket.summary.id) || (selection.kind === 'hybrid' && selection.elementIds.includes(bracket.summary.id)) ? ' is-selected' : ''}`}
                data-summary-side={bracket.side}
                role="button"
                tabIndex={readOnly ? -1 : (selection.kind === 'element' && selection.elementId === bracket.summary.id ? 0 : -1)}
                aria-disabled={readOnly || undefined}
                aria-pressed={(selection.kind === 'element' && selection.elementId === bracket.summary.id) || (selection.kind === 'hybrid' && selection.elementIds.includes(bracket.summary.id))}
                onPointerDown={(event) => {
                  if (readOnly) return
                  event.stopPropagation()
                  event.preventDefault()
                  dragRef.current = null
                  selectElement(bracket.summary.id, 'summary')
                }}
                aria-label={label}
              >
                <title>{label}</title>
                <path
                  className="mindmap-summary-brace"
                  d={summaryPath(bracket)}
                  style={{ stroke: strokeColor, ...lineStyleProps }}
                  aria-hidden="true"
                />
                {bracket.outputTopic === undefined && bracket.summary.label ? (
                  <text
                    className="mindmap-summary-label"
                    x={bracket.labelX}
                    y={bracket.labelY}
                    textAnchor={bracket.side === 'left' ? 'end' : 'start'}
                    dominantBaseline="central"
                    style={{
                      ...(bracket.summary.style?.textColor
                        ? { fill: bracket.summary.style.textColor }
                        : {}),
                      ...(bracket.summary.style?.fontFamily
                        ? { fontFamily: bracket.summary.style.fontFamily }
                        : {}),
                      ...(bracket.summary.style?.fontSize
                        ? { fontSize: `${bracket.summary.style.fontSize}px` }
                        : {})
                    }}
                  >
                    {bracket.summary.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {layout.boundaries.map((boundary) => {
            const bColor = boundary.style?.stroke ?? branchColor(document.theme, 0) ?? '#8E8E93'
            return (
              <g
                key={boundary.id}
                className={`mindmap-boundary-group${(selection.kind === 'element' && selection.elementId === boundary.id) || (selection.kind === 'hybrid' && selection.elementIds.includes(boundary.id)) ? ' is-selected' : ''}`}
                role="button"
                tabIndex={readOnly ? -1 : (selection.kind === 'element' && selection.elementId === boundary.id ? 0 : -1)}
                aria-disabled={readOnly || undefined}
                aria-pressed={(selection.kind === 'element' && selection.elementId === boundary.id) || (selection.kind === 'hybrid' && selection.elementIds.includes(boundary.id))}
                aria-label={boundary.label || t('mindmap.elementStyle.types.boundary')}
                onPointerDown={(event) => {
                  if (readOnly) return
                  event.stopPropagation()
                  event.preventDefault()
                  dragRef.current = null
                  selectElement(boundary.id, 'boundary')
                }}
              >
                <path
                  className="mindmap-boundary"
                  d={elementOutlinePath({
                    x: boundary.x,
                    y: boundary.y,
                    width: boundary.width,
                    height: boundary.height
                  }, boundary.style?.outlineShape)}
                  style={{
                    stroke: bColor,
                    strokeWidth: boundary.style?.strokeWidth ?? 1.5,
                    strokeDasharray: boundary.style?.linePattern !== undefined
                      ? elementLineDashArray(boundary.style.linePattern) ?? 'none'
                      : boundary.style?.dashed === true ? '5 4' : 'none',
                    fill: boundary.style?.fill ?? bColor,
                    fillOpacity: boundary.style?.fill ? 1 : 0.06
                  }}
                />
                {boundary.label ? (
                  <text
                    className="mindmap-boundary-label"
                    x={boundary.x + 10}
                    y={boundary.y + 16}
                    style={{
                      ...(boundary.style?.textColor ? { fill: boundary.style.textColor } : {}),
                      ...(boundary.style?.fontFamily
                        ? { fontFamily: boundary.style.fontFamily }
                        : {}),
                      ...(boundary.style?.fontSize
                        ? { fontSize: `${boundary.style.fontSize}px` }
                        : {})
                    }}
                  >
                    {boundary.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {layout.nodes.map((node) => {
            const rootNode = layout.nodes[0] ?? node
            const isSelected = (selection.kind === 'topic' && selection.topicIds.includes(node.id))
              || (selection.kind === 'hybrid' && selection.topicIds.includes(node.id))
            const isPrimarySelection = node.id === selectedNodeId
            const isEditing = node.id === editingNodeId
            const selectionGap = MIND_MAP_SELECTION_RING_GAP / Math.max(zoom, 0.01)
            const depthClass = node.depth === 0 ? ' is-root' : node.depth === 1 ? ' is-branch' : ''
            // P4: Merge theme.topicStyles[central/main/sub] with node.style.
            // Priority: node.style > theme.topicStyles[layer] > CSS default.
            const styleOverride = resolveEffectiveTopicStyle(
              node.style,
              document.theme,
              node.depth
            )
            const textAlign = styleOverride?.textAlign
              ?? defaultTopicTextAlign(
                styleOverride?.structureClass ?? sheet.layout.structureClass,
                node.depth
              )
            const topicActions: Array<{
              kind: 'note'
              label: string
              onOpen?: (nodeId: string) => void
            }> = []
            if (node.hasNote) {
              topicActions.push({
                kind: 'note',
                label: t('mindmap.notesPanel.title'),
                onOpen: onOpenNote
              })
            }
            // Split the laid-out topic rect into non-overlapping text and image
            // regions so text editing never collides with the attached image,
            // and so the image can sit above/below/beside the label.
            const imagePlacement = node.imagePlacement ?? 'bottom'
            const nodeImages = (sheet?.images ?? []).filter(
              (image) => image.topicId === node.id
            )
            const regions = computeTopicImageAndTextRegions(node, nodeImages, imagePlacement)
            const textRegion = regions.text
            const shape = resolveShape(node.shape)
            const topicTextStyle = resolveMindMapTopicTextStyle(node.depth, styleOverride)
            const topicTextColor = shape === 'underline' && !styleOverride?.textColor
              ? 'var(--mindmap-theme-text, var(--text))'
              : resolveMindMapTopicTextColor(node.depth, styleOverride)
            const displayTitle = node.title || t('mindmap.untitledTopic')
            // Keep ordinary labels in SVG text (which preserves the existing
            // measurement/wrapping behaviour), and opt into a foreignObject
            // whenever markdown-it finds real formatting tokens. This covers
            // links, emphasis, inline code, marks, strikethrough, and math.
            const hasInlineMarkdown = hasMindMapTopicMarkdown(node.title)
            const labelLines = wrapMindMapTopicTitle(displayTitle, textRegion.width, node.depth)
            const labelLineHeight = mindMapTopicLineHeight(node.depth)
            // Keep every representation of an underline label—SVG text,
            // markdown and the textarea editor—in the same bottom-aligned
            // region. Switching into edit mode therefore replaces the label in
            // place instead of re-centering it higher in the full node box.
            const labelRegion = shape === 'underline'
              ? {
                  ...textRegion,
                  y: textRegion.y + textRegion.height
                    - UNDERLINE_TOPIC_LABEL_GAP
                    - labelLines.length * labelLineHeight,
                  height: labelLines.length * labelLineHeight
                }
              : textRegion
            const labelGeometry = topicLabelGeometry(labelRegion.x, labelRegion.width, textAlign)
            const firstLabelLineY = labelRegion.y + labelRegion.height / 2
              - ((labelLines.length - 1) * labelLineHeight) / 2
            return (
              <g
                key={node.id}
                className={`mindmap-node-group${isSelected ? ' is-selected' : ''}${depthClass}${nodeDragState?.draggingId === node.id ? ' is-dragging' : ''}${nodeDragState?.dropTargetId === node.id ? ' is-drop-target' : ''}${nodeResizeState?.nodeId === node.id ? ' is-resizing' : ''}${newlyRevealedNodeIds.includes(node.id) ? ' is-generation-new' : ''}`}
                data-depth={node.depth}
                data-node-id={node.id}
                role="button"
                tabIndex={readOnly ? -1 : (isPrimarySelection ? 0 : -1)}
                style={{ outline: 'none' }}
                aria-label={node.title || t('mindmap.untitledTopic')}
                aria-disabled={readOnly || undefined}
                aria-pressed={isSelected}
                onPointerDown={(event) => {
                  if (readOnly) return
                  event.stopPropagation()
                  // A secondary click opens the context menu. It must not run
                  // the normal primary-click selection path first, otherwise
                  // right-clicking one topic collapses a marquee selection to
                  // that topic before batch actions can inspect it.
                  if (event.button !== 0) return
                  // SVG groups can receive the browser's native focus halo on
                  // pointer activation. The selected topic already has an
                  // explicit outline on its own shape, so suppressing the
                  // default focus transfer avoids a second outer rectangle.
                  event.preventDefault()
                  dragRef.current = null
                  // Match marquee selection: Ctrl/Cmd/Shift all add or remove
                  // a topic from the current selection instead of starting a
                  // reparent drag. Shift is especially useful on keyboards
                  // without a Command key and mirrors StudiumX's range-select
                  // affordance.
                  const additive = event.metaKey || event.ctrlKey || event.shiftKey
                  const isPrimaryActivation = event.button === 0 && !additive
                  const now = performance.now()
                  const previous = lastNodePointerDownRef.current
                  // Do not rely solely on React's onDoubleClick here. The
                  // drag class can make the topic pointer-transparent between
                  // down/up, which prevents Chromium from emitting dblclick.
                  const isDoublePointerActivation = Boolean(
                    isPrimaryActivation &&
                    previous?.nodeId === node.id &&
                    now - previous.at <= NODE_DOUBLE_POINTER_INTERVAL_MS &&
                    Math.hypot(
                      event.clientX - previous.pointer.x,
                      event.clientY - previous.pointer.y
                    ) <= NODE_DOUBLE_POINTER_DISTANCE_PX
                  )

                  if (isDoublePointerActivation) {
                    lastNodePointerDownRef.current = null
                    setNodeDragState(null)
                    beginEdit(node.id, node.title, node.titleFormatting ?? [])
                    return
                  }

                  lastNodePointerDownRef.current = isPrimaryActivation
                    ? {
                        nodeId: node.id,
                        at: now,
                        pointer: { x: event.clientX, y: event.clientY }
                      }
                    : null
                  beginNodeAction(node.id, additive)
                }}
                onContextMenu={(event) => {
                  if (readOnly) return
                  if (onContextMenu) {
                    event.preventDefault()
                    onContextMenu(node.id, event.clientX, event.clientY)
                  }
                }}
                onPointerDownCapture={(event) => {
                  if (readOnly) return
                  const target = event.target as Element
                  const isControl = target.closest?.(
                    '.mindmap-node-action, .mindmap-node-action-group, .mindmap-collapse-badge, .mindmap-node-topic-action, .mindmap-node-topic-action-group, .mindmap-node-note-button, .mindmap-node-note-button-group, .mindmap-node-input, .mindmap-node-resize-control'
                  )
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !editingNodeId &&
                    !isControl
                  ) {
                    startNodeDrag(node.id, event)
                  }
                }}
                onDoubleClick={(event) => {
                  if (readOnly) return
                  event.stopPropagation()
                  if (!isEditing) beginEdit(node.id, node.title, node.titleFormatting ?? [])
                }}
              >
                {(() => {
                  const elem = shapeElement(node, shape)
                  const branchInk = branchColorForKey(document.theme, node.branchKey)
                  const bColor = node.depth === 1 ? branchInk : null
                  // StudiumX Snowbrush look: first-level branches are solid chips
                  // in the branch colour with no border; deeper topics use the
                  // quiet grey fill from the stylesheet.
                  const fill = styleOverride?.fill
                    ?? (node.depth === 1 && bColor ? bColor : undefined)
                  // Selection no longer repaints the node's own border: the
                  // topic-style inspector edits border colour/width in place,
                  // so the real border must stay visible while selected; the
                  // dashed ring (mindmap-node-selection) marks selection
                  // instead. Underlines stay in branch ink because they are
                  // connectors, not independently highlighted node borders.
                  const borderStyle = styleOverride?.borderStyle
                  const stroke = (borderStyle === 'none' ? 'none' : styleOverride?.stroke)
                    ?? (borderStyle ? 'var(--mindmap-theme-line, #8E8E93)' : undefined)
                    // The underline is part of the branch, so its default ink
                    // must match the incoming/outgoing edge rather than the
                    // transparent branch-chip border default.
                    ?? (shape === 'underline' ? branchInk : undefined)
                    ?? (node.depth === 1 ? 'none' : undefined)
                  const styleProps: Record<string, string | number> = {}
                  if (fill) styleProps.fill = fill
                  if (stroke) styleProps.stroke = stroke
                  // The underline is a continuation of the branch, not an
                  // independent border. Match the incoming branch's width so
                  // it reads as one uninterrupted line.
                  if (shape === 'underline' && styleOverride?.borderWidth === undefined) {
                    styleProps.strokeWidth = edgeStrokeWidth(
                      node.depth,
                      sheet?.layout?.lineWidthScale
                    )
                  }
                  if (styleOverride?.borderWidth !== undefined) {
                    styleProps.strokeWidth = styleOverride.borderWidth
                  }
                  if (borderStyle === 'dash' || borderStyle === 'hand-drawn-dash') {
                    styleProps.strokeDasharray = '6 4'
                  } else if (borderStyle === 'solid' || borderStyle === 'hand-drawn-solid') {
                    styleProps.strokeDasharray = 'none'
                  }
                  if (borderStyle === 'hand-drawn-solid' || borderStyle === 'hand-drawn-dash') {
                    styleProps.filter = 'url(#mindmap-topic-hand-drawn)'
                  }

                  const Tag = elem.tag
                  const patternId =
                    styleOverride?.fillPattern === 'diagonal'
                      ? 'mindmap-pattern-diagonal'
                      : styleOverride?.fillPattern === 'horizontal'
                        ? 'mindmap-pattern-horizontal'
                        : styleOverride?.fillPattern === 'hand-drawn'
                          ? 'mindmap-pattern-hand-drawn'
                          : undefined
                  return (
                    <>
                      <Tag
                        className={`mindmap-node-rect mindmap-node-shape--${shape}`}
                        {...elem.attrs}
                        style={Object.keys(styleProps).length > 0 ? styleProps : undefined}
                      />
                      {patternId ? (
                        <Tag
                          className="mindmap-node-rect mindmap-node-pattern"
                          {...elem.attrs}
                          style={{ fill: `url(#${patternId})`, stroke: 'none', pointerEvents: 'none' }}
                        />
                      ) : null}
                    </>
                  )
                })()}
                {!isEditing && isSelected && shape !== 'underline' ? (
                  <rect
                    className="mindmap-node-selection"
                    x={node.x - selectionGap}
                    y={node.y - selectionGap}
                    width={node.width + selectionGap * 2}
                    height={node.height + selectionGap * 2}
                    pointerEvents="none"
                    aria-hidden="true"
                  />
                ) : null}
                {!isEditing ? topicActions.map((action, actionIndex) => {
                  const actionX = node.x + node.width
                    - topicActions.length * MIND_MAP_TOPIC_ACTION_BUTTON_RESERVED_WIDTH
                    + actionIndex * MIND_MAP_TOPIC_ACTION_BUTTON_RESERVED_WIDTH
                    + 3
                  const actionY = node.y + node.height - 24
                  const actionLabel = `${action.label}: ${node.title || t('mindmap.untitledTopic')}`
                  const iconProps = {
                    x: actionX + 4,
                    y: actionY + 4,
                    width: 14,
                    height: 14,
                    strokeWidth: 1.7,
                    className: 'mindmap-node-topic-action-icon'
                  }
                  return (
                    <g
                      key={action.kind}
                      className={`mindmap-node-topic-action-group mindmap-node-note-button-group${action.kind === 'note' ? ' mindmap-note-indicator' : ''}`}
                      data-topic-action={action.kind}
                      role="button"
                      tabIndex={readOnly ? -1 : 0}
                      aria-disabled={readOnly || undefined}
                      aria-label={actionLabel}
                      onPointerDown={(event) => {
                        if (readOnly) return
                        event.stopPropagation()
                        event.preventDefault()
                      }}
                      onClick={(event) => {
                        if (readOnly) return
                        event.stopPropagation()
                        action.onOpen?.(node.id)
                      }}
                      onKeyDown={(event) => {
                        if (readOnly) return
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        event.stopPropagation()
                        action.onOpen?.(node.id)
                      }}
                    >
                      <title>{actionLabel}</title>
                      <rect
                        className="mindmap-node-topic-action mindmap-node-note-button"
                        x={actionX}
                        y={actionY}
                        width={22}
                        height={22}
                        rx={6}
                      />
                      {action.kind === 'note' ? <StickyNote {...iconProps} /> : null}
                    </g>
                  )
                }) : null}
                {node.labels && node.labels.length > 0 ? (
                  <g className="mindmap-node-labels">
                    {node.labels.map((label, labelIndex) => (
                      <text
                        key={labelIndex}
                        className="mindmap-node-label-tag"
                        x={node.x + 4}
                        y={node.y + node.height + 14 + labelIndex * 12}
                      >
                        #{label}
                      </text>
                    ))}
                  </g>
                ) : null}
                {isEditing ? (
                  <foreignObject
                    x={labelRegion.x}
                    y={labelRegion.y}
                    width={labelRegion.width}
                    height={labelRegion.height}
                    className={`mindmap-node-foreign mindmap-node-input-foreign mindmap-node-region--${imagePlacement}`}
                  >
                    <div className="mindmap-node-input-wrap">
                      <MindMapRichTextEditor
                        ref={nodeEditorRef}
                        text={editValue}
                        spans={editSpans}
                        className="mindmap-node-input"
                        ariaLabel={`${t('mindmap.editTopic')}: ${node.title}`}
                        baseStyle={{
                          ...topicTextStyle,
                          color: topicTextColor,
                          lineHeight: 1,
                          textAlign
                        }}
                        autoFocus
                        selectAllOnFocus
                        placeholder={t('mindmap.untitledTopic')}
                        onModelChange={(text, spans) => {
                          setEditValue(text)
                          setEditSpans(spans)
                        }}
                        onSelectionChange={handleRichTextSelectionChange}
                        onBlur={(event, text, spans) => {
                          setEditValue(text)
                          setEditSpans(spans)
                          // Keep the edit + selection alive when the user
                          // moves into the right-side inspector so its text
                          // controls target the selected span.
                          if (isMindMapInspectorTarget(event.relatedTarget)) {
                            panelDeferredCommitRef.current = true
                            return
                          }
                          commitEdit(text, spans)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault()
                            commitEdit()
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setEditingNodeId(null)
                          }
                        }}
                      />
                    </div>
                  </foreignObject>
                ) : hasTextSpans(node.titleFormatting) ? (
                  <foreignObject
                    x={labelRegion.x}
                    y={labelRegion.y}
                    width={labelRegion.width}
                    height={labelRegion.height}
                    className="mindmap-node-foreign mindmap-node-markdown-foreign"
                  >
                    <div
                      className={`mindmap-node-markdown-label${node.title ? '' : ' is-placeholder'}`}
                      style={{
                        ...topicTextStyle,
                        color: topicTextColor,
                        textAlign,
                        lineHeight: 1.2
                      }}
                    >
                      <MindMapRichTextLabel
                        text={topicNumbers.get(node.id)
                          ? `${topicNumbers.get(node.id)}  ${displayTitle}`
                          : displayTitle}
                        spans={node.titleFormatting ?? []}
                        className="mindmap-node-markdown-label__content"
                      />
                    </div>
                  </foreignObject>
                ) : hasInlineMarkdown ? (
                  <foreignObject
                    x={labelRegion.x}
                    y={labelRegion.y}
                    width={labelRegion.width}
                    height={labelRegion.height}
                    className="mindmap-node-foreign mindmap-node-markdown-foreign"
                  >
                    <div
                      className={`mindmap-node-markdown-label${node.title ? '' : ' is-placeholder'}`}
                      style={{
                        ...topicTextStyle,
                        color: topicTextColor,
                        textAlign,
                        lineHeight: 1.2
                      }}
                      onPointerDown={(event) => {
                        const target = event.target as HTMLElement
                        if (target.closest('a')) event.stopPropagation()
                      }}
                      onClick={(event) => {
                        const target = event.target as HTMLElement
                        const anchor = target.closest('a')
                        if (!anchor) return
                        event.preventDefault()
                        event.stopPropagation()
                        const destination = classifyExternalDestination(anchor.getAttribute('href'))
                        if (destination.kind === 'browser') void openExternal(destination.url)
                      }}
                    >
                      <span
                        className="mindmap-node-markdown-label__content"
                        // markdown-it is configured with html disabled and the
                        // KaTeX renderer does not trust user commands.
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdownInlineHtml(
                            topicNumbers.get(node.id)
                              ? `${topicNumbers.get(node.id)}  ${displayTitle}`
                              : displayTitle
                          )
                        }}
                      />
                    </div>
                  </foreignObject>
                ) : (
                    <text
                      className={`mindmap-node-label${node.title ? '' : ' is-placeholder'}`}
                      x={labelGeometry.x}
                      y={firstLabelLineY}
                      textAnchor={labelGeometry.textAnchor}
                      dominantBaseline="central"
                      style={{
                        ...topicTextStyle,
                        fill: topicTextColor
                      }}
                    >
                      {labelLines.map((line, lineIndex) => (
                        <tspan
                          key={`${lineIndex}-${line}`}
                          className="mindmap-node-label-line"
                          x={labelGeometry.x}
                          dy={lineIndex === 0 ? 0 : labelLineHeight}
                        >
                          {lineIndex === 0 && topicNumbers.get(node.id) ? (
                            <tspan className="mindmap-node-number">{topicNumbers.get(node.id)}  </tspan>
                          ) : null}
                          {line}
                        </tspan>
                      ))}
                    </text>
                )}

                {!isEditing ? (
                  <g className="mindmap-node-resize-control" aria-hidden="true">
                    <rect
                      className="mindmap-node-resize-hitarea"
                      x={node.x - MIND_MAP_NODE_RESIZE_EDGE_HIT_SIZE / 2}
                      y={node.y}
                      width={MIND_MAP_NODE_RESIZE_EDGE_HIT_SIZE}
                      height={node.height}
                      onPointerDown={(event) => startNodeResize(node, 'left', event)}
                    />
                    <rect
                      className="mindmap-node-resize-hitarea"
                      x={node.x + node.width - MIND_MAP_NODE_RESIZE_EDGE_HIT_SIZE / 2}
                      y={node.y}
                      width={MIND_MAP_NODE_RESIZE_EDGE_HIT_SIZE}
                      height={node.height}
                      onPointerDown={(event) => startNodeResize(node, 'right', event)}
                    />
                  </g>
                ) : null}

                {node.markers?.map((marker, index) => {
                  const position = markerBadgePosition(node, index)
                  const markerLabel = marker.label || marker.symbol
                  const markerIcon = markerIconFor(marker)
                  return (
                    <g
                      key={marker.id}
                      className="mindmap-node-marker"
                      role="img"
                      aria-label={markerLabel}
                    >
                      <title>{markerLabel}</title>
                      {markerIcon ? (
                        <g
                          transform={`translate(${position.x - MARKER_ICON_SIZE / 2}, ${position.y - MARKER_ICON_SIZE / 2})`}
                        >
                          {markerIcon}
                        </g>
                      ) : (
                        <>
                          <circle
                            className="mindmap-node-marker-badge"
                            cx={position.x}
                            cy={position.y}
                            r={MARKER_BADGE_SIZE / 2}
                          />
                          <text
                            className="mindmap-node-marker-symbol"
                            x={position.x}
                            y={position.y}
                            textAnchor="middle"
                            dominantBaseline="central"
                          >
                            {marker.symbol}
                          </text>
                        </>
                      )}
                    </g>
                  )
                })}

                {node.collapsed ? (
                  (() => {
                    const count = node.hiddenDescendantCount ?? 1
                    const badgeW = count > 9 ? 26 : 20
                    const badgeH = 18
                    const badgeX = node.x + node.width + 4
                    const badgeY = node.y + node.height / 2 - badgeH / 2
                    const bColor = branchColorForKey(document.theme, node.branchKey) ?? '#438EFF'
                    return (
                      <g
                        className="mindmap-collapse-badge"
                        onClick={(event) => {
                          if (readOnly) return
                          event.stopPropagation()
                          toggleCollapse(node.id)
                        }}
                      >
                        <rect
                          className="mindmap-collapse-badge-rect"
                          x={badgeX}
                          y={badgeY}
                          width={badgeW}
                          height={badgeH}
                          rx={badgeH / 2}
                          style={{ stroke: bColor, fill: 'var(--surface-solid)' }}
                        />
                        <text
                          className="mindmap-collapse-badge-symbol"
                          x={badgeX + badgeW / 2}
                          y={badgeY + badgeH / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          style={{ fill: bColor }}
                        >
                          {count}
                        </text>
                      </g>
                    )
                  })()
                ) : null}

                {!node.collapsed && !isEditing ? (
                  <g className="mindmap-node-actions">
                    {resolveMindMapNodeActionDirections(
                      node,
                      sheet.layout.structureClass,
                      rootNode
                    ).map((direction) => {
                      const position = resolveMindMapNodeActionPosition(node, direction)
                      return (
                        <g
                          key={direction}
                          className={`mindmap-node-action-group mindmap-node-action-group--${direction}`}
                          role="button"
                          tabIndex={readOnly ? -1 : 0}
                          aria-disabled={readOnly || undefined}
                          aria-label={t('mindmap.addChild')}
                          onPointerDown={(event) => {
                            if (readOnly) return
                            event.stopPropagation()
                            event.preventDefault()
                          }}
                          onClick={(event) => {
                            if (readOnly) return
                            event.stopPropagation()
                            addChild(node.id)
                          }}
                          onKeyDown={(event) => {
                            if (readOnly) return
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            event.stopPropagation()
                            addChild(node.id)
                          }}
                        >
                          <title>{t('mindmap.addChild')}</title>
                          <circle
                            className="mindmap-node-action-hitarea"
                            cx={position.x}
                            cy={position.y}
                            r={MIND_MAP_NODE_ACTION_OFFSET}
                          />
                          <circle
                            className="mindmap-node-action mindmap-node-action--add"
                            cx={position.x}
                            cy={position.y}
                            r={MIND_MAP_NODE_ACTION_RADIUS}
                          />
                          <path
                            className="mindmap-node-action-plus"
                            d={`M ${position.x - 4.5} ${position.y} H ${position.x + 4.5} M ${position.x} ${position.y - 4.5} V ${position.y + 4.5}`}
                          />
                        </g>
                      )
                    })}
                  </g>
                ) : null}
              </g>
            )
          })}

          {imageDragState?.dropRegion ? (() => {
            const dropNode = nodeById.get(imageDragState.dropRegion.topicId)
            if (!dropNode) return null
            return (
              <g className="mindmap-image-drop-regions" pointerEvents="none" aria-hidden="true">
                {(['top', 'bottom', 'left', 'right'] as const).map((region) => {
                  const active = imageDragState.dropRegion?.region === region
                  let r: { x: number; y: number; width: number; height: number }
                  if (region === 'top') r = { x: dropNode.x, y: dropNode.y, width: dropNode.width, height: dropNode.height / 2 }
                  else if (region === 'bottom') r = { x: dropNode.x, y: dropNode.y + dropNode.height / 2, width: dropNode.width, height: dropNode.height / 2 }
                  else if (region === 'left') r = { x: dropNode.x, y: dropNode.y, width: dropNode.width / 2, height: dropNode.height }
                  else r = { x: dropNode.x + dropNode.width / 2, y: dropNode.y, width: dropNode.width / 2, height: dropNode.height }
                  return (
                    <path
                      key={region}
                      className={`mindmap-image-drop-region${active ? ' is-active' : ''}`}
                      d={elementOutlinePath(r, 'rounded-rectangle')}
                      data-region={region}
                    />
                  )
                })}
              </g>
            )
          })() : null}

          {imageRects.map((rect) => {
            const dataUrl = assetDataUrls[rect.assetId]
            const asset = document.assets.find((a) => a.id === rect.assetId)
            const isSelected = selection.kind === 'image' && selection.imageId === rect.id
            const isDragging = imageDragState?.imageId === rect.id
            return (
              <g
                key={rect.id}
                className={`mindmap-image-group${isSelected ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}`}
                role="button"
                tabIndex={readOnly ? -1 : (isSelected ? 0 : -1)}
                aria-disabled={readOnly || undefined}
                aria-label={asset?.fileName ?? t('mindmap.contentPanel.images')}
                onPointerDown={(event) => startImageDrag(rect.id, event)}
              >
                <foreignObject
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  className="mindmap-image-foreign"
                >
                  {dataUrl ? (
                    <img
                      className="mindmap-image"
                      src={dataUrl}
                      alt={asset?.fileName ?? t('mindmap.contentPanel.images')}
                      draggable={false}
                    />
                  ) : (
                    <div className="mindmap-image mindmap-image--loading" role="status">
                      {t('mindmap.contentPanel.assetLoading')}
                    </div>
                  )}
                </foreignObject>
                {isSelected && !isDragging ? (
                  <>
                    <rect
                      className="mindmap-image-selection"
                      x={rect.x - 1}
                      y={rect.y - 1}
                      width={rect.width + 2}
                      height={rect.height + 2}
                      rx={6}
                      pointerEvents="none"
                    />
                    <rect
                      className="mindmap-image-resize-handle"
                      x={rect.x + rect.width - 9}
                      y={rect.y + rect.height - 9}
                      width={12}
                      height={12}
                      rx={3}
                      onPointerDown={(event) => startImageResize(rect.id, event)}
                    />
                    <g
                      className="mindmap-image-delete-button"
                      role="button"
                      aria-label={t('mindmap.contentPanel.removeImage')}
                      transform={`translate(${rect.x + rect.width - 26} ${rect.y - 26})`}
                      onPointerDown={(event) => {
                        if (readOnly) return
                        event.stopPropagation()
                      }}
                      onClick={(event) => {
                        if (readOnly) return
                        event.stopPropagation()
                        deleteImage(rect.id)
                      }}
                    >
                      <rect width={20} height={20} rx={6} />
                      <Trash2 x={3} y={3} width={14} height={14} />
                    </g>
                  </>
                ) : null}
              </g>
            )
          })}

          {imageDragState ? (() => {
            const rect = imageRects.find((candidate) => candidate.id === imageDragState.imageId)
            const dataUrl = rect ? assetDataUrls[rect.assetId] : undefined
            const width = rect?.width ?? 160
            const height = rect?.height ?? 88
            return (
              <g
                className="mindmap-image-ghost"
                pointerEvents="none"
                aria-hidden="true"
                transform={`translate(${imageDragState.current.x - imageDragState.grabOffset.x} ${imageDragState.current.y - imageDragState.grabOffset.y})`}
              >
                <rect width={width} height={height} rx={6} />
                {dataUrl ? (
                  <image
                    href={dataUrl}
                    x={2}
                    y={2}
                    width={width - 4}
                    height={height - 4}
                    preserveAspectRatio="xMidYMid meet"
                  />
                ) : null}
              </g>
            )
          })() : null}

          {renderedLineGeometries.map(({
            line,
            interaction,
            controlInteraction,
            from,
            to,
            curvePoint
          }) => {
            const isSelected = (selection.kind === 'element' && selection.elementId === line.id)
              || (selection.kind === 'hybrid' && selection.elementIds.includes(line.id))
            const canEdit = !readOnly && !lineTool?.active && !drawingShape
            if (!isSelected || !canEdit) return null

            const endpointLabel = line.label || t('mindmap.elementStyle.types.connector', { defaultValue: 'Connector' })
            const hitRadius = 13 / Math.max(zoom, 0.01)
            const visibleRadius = 4.5 / Math.max(zoom, 0.01)
            const endpoints: ReadonlyArray<{
              key: 'from' | 'to'
              point: { x: number; y: number }
              label: string
            }> = [
              { key: 'from', point: from, label: `${endpointLabel} start` },
              { key: 'to', point: to, label: `${endpointLabel} end` }
            ]

            return (
              <g
                key={`endpoints-${line.id}`}
                data-mindmap-line-endpoint-overlay={line.id}
                className={`mindmap-drawn-line-endpoint-overlay${interaction || controlInteraction ? ' is-interacting' : ''}`}
              >
                {curvePoint ? (
                  <g className="mindmap-drawn-line-control">
                    <path
                      className="mindmap-drawn-line-control-guide"
                      d={`M ${from.x} ${from.y} L ${curvePoint.x} ${curvePoint.y} L ${to.x} ${to.y}`}
                      pointerEvents="none"
                      aria-hidden="true"
                    />
                    <circle
                      data-mindmap-line-control={line.id}
                      className="mindmap-drawn-line-control-hit"
                      cx={curvePoint.x}
                      cy={curvePoint.y}
                      r={hitRadius}
                      fill="transparent"
                      pointerEvents="all"
                      aria-label={`${endpointLabel} curve control`}
                      onPointerDown={(event) => startLineControlInteraction(line, curvePoint, event)}
                      onContextMenu={(event) => openLineContextMenu(line.id, event)}
                    />
                    <circle
                      className="mindmap-drawn-line-control-core"
                      cx={curvePoint.x}
                      cy={curvePoint.y}
                      r={visibleRadius + 1}
                      pointerEvents="none"
                      aria-hidden="true"
                    />
                  </g>
                ) : null}
                {endpoints.map(({ key, point, label }) => (
                  <g key={key}>
                    <circle
                      data-mindmap-line-endpoint={key}
                      data-mindmap-line-id={line.id}
                      className="mindmap-drawn-line-endpoint-hit"
                      cx={point.x}
                      cy={point.y}
                      r={hitRadius}
                      fill="transparent"
                      pointerEvents="all"
                      aria-label={label}
                      onPointerDown={(event) => startLineEndpointInteraction(line, key, event)}
                      onContextMenu={(event) => openLineContextMenu(line.id, event)}
                    />
                    <circle
                      className="mindmap-drawn-line-endpoint-core"
                      cx={point.x}
                      cy={point.y}
                      r={visibleRadius}
                      pointerEvents="none"
                      aria-hidden="true"
                    />
                  </g>
                ))}
              </g>
            )
          })}

          {nodeDragState?.ghost ? (() => {
            const ghost = nodeDragState.ghost
            const dropTarget = nodeDragState.dropTargetId
              ? nodeById.get(nodeDragState.dropTargetId)
              : undefined
            return (
              <g className="mindmap-node-ghost" pointerEvents="none" aria-hidden="true">
                {dropTarget ? (
                  <path
                    className="mindmap-node-ghost-edge"
                    d={ghostConnectorPath(dropTarget, ghost)}
                  />
                ) : null}
                <rect
                  className="mindmap-node-ghost-rect"
                  x={ghost.x}
                  y={ghost.y}
                  width={ghost.width}
                  height={ghost.height}
                  rx={Math.min(12, ghost.height / 2)}
                  ry={Math.min(12, ghost.height / 2)}
                />
              </g>
            )
          })() : null}

          {shapePreview ? (
            <path
              className="mindmap-shape-draft"
              d={mindMapDrawingShapePath(shapePreview.shape, shapePreview.rect)}
              pointerEvents="none"
            />
          ) : null}

          {linePreview ? (() => {
            const currentTarget = lineDrawState?.current.target
              ? lineSnapTargetByKey.get(`${lineDrawState.current.target.kind}:${lineDrawState.current.target.id}`)
              : undefined
            return (
              <g className="mindmap-line-draft-group" pointerEvents="none" aria-hidden="true">
                {currentTarget ? (
                  <rect
                    className="mindmap-line-snap-highlight"
                    x={currentTarget.x - 3}
                    y={currentTarget.y - 3}
                    width={currentTarget.width + 6}
                    height={currentTarget.height + 6}
                    rx={8}
                  />
                ) : null}
                <path
                  className="mindmap-line-draft"
                  d={relationshipElementPath(
                    linePreview.from,
                    linePreview.to,
                    linePreview.style.lineShape,
                    connectorPathOptions(
                      linePreview.from,
                      linePreview.to,
                      linePreviewCurvePoint,
                      linePreview.style
                    )
                  )}
                  markerStart={linePreview.style.beginArrow && linePreview.style.beginArrow !== 'none'
                    ? `url(#mindmap-rel-arrow-${linePreview.style.beginArrow})`
                    : undefined}
                  markerEnd={linePreview.style.endArrow && linePreview.style.endArrow !== 'none'
                    ? `url(#mindmap-rel-arrow-${linePreview.style.endArrow})`
                    : undefined}
                  style={{
                    ...arrowedLineCapStyle(linePreview.style),
                    ...(linePreview.style.linePattern
                      ? { strokeDasharray: elementLineDashArray(linePreview.style.linePattern) ?? 'none' }
                      : {})
                  }}
                />
              </g>
            )
          })() : null}

          {lineTool?.active ? (
            <g className="mindmap-line-snap-targets" aria-hidden="true">
              {availableLineSnapTargets.map((target) => (
                <rect
                  key={`${target.kind}:${target.id}`}
                  data-mindmap-line-snap-target={`${target.kind}:${target.id}`}
                  x={target.x}
                  y={target.y}
                  width={target.width}
                  height={target.height}
                  fill="transparent"
                />
              ))}
            </g>
          ) : null}
        </g>
        {readOnly ? (
          <rect
            className="mindmap-generation-read-only-shield"
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="transparent"
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          />
        ) : null}
      </svg>
      {!readOnly ? (
        <MindMapTextFormatToolbar
          selection={richTextSelection}
          onApplyStyle={(style) => {
            const editor = editingNodeId ? nodeEditorRef.current : shapeEditorRef.current
            editor?.applyStyle(style)
          }}
          onToggleBold={() => {
            const editor = editingNodeId ? nodeEditorRef.current : shapeEditorRef.current
            editor?.applyStyle({ bold: true }, true)
          }}
          onToggleItalic={() => {
            const editor = editingNodeId ? nodeEditorRef.current : shapeEditorRef.current
            editor?.applyStyle({ italic: true }, true)
          }}
          defaultFontLabel={toolbarTextDefaults.fontLabel}
          defaultFontSize={toolbarTextDefaults.fontSize}
        />
      ) : null}
    </div>
  )
}
