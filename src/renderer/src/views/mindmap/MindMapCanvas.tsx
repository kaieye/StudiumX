import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapDocumentV2, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import {
  computeMindMapLayout,
  type MindMapLayoutCallout,
  type MindMapLayoutNode,
  type MindMapLayoutRelationship,
  type MindMapLayoutSummary
} from './mind-map-layout'
import { branchColor } from './mind-map-branch-colors'
import { defaultTopicTextAlign, resolveEffectiveTopicStyle } from './mind-map-topic-style'
import { resolveEdgePath, edgeStrokeWidth, lineDashPattern, taperedEdgePath } from './mind-map-edge-styles'
import {
  elementLineDashArray,
  elementOutlinePath,
  relationshipArrowMarkerPath,
  relationshipElementPath
} from './mind-map-element-styles'
import { resolveShape, shapeElement } from './mind-map-node-shapes'
import {
  centerMindMapViewport,
  fitMindMapViewport,
  MAX_MIND_MAP_ZOOM,
  MIN_MIND_MAP_ZOOM,
  zoomMindMapViewport
} from './mind-map-viewport'
import { useMindMapViewStore } from './mind-map-view-store'
import { computeAllTopicNumbers } from './mind-map-numbering'

/**
 * Custom SVG mind-map canvas (docs/mindmap/design.md §6.3).
 *
 * No heavy graph/react-flow dependency — the tree is laid out by the pure
 * `computeMindMapLayout` module and painted as smoothed bezier edges + rounded
 * rect nodes. Colors come from the app's CSS design tokens so the dark theme
 * stays neutral. Pan (drag background) and zoom (wheel) drive a view transform.
 */

type Vec2 = { x: number; y: number }

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

type CanvasProps = {
  document: MindMapDocumentV2
  activeSheetIndex: number
  onActiveSheetChange: (index: number) => void
  viewportAction?: MindMapCanvasViewportAction | null
  onZoomChange?: (zoom: number) => void
  onViewportChange?: (viewport: { x: number; y: number; width: number; height: number }) => void
  onContextMenu?: (nodeId: string, x: number, y: number) => void
  onMoveNode?: (topicId: string, toParentId: string) => void
}

const VIEW_PADDING = 48
const CALLOUT_WIDTH = 192
const CALLOUT_HEIGHT = 52
const CALLOUT_GAP = 28
const MARKER_BADGE_SIZE = 18
const MARKER_BADGE_GAP = 3
const SUMMARY_GAP = 24
const SUMMARY_LABEL_GAP = 12
const SUMMARY_LABEL_WIDTH = 160
const TOPIC_LABEL_HORIZONTAL_PADDING = 10

function topicLabelGeometry(
  node: MindMapLayoutNode,
  textAlign: NonNullable<NonNullable<MindMapTopicV2['style']>['textAlign']>
): { x: number; textAnchor: 'start' | 'middle' | 'end' } {
  if (textAlign === 'left') {
    return { x: node.x + TOPIC_LABEL_HORIZONTAL_PADDING, textAnchor: 'start' }
  }
  if (textAlign === 'right') {
    return { x: node.x + node.width - TOPIC_LABEL_HORIZONTAL_PADDING, textAnchor: 'end' }
  }
  return { x: node.x + node.width / 2, textAnchor: 'middle' }
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

type MindMapSummaryBracket = {
  summary: MindMapLayoutSummary
  from: MindMapLayoutNode
  to: MindMapLayoutNode
  x: number
  y: number
  bottom: number
  labelX: number
  labelY: number
}

function summaryBracket(
  summary: MindMapLayoutSummary,
  from: MindMapLayoutNode,
  to: MindMapLayoutNode
): MindMapSummaryBracket {
  const y = Math.min(from.y, to.y) - 4
  const bottom = Math.max(from.y + from.height, to.y + to.height) + 4
  const x = Math.max(from.x + from.width, to.x + to.width) + SUMMARY_GAP
  return {
    summary,
    from,
    to,
    x,
    y,
    bottom,
    labelX: x + SUMMARY_LABEL_GAP,
    labelY: (y + bottom) / 2
  }
}

function summaryPath(bracket: MindMapSummaryBracket): string {
  const height = Math.max(16, bracket.bottom - bracket.y)
  const middle = bracket.y + height / 2
  const hook = Math.min(12, Math.max(6, height / 4))
  const bend = Math.min(18, Math.max(8, height / 3))
  return [
    `M ${bracket.x} ${bracket.y}`,
    `C ${bracket.x + hook} ${bracket.y}, ${bracket.x + hook} ${bracket.y + bend}, ${bracket.x + bend} ${bracket.y + bend}`,
    `C ${bracket.x + bend * 1.45} ${bracket.y + bend}, ${bracket.x + bend * 1.45} ${middle - hook}, ${bracket.x + bend * 2} ${middle}`,
    `C ${bracket.x + bend * 1.45} ${middle + hook}, ${bracket.x + bend * 1.45} ${bracket.bottom - bend}, ${bracket.x + bend} ${bracket.bottom - bend}`,
    `C ${bracket.x + hook} ${bracket.bottom - bend}, ${bracket.x + hook} ${bracket.bottom}, ${bracket.x} ${bracket.bottom}`
  ].join(' ')
}

export function MindMapCanvas({ document, activeSheetIndex, viewportAction, onZoomChange, onViewportChange, onContextMenu, onMoveNode }: CanvasProps) {
  const { t } = useTranslation()
  const selection = useMindMapViewStore((s) => s.selection)
  const selectedNodeId = useMindMapViewStore((s) => s.selectedNodeId)
  const selectTopic = useMindMapViewStore((s) => s.selectTopic)
  const selectElement = useMindMapViewStore((s) => s.selectElement)
  const selectCanvas = useMindMapViewStore((s) => s.selectCanvas)
  const editingNodeId = useMindMapViewStore((s) => s.editingNodeId)
  const setEditingNodeId = useMindMapViewStore((s) => s.setEditingNodeId)
  const updateNode = useMindMapViewStore((s) => s.updateNode)
  const addChild = useMindMapViewStore((s) => s.addChild)
  const toggleCollapse = useMindMapViewStore((s) => s.toggleCollapse)
  const dispatchCommand = useMindMapViewStore((s) => s.dispatchCommand)

  const sheetCount = document.sheets.length
  const safeSheetIndex = Math.min(Math.max(activeSheetIndex, 0), sheetCount - 1)
  const sheet = document.sheets[safeSheetIndex]

  const layout = useMemo(
    () => (sheet
      // G3: untitled topics are measured as the placeholder label so they
      // render as a normal-sized chip instead of a blank stub.
      ? computeMindMapLayout(sheet, { emptyTitleFallback: t('mindmap.untitledTopic') })
      : { nodes: [], edges: [], relationships: [], callouts: [], summaries: [], boundaries: [] }),
    [sheet, t]
  )

  const nodeById = useMemo(() => {
    const map = new Map<string, MindMapLayoutNode>()
    for (const node of layout.nodes) map.set(node.id, node)
    return map
  }, [layout.nodes])

  // XMind numbering prefixes (2.1.3). Purely derived from the sheet tree and
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
      const from = nodeById.get(summary.from)
      const to = nodeById.get(summary.to)
      // A collapsed subtree removes its descendants from nodeById; hide the
      // summary rather than leaving a dangling structural annotation.
      if (!from || !to) continue
      brackets.push(summaryBracket(summary, from, to))
    }
    return brackets
  }, [layout.summaries, nodeById])

  // Container-pixel coordinate system: 1 SVG unit = 1 CSS pixel.
  // ResizeObserver tracks the actual rendered container so the viewBox always
  // matches the on-screen pixel dimensions (Xmind model).  This prevents the
  // old behaviour where a single-node map was stretched to fill the viewport.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState<{ cw: number; ch: number }>({ cw: 800, ch: 600 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect
        setContainerSize({ cw: Math.max(1, cr.width), ch: Math.max(1, cr.height) })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [editValue, setEditValue] = useState('')
  const dragRef = useRef<{ startPointer: Vec2; startPan: Vec2; moved: boolean } | null>(null)
  const handledViewportActionIdRef = useRef<number | null>(null)
  // Node drag-and-drop reparenting state
  const [nodeDragState, setNodeDragState] = useState<{
    draggingId: string
    startPointer: Vec2
    dropTargetId: string | null
  } | null>(null)

  // When the store's editing node changes (e.g. F2 from the keyboard), seed the
  // local edit buffer with that node's current title.
  useEffect(() => {
    if (editingNodeId === null || !sheet) return
    const ref = findTopicTitle(sheet.root, editingNodeId)
    if (ref !== undefined) setEditValue(ref)
  }, [editingNodeId, sheet])

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
    for (const callout of calloutRects) {
      left = Math.min(left, callout.x)
      top = Math.min(top, callout.y)
      right = Math.max(right, callout.x + callout.width)
      bottom = Math.max(bottom, callout.y + callout.height)
    }
    for (const summary of summaryBrackets) {
      left = Math.min(left, summary.x)
      top = Math.min(top, summary.y)
      right = Math.max(right, summary.labelX + SUMMARY_LABEL_WIDTH)
      bottom = Math.max(bottom, summary.bottom)
    }
    return { left, top, right, bottom }
  }, [calloutRects, layout.nodes, summaryBrackets])

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

  // Xmind keeps a freshly created / edited topic on screen: when inline editing
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
  // Xmind opens a map with its content visible and centred; fit only ever
  // shrinks (zoom caps at 100%), so a fresh single-node map still opens at 1:1.
  const documentId = document.id
  const centeredDocRef = useRef<string | null>(null)
  useEffect(() => {
    if (!sheet || centeredDocRef.current === documentId) return
    if (layout.nodes.length === 0) return
    centeredDocRef.current = documentId
    const next = fitMindMapViewport(bounds, viewportSize)
    setPan(next.pan)
    setZoom(next.zoom)
  }, [documentId, sheet, layout.nodes, bounds, viewportSize])

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

  const startPointerDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (editingNodeId) return
    dragRef.current = {
      startPointer: { x: event.clientX, y: event.clientY },
      startPan: pan,
      moved: false
    }
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startPointer.x
    const dy = event.clientY - drag.startPointer.y
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    setPan({ x: drag.startPan.x + dx, y: drag.startPan.y + dy })
  }

  const endPointerDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    // Treat a click on the background as a selection clear.
    if (dragRef.current && !dragRef.current.moved && event.target === event.currentTarget) {
      selectCanvas()
    }
    dragRef.current = null
  }

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault()
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
  }

  const beginEdit = (nodeId: string, initial: string): void => {
    setEditingNodeId(nodeId)
    setEditValue(initial)
  }

  const commitEdit = (): void => {
    if (editingNodeId !== null) {
      updateNode(editingNodeId, { title: editValue })
    }
    setEditingNodeId(null)
  }

  const beginNodeAction = useCallback(
    (nodeId: string, additive: boolean) => {
      selectTopic(nodeId, additive)
    },
    [selectTopic]
  )

  // --- Node drag-and-drop reparenting ---

  const startNodeDrag = (nodeId: string, event: ReactPointerEvent<SVGGElement>): void => {
    if (editingNodeId) return
    dragRef.current = null
    setNodeDragState({
      draggingId: nodeId,
      startPointer: { x: event.clientX, y: event.clientY },
      dropTargetId: null
    })
  }

  const updateNodeDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!nodeDragState) return
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
      setNodeDragState({ ...nodeDragState, dropTargetId: targetId })
    }
  }

  const endNodeDrag = (): void => {
    if (!nodeDragState) return
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

  return (
    <div
      ref={containerRef}
      className={`mindmap-canvas${nodeDragState ? ' is-dragging-node' : ''}`}
      data-theme-id={document.theme.id}
      style={canvasStyle}
    >
      <svg
        className="mindmap-svg"
        viewBox={viewBox}
        role="img"
        aria-label={sheet.title}
        onPointerDown={startPointerDrag}
        onPointerMove={(e) => { onPointerMove(e); updateNodeDrag(e) }}
        onPointerUp={(e) => { endPointerDrag(e); endNodeDrag() }}
        onPointerLeave={(e) => { endPointerDrag(e); endNodeDrag() }}
        onWheel={onWheel}
      >
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
              if (!markerPath) return null
              return (
                <marker
                  key={arrow}
                  id={`mindmap-rel-arrow-${arrow}`}
                  viewBox="0 0 10 10"
                  refX={arrow === 'dot' ? 6 : arrow === 'herringbone' || arrow === 'attached' ? 6 : 8}
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                  fill="context-stroke"
                  opacity="0.78"
                >
                  <path d={markerPath} />
                </marker>
              )
            })}
          </defs>
          {layout.edges.map((edge) => {
            const from = nodeById.get(edge.from)
            const to = nodeById.get(edge.to)
            if (!from || !to) return null
            const color = branchColor(document.theme, edge.branchIndex)
            // A user-selected line style is an explicit override. Otherwise
            // use the connector language attached by the structure layout so
            // a timeline/fishbone/matrix does not look like a generic map.
            const lineStyle = sheet?.layout?.lineStyle ?? edge.connectorStyle
            const strokeWidth = edgeStrokeWidth(to.depth, sheet?.layout?.lineWidthScale)
            const pattern = sheet?.layout?.linePattern
            const dash = lineDashPattern(pattern)
            const tapered = sheet?.layout?.tapered === true
            const edgeStyle: CSSProperties = color
              ? { stroke: color, strokeWidth, ...(dash ? { strokeDasharray: dash } : {}) }
              : { strokeWidth, ...(dash ? { strokeDasharray: dash } : {}) }
            if (tapered) {
              const childWidth = Math.max(1, strokeWidth * 0.45)
              return (
                <path
                  key={edge.to}
                  className="mindmap-edge mindmap-edge--tapered"
                  d={taperedEdgePath(from, to, strokeWidth, childWidth, edge.axis)}
                  style={color ? { fill: color } : {}}
                />
              )
            }
            return (
              <path
                key={edge.to}
                className="mindmap-edge"
                d={resolveEdgePath(from, to, lineStyle, edge.axis)}
                style={edgeStyle}
              />
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
                className={`mindmap-relationship-group${selection.kind === 'element' && selection.elementId === relationship.id ? ' is-selected' : ''}`}
                role="button"
                tabIndex={selection.kind === 'element' && selection.elementId === relationship.id ? 0 : -1}
                aria-pressed={selection.kind === 'element' && selection.elementId === relationship.id}
                aria-label={relationship.label || endpointLabel}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  dragRef.current = null
                  selectElement(relationship.id, 'relationship')
                }}
              >
                <path
                  className="mindmap-relationship"
                  d={relationshipElementPath(from, to, relationship.style?.lineShape)}
                  markerStart={relationship.style?.beginArrow && relationship.style.beginArrow !== 'none'
                    ? `url(#mindmap-rel-arrow-${relationship.style.beginArrow})`
                    : undefined}
                  markerEnd={relationship.style?.endArrow && relationship.style.endArrow !== 'none'
                    ? `url(#mindmap-rel-arrow-${relationship.style.endArrow})`
                    : undefined}
                  style={{
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
              className={`mindmap-callout-group${selection.kind === 'element' && selection.elementId === rect.callout.id ? ' is-selected' : ''}`}
              role="button"
              tabIndex={selection.kind === 'element' && selection.elementId === rect.callout.id ? 0 : -1}
              aria-pressed={selection.kind === 'element' && selection.elementId === rect.callout.id}
              onPointerDown={(event) => {
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
            const label = bracket.summary.label || endpointLabel
            // P3 §6.3: summary brace follows the from-node's branch colour.
            const summaryColor = branchColor(document.theme, bracket.from.branchIndex)

            return (
              <g
                key={bracket.summary.id}
                className={`mindmap-summary-group${selection.kind === 'element' && selection.elementId === bracket.summary.id ? ' is-selected' : ''}`}
                role="button"
                tabIndex={selection.kind === 'element' && selection.elementId === bracket.summary.id ? 0 : -1}
                aria-pressed={selection.kind === 'element' && selection.elementId === bracket.summary.id}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  dragRef.current = null
                  selectElement(bracket.summary.id, 'summary')
                }}
                aria-label={label}
              >
                <path
                  className="mindmap-summary-brace"
                  d={summaryPath(bracket)}
                  style={{
                    stroke: bracket.summary.style?.stroke ?? summaryColor ?? undefined,
                    ...(bracket.summary.style?.strokeWidth !== undefined ? { strokeWidth: bracket.summary.style.strokeWidth } : {}),
                    ...(bracket.summary.style?.linePattern !== undefined
                      ? { strokeDasharray: elementLineDashArray(bracket.summary.style.linePattern) ?? 'none' }
                      : bracket.summary.style?.dashed === false
                        ? { strokeDasharray: 'none' }
                        : bracket.summary.style?.dashed
                          ? { strokeDasharray: '5 4' }
                          : {})
                  }}
                  aria-hidden="true"
                >
                  <title>{label}</title>
                </path>
                {bracket.summary.label ? (
                  <text
                    className="mindmap-summary-label"
                    x={bracket.labelX}
                    y={bracket.labelY}
                    dominantBaseline="central"
                    style={{
                      ...(bracket.summary.style?.textColor ? { fill: bracket.summary.style.textColor } : {}),
                      ...(bracket.summary.style?.fontFamily ? { fontFamily: bracket.summary.style.fontFamily } : {}),
                      ...(bracket.summary.style?.fontSize ? { fontSize: `${bracket.summary.style.fontSize}px` } : {})
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
                className={`mindmap-boundary-group${selection.kind === 'element' && selection.elementId === boundary.id ? ' is-selected' : ''}`}
                role="button"
                tabIndex={selection.kind === 'element' && selection.elementId === boundary.id ? 0 : -1}
                aria-pressed={selection.kind === 'element' && selection.elementId === boundary.id}
                aria-label={boundary.label || t('mindmap.elementStyle.types.boundary')}
                onPointerDown={(event) => {
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
            const isSelected = selection.kind === 'topic' && selection.topicIds.includes(node.id)
            const isPrimarySelection = node.id === selectedNodeId
            const isEditing = node.id === editingNodeId
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
            const labelGeometry = topicLabelGeometry(node, textAlign)
            return (
              <g
                key={node.id}
                className={`mindmap-node-group${isSelected ? ' is-selected' : ''}${depthClass}${nodeDragState?.draggingId === node.id ? ' is-dragging' : ''}${nodeDragState?.dropTargetId === node.id ? ' is-drop-target' : ''}`}
                data-depth={node.depth}
                role="button"
                tabIndex={isPrimarySelection ? 0 : -1}
                style={{ outline: 'none' }}
                aria-label={node.title || t('mindmap.untitledTopic')}
                aria-pressed={isSelected}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  // SVG groups can receive the browser's native focus halo on
                  // pointer activation. The selected topic already has an
                  // explicit outline on its own shape, so suppressing the
                  // default focus transfer avoids a second outer rectangle.
                  event.preventDefault()
                  dragRef.current = null
                  beginNodeAction(node.id, event.metaKey || event.ctrlKey)
                }}
                onContextMenu={(event) => {
                  if (onContextMenu) {
                    event.preventDefault()
                    onContextMenu(node.id, event.clientX, event.clientY)
                  }
                }}
                onPointerDownCapture={(event) => {
                  const target = event.target as Element
                  const isControl = target.closest?.(
                    '.mindmap-node-action, .mindmap-collapse-badge, .mindmap-node-input'
                  )
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !editingNodeId &&
                    !isControl
                  ) {
                    startNodeDrag(node.id, event)
                  }
                }}
                onDoubleClick={() => beginEdit(node.id, node.title)}
              >
                {(() => {
                  const shape = resolveShape(node.shape)
                  const elem = shapeElement(node, shape)
                  const bColor = node.depth === 1
                    ? branchColor(document.theme, node.branchIndex)
                    : null
                  // Xmind Snowbrush look: first-level branches are solid chips
                  // in the branch colour with no border; deeper topics use the
                  // quiet grey fill from the stylesheet.
                  const fill = styleOverride?.fill
                    ?? (node.depth === 1 && bColor ? bColor : undefined)
                  // Selection/focus is rendered on the topic shape itself.
                  // This deliberately takes precedence over the branch chip's
                  // borderless default and any theme stroke so a selected topic
                  // has exactly one visible highlight, not a second outer ring.
                  const focusStroke = !isEditing && isSelected
                    ? 'var(--mm-focus)'
                    : undefined
                  const borderStyle = styleOverride?.borderStyle
                  const stroke = focusStroke
                    ?? (borderStyle === 'none' ? 'none' : styleOverride?.stroke)
                    ?? (borderStyle ? 'var(--mindmap-theme-line, #8E8E93)' : undefined)
                    ?? (node.depth === 1 ? 'none' : undefined)
                  const styleProps: Record<string, string | number> = {}
                  if (fill) styleProps.fill = fill
                  if (stroke) styleProps.stroke = stroke
                  if (focusStroke) {
                    styleProps.strokeWidth = isSelected ? 2 : 1.5
                    styleProps.strokeDasharray = 'none'
                    styleProps.filter = 'none'
                  } else {
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
                {node.hasNote ? (
                  <g className="mindmap-note-indicator" role="img" aria-label="Note">
                    <title>{node.note}</title>
                    <circle
                      className="mindmap-note-indicator-badge"
                      cx={node.x + node.width - 10}
                      cy={node.y + node.height - 10}
                      r={7}
                    />
                    <text
                      className="mindmap-note-indicator-symbol"
                      x={node.x + node.width - 10}
                      y={node.y + node.height - 10}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      i
                    </text>
                  </g>
                ) : null}
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
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    className="mindmap-node-foreign"
                  >
                    <div className="mindmap-node-input-wrap">
                      <input
                        className="mindmap-node-input"
                        value={editValue}
                        autoFocus
                        style={{
                          ...(styleOverride?.textColor ? { color: styleOverride.textColor } : {}),
                          ...(styleOverride?.fontFamily ? { fontFamily: styleOverride.fontFamily } : {}),
                          ...(styleOverride?.fontSize ? { fontSize: `${styleOverride.fontSize}px` } : {}),
                          ...(styleOverride?.fontWeight ? { fontWeight: styleOverride.fontWeight } : {}),
                          ...(styleOverride?.fontStyle ? { fontStyle: styleOverride.fontStyle } : {}),
                          ...(styleOverride?.textDecoration ? { textDecoration: styleOverride.textDecoration } : {}),
                          ...(styleOverride?.textTransform ? { textTransform: styleOverride.textTransform } : {}),
                          textAlign
                        }}
                        onFocus={(event) => event.target.select()}
                        onChange={(event) => setEditValue(event.currentTarget.value)}
                        onBlur={commitEdit}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitEdit()
                          }
                          if (event.key === 'Escape') {
                            setEditingNodeId(null)
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      />
                    </div>
                  </foreignObject>
                ) : (
                    <text
                      className={`mindmap-node-label${node.title ? '' : ' is-placeholder'}`}
                      x={labelGeometry.x}
                      y={node.y + node.height / 2}
                      textAnchor={labelGeometry.textAnchor}
                      dominantBaseline="central"
                      style={{
                        ...(styleOverride?.textColor ? { fill: styleOverride.textColor } : {}),
                        ...(styleOverride?.fontFamily ? { fontFamily: styleOverride.fontFamily } : {}),
                        ...(styleOverride?.fontSize ? { fontSize: `${styleOverride.fontSize}px` } : {}),
                        ...(styleOverride?.fontWeight ? { fontWeight: styleOverride.fontWeight } : {}),
                        ...(styleOverride?.fontStyle ? { fontStyle: styleOverride.fontStyle } : {}),
                        ...(styleOverride?.textDecoration ? { textDecoration: styleOverride.textDecoration } : {}),
                        ...(styleOverride?.textTransform ? { textTransform: styleOverride.textTransform } : {})
                      }}
                    >
                    {topicNumbers.get(node.id) ? (
                      <tspan className="mindmap-node-number">{topicNumbers.get(node.id)}  </tspan>
                    ) : null}
                    {node.title || t('mindmap.untitledTopic')}
                  </text>
                )}

                {node.markers?.map((marker, index) => {
                  const position = markerBadgePosition(node, index)
                  const markerLabel = marker.label || marker.symbol
                  return (
                    <g
                      key={marker.id}
                      className="mindmap-node-marker"
                      role="img"
                      aria-label={markerLabel}
                    >
                      <title>{markerLabel}</title>
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
                    const bColor = branchColor(document.theme, node.branchIndex) ?? '#438EFF'
                    return (
                      <g
                        className="mindmap-collapse-badge"
                        onClick={(event) => {
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

                {isSelected && !isEditing ? (
                  <g className="mindmap-node-actions">
                    {isSelected && !node.collapsed ? (
                      <>
                        <circle
                          className="mindmap-node-action mindmap-node-action--add"
                          cx={node.x + node.width + 14}
                          cy={node.y + node.height / 2}
                          r={10}
                          onClick={(event) => {
                            event.stopPropagation()
                            addChild(node.id)
                          }}
                        >
                          <title>{t('mindmap.addChild')}</title>
                        </circle>
                        <text
                          className="mindmap-node-action-label mindmap-node-action-label--add"
                          x={node.x + node.width + 14}
                          y={node.y + node.height / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                        >
                          +
                        </text>
                      </>
                    ) : null}
                  </g>
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

function findTopicTitle(node: MindMapTopicV2, id: string): string | undefined {
  if (node.id === id) return node.title
  for (const child of node.children) {
    const found = findTopicTitle(child, id)
    if (found !== undefined) return found
  }
  return undefined
}
