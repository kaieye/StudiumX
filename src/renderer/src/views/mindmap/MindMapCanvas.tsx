import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapDocumentV2, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import {
  computeMindMapLayout,
  MIND_MAP_HORIZONTAL_GAP,
  MIND_MAP_NODE_WIDTH,
  type MindMapLayoutCallout,
  type MindMapLayoutNode,
  type MindMapLayoutRelationship,
  type MindMapLayoutSummary
} from './mind-map-layout'
import {
  centerMindMapViewport,
  fitMindMapViewport,
  MAX_MIND_MAP_ZOOM,
  MIN_MIND_MAP_ZOOM,
  zoomMindMapViewport
} from './mind-map-viewport'
import { useMindMapViewStore } from './mind-map-view-store'

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
  type: 'fit' | 'actual' | 'center'
}

type CanvasProps = {
  document: MindMapDocumentV2
  activeSheetIndex: number
  onActiveSheetChange: (index: number) => void
  viewportAction?: MindMapCanvasViewportAction | null
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

function edgePath(from: MindMapLayoutNode, to: MindMapLayoutNode): string {
  const x1 = from.x + from.width
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y + to.height / 2
  const dx = Math.max(MIND_MAP_HORIZONTAL_GAP / 2, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/**
 * Relationship connectors may point in either direction, unlike tree edges
 * which always leave a parent on the same side. Pick the nearest horizontal
 * edge of each topic so left-facing and balanced sheets remain legible.
 */
function relationshipPath(from: MindMapLayoutNode, to: MindMapLayoutNode): string {
  const toRight = to.x >= from.x
  const x1 = toRight ? from.x + from.width : from.x
  const y1 = from.y + from.height / 2
  const x2 = toRight ? to.x : to.x + to.width
  const y2 = to.y + to.height / 2
  const direction = toRight ? 1 : -1
  const dx = Math.max(MIND_MAP_HORIZONTAL_GAP / 2, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + direction * dx} ${y1}, ${x2 - direction * dx} ${y2}, ${x2} ${y2}`
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

export function MindMapCanvas({ document, activeSheetIndex, viewportAction }: CanvasProps) {
  const { t } = useTranslation()
  const selectedNodeId = useMindMapViewStore((s) => s.selectedNodeId)
  const editingNodeId = useMindMapViewStore((s) => s.editingNodeId)
  const setEditingNodeId = useMindMapViewStore((s) => s.setEditingNodeId)
  const updateNode = useMindMapViewStore((s) => s.updateNode)
  const addChild = useMindMapViewStore((s) => s.addChild)
  const deleteNode = useMindMapViewStore((s) => s.deleteNode)
  const toggleCollapse = useMindMapViewStore((s) => s.toggleCollapse)

  const sheetCount = document.sheets.length
  const safeSheetIndex = Math.min(Math.max(activeSheetIndex, 0), sheetCount - 1)
  const sheet = document.sheets[safeSheetIndex]

  const layout = useMemo(
    () => (sheet
      ? computeMindMapLayout(sheet)
      : { nodes: [], edges: [], relationships: [], callouts: [], summaries: [] }),
    [sheet]
  )

  const nodeById = useMemo(() => {
    const map = new Map<string, MindMapLayoutNode>()
    for (const node of layout.nodes) map.set(node.id, node)
    return map
  }, [layout.nodes])

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

  const [pan, setPan] = useState<Vec2>({ x: VIEW_PADDING + MIND_MAP_NODE_WIDTH, y: VIEW_PADDING })
  const [zoom, setZoom] = useState(1)
  const [editValue, setEditValue] = useState('')
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const dragRef = useRef<{ startPointer: Vec2; startPan: Vec2; moved: boolean } | null>(null)
  const handledViewportActionIdRef = useRef<number | null>(null)

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

  const viewBox = useMemo(() => {
    const width = Math.max(1, bounds.right - bounds.left)
    const height = Math.max(1, bounds.bottom - bounds.top)
    return `0 0 ${width + VIEW_PADDING * 2} ${height + VIEW_PADDING * 2}`
  }, [bounds])

  const viewportSize = useMemo(
    () => ({
      width: Math.max(1, bounds.right - bounds.left + VIEW_PADDING * 2),
      height: Math.max(1, bounds.bottom - bounds.top + VIEW_PADDING * 2)
    }),
    [bounds]
  )

  useEffect(() => {
    if (!viewportAction || handledViewportActionIdRef.current === viewportAction.id) return
    handledViewportActionIdRef.current = viewportAction.id

    if (viewportAction.type === 'fit') {
      const next = fitMindMapViewport(bounds, viewportSize, VIEW_PADDING)
      setPan(next.pan)
      setZoom(next.zoom)
      return
    }

    const next = centerMindMapViewport(
      bounds,
      viewportSize,
      viewportAction.type === 'actual' ? 1 : zoom
    )
    setPan(next.pan)
    setZoom(next.zoom)
  }, [bounds, viewportAction, viewportSize, zoom])

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
      useMindMapViewStore.setState({ selectedNodeId: null })
    }
    dragRef.current = null
  }

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    const rect = event.currentTarget.getBoundingClientRect()
    const pointer = {
      x: rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * viewportSize.width : viewportSize.width / 2,
      y: rect.height > 0 ? ((event.clientY - rect.top) / rect.height) * viewportSize.height : viewportSize.height / 2
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
    (nodeId: string) => {
      useMindMapViewStore.setState({ selectedNodeId: nodeId })
    },
    []
  )

  if (!sheet || layout.nodes.length === 0) {
    return (
      <div className="mindmap-canvas mindmap-canvas--empty" role="status">
        <p>—</p>
      </div>
    )
  }

  return (
    <div className="mindmap-canvas">
      <svg
        className="mindmap-svg"
        viewBox={viewBox}
        role="img"
        aria-label={sheet.title}
        onPointerDown={startPointerDrag}
        onPointerMove={onPointerMove}
        onPointerUp={endPointerDrag}
        onPointerLeave={endPointerDrag}
        onWheel={onWheel}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {layout.edges.map((edge) => {
            const from = nodeById.get(edge.from)
            const to = nodeById.get(edge.to)
            if (!from || !to) return null
            return <path key={edge.to} className="mindmap-edge" d={edgePath(from, to)} />
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
                className="mindmap-relationship-group"
                aria-label={relationship.label || endpointLabel}
              >
                <path
                  className="mindmap-relationship"
                  d={relationshipPath(from, to)}
                  aria-hidden="true"
                >
                  <title>{relationship.label || endpointLabel}</title>
                </path>
                {relationship.label ? (
                  <text
                    className="mindmap-relationship-label"
                    x={labelPosition.x}
                    y={labelPosition.y}
                    textAnchor="middle"
                  >
                    {relationship.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {calloutRects.map((rect) => (
            <g
              key={rect.callout.id}
              className="mindmap-callout-group"
              role="note"
              aria-label={rect.callout.text}
            >
              <path
                className="mindmap-callout-leader"
                d={calloutLeaderPath(rect)}
                aria-hidden="true"
              />
              <rect
                className="mindmap-callout"
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                rx={10}
              />
              <text
                className="mindmap-callout-text"
                x={rect.x + rect.width / 2}
                y={rect.y + rect.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
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

            return (
              <g
                key={bracket.summary.id}
                className="mindmap-summary-group"
                role="img"
                aria-label={label}
              >
                <path
                  className="mindmap-summary-brace"
                  d={summaryPath(bracket)}
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
                  >
                    {bracket.summary.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {layout.nodes.map((node) => {
            const isSelected = node.id === selectedNodeId
            const isHovered = node.id === hoveredNodeId
            const focused = isSelected || isHovered
            const isEditing = node.id === editingNodeId
            return (
              <g
                key={node.id}
                className={`mindmap-node-group${isSelected ? ' is-selected' : ''}`}
                role="button"
                tabIndex={isSelected ? 0 : -1}
                aria-label={node.title || t('mindmap.untitledTopic')}
                aria-pressed={isSelected}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  dragRef.current = null
                  beginNodeAction(node.id)
                }}
                onDoubleClick={() => beginEdit(node.id, node.title)}
                onPointerEnter={() => setHoveredNodeId(node.id)}
                onPointerLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
              >
                <rect
                  className="mindmap-node-rect"
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={10}
                />
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
                    className="mindmap-node-label"
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {node.title || ' '}
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
                  <text
                    className="mindmap-collapse-badge"
                    x={node.x + node.width}
                    y={node.y + node.height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleCollapse(node.id)
                    }}
                  >
                    +
                  </text>
                ) : null}

                {focused && !isEditing ? (
                  <g className="mindmap-node-actions">
                    <circle
                      className="mindmap-node-action"
                      cx={node.x + node.width / 2}
                      cy={node.y - 12}
                      r={9}
                      onClick={(event) => {
                        event.stopPropagation()
                        addChild(node.id)
                      }}
                    >
                      <title>+ child</title>
                    </circle>
                    <text
                      className="mindmap-node-action-label"
                      x={node.x + node.width / 2}
                      y={node.y - 12}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      +
                    </text>
                    <circle
                      className="mindmap-node-action mindmap-node-action--danger"
                      cx={node.x + node.width / 2}
                      cy={node.y + node.height + 12}
                      r={9}
                      onClick={(event) => {
                        event.stopPropagation()
                        deleteNode(node.id)
                      }}
                    />
                    <text
                      className="mindmap-node-action-label mindmap-node-action-label--danger"
                      x={node.x + node.width / 2}
                      y={node.y + node.height + 12}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      ×
                    </text>
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
