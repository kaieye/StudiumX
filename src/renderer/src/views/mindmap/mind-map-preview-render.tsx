import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { MindMapCardPreview } from '../../../../shared/mindmap/mind-map-types'
import type {
  MindMapConnector,
  MindMapElementStyle,
  MindMapShape,
  MindMapSheetV2
} from '../../../../shared/mindmap/domain/types'
import { branchColorForKey } from './mind-map-branch-colors'
import {
  elementLineDashArray,
  elementOutlinePath,
  relationshipArrowMarkerMetrics,
  relationshipArrowMarkerPath,
  relationshipElementPath
} from './mind-map-element-styles'
import {
  edgeStrokeWidth,
  lineDashPattern,
  resolveEdgePath
} from './mind-map-edge-styles'
import {
  computeMindMapLayout,
  MIND_MAP_SUMMARY_BRACE_WIDTH,
  MIND_MAP_SUMMARY_RANGE_GAP,
  mindMapTopicLineHeight,
  wrapMindMapTopicTitle,
  type MindMapLayoutBoundary,
  type MindMapLayoutCallout,
  type MindMapLayoutNode,
  type MindMapLayoutRelationship,
  type MindMapLayoutResult,
  type MindMapLayoutSummary
} from './mind-map-layout'
import {
  resolveMindMapTopicTextColor,
  resolveMindMapTopicTextStyle
} from './mind-map-topic-text-style'
import { resolveEffectiveTopicStyle } from './mind-map-topic-style'
import {
  mindMapDrawingShapePath,
  mindMapShapeBounds
} from './mind-map-drawing-geometry'
import { resolveShape } from './mind-map-node-shapes'
import {
  mindMapLineShapeSupportsCurvePoint,
  resolveMindMapLineCurvePoint,
  resolveMindMapLineEndpoints,
  type MindMapCanvasLineEndpoint,
  type MindMapCanvasLineSnapTarget
} from './mind-map-line-tool'

/**
 * Home-page mind-map preview renderer.
 *
 * The gallery cards previously rendered only topic nodes plus the tree edges
 * between them. That omitted every sheet-level drawing element — free shapes,
 * free connectors, relationship arrows, brace summaries, boundaries, and
 * callouts — so a rich map could look nearly empty in its card while the
 * editor showed a busy canvas.
 *
 * This module renders the same element families the canvas paints, using the
 * identical pure geometry helpers (`mindMapDrawingShapePath`,
 * `relationshipElementPath`, `elementOutlinePath`, the summary/edge style
 * helpers, …) so the preview is a faithful, scaled snapshot of the first
 * sheet. It is deliberately static: no interaction, no hit-targets, no asset
 * images (assets stay behind the canonical read boundary). The viewBox fits
 * the union of node bounds and every element bounds so nothing is clipped.
 *
 * `MindMapHomeLibrary` and the legacy `MindMapHomeGallery` both call this so
 * the two surfaces cannot drift in what they show.
 */

const PREVIEW_PADDING = 28

/** Inset used for a free-shape label so its text stays clear of the border. */
const PREVIEW_SHAPE_LABEL_PADDING = 8

const CALLOUT_WIDTH = 192
const CALLOUT_HEIGHT = 52
const CALLOUT_GAP = 28

const SUMMARY_LABEL_GAP = 12

/** Default visual properties for a free-drawn shape preview without a style. */
const DEFAULT_SHAPE_STROKE = 'var(--mindmap-theme-line, var(--text))'
const DEFAULT_SHAPE_FILL = 'transparent'
const DEFAULT_SHAPE_STROKE_WIDTH = 2

/** Default visual properties for a free connector preview. */
const DEFAULT_CONNECTOR_STROKE = 'var(--mindmap-theme-line, var(--text))'
const DEFAULT_CONNECTOR_STROKE_WIDTH = 1.6

type MindMapCardPreviewProps = {
  preview?: MindMapCardPreview
  title: string
}

/**
 * Render the library card preview. Falls back to a centred placeholder card
 * when there is no preview or no laid-out node, preserving the previous
 * non-empty card silhouette instead of a blank chip.
 */
export function MindMapPreview({ preview, title }: MindMapCardPreviewProps): React.ReactNode {
  const sheet = useMemo<MindMapSheetV2 | null>(
    () => preview
      ? {
          id: 'preview-sheet',
          title,
          root: preview.root,
          elements: preview.elements ?? [],
          layout: preview.layout
        }
      : null,
    [preview, title]
  )
  const layout = useMemo(() => (sheet ? computeMindMapLayout(sheet) : null), [sheet])
  if (!layout || layout.nodes.length === 0) {
    return <PreviewPlaceholder title={title} />
  }
  return <MindMapPreviewSvg preview={preview!} title={title} layout={layout} />
}

/** A centred placeholder card used when a document has no preview yet. */
export function PreviewPlaceholder({ title }: { title: string }): React.ReactNode {
  return (
    <svg className="mindmap-home-card__svg" viewBox="0 0 328 204" role="img" aria-label={title}>
      <rect x="103" y="78" width="122" height="48" rx="10" fill="#fff" stroke="#438eff" strokeWidth="2" />
      <text x="164" y="103" textAnchor="middle" dominantBaseline="central" fill="#2854d8" fontSize="16" fontWeight="600">
        {title || '思维导图'}
      </text>
    </svg>
  )
}

function MindMapPreviewSvg({
  preview,
  title,
  layout
}: {
  preview: MindMapCardPreview
  title: string
  layout: MindMapLayoutResult
}) {
  const nodes = layout.nodes
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  // Free shapes (rect/ellipse/…), positioned at their stored document coords.
  const shapes = useMemo(
    () => (preview.elements ?? []).filter(
      (element): element is MindMapShape => element.type === 'shape'
    ),
    [preview.elements]
  )
  const shapeRects = useMemo(
    () => shapes.map((shape) => ({
      shape,
      rect: mindMapShapeBounds(shape.position, shape.width, shape.height)
    })),
    [shapes]
  )

  // Snap targets (topics + free shapes) used to resolve connector endpoints.
  const snapTargets = useMemo<MindMapCanvasLineSnapTarget[]>(() => {
    const targets: MindMapCanvasLineSnapTarget[] = []
    for (const node of nodes) {
      targets.push({
        id: node.id,
        kind: 'topic',
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        shape: resolveShape(node.shape)
      })
    }
    for (const { shape, rect } of shapeRects) {
      targets.push({
        id: shape.id,
        kind: 'shape',
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        shape: shape.shape
      })
    }
    return targets
  }, [nodes, shapeRects])

  const connectors = useMemo(
    () => (preview.elements ?? []).filter(
      (element): element is MindMapConnector => element.type === 'connector'
    ),
    [preview.elements]
  )
  // Resolve connector endpoint geometry the same way the canvas does: replay
  // anchored endpoints from their stored border parameter against the current
  // target bounds, and resolve a draggable curve point for curved families.
  const connectorGeometries = useMemo(() => connectors.map((connector) => {
    const from = connector.start as MindMapCanvasLineEndpoint
    const to = connector.end as MindMapCanvasLineEndpoint
    const resolved = resolveMindMapLineEndpoints(from, to, snapTargets)
    const lineShape = connector.style?.lineShape ?? 'curved'
    const curvePoint = mindMapLineShapeSupportsCurvePoint(lineShape)
      ? resolveMindMapLineCurvePoint(resolved.from, resolved.to, connector.curveControlOffset)
      : undefined
    return {
      connector,
      from: resolved.from,
      to: resolved.to,
      curvePoint,
      path: relationshipElementPath(
        resolved.from,
        resolved.to,
        lineShape,
        {
          ...(curvePoint ? { curvePoint } : {}),
          ...(connector.style?.beginArrow
            ? { beginArrow: connector.style.beginArrow }
            : {}),
          ...(connector.style?.endArrow
            ? { endArrow: connector.style.endArrow }
            : {})
        }
      )
    }
  }), [connectors, snapTargets])

  // Callout rectangles (leader + box). The canvas stacks multiple callouts on
  // the same topic by index; mirror that so a topic with several annotations
  // does not collapse them onto one another.
  const calloutRects = useMemo(() => {
    const topicCalloutIndexes = new Map<string, number>()
    const rects: Array<{ callout: MindMapLayoutCallout; topic: MindMapLayoutNode; x: number; y: number; width: number; height: number }> = []
    for (const callout of layout.callouts) {
      const topic = nodeById.get(callout.topicId)
      if (!topic) continue
      const topicCalloutIndex = topicCalloutIndexes.get(callout.topicId) ?? 0
      topicCalloutIndexes.set(callout.topicId, topicCalloutIndex + 1)
      const explicitPosition = callout.position
      const x = explicitPosition && Number.isFinite(explicitPosition.x)
        ? explicitPosition.x
        : topic.x + topic.width + CALLOUT_GAP
      const y = explicitPosition && Number.isFinite(explicitPosition.y)
        ? explicitPosition.y
        : topic.y + topicCalloutIndex * (CALLOUT_HEIGHT + 12)
      rects.push({
        callout,
        topic,
        x,
        y,
        width: CALLOUT_WIDTH,
        height: CALLOUT_HEIGHT
      })
    }
    return rects
  }, [layout.callouts, nodeById])

  // Summary brackets reuse the canvas geometry helpers. The layout projection
  // carries the covered bounds and side for each summary.
  const summaryBrackets = useMemo(() => layout.summaries.map((summary) => {
    const sourceTopicIds = summary.sourceTopicIds ?? [summary.from, summary.to]
    const sourceTopics = sourceTopicIds
      .map((topicId) => nodeById.get(topicId))
      .filter((node): node is MindMapLayoutNode => node !== undefined)
    const outputTopic = summary.summaryTopicId === undefined
      ? undefined
      : nodeById.get(summary.summaryTopicId)
    return previewSummaryBracket(summary, sourceTopics, outputTopic)
  }).filter((bracket) => bracket !== null), [layout.summaries, nodeById])

  // ViewBox: union of node bounds and every element bounds so nothing is
  // clipped. Free shapes/connectors/callouts can sit far outside the tree.
  const viewBox = useMemo(() => computeViewBox(
    nodes,
    shapeRects.map(({ rect }) => rect),
    connectorGeometries.map(({ from, to }) => ({ x: from.x, y: from.y, width: 0, height: 0, x2: to.x, y2: to.y })),
    calloutRects.map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })),
    layout.boundaries,
    summaryBrackets
  ), [nodes, shapeRects, connectorGeometries, calloutRects, layout.boundaries, summaryBrackets])

  const linePattern = preview.layout.linePattern
  const layoutDash = lineDashPattern(linePattern)
  const tapered = preview.layout.tapered === true

  // Mirror the canvas container's theme tokens so `var(--mindmap-theme-*)`
  // references inside label/text styles resolve to the document theme instead
  // of the app defaults. Without this the preview labels fall back to the page
  // font/colour and no longer match what the editor paints.
  const themeStyle = {
    ...(preview.theme.fontFamily ? { '--mindmap-theme-font': preview.theme.fontFamily } : {}),
    ...(preview.theme.textColor ? { '--mindmap-theme-text': preview.theme.textColor } : {}),
    ...(preview.theme.lineColor ? { '--mindmap-theme-line': preview.theme.lineColor } : {})
  } as CSSProperties

  return (
    <svg
      className="mindmap-home-card__svg"
      viewBox={viewBox}
      role="img"
      aria-label={title}
      style={themeStyle}
    >
      <defs>
        {renderPreviewArrowDefs()}
      </defs>
      {/* Tree edges (curved/elbow/…). Drawn first so nodes paint over them. */}
      <g className="mindmap-home-card__edges">
        {layout.edges.map((edge) => {
          const from = nodeById.get(edge.from)
          const to = nodeById.get(edge.to)
          if (!from || !to) return null
          const color = branchColorForKey(preview.theme, edge.branchKey)
          const lineStyle = preview.layout.lineStyle ?? edge.connectorStyle
          const strokeWidth = edgeStrokeWidth(to.depth, preview.layout.lineWidthScale)
          const edgeStyle: CSSProperties = color
            ? { stroke: color, strokeWidth, ...(layoutDash ? { strokeDasharray: layoutDash } : {}) }
            : { strokeWidth, ...(layoutDash ? { strokeDasharray: layoutDash } : {}) }
          if (tapered) {
            return (
              <path
                key={edge.to}
                className="mindmap-edge--tapered"
                d={taperedEdgePreviewPath(from, to, strokeWidth)}
                style={{ fill: color ?? 'var(--mindmap-theme-line, var(--accent))', stroke: 'none' }}
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
      </g>
      {/* Sheet-level boundaries (under shapes/nodes, like the canvas). */}
      <g className="mindmap-home-card__boundaries">
        {layout.boundaries.map((boundary) => renderPreviewBoundary(boundary, preview.theme))}
      </g>
      {/* Relationship connectors. */}
      <g className="mindmap-home-card__relationships">
        {layout.relationships.map((relationship) => renderPreviewRelationship(relationship, nodeById, preview.theme))}
      </g>
      {/* Free connectors. */}
      <g className="mindmap-home-card__connectors">
        {connectorGeometries.map(({ connector, path }) => renderPreviewConnector(connector, path))}
      </g>
      {/* Summary braces. */}
      <g className="mindmap-home-card__summaries">
        {summaryBrackets.map((bracket) => bracket ? renderPreviewSummary(bracket, preview.theme) : null)}
      </g>
      {/* Free shapes. */}
      <g className="mindmap-home-card__shapes">
        {shapeRects.map(({ shape, rect }) => renderPreviewShape(shape, rect))}
      </g>
      {/* Callouts. */}
      <g className="mindmap-home-card__callouts">
        {calloutRects.map((rect) => renderPreviewCallout(rect))}
      </g>
      {/* Topic nodes (last, on top). */}
      {nodes.map((node) => renderPreviewNode(node, preview.theme))}
    </svg>
  )
}

// ---- element render helpers ----

function renderPreviewNode(node: MindMapLayoutNode, theme: MindMapCardPreview['theme']): React.ReactNode {
  const fill = node.depth === 1
    ? branchColorForKey(theme, node.branchKey) ?? '#3157dd'
    : node.depth === 0
      ? '#fff'
      : '#f5f5f7'
  // Match the canvas text pipeline (theme style layers, depth-based
  // size/weight, theme font and theme text colour) so node labels read like
  // the editor at 100% zoom.
  const styleOverride = resolveEffectiveTopicStyle(node.style, theme, node.depth)
  const textStyle = resolveMindMapTopicTextStyle(node.depth, styleOverride)
  const textColor = resolveMindMapTopicTextColor(node.depth, styleOverride)
  const labelLines = wrapMindMapTopicTitle(node.title || ' ', node.width, node.depth)
  const labelLineHeight = mindMapTopicLineHeight(node.depth)
  const firstLabelLineY = node.y + node.height / 2
    - ((labelLines.length - 1) * labelLineHeight) / 2
  return (
    <g key={node.id}>
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={Math.min(10, node.height / 2)}
        fill={fill}
        stroke={node.depth === 0 ? '#438eff' : 'none'}
        strokeWidth={node.depth === 0 ? 1.5 : 0}
      />
      <text
        x={node.x + node.width / 2}
        y={firstLabelLineY}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          ...textStyle,
          fill: textColor
        }}
      >
        {labelLines.map((line, lineIndex) => (
          <tspan
            key={`${lineIndex}-${line}`}
            x={node.x + node.width / 2}
            dy={lineIndex === 0 ? 0 : labelLineHeight}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  )
}

function previewLineStyle(style: MindMapElementStyle | undefined): CSSProperties {
  const dashArray = style?.linePattern !== undefined
    ? elementLineDashArray(style.linePattern) ?? 'none'
    : style?.dashed === false
      ? 'none'
      : style?.dashed
        ? '6 4'
        : undefined
  const hasArrow = (style?.beginArrow !== undefined && style.beginArrow !== 'none')
    || (style?.endArrow !== undefined && style.endArrow !== 'none')
  return {
    ...(hasArrow ? { strokeLinecap: 'butt' as const } : {}),
    ...(style?.stroke ? { stroke: style.stroke } : {}),
    ...(style?.strokeWidth !== undefined ? { strokeWidth: style.strokeWidth } : {}),
    ...(dashArray ? { strokeDasharray: dashArray } : {})
  }
}

function renderPreviewShape(shape: MindMapShape, rect: { x: number; y: number; width: number; height: number }): React.ReactNode {
  const stroke = shape.style?.stroke ?? DEFAULT_SHAPE_STROKE
  const fill = shape.style?.fill ?? DEFAULT_SHAPE_FILL
  const styleProps: CSSProperties = {
    fill,
    stroke,
    strokeWidth: shape.style?.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH,
    ...previewLineStyle(shape.style)
  }
  // Mirror the canvas label geometry: the text lives in a foreignObject inset
  // from the shape edge (and HTML text layout, so wrapping and the theme font
  // behave exactly like the editor's in-place label).
  const labelInset = Math.min(
    PREVIEW_SHAPE_LABEL_PADDING,
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
  return (
    <g key={shape.id} className="mindmap-drawn-shape-group">
      <path
        className="mindmap-drawn-shape"
        d={mindMapDrawingShapePath(shape.shape, rect)}
        style={styleProps}
        aria-hidden="true"
      />
      {shape.label ? (
        <foreignObject
          className="mindmap-drawn-shape-label-foreign"
          x={labelRect.x}
          y={labelRect.y}
          width={labelRect.width}
          height={labelRect.height}
        >
          <div
            className="mindmap-drawn-shape-label"
            style={shapeTextStyle}
            aria-hidden="true"
          >
            {shape.label}
          </div>
        </foreignObject>
      ) : null}
    </g>
  )
}

function renderPreviewConnector(connector: MindMapConnector, path: string): React.ReactNode {
  const style: CSSProperties = {
    fill: 'none',
    stroke: connector.style?.stroke ?? DEFAULT_CONNECTOR_STROKE,
    strokeWidth: connector.style?.strokeWidth ?? DEFAULT_CONNECTOR_STROKE_WIDTH,
    ...previewLineStyle(connector.style)
  }
  return (
    <g key={connector.id} className="mindmap-drawn-line-group">
      <path
        className="mindmap-drawn-line"
        d={path}
        style={style}
        markerStart={connector.style?.beginArrow && connector.style.beginArrow !== 'none'
          ? `url(#mindmap-preview-rel-arrow-${connector.style.beginArrow})`
          : undefined}
        markerEnd={connector.style?.endArrow && connector.style.endArrow !== 'none'
          ? `url(#mindmap-preview-rel-arrow-${connector.style.endArrow})`
          : undefined}
        aria-hidden="true"
      />
      {connector.label ? (
        <text
          className="mindmap-drawn-line-label"
          x={0}
          y={0}
          style={{
            fill: connector.style?.textColor ?? 'var(--mindmap-theme-text, var(--text))',
            fontFamily: connector.style?.fontFamily ?? 'var(--mindmap-theme-font, inherit)',
            fontSize: connector.style?.fontSize ?? 12
          }}
        />
      ) : null}
    </g>
  )
}

function renderPreviewRelationship(
  relationship: MindMapLayoutRelationship,
  nodeById: Map<string, MindMapLayoutNode>,
  theme: MindMapCardPreview['theme']
): React.ReactNode {
  const from = nodeById.get(relationship.from)
  const to = nodeById.get(relationship.to)
  if (!from || !to) return null
  const path = relationshipElementPath(
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
  )
  const styleProps: CSSProperties = {
    fill: 'none',
    stroke: relationship.style?.stroke ?? branchColorForKey(theme, from.branchKey) ?? '#6b82ee',
    strokeWidth: relationship.style?.strokeWidth ?? 1.8,
    ...previewLineStyle(relationship.style)
  }
  const labelPosition = relationshipLabelPosition(from, to)
  return (
    <g key={relationship.id} className="mindmap-relationship-group">
      <path
        className="mindmap-relationship"
        d={path}
        style={styleProps}
        markerStart={relationship.style?.beginArrow && relationship.style.beginArrow !== 'none'
          ? `url(#mindmap-preview-rel-arrow-${relationship.style.beginArrow})`
          : undefined}
        markerEnd={relationship.style?.endArrow && relationship.style.endArrow !== 'none'
          ? `url(#mindmap-preview-rel-arrow-${relationship.style.endArrow})`
          : undefined}
        aria-hidden="true"
      />
      {relationship.label ? (
        <text
          className="mindmap-relationship-label"
          x={labelPosition.x}
          y={labelPosition.y}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fill: relationship.style?.textColor ?? 'var(--mindmap-theme-text, var(--text))',
            fontFamily: relationship.style?.fontFamily ?? 'var(--mindmap-theme-font, inherit)',
            fontSize: relationship.style?.fontSize ?? 12
          }}
        >
          {relationship.label}
        </text>
      ) : null}
    </g>
  )
}

function renderPreviewCallout(rect: {
  callout: MindMapLayoutCallout
  topic: MindMapLayoutNode
  x: number
  y: number
  width: number
  height: number
}): React.ReactNode {
  const leaderPath = calloutLeaderPath(rect)
  const styleProps: CSSProperties = {
    fill: rect.callout.style?.fill ?? '#fff',
    stroke: rect.callout.style?.stroke ?? '#8E8E93',
    strokeWidth: rect.callout.style?.strokeWidth ?? 1.4,
    ...previewLineStyle(rect.callout.style)
  }
  const leaderStyle: CSSProperties = {
    fill: 'none',
    stroke: rect.callout.style?.stroke ?? '#8E8E93',
    strokeWidth: rect.callout.style?.strokeWidth ?? 1.4,
    ...previewLineStyle(rect.callout.style)
  }
  return (
    <g key={rect.callout.id} className="mindmap-callout-group">
      <path className="mindmap-callout-leader" d={leaderPath} style={leaderStyle} aria-hidden="true" />
      <path
        className="mindmap-callout"
        d={elementOutlinePath({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, rect.callout.style?.outlineShape)}
        style={styleProps}
      />
      <text
        className="mindmap-callout-text"
        x={rect.x + rect.width / 2}
        y={rect.y + rect.height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fill: rect.callout.style?.textColor ?? 'var(--mindmap-theme-text, var(--text))',
          fontFamily: rect.callout.style?.fontFamily ?? 'var(--mindmap-theme-font, inherit)',
          fontSize: rect.callout.style?.fontSize ?? 12
        }}
      >
        {rect.callout.text || ' '}
      </text>
    </g>
  )
}

type PreviewSummaryBracket = {
  summary: MindMapLayoutSummary
  side: MindMapLayoutSummary['side']
  branchKey: string
  x: number
  y: number
  bottom: number
  labelX: number
  labelY: number
} | null

function previewSummaryBracket(
  summary: MindMapLayoutSummary,
  sourceTopics: readonly MindMapLayoutNode[],
  _outputTopic?: MindMapLayoutNode
): PreviewSummaryBracket {
  if (sourceTopics.length === 0) return null
  const from = sourceTopics[0]!
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
    branchKey: from.branchKey,
    x,
    y,
    bottom,
    labelX: summary.side === 'left' ? x - SUMMARY_LABEL_GAP : x + SUMMARY_LABEL_GAP,
    labelY: (y + bottom) / 2
  }
}

function renderPreviewSummary(bracket: NonNullable<PreviewSummaryBracket>, theme: MindMapCardPreview['theme']): React.ReactNode {
  const { summary, side, branchKey, x, y, bottom, labelX, labelY } = bracket
  const height = Math.max(16, bottom - y)
  const horizontalDirection = side === 'left' ? -1 : 1
  const shoulderX = x + horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.62
  const pointX = x + horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH
  const upperY = y + height * 0.24
  const lowerY = bottom - height * 0.24
  const pointControlY = Math.max(6, height * 0.13)
  const path = [
    `M ${x} ${y}`,
    `C ${x + horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.5} ${y}, ${shoulderX} ${y + height * 0.08}, ${shoulderX} ${upperY}`,
    `C ${shoulderX} ${y + height * 0.4}, ${pointX - horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.35} ${y + height / 2 - pointControlY}, ${pointX} ${y + height / 2}`,
    `C ${pointX - horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.35} ${y + height / 2 + pointControlY}, ${shoulderX} ${bottom - height * 0.4}, ${shoulderX} ${lowerY}`,
    `C ${shoulderX} ${bottom - height * 0.08}, ${x + horizontalDirection * MIND_MAP_SUMMARY_BRACE_WIDTH * 0.5} ${bottom}, ${x} ${bottom}`
  ].join(' ')
  const strokeColor = summary.style?.stroke ?? branchColorForKey(theme, branchKey) ?? '#6b82ee'
  const styleProps: CSSProperties = {
    fill: 'none',
    stroke: strokeColor,
    strokeWidth: summary.style?.strokeWidth ?? edgeStrokeWidth(1, undefined),
    ...previewLineStyle(summary.style)
  }
  return (
    <g key={summary.id} className="mindmap-summary-group">
      <path className="mindmap-summary-brace" d={path} style={styleProps} aria-hidden="true" />
      {summary.summaryTopicId === undefined && summary.label ? (
        <text
          className="mindmap-summary-label"
          x={labelX}
          y={labelY}
          textAnchor={side === 'left' ? 'end' : 'start'}
          dominantBaseline="central"
          style={{
            fill: summary.style?.textColor ?? 'var(--mindmap-theme-text, var(--text))',
            fontFamily: summary.style?.fontFamily ?? 'var(--mindmap-theme-font, inherit)',
            fontSize: summary.style?.fontSize ?? 12
          }}
        >
          {summary.label}
        </text>
      ) : null}
    </g>
  )
}

function renderPreviewBoundary(boundary: MindMapLayoutBoundary, theme: MindMapCardPreview['theme']): React.ReactNode {
  const bColor = boundary.style?.stroke ?? branchColorForKey(theme, '0') ?? '#8E8E93'
  const styleProps: CSSProperties = {
    stroke: bColor,
    strokeWidth: boundary.style?.strokeWidth ?? 1.5,
    strokeDasharray: boundary.style?.linePattern !== undefined
      ? elementLineDashArray(boundary.style.linePattern) ?? 'none'
      : boundary.style?.dashed === true ? '5 4' : 'none',
    fill: boundary.style?.fill ?? bColor,
    fillOpacity: boundary.style?.fill ? 1 : 0.06
  }
  return (
    <g key={boundary.id} className="mindmap-boundary-group">
      <path
        className="mindmap-boundary"
        d={elementOutlinePath({ x: boundary.x, y: boundary.y, width: boundary.width, height: boundary.height }, boundary.style?.outlineShape)}
        style={styleProps}
      />
      {boundary.label ? (
        <text
          className="mindmap-boundary-label"
          x={boundary.x + 10}
          y={boundary.y + 16}
          style={{
            fill: boundary.style?.textColor ?? 'var(--mindmap-theme-text, var(--text))',
            fontFamily: boundary.style?.fontFamily ?? 'var(--mindmap-theme-font, inherit)',
            fontSize: boundary.style?.fontSize ?? 12
          }}
        >
          {boundary.label}
        </text>
      ) : null}
    </g>
  )
}

function renderPreviewArrowDefs(): React.ReactNode {
  const arrows = [
    'dot', 'triangle', 'spearhead', 'square', 'diamond',
    'herringbone', 'double-arrow', 'anti-triangle', 'attached', 'hook'
  ] as const
  return arrows.map((arrow) => {
    const markerPath = relationshipArrowMarkerPath(arrow)
    const markerMetrics = relationshipArrowMarkerMetrics(arrow)
    if (!markerPath || !markerMetrics) return null
    return (
      <marker
        key={arrow}
        id={`mindmap-preview-rel-arrow-${arrow}`}
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
  })
}

// ---- geometry helpers (mirror the canvas, kept local to the preview) ----

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

function calloutLeaderPath(rect: {
  topic: MindMapLayoutNode
  x: number
  y: number
  width: number
  height: number
}): string {
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

/**
 * Filled tapered edge polygon for the tapered tree-edge preview. A thin local
 * copy of the canvas's `taperedEdgePath` keeps this module free of canvas-only
 * dependencies while producing the identical silhouette.
 */
function taperedEdgePreviewPath(
  from: MindMapLayoutNode,
  to: MindMapLayoutNode,
  startWidth: number
): string {
  const w1 = Math.max(0.5, startWidth)
  const w2 = Math.max(0.5, startWidth * 0.45)
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height / 2
  const x2 = to.x + to.width / 2
  const y2 = to.y + to.height / 2
  const dx = Math.max(24, Math.abs(x2 - x1))
  const dy = Math.max(24, Math.abs(y2 - y1))
  const axis = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? 'horizontal' : 'vertical'
  if (axis === 'vertical') {
    const control = Math.min(36, dy / 2)
    const dir = y2 >= y1 ? 1 : -1
    const topStart = x1 - w1 / 2
    const topEnd = x2 - w2 / 2
    const bottomStart = x1 + w1 / 2
    const bottomEnd = x2 + w2 / 2
    return (
      `M ${topStart} ${y1} ` +
      `C ${topStart} ${y1 + dir * control}, ${topEnd} ${y2 - dir * control}, ${topEnd} ${y2} ` +
      `L ${bottomEnd} ${y2} ` +
      `C ${bottomEnd} ${y2 - dir * control}, ${bottomStart} ${y1 + dir * control}, ${bottomStart} ${y1} ` +
      'Z'
    )
  }
  const control = Math.min(36, dx / 2)
  const dir = x2 >= x1 ? 1 : -1
  const topStart = y1 - w1 / 2
  const topEnd = y2 - w2 / 2
  const bottomStart = y1 + w1 / 2
  const bottomEnd = y2 + w2 / 2
  return (
    `M ${x1} ${topStart} ` +
    `C ${x1 + dir * control} ${topStart}, ${x2 - dir * control} ${topEnd}, ${x2} ${topEnd} ` +
    `L ${x2} ${bottomEnd} ` +
    `C ${x2 - dir * control} ${bottomEnd}, ${x1 + dir * control} ${bottomStart}, ${x1} ${bottomStart} ` +
    'Z'
  )
}

type RectLike = { x: number; y: number; width: number; height: number }
type ConnectorEndpointLike = { x: number; y: number; x2: number; y2: number }

function computeViewBox(
  nodes: readonly MindMapLayoutNode[],
  shapeRects: readonly RectLike[],
  connectorEndpoints: readonly ConnectorEndpointLike[],
  calloutRects: readonly RectLike[],
  boundaries: readonly MindMapLayoutBoundary[],
  summaryBrackets: readonly PreviewSummaryBracket[]
): string {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const expand = (x: number, y: number, x2: number, y2: number): void => {
    if (Number.isFinite(x)) minX = Math.min(minX, x)
    if (Number.isFinite(y)) minY = Math.min(minY, y)
    if (Number.isFinite(x2)) maxX = Math.max(maxX, x2)
    if (Number.isFinite(y2)) maxY = Math.max(maxY, y2)
  }
  for (const node of nodes) expand(node.x, node.y, node.x + node.width, node.y + node.height)
  for (const rect of shapeRects) expand(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)
  for (const endpoint of connectorEndpoints) {
    expand(endpoint.x, endpoint.y, endpoint.x, endpoint.y)
    expand(endpoint.x2, endpoint.y2, endpoint.x2, endpoint.y2)
  }
  for (const rect of calloutRects) expand(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)
  for (const boundary of boundaries) {
    expand(boundary.x, boundary.y, boundary.x + boundary.width, boundary.y + boundary.height)
  }
  for (const bracket of summaryBrackets) {
    if (!bracket) continue
    const bx = bracket.x - MIND_MAP_SUMMARY_BRACE_WIDTH
    const bx2 = bracket.x + MIND_MAP_SUMMARY_BRACE_WIDTH
    expand(bx, bracket.y, bx2, bracket.bottom)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    minX = 0
    minY = 0
    maxX = 180
    maxY = 120
  }
  const width = Math.max(180, maxX - minX + PREVIEW_PADDING * 2)
  const height = Math.max(120, maxY - minY + PREVIEW_PADDING * 2)
  return `${minX - PREVIEW_PADDING} ${minY - PREVIEW_PADDING} ${width} ${height}`
}
