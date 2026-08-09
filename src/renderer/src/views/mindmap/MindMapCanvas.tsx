import { useCallback, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { MindMapDocument } from '../../../../shared/mindmap/mind-map-types'
import {
  computeMindMapLayout,
  MIND_MAP_HORIZONTAL_GAP,
  MIND_MAP_NODE_WIDTH,
  type MindMapLayoutNode
} from './mind-map-layout'
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

type CanvasProps = {
  document: MindMapDocument
  activeSheetIndex: number
  onActiveSheetChange: (index: number) => void
}

const VIEW_PADDING = 48

function edgePath(from: MindMapLayoutNode, to: MindMapLayoutNode): string {
  const x1 = from.x + from.width
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y + to.height / 2
  const dx = Math.max(MIND_MAP_HORIZONTAL_GAP / 2, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

export function MindMapCanvas({ document, activeSheetIndex }: CanvasProps) {
  const selectedNodeId = useMindMapViewStore((s) => s.selectedNodeId)
  const updateNode = useMindMapViewStore((s) => s.updateNode)
  const addChild = useMindMapViewStore((s) => s.addChild)
  const deleteNode = useMindMapViewStore((s) => s.deleteNode)
  const toggleCollapse = useMindMapViewStore((s) => s.toggleCollapse)

  const sheetCount = document.sheets.length
  const safeSheetIndex = Math.min(Math.max(activeSheetIndex, 0), sheetCount - 1)
  const sheet = document.sheets[safeSheetIndex]

  const layout = useMemo(
    () => (sheet ? computeMindMapLayout(sheet) : { nodes: [], edges: [] }),
    [sheet]
  )

  const [pan, setPan] = useState<Vec2>({ x: VIEW_PADDING + MIND_MAP_NODE_WIDTH, y: VIEW_PADDING })
  const [zoom, setZoom] = useState(1)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const dragRef = useRef<{ startPointer: Vec2; startPan: Vec2; moved: boolean } | null>(null)

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
    return { left, top, right, bottom }
  }, [layout.nodes])

  const viewBox = useMemo(() => {
    const width = Math.max(1, bounds.right - bounds.left)
    const height = Math.max(1, bounds.bottom - bounds.top)
    return `0 0 ${width + VIEW_PADDING * 2} ${height + VIEW_PADDING * 2}`
  }, [bounds])

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
    setZoom((current) => Math.min(3, Math.max(0.25, current * factor)))
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

  const nodeById = useMemo(() => {
    const map = new Map<string, MindMapLayoutNode>()
    for (const node of layout.nodes) map.set(node.id, node)
    return map
  }, [layout.nodes])

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

          {layout.nodes.map((node) => {
            const isSelected = node.id === selectedNodeId
            const isHovered = node.id === hoveredNodeId
            const focused = isSelected || isHovered
            const isEditing = node.id === editingNodeId
            return (
              <g
                key={node.id}
                className={`mindmap-node-group${isSelected ? ' is-selected' : ''}`}
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