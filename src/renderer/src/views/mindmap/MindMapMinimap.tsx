import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapDocumentV2 } from '../../../../shared/mindmap/domain/types'
import { computeMindMapLayout } from './mind-map-layout'
import { branchColorForKey } from './mind-map-branch-colors'

/**
 * Minimap (overview) panel for the mind-map canvas (StudiumX-style).
 *
 * Renders a scaled-down view of the entire sheet so the user can see the full
 * structure at a glance and click to navigate.
 */
type MindMapMinimapProps = {
  document: MindMapDocumentV2
  activeSheetId: string | null
  /** Viewport rectangle in content coordinates (for the indicator box). */
  viewport?: { x: number; y: number; width: number; height: number } | null
  onNavigate?: (contentX: number, contentY: number) => void
}

const MINIMAP_WIDTH = 148
const MINIMAP_HEIGHT = 108

export function MindMapMinimap({
  document,
  activeSheetId,
  viewport,
  onNavigate
}: MindMapMinimapProps) {
  const { t } = useTranslation()
  const sheet = document.sheets.find((s) => s.id === activeSheetId) ?? document.sheets[0]

  const { nodes, nodeById, edges, bounds, scale, offset } = useMemo(() => {
    if (!sheet) return { nodes: [], nodeById: new Map(), edges: [], bounds: null, scale: 1, offset: { x: 0, y: 0 } }
    const layout = computeMindMapLayout(sheet)
    if (layout.nodes.length === 0) {
      return { nodes: [], nodeById: new Map(), edges: [], bounds: null, scale: 1, offset: { x: 0, y: 0 } }
    }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    for (const node of layout.nodes) {
      left = Math.min(left, node.x)
      top = Math.min(top, node.y)
      right = Math.max(right, node.x + node.width)
      bottom = Math.max(bottom, node.y + node.height)
    }
    const w = right - left
    const h = bottom - top
    const s = Math.min(MINIMAP_WIDTH / w, MINIMAP_HEIGHT / h)
    // Offset so the content sits centred inside the minimap box.
    const offsetX = left - (MINIMAP_WIDTH / s - w) / 2
    const offsetY = top - (MINIMAP_HEIGHT / s - h) / 2
    return {
      nodes: layout.nodes,
      nodeById: new Map(layout.nodes.map((node) => [node.id, node] as const)),
      edges: layout.edges,
      bounds: { left, top, right, bottom },
      scale: s,
      offset: { x: offsetX, y: offsetY }
    }
  }, [sheet])

  if (!sheet || nodes.length === 0) return null

  // StudiumX hides the minimap for small maps - it adds no navigation value
  // when the entire structure is already visible on the canvas.
  if (nodes.length < 5) return null

  const handleClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (!onNavigate || !bounds) return
    const rect = event.currentTarget.getBoundingClientRect()
    const minimapX = ((event.clientX - rect.left) / rect.width) * MINIMAP_WIDTH
    const minimapY = ((event.clientY - rect.top) / rect.height) * MINIMAP_HEIGHT
    // Convert minimap coordinates back to content coordinates
    const contentX = minimapX / scale + offset.x
    const contentY = minimapY / scale + offset.y
    onNavigate(contentX, contentY)
  }

  return (
    <div className="mindmap-minimap" role="navigation" aria-label={t('mindmap.minimap')}>
      <svg
        viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
        onClick={handleClick}
      >
        {edges.map((edge, i) => {
          const from = nodeById.get(edge.from)
          const to = nodeById.get(edge.to)
          if (!from || !to) return null
          const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
          const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
          const vertical = Math.abs(toCenter.y - fromCenter.y) > Math.abs(toCenter.x - fromCenter.x)
          const below = toCenter.y >= fromCenter.y
          const right = toCenter.x >= fromCenter.x
          const x1 = ((vertical ? fromCenter.x : right ? from.x + from.width : from.x) - offset.x) * scale
          const y1 = ((vertical ? (below ? from.y + from.height : from.y) : fromCenter.y) - offset.y) * scale
          const x2 = ((vertical ? toCenter.x : right ? to.x : to.x + to.width) - offset.x) * scale
          const y2 = ((vertical ? (below ? to.y : to.y + to.height) : toCenter.y) - offset.y) * scale
          return (
            <line
              key={i}
              className="mindmap-minimap__edge"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            />
          )
        })}
        {nodes.map((node) => {
          const color = node.depth === 0
            ? null
            : branchColorForKey(document.theme, node.branchKey)
          return (
            <rect
              key={node.id}
              className="mindmap-minimap__node"
              x={(node.x - offset.x) * scale}
              y={(node.y - offset.y) * scale}
              width={Math.max(2, node.width * scale)}
              height={Math.max(2, node.height * scale)}
              rx={1}
              style={color ? { fill: color } : undefined}
            />
          )
        })}
        {viewport && bounds
          ? (() => {
              // Clamp the indicator to the minimap box — the viewport is often
              // far larger than the content, and an unclamped rect renders as a
              // stray line outside the thumbnail.
              const rawX = (viewport.x - offset.x) * scale
              const rawY = (viewport.y - offset.y) * scale
              const clampedX = Math.max(0, rawX)
              const clampedY = Math.max(0, rawY)
              const clampedRight = Math.min(MINIMAP_WIDTH, rawX + viewport.width * scale)
              const clampedBottom = Math.min(MINIMAP_HEIGHT, rawY + viewport.height * scale)
              if (clampedRight - clampedX < 2 || clampedBottom - clampedY < 2) return null
              return (
                <rect
                  className="mindmap-minimap__viewport"
                  x={clampedX}
                  y={clampedY}
                  width={clampedRight - clampedX}
                  height={clampedBottom - clampedY}
                />
              )
            })()
          : null}
      </svg>
    </div>
  )
}
