import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { StickyNote, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapDocumentV2, MindMapImageElement, MindMapImagePlacement, MindMapMarker, MindMapSheetV2, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapCommand } from '../../../../shared/mindmap/commands'
import { classifyExternalDestination } from '../../../../shared/external-destination'
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
import { useAppStore } from '../../app-shell/appStore'
import { hasMindMapTopicMarkdown, renderMarkdownInlineHtml } from '../../markdown-preview'
import { computeAllTopicNumbers } from './mind-map-numbering'
import { selectMindMapNodesInRectangle } from '../../../../shared/mindmap/domain/selection'
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
  // A summary brace spans the centres of every covered source topic, rather
  // than their outer bounds, matching the visual rhythm of branch lines.
  const y = Math.min(...sourceTopics.map((topic) => topic.y + topic.height / 2))
  const bottom = Math.max(...sourceTopics.map((topic) => topic.y + topic.height / 2))
  const x = Math.max(...sourceTopics.map((topic) => topic.x + topic.width))
    + MIND_MAP_SUMMARY_RANGE_GAP
  return {
    summary,
    from,
    to,
    sourceTopics,
    outputTopic,
    x,
    y,
    bottom,
    labelX: x + SUMMARY_LABEL_GAP,
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
  const shoulderX = bracket.x + MIND_MAP_SUMMARY_BRACE_WIDTH * 0.62
  return {
    height,
    middle: bracket.y + height / 2,
    shoulderX,
    // Keep the acute point inside the brace envelope. It should read as a
    // compact flower-brace point, never as a separate oversized connector.
    pointX: bracket.x + MIND_MAP_SUMMARY_BRACE_WIDTH,
    upperY: bracket.y + height * 0.24,
    lowerY: bracket.bottom - height * 0.24
  }
}

function summaryPath(bracket: MindMapSummaryBracket): string {
  const { height, middle, shoulderX, pointX, upperY, lowerY } = summaryBraceGeometry(bracket)
  const pointControlY = Math.max(6, height * 0.13)
  return [
    `M ${bracket.x} ${bracket.y}`,
    `C ${bracket.x + MIND_MAP_SUMMARY_BRACE_WIDTH * 0.5} ${bracket.y}, ${shoulderX} ${bracket.y + height * 0.08}, ${shoulderX} ${upperY}`,
    // Different incoming/outgoing tangents make the centre a deliberate sharp
    // point while keeping the two brace arms gently curved.
    `C ${shoulderX} ${bracket.y + height * 0.4}, ${pointX - MIND_MAP_SUMMARY_BRACE_WIDTH * 0.35} ${middle - pointControlY}, ${pointX} ${middle}`,
    `C ${pointX - MIND_MAP_SUMMARY_BRACE_WIDTH * 0.35} ${middle + pointControlY}, ${shoulderX} ${bracket.bottom - height * 0.4}, ${shoulderX} ${lowerY}`,
    `C ${shoulderX} ${bracket.bottom - height * 0.08}, ${bracket.x + MIND_MAP_SUMMARY_BRACE_WIDTH * 0.5} ${bracket.bottom}, ${bracket.x} ${bracket.bottom}`
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

export function MindMapCanvas({ document, activeSheetIndex, viewportAction, onZoomChange, onViewportChange, onContextMenu, onMoveNode, onOpenNote }: CanvasProps) {
  const { t } = useTranslation()
  const openExternal = useAppStore((state) => state.openExternal)
  const workspaceId = useAppStore((state) => state.appState?.activeWorkspace?.id ?? null)
  const selection = useMindMapViewStore((s) => s.selection)
  const selectedNodeId = useMindMapViewStore((s) => s.selectedNodeId)
  const selectTopic = useMindMapViewStore((s) => s.selectTopic)
  const setTopicSelection = useMindMapViewStore((s) => s.setTopicSelection)
  const selectElement = useMindMapViewStore((s) => s.selectElement)
  const selectCanvas = useMindMapViewStore((s) => s.selectCanvas)
  const editingNodeId = useMindMapViewStore((s) => s.editingNodeId)
  const setEditingNodeId = useMindMapViewStore((s) => s.setEditingNodeId)
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
  // matches the on-screen pixel dimensions (Xmind model).  This prevents the
  // old behaviour where a single-node map was stretched to fill the viewport.
  const containerRef = useRef<HTMLDivElement | null>(null)
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
      const { pointX } = summaryBraceGeometry(summary)
      left = Math.min(left, summary.x)
      top = Math.min(top, summary.y)
      right = Math.max(right, pointX)
      bottom = Math.max(bottom, summary.bottom)
      if (!summary.outputTopic) {
        right = Math.max(right, summary.labelX + SUMMARY_LABEL_WIDTH)
      }
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
  useLayoutEffect(() => {
    if (!hasMeasuredContainer || !sheet || centeredDocRef.current === documentId) return
    if (layout.nodes.length === 0) return
    centeredDocRef.current = documentId
    const next = fitMindMapViewport(bounds, viewportSize)
    setPan(next.pan)
    setZoom(next.zoom)
  }, [documentId, hasMeasuredContainer, sheet, layout.nodes, bounds, viewportSize])

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

  const svgPointFromPointer = (event: ReactPointerEvent<SVGSVGElement>): Vec2 => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const startPointerDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (editingNodeId || nodeResizeState) return
    lastNodePointerDownRef.current = null
    const startSvg = svgPointFromPointer(event)
    // A primary-button drag on the empty canvas is a marquee selection.  Keep
    // middle-button (and other non-primary pointers) as the existing pan
    // gesture so users can still move the viewport without changing the
    // current selection.
    const kind = event.button === 0 || event.button === undefined ? 'box' : 'pan'
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

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
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
    const drag = dragRef.current
    const isBackground = event.target === event.currentTarget
    if (drag?.kind === 'box' && drag.moved) {
      const endSvg = svgPointFromPointer(event)
      const left = Math.min(drag.startSvg.x, endSvg.x)
      const top = Math.min(drag.startSvg.y, endSvg.y)
      const right = Math.max(drag.startSvg.x, endSvg.x)
      const bottom = Math.max(drag.startSvg.y, endSvg.y)
      const ids = selectMindMapNodesInRectangle(
        layout.nodes.map((node) => ({
          id: node.id,
          x: pan.x + node.x * zoom,
          y: pan.y + node.y * zoom,
          width: node.width * zoom,
          height: node.height * zoom
        })),
        { left, top, right, bottom }
      )
      setTopicSelection(ids, drag.additive)
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

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault()
    // Ctrl/Cmd + wheel (trackpad pinch) still zooms; a plain wheel scrolls the
    // canvas instead. This matches the requested Xmind-style interaction where
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

  const beginEdit = (nodeId: string, initial: string): void => {
    selectTopic(nodeId, false)
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

  // --- Node resize interaction ---

  const startNodeResize = (
    node: MindMapLayoutNode,
    edge: 'left' | 'right',
    event: ReactPointerEvent<SVGGElement>
  ): void => {
    if (editingNodeId || nodeDragState) return
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
    if (editingNodeId) return
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
        onPointerMove={(e) => { onPointerMove(e); updateNodeDrag(e); updateNodeResize(e); updateImageDrag(e); updateImageResize(e) }}
        onPointerUp={(e) => { endPointerDrag(e); endNodeDrag(); endNodeResize(e); endImageDrag(e); endImageResize() }}
        onPointerLeave={(e) => { endPointerDrag(e); endNodeDrag(); endNodeResize(e); endImageDrag(e); endImageResize() }}
        onPointerCancel={(e) => { endPointerDrag(e); endNodeDrag(); endNodeResize(e); endImageDrag(e); endImageResize() }}
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
            const color = branchColorForKey(document.theme, edge.branchKey)
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
            const rootNode = layout.nodes[0] ?? node
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
                className={`mindmap-node-group${isSelected ? ' is-selected' : ''}${depthClass}${nodeDragState?.draggingId === node.id ? ' is-dragging' : ''}${nodeDragState?.dropTargetId === node.id ? ' is-drop-target' : ''}${nodeResizeState?.nodeId === node.id ? ' is-resizing' : ''}`}
                data-depth={node.depth}
                data-node-id={node.id}
                role="button"
                tabIndex={isPrimarySelection ? 0 : -1}
                style={{ outline: 'none' }}
                aria-label={node.title || t('mindmap.untitledTopic')}
                aria-pressed={isSelected}
                onPointerDown={(event) => {
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
                  // without a Command key and mirrors XMind's range-select
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
                    beginEdit(node.id, node.title)
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
                  if (onContextMenu) {
                    event.preventDefault()
                    onContextMenu(node.id, event.clientX, event.clientY)
                  }
                }}
                onPointerDownCapture={(event) => {
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
                  event.stopPropagation()
                  if (!isEditing) beginEdit(node.id, node.title)
                }}
              >
                {(() => {
                  const elem = shapeElement(node, shape)
                  const branchInk = branchColorForKey(document.theme, node.branchKey)
                  const bColor = node.depth === 1 ? branchInk : null
                  // Xmind Snowbrush look: first-level branches are solid chips
                  // in the branch colour with no border; deeper topics use the
                  // quiet grey fill from the stylesheet.
                  const fill = styleOverride?.fill
                    ?? (node.depth === 1 && bColor ? bColor : undefined)
                  // Selection/focus is rendered on ordinary topic shapes.
                  // Underlines stay in branch ink because they are connectors,
                  // not independently highlighted node borders.
                  const focusStroke = !isEditing && isSelected && shape !== 'underline'
                    ? 'var(--mm-focus)'
                    : undefined
                  const borderStyle = styleOverride?.borderStyle
                  const stroke = focusStroke
                    ?? (borderStyle === 'none' ? 'none' : styleOverride?.stroke)
                    ?? (borderStyle ? 'var(--mindmap-theme-line, #8E8E93)' : undefined)
                    // The underline is part of the branch, so its default ink
                    // must match the incoming/outgoing edge rather than the
                    // transparent branch-chip border default.
                    ?? (shape === 'underline' ? branchInk : undefined)
                    ?? (node.depth === 1 ? 'none' : undefined)
                  const styleProps: Record<string, string | number> = {}
                  if (fill) styleProps.fill = fill
                  if (stroke) styleProps.stroke = stroke
                  if (focusStroke) {
                    styleProps.strokeWidth = isSelected ? 2 : 1.5
                    styleProps.strokeDasharray = 'none'
                    styleProps.filter = 'none'
                  } else {
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
                      tabIndex={0}
                      aria-label={actionLabel}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        event.preventDefault()
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        action.onOpen?.(node.id)
                      }}
                      onKeyDown={(event) => {
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
                      <textarea
                        className="mindmap-node-input"
                        value={editValue}
                        rows={Math.max(1, labelLines.length)}
                        autoFocus
                        style={{
                          ...topicTextStyle,
                          color: topicTextColor,
                          lineHeight: 1,
                          textAlign
                        }}
                        onFocus={(event) => event.target.select()}
                        onChange={(event) => setEditValue(event.currentTarget.value)}
                        onBlur={commitEdit}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault()
                            commitEdit()
                          }
                          if (event.key === 'Escape') {
                            setEditingNodeId(null)
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
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
                          tabIndex={0}
                          aria-label={t('mindmap.addChild')}
                          onPointerDown={(event) => {
                            event.stopPropagation()
                            event.preventDefault()
                          }}
                          onClick={(event) => {
                            event.stopPropagation()
                            addChild(node.id)
                          }}
                          onKeyDown={(event) => {
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
                tabIndex={isSelected ? 0 : -1}
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
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
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
