import type {
  MindMapStructureClass
} from '../../../../shared/mindmap/mind-map-types'
import {
  getConnectorStyle,
  getLayoutGeometry,
  type LayoutGeometry,
  type MindMapConnectorStyle
} from '../../../../shared/mindmap/structure-types'
import type {
  MindMapBoundary,
  MindMapCallout,
  MindMapElementStyle,
  MindMapImageElement,
  MindMapImagePlacement,
  MindMapMarker,
  MindMapSheetV2,
  MindMapSummary,
  MindMapTextSpan,
  MindMapTheme,
  MindMapTopicStyleOverride,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'
import { mindMapTopicDisplayTitle } from './mind-map-topic-markdown'
import { resolveEffectiveTopicStyle } from './mind-map-topic-style'

/**
 * Pure, deterministic O(n) tree layout for a v2 mind-map sheet.
 *
 * This module has no React / DOM / IPC dependencies so it can be unit-tested
 * in isolation. The layout reads the sheet's `layout.structureClass` to decide
 * the direction children spread from their parent:
 *
 * - `…right`  - all children to the right (+x)
 * - `…left`   - all children to the left (−x)
 * - `…balanced` / `…map` - children alternate right/left so the tree spreads
 *   across both sides of the root (this is the default for new sheets)
 * - `…down` / `…up` - children are placed below/above the parent
 *
 * For the horizontal structures (right / left / balanced / map) the children of
 * a node are vertically centered around the parent's midline so the subtree
 * spreads symmetrically above and below the parent.  For two-sided structures
 * (balanced / map) the left-side and right-side groups are centered
 * independently, matching StudiumX's layout at every depth.
 *
 * `collapsed` nodes are still emitted (rendered with a collapse badge) but their
 * descendants are not visited, so collapse hides the subtree with no reflow cost.
 *
 * Node dimensions auto-size to the title text (matching StudiumX), while branch
 * indices are computed for per-branch colour assignment.
 */

// ---- text measurement (pure, no DOM) ----
//
// v2 §4.2: Font sizes follow StudiumX M01's 2 : 1.43 : 1 tier ratio (28/20/14pt)
// scaled to a 100%-zoom-friendly density:
//   depth 0 (root):   26px/600 → CJK ≈ 26, ASCII ≈ 13.5
//   depth 1 (branch): 16px/500 → CJK ≈ 16, ASCII ≈ 8.5
//   deeper:           13px/500 → CJK ≈ 13, ASCII ≈ 7
// The measurement constants MUST stay in sync with the font-size values in
// mindmap.css (v2 canvas section). If you change one, change the other.
//
// Line wrapping budgets {@link MIND_MAP_TOPIC_LABEL_GUTTER}, the horizontal
// padding of the foreignObject labels (`.mindmap-node-input-wrap` and
// `.mindmap-node-markdown-label` in mindmap.css), so the SVG tspan lines, the
// markdown label and the inline editor all break at the same width.

/** Depth-specific character widths for text measurement. */
function charWidthsForDepth(depth: number): { cjk: number; ascii: number } {
  if (depth === 0) return { cjk: 26, ascii: 13.5 }
  if (depth === 1) return { cjk: 16, ascii: 8.5 }
  return { cjk: 13, ascii: 7 }
}

/** Depth-specific horizontal padding. */
function paddingForDepth(depth: number): number {
  if (depth === 0) return 36
  if (depth === 1) return 32
  return 24
}

/** Single-line node height per depth (root 56 / branch 42 / deeper 34). */
function baseHeightForDepth(depth: number): number {
  if (depth === 0) return 56
  if (depth === 1) return 42
  return 34
}

/** Wrapped-line advance per depth; base height = line height + Y padding. */
export function mindMapTopicLineHeight(depth: number): number {
  if (depth === 0) return 34
  if (depth === 1) return 22
  return 18
}

/**
 * Line advance actually used for wrapping vertical rhythm. A topic with a
 * custom (theme or per-node) font size larger than the depth default must grow
 * its line advance with the glyphs, otherwise single-line labels get clipped
 * by the fixed depth line height. The renderer computes its label line height
 * with the same formula so measured heights and painted baselines agree.
 */
export function effectiveMindMapTopicLineHeight(
  depth: number,
  fontSizeOverride?: number
): number {
  const base = mindMapTopicLineHeight(depth)
  if (fontSizeOverride === undefined || !Number.isFinite(fontSizeOverride)) return base
  return Math.max(base, Math.ceil(fontSizeOverride * 1.25))
}

/** Minimum width accepted by both automatic and fixed topic sizing. */
export const MIND_MAP_NODE_MIN_WIDTH = 72
/**
 * Total horizontal padding inside a topic's foreignObject label (`padding:
 * 0 10px` in mindmap.css). Wrapping and height measurement budget the same
 * gutter the CSS label uses so the inline editor, the markdown label and the
 * SVG tspan lines break identically — text neither reflows nor jumps when an
 * edit commits.
 */
export const MIND_MAP_TOPIC_LABEL_GUTTER = 20
/** Automatic sizing remains compact; fixed sizing can grow further. */
export const MIND_MAP_AUTO_NODE_MAX_WIDTH = 360
/** Maximum persisted fixed topic width. */
export const MIND_MAP_NODE_MAX_WIDTH = 720
/** Canvas-only width reserved for each in-node topic-content action button. */
export const MIND_MAP_TOPIC_ACTION_BUTTON_RESERVED_WIDTH = 28
/** @deprecated Use {@link MIND_MAP_TOPIC_ACTION_BUTTON_RESERVED_WIDTH}. */
export const MIND_MAP_NOTE_BUTTON_RESERVED_WIDTH = MIND_MAP_TOPIC_ACTION_BUTTON_RESERVED_WIDTH
/** Fixed thumbnail height used for workspace-backed images rendered inside a topic. */
export const MIND_MAP_TOPIC_IMAGE_HEIGHT = 88
/** Minimum width for an image-bearing topic so the thumbnail stays useful. */
export const MIND_MAP_TOPIC_IMAGE_MIN_WIDTH = 180
/** Gap between stacked images inside a topic image block. */
export const MIND_MAP_TOPIC_IMAGE_GAP = 6
/** Top/bottom padding of a stacked image block. */
export const MIND_MAP_TOPIC_IMAGE_VERTICAL_PADDING = 12
/** Per-side padding of the image column when images sit beside the text (left/right). */
export const MIND_MAP_TOPIC_IMAGE_SIDE_PADDING = 8

/** Minimal size metadata needed to lay out an image. */
export type MindMapTopicImageDim = { width: number; height: number }

/**
 * Intrinsic size of a stacked image block for the given images and placement.
 * `height` is the total vertical extent (stack + gaps + padding); `width` is
 * the widest image (plus side padding when the block sits beside the text).
 */
export function topicImageBlockSize(
  images: MindMapTopicImageDim[],
  placement: MindMapImagePlacement
): { width: number; height: number } {
  if (images.length === 0) return { width: 0, height: 0 }
  const stackHeight =
    images.reduce((sum, img) => sum + img.height, 0)
    + Math.max(0, images.length - 1) * MIND_MAP_TOPIC_IMAGE_GAP
    + MIND_MAP_TOPIC_IMAGE_VERTICAL_PADDING
  const maxWidth = Math.max(...images.map((img) => img.width))
  if (placement === 'left' || placement === 'right') {
    return { width: maxWidth + MIND_MAP_TOPIC_IMAGE_SIDE_PADDING * 2, height: stackHeight }
  }
  return { width: maxWidth, height: stackHeight }
}

/**
 * Split a laid-out topic rect into its text and image regions for a given
 * image placement. `image` is `null` when the topic has no images. The two
 * regions never overlap, so editing text never collides with the image.
 */
export function computeTopicImageAndTextRegions(
  node: { x: number; y: number; width: number; height: number },
  images: MindMapTopicImageDim[] = [],
  placement: MindMapImagePlacement = 'bottom'
): {
  text: { x: number; y: number; width: number; height: number }
  image: { x: number; y: number; width: number; height: number } | null
} {
  const block = topicImageBlockSize(images, placement)
  if (images.length === 0) {
    return {
      text: { x: node.x, y: node.y, width: node.width, height: node.height },
      image: null
    }
  }
  switch (placement) {
    case 'top': {
      const textHeight = Math.max(1, node.height - block.height)
      return {
        text: { x: node.x, y: node.y + block.height, width: node.width, height: textHeight },
        image: { x: node.x, y: node.y, width: node.width, height: block.height }
      }
    }
    case 'left': {
      const imageWidth = Math.min(block.width, node.width - 1)
      const textWidth = Math.max(1, node.width - imageWidth)
      return {
        text: { x: node.x + imageWidth, y: node.y, width: textWidth, height: node.height },
        image: { x: node.x, y: node.y, width: imageWidth, height: node.height }
      }
    }
    case 'right': {
      const imageWidth = Math.min(block.width, node.width - 1)
      const textWidth = Math.max(1, node.width - imageWidth)
      return {
        text: { x: node.x, y: node.y, width: textWidth, height: node.height },
        image: { x: node.x + textWidth, y: node.y, width: imageWidth, height: node.height }
      }
    }
    case 'bottom':
    default: {
      const textHeight = Math.max(1, node.height - block.height)
      return {
        text: { x: node.x, y: node.y, width: node.width, height: textHeight },
        image: { x: node.x, y: node.y + textHeight, width: node.width, height: block.height }
      }
    }
  }
}

export function clampMindMapNodeWidth(width: number): number {
  return Math.min(MIND_MAP_NODE_MAX_WIDTH, Math.max(MIND_MAP_NODE_MIN_WIDTH, width))
}

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0)
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

/**
 * Character advance probe used by wrapping/measuring. The canvas supplies a
 * canvas-2D `measureText`-backed probe so laid-out widths match the fonts the
 * browser actually renders (estimating Latin advances from a fixed table lets
 * labels overflow or reflow while typing); pure/test callers keep the built-in
 * per-depth estimates by omitting the probe.
 */
export type MindMapCharacterWidthProbe = (char: string, depth: number) => number

function measuredCharacterWidth(
  char: string,
  depth: number,
  measureChar?: MindMapCharacterWidthProbe
): number {
  if (measureChar) return measureChar(char, depth)
  const { cjk, ascii } = charWidthsForDepth(depth)
  return isCJK(char) ? cjk : ascii
}

function measurePlainTextWidth(
  text: string,
  depth: number,
  measureChar?: MindMapCharacterWidthProbe
): number {
  let width = 0
  for (const char of text) width += measuredCharacterWidth(char, depth, measureChar)
  return width
}

/**
 * Public plain-text width under the same metrics the wrap algorithm uses, so
 * callers (e.g. the inline editor placing its caret behind a numbering prefix)
 * measure exactly what the rendered tspans measured.
 */
export function measureMindMapTopicTextWidth(
  text: string,
  depth: number,
  measureChar?: MindMapCharacterWidthProbe
): number {
  return measurePlainTextWidth(text, depth, measureChar)
}

/** Length of the trailing run of Latin (non-CJK, non-space) characters. */
function trailingLatinWordRunLength(chars: readonly string[]): number {
  let run = 0
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const char = chars[i]!
    if (/\s/u.test(char) || isCJK(char)) break
    run += 1
  }
  return run
}

/**
 * Avoid a lonely one-or-two-character last line: when an automatically wrapped
 * paragraph leaves less than a third of the line width on its final line, pull
 * trailing characters (whole Latin words, so breaks stay on word boundaries)
 * down from the previous line until the two lines read balanced. The line
 * count never changes, so node heights stay stable. Explicit `\n` paragraphs
 * are single-line and never rebalanced.
 */
function balanceLastLine(
  lines: string[],
  innerWidth: number,
  depth: number,
  measureChar?: MindMapCharacterWidthProbe
): string[] {
  if (lines.length < 2) return lines
  let prev = lines[lines.length - 2]!
  let last = lines[lines.length - 1]!
  const minLastWidth = innerWidth / 3

  while (
    measurePlainTextWidth(last, depth, measureChar) < minLastWidth &&
    Array.from(prev).length > 1
  ) {
    const prevChars = Array.from(prev)
    const run = Math.max(1, trailingLatinWordRunLength(prevChars))
    if (run >= prevChars.length) break
    const moved = prevChars.splice(prevChars.length - run, run)
    prev = prevChars.join('').trimEnd()
    last = moved.join('') + last
  }

  if (prev === lines[lines.length - 2]! && last === lines[lines.length - 1]!) return lines
  return [...lines.slice(0, -2), prev, last]
}

/**
 * Wrap a topic title to the same approximate text metrics used by the pure
 * layout. SVG text has no native width-constrained line wrapping, so the
 * canvas renders these lines as tspans while `measureNodeHeight` uses their
 * count. Keeping both callers on this helper prevents the label from visually
 * overflowing a narrow fixed-width topic.
 *
 * Explicit newlines are preserved. For Latin text, whitespace is preferred as
 * a break point; CJK text and words wider than the available line fall back to
 * character-level wrapping.
 */
export function wrapMindMapTopicTitle(
  title: string,
  width: number,
  depth: number,
  measureChar?: MindMapCharacterWidthProbe
): string[] {
  if (!title) return ['']

  const innerWidth = Math.max(1, clampMindMapNodeWidth(width) - MIND_MAP_TOPIC_LABEL_GUTTER)
  const wrappedLines: string[] = []

  for (const paragraph of title.split(/\r?\n/)) {
    const characters = Array.from(paragraph)
    if (characters.length === 0 || characters.every((char) => /\s/u.test(char))) {
      wrappedLines.push('')
      continue
    }

    const paragraphLines: string[] = []
    let start = 0
    while (start < characters.length) {
      // Whitespace used as a previous line's break point should not become
      // indentation on the next visual line.
      while (start < characters.length && /\s/u.test(characters[start]!)) start += 1
      if (start >= characters.length) break

      let cursor = start
      let measuredWidth = 0
      let lastWhitespace = -1

      while (cursor < characters.length) {
        const char = characters[cursor]!
        const nextWidth = measuredWidth + measuredCharacterWidth(char, depth, measureChar)
        if (nextWidth > innerWidth && cursor > start) break
        measuredWidth = nextWidth
        if (/\s/u.test(char)) lastWhitespace = cursor
        cursor += 1
        // A single glyph can be wider than the usable area at the minimum
        // width. Always consume it so wrapping makes forward progress.
        if (nextWidth > innerWidth) break
      }

      if (cursor < characters.length && lastWhitespace >= start) {
        const line = characters.slice(start, lastWhitespace).join('').trimEnd()
        if (line) paragraphLines.push(line)
        start = lastWhitespace + 1
      } else {
        paragraphLines.push(characters.slice(start, cursor).join('').trimEnd())
        start = cursor
      }
    }

    wrappedLines.push(...balanceLastLine(paragraphLines, innerWidth, depth, measureChar))
  }

  return wrappedLines.length > 0 ? wrappedLines : ['']
}

function measureNodeWidth(
  title: string,
  depth: number,
  measureChar?: MindMapCharacterWidthProbe
): number {
  if (!title) return MIND_MAP_NODE_MIN_WIDTH
  let widestLine = 0
  let lineWidth = 0
  for (const char of title) {
    if (char === '\n' || char === '\r') {
      widestLine = Math.max(widestLine, lineWidth)
      lineWidth = 0
      continue
    }
    lineWidth += measuredCharacterWidth(char, depth, measureChar)
  }
  widestLine = Math.max(widestLine, lineWidth)
  const paddingX = paddingForDepth(depth)
  return Math.min(MIND_MAP_AUTO_NODE_MAX_WIDTH, Math.max(MIND_MAP_NODE_MIN_WIDTH, widestLine + paddingX))
}

function measureNodeHeight(
  title: string,
  width: number,
  depth: number,
  measureChar?: MindMapCharacterWidthProbe,
  lineHeightOverride?: number
): number {
  const baseHeight = baseHeightForDepth(depth)
  if (!title) return baseHeight
  const lineHeight = lineHeightOverride ?? mindMapTopicLineHeight(depth)
  const lines = wrapMindMapTopicTitle(title, width, depth, measureChar).length
  // The Y padding never goes negative: an oversized font must grow the node
  // instead of letting the line boxes overflow the label region.
  const paddingY = Math.max(0, baseHeight - lineHeight)
  return Math.max(baseHeight, lines * lineHeight + paddingY)
}

// ---- layout types ----

export type MindMapLayoutNode = {
  id: string
  title: string
  /** Per-character formatting over `title` (Xmind-style rich text spans). */
  titleFormatting?: MindMapTextSpan[]
  /** Top-left corner of the node rect (SVG user-space). */
  x: number
  y: number
  width: number
  height: number
  /** 0 = root, increasing away from it. */
  depth: number
  collapsed: boolean
  note?: string
  /** Whether the topic has a non-empty note (for note indicator badge). */
  hasNote?: boolean
  /** Whether the topic has a formula that can be reopened from the node. */
  hasFormula?: boolean
  /** Whether the topic has at least one link that can be reopened from the node. */
  hasLinks?: boolean
  /** Workspace-backed images attached to this topic (from the sheet `images` collection). */
  imageCount?: number
  /** Where the attached image block sits relative to the text label. */
  imagePlacement?: MindMapImagePlacement
  /** Small, accessible StudiumX-style marker badges attached to the topic. */
  markers?: MindMapMarker[]
  /** Text labels attached to the topic. */
  labels?: string[]
  /** Branch index for colour assignment (0 for root, 0-based for first-level children, inherited by descendants). */
  branchIndex: number
  /** Stable identity of the top-level branch ancestor (its topic id). Used for
   * colour assignment so inserting/reordering siblings does not re-colour
   * existing branches. Root has its own id. */
  branchKey: string
  /** Shape override from topic style or theme. */
  shape?: string
  /** Number of descendants hidden when this node is collapsed (for badge display). */
  hiddenDescendantCount?: number
  /** Full style override (fill, stroke, textColor, font, etc.). */
  style?: MindMapTopicStyleOverride
  /** Planning metadata for task info display. */
  taskStatus?: string
  progress?: number
  priority?: number
}

export type MindMapLayoutEdge = {
  from: string
  to: string
  /** Branch index for edge colouring. */
  branchIndex: number
  /** Stable identity of the top-level branch ancestor (its topic id). */
  branchKey: string
  /** Connector attachment axis dictated by the structure layout. */
  axis: 'horizontal' | 'vertical'
  /** Family-specific connector language; omitted for the default curve. */
  connectorStyle?: MindMapConnectorStyle
}

/** A sheet-level relationship connector projected into layout coordinates. */
export type MindMapLayoutRelationship = {
  id: string
  from: string
  to: string
  label?: string
  style?: MindMapElementStyle
}

/** A topic annotation projected into layout coordinates. */
export type MindMapLayoutCallout = {
  id: string
  topicId: string
  text: string
  position?: { x: number; y: number }
  style?: MindMapElementStyle
}

/** A sheet-level brace summary. Its linked output remains a normal layout node. */
export type MindMapLayoutSummary = {
  id: string
  from: string
  to: string
  /** Horizontal side on which the brace and linked output are rendered. */
  side: 'left' | 'right'
  /** Explicit source topics for a cross-branch summary. */
  sourceTopicIds?: string[]
  /** Real topic rendered beside the brace for newly created summaries. */
  summaryTopicId?: string
  /** Legacy label-only summaries omit `summaryTopicId`. */
  label?: string
  style?: MindMapElementStyle
  /** Outward horizontal edge of the currently visible covered subtrees. */
  coveredEdgeX?: number
  /** Top and bottom edges of the currently visible covered subtrees. */
  coveredTopY?: number
  coveredBottomY?: number
}

/** A boundary enclosing a topic subtree, projected into layout coordinates. */
export type MindMapLayoutBoundary = {
  id: string
  topicId: string
  label?: string
  style?: MindMapElementStyle
  x: number
  y: number
  width: number
  height: number
}

/** A free (canvas-positioned) image projected into layout coordinates. */
export type MindMapLayoutImage = {
  id: string
  assetId: string
  x: number
  y: number
  width: number
  height: number
  label?: string
  style?: MindMapElementStyle
}

export type MindMapLayoutResult = {
  nodes: MindMapLayoutNode[]
  edges: MindMapLayoutEdge[]
  relationships: MindMapLayoutRelationship[]
  callouts: MindMapLayoutCallout[]
  summaries: MindMapLayoutSummary[]
  boundaries: MindMapLayoutBoundary[]
  images: MindMapLayoutImage[]
}

// ---- layout constants (kept for tests / external consumers) ----

export const MIND_MAP_NODE_WIDTH = 160
export const MIND_MAP_NODE_HEIGHT = 40
/** Horizontal gap between the edge of a parent and the edge of its child.
 * @deprecated Use {@link horizontalGapForDepth} for depth-aware spacing. */
export const MIND_MAP_HORIZONTAL_GAP = 80
/** Vertical gap between sibling subtrees.
 * @deprecated Use {@link verticalGapForDepth} for depth-aware spacing. */
export const MIND_MAP_VERTICAL_GAP = 16

/**
 * Horizontal gap between a parent's right edge and its child's left edge,
 * varying by depth to match StudiumX Snowbrush spacing (wider near the root,
 * tighter for deeper levels). MUST stay in sync with CSS font-size values.
 */
export function horizontalGapForDepth(depth: number): number {
  return depth === 0 ? 64 : 44
}

/** Vertical gap between sibling subtrees, varying by depth (StudiumX-style). */
export function verticalGapForDepth(depth: number): number {
  return depth === 0 ? 24 : 10
}

/** Resolve the sibling gap for one depth, including the compact multiplier. */
function effectiveVerticalGap(sheet: MindMapSheetV2, depth: number): number {
  const configured = sheet.layout.spacing
  const base = configured === undefined || !Number.isFinite(configured)
    ? verticalGapForDepth(depth)
    : Math.max(4, configured)
  return sheet.layout.compact === true ? Math.max(4, base * 0.6) : base
}

/** Count all descendants (recursive, ignoring collapsed state) for badge display. */
function countDescendants(node: MindMapTopicV2): number {
  let count = 0
  for (const child of node.children) {
    count += 1 + countDescendants(child)
  }
  return count
}

// ---- layout algorithm ----

/** Direction (in x units) applied to each child index for a given structure.
 *
 * Balanced structures alternate right/left **at the root only** — deeper
 * topics stay on their branch's side (StudiumX behaviour). Without this, the
 * second child of a right-side branch would swing back toward the root and
 * overlap it.
 */
function childDirections(
  structureClass: MindMapStructureClass,
  childCount: number,
  depth: number,
  inheritedSide: 1 | -1
): number[] {
  const strategy = getLayoutGeometry(structureClass)
  if (strategy === 'horizontal-left') {
    return new Array<number>(childCount).fill(-1)
  }
  if (strategy === 'balanced') {
    if (depth > 0) {
      return new Array<number>(childCount).fill(inheritedSide)
    }
    return Array.from({ length: childCount }, (_, index) => (index % 2 === 0 ? 1 : -1))
  }
  return new Array<number>(childCount).fill(1)
}

function isVerticalStructure(structureClass: MindMapStructureClass): boolean {
  const strategy = getLayoutGeometry(structureClass)
  return strategy === 'vertical-down' || strategy === 'vertical-up'
}

function pushEdge(
  edges: MindMapLayoutEdge[],
  from: string,
  to: string,
  branchIndex: number,
  branchKey: string,
  structureClass: MindMapStructureClass
): void {
  const geometry = getLayoutGeometry(structureClass)
  const connectorStyle = getConnectorStyle(structureClass)
  const axis =
    geometry === 'vertical-down' ||
    geometry === 'vertical-up' ||
    geometry === 'timeline-vertical' ||
    geometry === 'matrix-rows' ||
    geometry === 'matrix-columns'
      ? 'vertical'
      : 'horizontal'
  edges.push({
    from,
    to,
    branchIndex,
    branchKey,
    axis,
    ...(connectorStyle === 'curve' ? {} : { connectorStyle })
  })
}

type LayoutBounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

type MindMapLayoutChildPlan = {
  index: number
  plan: MindMapLayoutPlan
  /** Offset from the parent's top-centre anchor. */
  offsetX: number
  offsetY: number
}

type MindMapLayoutPlan = {
  node: MindMapTopicV2
  structureClass: MindMapStructureClass
  size: { width: number; height: number }
  collapsed: boolean
  /** Bounds relative to this topic's top-centre anchor. */
  bounds: LayoutBounds
  children: MindMapLayoutChildPlan[]
  /**
   * Summary-output children excluded from ordinary sibling stacking. They are
   * still planned (so their subtrees get correct sizes/depths) and emitted, but
   * their final position is driven by `placeSummaryTopicBesideBrace` rather than
   * by the tree. Keeping them out of `children`/`bounds` means adding a summary
   * never re-flips balanced sides nor leaves a mis-centred gap behind.
   */
  floatingChildren: MindMapLayoutChildPlan[]
}

/** No-op set used when callers do not need summary-output floating handling. */
const EMPTY_TOPIC_SET: ReadonlySet<string> = new Set()

function boundsForSize(size: { width: number; height: number }): LayoutBounds {
  return {
    left: -size.width / 2,
    top: 0,
    right: size.width / 2,
    bottom: size.height,
    width: size.width,
    height: size.height
  }
}

function translateBounds(bounds: LayoutBounds, offsetX: number, offsetY: number): LayoutBounds {
  return {
    left: bounds.left + offsetX,
    top: bounds.top + offsetY,
    right: bounds.right + offsetX,
    bottom: bounds.bottom + offsetY,
    width: bounds.width,
    height: bounds.height
  }
}

function unionBounds(first: LayoutBounds, second: LayoutBounds): LayoutBounds {
  const left = Math.min(first.left, second.left)
  const top = Math.min(first.top, second.top)
  const right = Math.max(first.right, second.right)
  const bottom = Math.max(first.bottom, second.bottom)
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function isSpecialGeometry(geometry: LayoutGeometry): boolean {
  return (
    geometry === 'timeline-horizontal' ||
    geometry === 'timeline-vertical' ||
    geometry === 'fishbone-right' ||
    geometry === 'fishbone-left' ||
    geometry === 'matrix-rows' ||
    geometry === 'matrix-columns'
  )
}

/**
 * Build a layout plan before emitting coordinates.  A child plan carries its
 * actual bounds, including any recursively selected structure, so parents can
 * reserve real space instead of guessing from a generic tree estimate.
 */
function createLayoutPlan(
  node: MindMapTopicV2,
  depth: number,
  inheritedStructureClass: MindMapStructureClass,
  sizes: Map<string, { width: number; height: number }>,
  verticalGap: (depth: number) => number,
  inheritedSide: 1 | -1 = 1,
  floatingTopicIds: ReadonlySet<string> = EMPTY_TOPIC_SET
): MindMapLayoutPlan {
  const structureClass = node.style?.structureClass ?? inheritedStructureClass
  const size = sizes.get(node.id) ?? { width: MIND_MAP_NODE_WIDTH, height: MIND_MAP_NODE_HEIGHT }
  const collapsed = node.collapsed === true
  const ownBounds = boundsForSize(size)

  if (collapsed || node.children.length === 0) {
    return { node, structureClass, size, collapsed, bounds: ownBounds, children: [], floatingChildren: [] }
  }

  const geometry = getLayoutGeometry(structureClass)
  if (isSpecialGeometry(geometry)) {
    const special = assignSpecialChildren(
      node,
      depth,
      structureClass,
      size,
      sizes,
      verticalGap,
      geometry,
      floatingTopicIds
    )
    return {
      node,
      structureClass,
      size,
      collapsed,
      bounds: special.bounds,
      children: special.children,
      floatingChildren: special.floatingChildren
    }
  }

  const hGap = horizontalGapForDepth(depth)
  const vGap = verticalGap(depth)
  const children: MindMapLayoutChildPlan[] = []
  const floatingChildren: MindMapLayoutChildPlan[] = []
  let bounds = ownBounds

  const placeChild = (index: number, plan: MindMapLayoutPlan, offsetX: number, offsetY: number): void => {
    children.push({ index, plan, offsetX, offsetY })
    bounds = unionBounds(bounds, translateBounds(plan.bounds, offsetX, offsetY))
  }
  const placeFloating = (child: { index: number; plan: MindMapLayoutPlan }): void => {
    floatingChildren.push({ index: child.index, plan: child.plan, offsetX: 0, offsetY: 0 })
  }

  if (isVerticalStructure(structureClass)) {
    const childPlans = node.children.map((child, index) => {
      const plan = createLayoutPlan(
        child,
        depth + 1,
        structureClass,
        sizes,
        verticalGap,
        inheritedSide,
        floatingTopicIds
      )
      return { index, floating: floatingTopicIds.has(child.id), plan }
    })
    const regularChildren = childPlans.filter((child) => !child.floating)
    const totalWidth = regularChildren.reduce((sum, child) => sum + child.plan.bounds.width, 0) +
      Math.max(0, regularChildren.length - 1) * vGap
    let cursorLeft = -totalWidth / 2
    const isDown = geometry === 'vertical-down'

    for (const child of regularChildren) {
      const offsetX = cursorLeft - child.plan.bounds.left
      const offsetY = isDown
        ? ownBounds.bottom + hGap - child.plan.bounds.top
        : ownBounds.top - hGap - child.plan.bounds.bottom
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorLeft += child.plan.bounds.width + vGap
    }

    for (const child of childPlans) {
      if (child.floating) placeFloating(child)
    }

    return { node, structureClass, size, collapsed, bounds, children, floatingChildren }
  }

  // For balanced/map structures the side of a root child is decided by its
  // index among *non-summary* children. A summary output occupies a real array
  // slot but must never re-index (and thereby flip) its siblings, so it is
  // excluded from the alternation and stacked separately beside its brace.
  const regularChildNodes = node.children.filter((child) => !floatingTopicIds.has(child.id))
  const directions = childDirections(structureClass, regularChildNodes.length, depth, inheritedSide)
  const childPlans = node.children.map((child, index) => {
    const floating = floatingTopicIds.has(child.id)
    const regularIndex = floating ? -1 : regularChildNodes.indexOf(child)
    const direction: 1 | -1 = floating
      ? inheritedSide
      : directions[regularIndex] === -1 ? -1 : 1
    return {
      index,
      floating,
      direction,
      plan: createLayoutPlan(
        child,
        depth + 1,
        structureClass,
        sizes,
        verticalGap,
        direction,
        floatingTopicIds
      )
    }
  })
  const sides = directions.some((direction) => direction > 0) && directions.some((direction) => direction < 0)
    ? ([1, -1] as const)
    : [directions[0] === -1 ? -1 : 1]

  for (const side of sides) {
    const sideChildren = childPlans.filter((child) => !child.floating && child.direction === side)
    const sideExtent = sideChildren.reduce((sum, child) => sum + child.plan.bounds.height, 0) +
      Math.max(0, sideChildren.length - 1) * vGap
    let cursorTop = (ownBounds.top + ownBounds.bottom) / 2 - sideExtent / 2

    for (const child of sideChildren) {
      const offsetX = side === 1
        ? ownBounds.right + hGap - child.plan.bounds.left
        : ownBounds.left - hGap - child.plan.bounds.right
      const offsetY = cursorTop - child.plan.bounds.top
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorTop += child.plan.bounds.height + vGap
    }
  }

  for (const child of childPlans) {
    if (child.floating) placeFloating(child)
  }

  return { node, structureClass, size, collapsed, bounds, children, floatingChildren }
}

/**
 * Arrange the structures whose child placement is not a regular tree.  Each
 * descendant is planned first, then packed by its true rectangular bounds.
 * This keeps added topics from entering a sibling's visual space.
 */
function assignSpecialChildren(
  node: MindMapTopicV2,
  depth: number,
  structureClass: MindMapStructureClass,
  size: { width: number; height: number },
  sizes: Map<string, { width: number; height: number }>,
  verticalGap: (depth: number) => number,
  geometry: LayoutGeometry,
  floatingTopicIds: ReadonlySet<string> = EMPTY_TOPIC_SET
): Pick<MindMapLayoutPlan, 'bounds' | 'children' | 'floatingChildren'> {
  const ownBounds = boundsForSize(size)
  const hGap = horizontalGapForDepth(depth)
  const vGap = verticalGap(depth)
  const children: MindMapLayoutChildPlan[] = []
  const floatingChildren: MindMapLayoutChildPlan[] = []
  let bounds = ownBounds

  const createChildPlans = (sideForIndex: (index: number) => 1 | -1) =>
    node.children.map((child, index) => ({
      index,
      floating: floatingTopicIds.has(child.id),
      plan: createLayoutPlan(
        child,
        depth + 1,
        structureClass,
        sizes,
        verticalGap,
        sideForIndex(index),
        floatingTopicIds
      )
    }))
  const placeChild = (index: number, plan: MindMapLayoutPlan, offsetX: number, offsetY: number): void => {
    children.push({ index, plan, offsetX, offsetY })
    bounds = unionBounds(bounds, translateBounds(plan.bounds, offsetX, offsetY))
  }
  const placeFloating = (child: { index: number; plan: MindMapLayoutPlan }): void => {
    floatingChildren.push({ index: child.index, plan: child.plan, offsetX: 0, offsetY: 0 })
  }
  const stack = (childPlans: Array<{ index: number; floating: boolean; plan: MindMapLayoutPlan }>): void => {
    for (const child of childPlans) {
      if (child.floating) placeFloating(child)
    }
  }
  const parentCenterY = (ownBounds.top + ownBounds.bottom) / 2

  if (geometry === 'timeline-horizontal') {
    const childPlans = createChildPlans((index) => (index % 2 === 0 ? -1 : 1))
    let cursorLeft = ownBounds.right + hGap
    for (const child of childPlans) {
      if (child.floating) continue
      const isAbove = child.index % 2 === 0
      const offsetX = cursorLeft - child.plan.bounds.left
      const offsetY = isAbove
        ? parentCenterY - vGap - child.plan.bounds.bottom
        : parentCenterY + vGap - child.plan.bounds.top
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorLeft += child.plan.bounds.width + hGap
    }
    stack(childPlans)
    return { bounds, children, floatingChildren }
  }

  if (geometry === 'timeline-vertical') {
    const childPlans = createChildPlans((index) => (index % 2 === 0 ? 1 : -1))
    let cursorTop = ownBounds.bottom + hGap
    for (const child of childPlans) {
      if (child.floating) continue
      const side: 1 | -1 = child.index % 2 === 0 ? 1 : -1
      const offsetX = side === 1
        ? ownBounds.right + hGap - child.plan.bounds.left
        : ownBounds.left - hGap - child.plan.bounds.right
      const offsetY = cursorTop - child.plan.bounds.top
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorTop += child.plan.bounds.height + vGap
    }
    stack(childPlans)
    return { bounds, children, floatingChildren }
  }

  if (geometry === 'fishbone-right' || geometry === 'fishbone-left') {
    const direction: 1 | -1 = geometry === 'fishbone-right' ? -1 : 1
    const childPlans = createChildPlans(() => direction)
    let cursorEdge = direction === 1 ? ownBounds.right + hGap : ownBounds.left - hGap
    for (const child of childPlans) {
      if (child.floating) continue
      const isAbove = child.index % 2 === 0
      const offsetX = direction === 1
        ? cursorEdge - child.plan.bounds.left
        : cursorEdge - child.plan.bounds.right
      const offsetY = isAbove
        ? parentCenterY - vGap - child.plan.bounds.bottom
        : parentCenterY + vGap - child.plan.bounds.top
      placeChild(child.index, child.plan, offsetX, offsetY)
      cursorEdge += direction * (child.plan.bounds.width + hGap)
    }
    stack(childPlans)
    return { bounds, children, floatingChildren }
  }

  const isColumnMajor = geometry === 'matrix-columns'
  const childPlans = createChildPlans(() => 1)
  const regularChildPlans = childPlans.filter((child) => !child.floating)
  const columnCount = Math.max(
    1,
    isColumnMajor ? Math.min(3, regularChildPlans.length) : Math.ceil(Math.sqrt(regularChildPlans.length))
  )
  const rowCount = Math.ceil(regularChildPlans.length / columnCount)
  const cellWidths = new Array<number>(columnCount).fill(0)
  const cellHeights = new Array<number>(rowCount).fill(0)
  for (const child of regularChildPlans) {
    const row = isColumnMajor ? child.index % rowCount : Math.floor(child.index / columnCount)
    const column = isColumnMajor ? Math.floor(child.index / rowCount) : child.index % columnCount
    cellWidths[column] = Math.max(cellWidths[column] ?? 0, child.plan.bounds.width)
    cellHeights[row] = Math.max(cellHeights[row] ?? 0, child.plan.bounds.height)
  }

  const totalGridWidth = cellWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, columnCount - 1) * hGap
  const columnLefts: number[] = []
  let columnLeft = -totalGridWidth / 2
  for (const cellWidth of cellWidths) {
    columnLefts.push(columnLeft)
    columnLeft += cellWidth + hGap
  }
  const rowTops: number[] = []
  let rowTop = ownBounds.bottom + hGap
  for (const cellHeight of cellHeights) {
    rowTops.push(rowTop)
    rowTop += cellHeight + vGap
  }

  for (const child of regularChildPlans) {
    const row = isColumnMajor ? child.index % rowCount : Math.floor(child.index / columnCount)
    const column = isColumnMajor ? Math.floor(child.index / rowCount) : child.index % columnCount
    const cellWidth = cellWidths[column] ?? child.plan.bounds.width
    const cellHeight = cellHeights[row] ?? child.plan.bounds.height
    const cellLeft = columnLefts[column] ?? 0
    const cellTop = rowTops[row] ?? ownBounds.bottom + hGap
    const offsetX = cellLeft + (cellWidth - child.plan.bounds.width) / 2 - child.plan.bounds.left
    const offsetY = cellTop + (cellHeight - child.plan.bounds.height) / 2 - child.plan.bounds.top
    placeChild(child.index, child.plan, offsetX, offsetY)
  }
  stack(childPlans)

  return { bounds, children, floatingChildren }
}

/** Pre-compute auto-sized dimensions for every node in the tree. */
function precomputeSizes(
  node: MindMapTopicV2,
  sizes: Map<string, { width: number; height: number }>,
  depth: number,
  emptyTitleFallback?: string,
  reserveTopicActionButtonSpace = false,
  attachedImages?: Map<string, MindMapImageElement[]>,
  measureChar?: MindMapCharacterWidthProbe,
  theme?: MindMapTheme
): void {
  // Untitled topics are rendered with a placeholder label (G3), so they are
  // measured as that placeholder rather than collapsing to the bare minimum.
  const displayTitle = mindMapTopicDisplayTitle(node)
  const measuredTitle = displayTitle || emptyTitleFallback || ''
  const fixedWidth = node.style?.widthMode === 'fixed' ? node.style.width : undefined
  const hasFixedWidth = fixedWidth !== undefined
  const measuredContentWidth = fixedWidth !== undefined
    ? clampMindMapNodeWidth(fixedWidth)
    : measureNodeWidth(measuredTitle, depth, measureChar)
  const images = attachedImages?.get(node.id) ?? []
  const hasImages = images.length > 0
  const placement = node.imagePlacement ?? 'bottom'
  const vertical = placement === 'top' || placement === 'bottom'
  const block = topicImageBlockSize(images, placement)
  const textWidth = hasImages && !hasFixedWidth && vertical
    ? Math.max(measuredContentWidth, MIND_MAP_TOPIC_IMAGE_MIN_WIDTH, block.width)
    : measuredContentWidth
  const topicActionCount = Number(Boolean(node.note))
  // Match the renderer: a themed or per-node font size larger than the depth
  // default grows the line advance (and the node) so labels never clip.
  const effectiveStyle = theme
    ? resolveEffectiveTopicStyle(node.style, theme, depth)
    : node.style
  const textHeight = measureNodeHeight(
    measuredTitle,
    textWidth,
    depth,
    measureChar,
    effectiveMindMapTopicLineHeight(depth, effectiveStyle?.fontSize)
  )
  const width = (vertical ? textWidth : textWidth + block.width)
    + (reserveTopicActionButtonSpace
      ? topicActionCount * MIND_MAP_TOPIC_ACTION_BUTTON_RESERVED_WIDTH
      : 0)
  const height = vertical ? textHeight + block.height : Math.max(textHeight, block.height)
  sizes.set(node.id, { width, height })
  for (const child of node.children) {
    precomputeSizes(child, sizes, depth + 1, emptyTitleFallback, reserveTopicActionButtonSpace, attachedImages, measureChar, theme)
  }
}

function emitLayoutPlan(
  plan: MindMapLayoutPlan,
  centerX: number,
  topY: number,
  depth: number,
  branchIndex: number,
  branchKey: string,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[]
): void {
  const { node, size, collapsed, structureClass } = plan

  nodes.push({
    id: node.id,
    branchKey,
    title: mindMapTopicDisplayTitle(node),
    ...(node.titleFormatting && node.titleFormatting.length > 0
      ? { titleFormatting: structuredClone(node.titleFormatting) }
      : {}),
    x: centerX - size.width / 2,
    y: topY,
    width: size.width,
    height: size.height,
    depth,
    collapsed,
    ...(node.note ? { note: node.note, hasNote: true } : {}),
    ...(node.formula ? { hasFormula: true } : {}),
    ...(node.links && node.links.length > 0 ? { hasLinks: true } : {}),
    ...(node.imagePlacement ? { imagePlacement: node.imagePlacement } : {}),
    ...(node.markers && node.markers.length > 0
      ? {
          markers: node.markers.map(({ id, symbol, label }) => ({
            id,
            symbol,
            ...(label !== undefined ? { label } : {})
          }))
        }
      : {}),
    ...(node.labels && node.labels.length > 0 ? { labels: [...node.labels] } : {}),
    branchIndex,
    ...(node.style?.shape ? { shape: node.style.shape } : {}),
    ...(node.style ? { style: node.style } : {}),
    ...(node.planning?.taskStatus ? { taskStatus: node.planning.taskStatus } : {}),
    ...(node.planning?.progress !== undefined ? { progress: node.planning.progress } : {}),
    ...(node.planning?.priority !== undefined ? { priority: node.planning.priority } : {})
  })

  if (collapsed) {
    const layoutNode = nodes[nodes.length - 1]
    if (layoutNode) layoutNode.hiddenDescendantCount = countDescendants(node)
    return
  }

  for (const child of plan.children) {
    const childBranchIndex = depth === 0 ? child.index : branchIndex
    const childBranchKey = depth === 0 ? child.plan.node.id : branchKey
    pushEdge(edges, node.id, child.plan.node.id, childBranchIndex, childBranchKey, structureClass)
    emitLayoutPlan(
      child.plan,
      centerX + child.offsetX,
      topY + child.offsetY,
      depth + 1,
      childBranchIndex,
      childBranchKey,
      nodes,
      edges
    )
  }

  // Summary-output subtrees are planned alongside their siblings but are not
  // stacked; emit them at the parent's anchor and let the summary placement
  // pass (placeSummaryTopicBesideBrace) translate them beside their brace.
  for (const child of plan.floatingChildren) {
    const childBranchIndex = depth === 0 ? child.index : branchIndex
    const childBranchKey = depth === 0 ? child.plan.node.id : branchKey
    pushEdge(edges, node.id, child.plan.node.id, childBranchIndex, childBranchKey, structureClass)
    emitLayoutPlan(
      child.plan,
      centerX + child.offsetX,
      topY + child.offsetY,
      depth + 1,
      childBranchIndex,
      childBranchKey,
      nodes,
      edges
    )
  }
}

/** Space between the covered range and the summary brace. */
export const MIND_MAP_SUMMARY_RANGE_GAP = 20
/** Horizontal envelope of the compact curly brace. */
export const MIND_MAP_SUMMARY_BRACE_WIDTH = 24
/** Clear space between the brace envelope and its output topic. */
export const MIND_MAP_SUMMARY_OUTPUT_GAP = 20

/**
 * A summary extends away from the branch it covers. For two-sided structures,
 * only a group wholly on the left is mirrored; cross-branch summaries retain
 * the established right-hand placement.
 */
function summarySideForSourceNodes(
  sourceNodes: readonly MindMapLayoutNode[],
  rootNode: MindMapLayoutNode,
  defaultStructureClass: MindMapStructureClass
): 'left' | 'right' {
  const rootCenterX = rootNode.x + rootNode.width / 2
  const sides = sourceNodes.map((node) => {
    switch (getLayoutGeometry(node.style?.structureClass ?? defaultStructureClass)) {
      case 'horizontal-left':
      case 'fishbone-right':
        return 'left' as const
      case 'balanced':
        return node.x + node.width / 2 < rootCenterX ? 'left' as const : 'right' as const
      default:
        return 'right' as const
    }
  })
  return sides.length > 0 && sides.every((side) => side === 'left') ? 'left' : 'right'
}

/**
 * Resolve the visible subtree envelope covered by a summary. A source topic's
 * descendants become part of that envelope as they are added, while collapsed
 * descendants and floating summary outputs remain outside it.
 */
function visibleSummaryCoverageNodes(
  root: MindMapTopicV2,
  nodes: readonly MindMapLayoutNode[],
  sourceTopicIds: readonly string[],
  excludedTopicIds: ReadonlySet<string>
): MindMapLayoutNode[] {
  const layoutNodeById = new Map(nodes.map((node) => [node.id, node]))
  const coveredNodes: MindMapLayoutNode[] = []
  const coveredTopicIds = new Set<string>()

  const visit = (topic: MindMapTopicV2): void => {
    if (excludedTopicIds.has(topic.id) || coveredTopicIds.has(topic.id)) return
    const layoutNode = layoutNodeById.get(topic.id)
    if (!layoutNode) return
    coveredTopicIds.add(topic.id)
    coveredNodes.push(layoutNode)
    if (layoutNode.collapsed) return
    for (const child of topic.children) visit(child)
  }

  for (const topicId of sourceTopicIds) {
    const topic = findTopicNodeById(root, topicId)
    if (topic) visit(topic)
  }
  return coveredNodes
}

/**
 * Move a linked summary topic (and its visible descendants) beside its brace.
 * The topic remains in the tree and continues through the regular canvas node
 * rendering path; only its ordinary incoming tree edge is suppressed below.
 */
function placeSummaryTopicBesideBrace(
  root: MindMapTopicV2,
  nodes: MindMapLayoutNode[],
  summaryTopicId: string,
  side: 'left' | 'right',
  x: number,
  y: number
): boolean {
  if (root.id === summaryTopicId) return false
  const topic = findTopicNodeById(root, summaryTopicId)
  const layoutTopic = nodes.find((node) => node.id === summaryTopicId)
  if (!topic || !layoutTopic) return false

  const topicIds = new Set<string>()
  const collectIds = (candidate: MindMapTopicV2): void => {
    topicIds.add(candidate.id)
    for (const child of candidate.children) collectIds(child)
  }
  collectIds(topic)

  const deltaX = x - layoutTopic.x
  const deltaY = y - layoutTopic.y
  for (const node of nodes) {
    if (!topicIds.has(node.id)) continue
    node.x += deltaX
    node.y += deltaY
  }

  // A cross-branch summary is inserted under its lowest common ancestor. In a
  // balanced map, that insertion index can have the opposite semantic branch
  // direction from the side where the summary brace is rendered. Translating
  // the output subtree alone would then leave newly added child topics growing
  // back through the brace. Mirror an entirely opposite-facing subtree around
  // the output topic so summary descendants always grow away from the covered
  // range. Do not disturb vertical/mixed layouts, which have no single
  // horizontal outward direction to correct.
  const outputCenterX = layoutTopic.x + layoutTopic.width / 2
  const desiredDirection = side === 'left' ? -1 : 1
  const directChildDirections = topic.children
    .map((child) => nodes.find((node) => node.id === child.id))
    .filter((node): node is MindMapLayoutNode => node !== undefined)
    .map((node) => Math.sign(node.x + node.width / 2 - outputCenterX))
    .filter((direction) => direction !== 0)
  if (
    directChildDirections.length > 0 &&
    directChildDirections.every((direction) => direction === -desiredDirection)
  ) {
    for (const node of nodes) {
      if (!topicIds.has(node.id) || node.id === summaryTopicId) continue
      node.x = 2 * outputCenterX - node.x - node.width
    }
  }
  return true
}

/**
 * Fallback placement for a floating summary output whose covered range cannot
 * be resolved (e.g. a source hidden by a collapsed subtree). The brace is not
 * drawn in that case, so the output topic is anchored beside its own parent on
 * the parent's side instead of being left overlapping the tree.
 */
function placeSummaryOutputBesideParent(
  root: MindMapTopicV2,
  nodes: MindMapLayoutNode[],
  summaryTopicId: string,
  rootNode: MindMapLayoutNode | undefined
): boolean {
  const outputNode = nodes.find((node) => node.id === summaryTopicId)
  const parent = findTopicParentNodeById(root, summaryTopicId)
  if (!outputNode || !parent || !rootNode) return false
  const parentNode = nodes.find((node) => node.id === parent.id)
  if (!parentNode) return false

  const side: 'left' | 'right' =
    parentNode.x + parentNode.width / 2 < rootNode.x + rootNode.width / 2
      ? 'left'
      : 'right'
  const hGap = horizontalGapForDepth(parentNode.depth)
  const x = side === 'left'
    ? parentNode.x - hGap - outputNode.width
    : parentNode.x + parentNode.width + hGap
  const y = parentNode.y + parentNode.height / 2 - outputNode.height / 2
  return placeSummaryTopicBesideBrace(root, nodes, summaryTopicId, side, x, y)
}

/** Optional knobs for {@link computeMindMapLayout}. */
export type MindMapLayoutOptions = {
  /**
   * Measure untitled topics as this string (the renderer's placeholder label)
   * so empty nodes don't collapse into tiny blank chips. Export/minimap
   * callers omit it and keep the bare minimum width.
   */
  emptyTitleFallback?: string
  /** Reserve one right-side slot for each note, formula, or link action button. */
  reserveTopicActionButtonSpace?: boolean
  /** @deprecated Use `reserveTopicActionButtonSpace`. */
  reserveNoteButtonSpace?: boolean
  /**
   * Real per-character advance (px) used for wrapping and node sizing. The
   * canvas passes a `measureText`-backed probe so laid-out widths match the
   * fonts the browser actually renders; pure/test callers keep the built-in
   * per-depth estimates by omitting it.
   */
  measureCharacterWidth?: MindMapCharacterWidthProbe
  /**
   * Document theme, merged per node (theme layer + node style) the same way
   * the renderer resolves effective styles. Themed font sizes must grow the
   * measured line advance or oversized labels clip inside the node.
   */
  theme?: MindMapTheme
}

export function computeMindMapLayout(
  sheet: MindMapSheetV2,
  options?: MindMapLayoutOptions
): MindMapLayoutResult {
  const nodes: MindMapLayoutNode[] = []
  const edges: MindMapLayoutEdge[] = []
  const sizes = new Map<string, { width: number; height: number }>()
  const attachedImages = new Map<string, MindMapImageElement[]>()
  for (const image of sheet.images ?? []) {
    if (image.topicId === undefined) continue
    const list = attachedImages.get(image.topicId) ?? []
    list.push(image)
    attachedImages.set(image.topicId, list)
  }
  precomputeSizes(
    sheet.root,
    sizes,
    0,
    options?.emptyTitleFallback,
    options?.reserveTopicActionButtonSpace ?? options?.reserveNoteButtonSpace,
    attachedImages,
    options?.measureCharacterWidth,
    options?.theme
  )
  const verticalGap = (depth: number): number => effectiveVerticalGap(sheet, depth)

  const images = (sheet.images ?? [])
    .filter((image) => image.topicId === undefined && image.position !== undefined)
    .map(({ id, assetId, width, height, position, label, style }) => ({
      id,
      assetId,
      x: position!.x,
      y: position!.y,
      width,
      height,
      ...(label !== undefined ? { label } : {}),
      ...(style !== undefined ? { style: { ...style } } : {})
    }))

  const relationships = sheet.elements
    .filter((element) => element.type === 'relationship')
    .map(({ id, from, to, label, style }) => ({
      id,
      from,
      to,
      ...(label !== undefined ? { label } : {}),
      ...(style !== undefined ? { style: { ...style } } : {})
    }))
  const callouts = sheet.elements
    .filter((element): element is MindMapCallout => element.type === 'callout')
    .map(({ id, topicId, text, position, style }) => ({
      id,
      topicId,
      text,
      ...(position !== undefined ? { position: { ...position } } : {}),
      ...(style !== undefined ? { style: { ...style } } : {})
    }))
  const summaryBase = sheet.elements
    .filter((element): element is MindMapSummary => element.type === 'summary')
    .map(({ id, from, to, sourceTopicIds, summaryTopicId, label, style }) => ({
      id,
      from,
      to,
      ...(sourceTopicIds !== undefined ? { sourceTopicIds: [...sourceTopicIds] } : {}),
      ...(summaryTopicId !== undefined ? { summaryTopicId } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(style !== undefined ? { style: { ...style } } : {})
    }))

  // Summary outputs are laid out as ordinary tree nodes (so their subtrees,
  // sizes and depths are all correct) but are excluded from sibling stacking
  // and positioned beside their brace below. This keeps adding a summary from
  // re-indexing balanced siblings or leaving a mis-centred gap behind.
  const floatingTopicIds = new Set<string>()
  for (const element of sheet.elements) {
    if (element.type === 'summary' && element.summaryTopicId !== undefined) {
      floatingTopicIds.add(element.summaryTopicId)
    }
  }
  const plan = createLayoutPlan(
    sheet.root,
    0,
    sheet.layout.structureClass,
    sizes,
    verticalGap,
    1,
    floatingTopicIds
  )
  emitLayoutPlan(plan, 0, 0, 0, 0, sheet.root.id, nodes, edges)

  // New summaries link to a real tree topic. Reposition its rendered subtree
  // beside the brace, then remove only its normal parent edge; all other topic
  // behavior remains the standard layout/canvas behavior.
  const summaryTopicIds = new Set<string>()
  const summarySides = new Map<string, 'left' | 'right'>()
  const summaryCoveredBounds = new Map<string, {
    edgeX: number
    topY: number
    bottomY: number
  }>()
  const rootNode = nodes.find((node) => node.id === sheet.root.id)
  for (const summary of summaryBase) {
    const sourceTopicIds = summary.sourceTopicIds ?? [summary.from, summary.to]
    const sourceNodes = sourceTopicIds.map((topicId) => nodes.find((node) => node.id === topicId))
    // A summary output is laid out floating (not stacked with siblings). When
    // a covered source sits inside a collapsed subtree the brace is hidden, but
    // the output topic must still get a sensible position instead of overlapping
    // its parent — fall back to placing it beside its parent.
    if (sourceNodes.some((node) => node === undefined) || !rootNode) {
      if (summary.summaryTopicId !== undefined) {
        const placed = placeSummaryOutputBesideParent(
          sheet.root,
          nodes,
          summary.summaryTopicId,
          rootNode
        )
        if (placed) summaryTopicIds.add(summary.summaryTopicId)
      }
      continue
    }
    const resolvedSourceNodes = sourceNodes as MindMapLayoutNode[]
    const side = summarySideForSourceNodes(
      resolvedSourceNodes,
      rootNode,
      sheet.layout.structureClass
    )
    summarySides.set(summary.id, side)

    const visibleCoveredNodes = visibleSummaryCoverageNodes(
      sheet.root,
      nodes,
      sourceTopicIds,
      floatingTopicIds
    )
    // A summary output can itself be selected as an ordinary topic for a later
    // summary. In that edge case it is also a floating topic, so retain the
    // already-resolved source nodes rather than producing an empty envelope.
    const coveredNodes = visibleCoveredNodes.length > 0
      ? visibleCoveredNodes
      : resolvedSourceNodes
    const left = Math.min(...coveredNodes.map((node) => node.x))
    const right = Math.max(...coveredNodes.map((node) => node.x + node.width))
    const top = Math.min(...coveredNodes.map((node) => node.y))
    const bottom = Math.max(...coveredNodes.map((node) => node.y + node.height))
    summaryCoveredBounds.set(summary.id, {
      edgeX: side === 'left' ? left : right,
      topY: top,
      bottomY: bottom
    })

    if (summary.summaryTopicId === undefined) continue
    const outputNode = nodes.find((node) => node.id === summary.summaryTopicId)
    if (!outputNode) continue

    const placed = placeSummaryTopicBesideBrace(
      sheet.root,
      nodes,
      summary.summaryTopicId,
      side,
      side === 'left'
        ? left
          - MIND_MAP_SUMMARY_RANGE_GAP
          - MIND_MAP_SUMMARY_BRACE_WIDTH
          - MIND_MAP_SUMMARY_OUTPUT_GAP
          - outputNode.width
        : right
          + MIND_MAP_SUMMARY_RANGE_GAP
          + MIND_MAP_SUMMARY_BRACE_WIDTH
          + MIND_MAP_SUMMARY_OUTPUT_GAP,
      (top + bottom) / 2 - outputNode.height / 2
    )
    if (placed) summaryTopicIds.add(summary.summaryTopicId)
  }
  const visibleEdges = edges.filter((edge) => !summaryTopicIds.has(edge.to))
  const summaries = summaryBase.map((summary) => {
    const coveredBounds = summaryCoveredBounds.get(summary.id)
    return {
      ...summary,
      side: summarySides.get(summary.id) ?? 'right',
      ...(coveredBounds
        ? {
            coveredEdgeX: coveredBounds.edgeX,
            coveredTopY: coveredBounds.topY,
            coveredBottomY: coveredBounds.bottomY
          }
        : {})
    }
  })

  // Compute boundary rectangles from layout nodes.
  const boundaries = sheet.elements
    .filter((element): element is MindMapBoundary => element.type === 'boundary')
    .map(({ id, topicId, children, label, style }) => {
      const targetIds = children ?? [topicId]
      const targetNodes = nodes.filter((n) => targetIds.includes(n.id))
      if (targetNodes.length === 0) {
        const single = nodes.find((n) => n.id === topicId)
        if (!single) return null
        const padding = 16
        return {
          id,
          topicId,
          ...(label !== undefined ? { label } : {}),
          ...(style !== undefined ? { style } : {}),
          x: single.x - padding,
          y: single.y - padding,
          width: single.width + padding * 2,
          height: single.height + padding * 2
        }
      }
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const n of targetNodes) {
        left = Math.min(left, n.x)
        top = Math.min(top, n.y)
        right = Math.max(right, n.x + n.width)
        bottom = Math.max(bottom, n.y + n.height)
      }
      const padding = 16
      return {
        id,
        topicId,
        ...(label !== undefined ? { label } : {}),
        ...(style !== undefined ? { style } : {}),
        x: left - padding,
        y: top - padding,
        width: right - left + padding * 2,
        height: bottom - top + padding * 2
      }
    })
    .filter((b): b is MindMapLayoutBoundary => b !== null)

  return { nodes, edges: visibleEdges, relationships, callouts, summaries, boundaries, images }
}

/** Find a topic by id within a cloned tree (or null). */
function findTopicNodeById(node: MindMapTopicV2, id: string): MindMapTopicV2 | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findTopicNodeById(child, id)
    if (found) return found
  }
  return null
}

/** Find the parent of the topic with `id` (or null if it is the root / absent). */
function findTopicParentNodeById(
  node: MindMapTopicV2,
  id: string
): MindMapTopicV2 | null {
  for (const child of node.children) {
    if (child.id === id) return node
    const found = findTopicParentNodeById(child, id)
    if (found) return found
  }
  return null
}

/** Whether `id` is `node` itself or one of its descendants. */
function containsTopicNode(node: MindMapTopicV2, id: string): boolean {
  if (node.id === id) return true
  return node.children.some((child) => containsTopicNode(child, id))
}

/** The content-space rect of a topic in a layout result. */
export type MindMapMovedTopicPreview = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Compute where a topic would be placed if it were moved to become a child of
 * `toParentId` (mirroring `topic.move`'s insert-at-front default), without
 * mutating the input tree.
 *
 * Returns the moved topic's layout rect in the preview tree, or `null` when
 * the move is invalid (topic missing, is the root, target missing, or a
 * cyclic move into its own descendant). The caller renders a dashed ghost node
 * at the returned rect so the user sees exactly where the topic will land.
 */
export function computeMovedTopicPreview(
  sheet: MindMapSheetV2,
  draggingId: string,
  toParentId: string
): MindMapMovedTopicPreview | null {
  if (draggingId === toParentId) return null
  const root = structuredClone(sheet.root)

  const dragNode = findTopicNodeById(root, draggingId)
  if (!dragNode) return null
  const toParent = findTopicNodeById(root, toParentId)
  if (!toParent) return null
  // Reject cyclic moves (target is the dragged topic or inside its subtree).
  if (containsTopicNode(dragNode, toParentId)) return null

  // Detach the dragged topic from its current parent (must not be the root).
  const dragParent = findTopicParentNodeById(root, draggingId)
  if (!dragParent) return null // root topic cannot be moved
  const fromIndex = dragParent.children.indexOf(dragNode)
  dragParent.children.splice(fromIndex, 1)

  // Attach as the first child of the target (matches `topic.move` default).
  toParent.children.unshift(dragNode)

  const preview = computeMindMapLayout({ ...sheet, root })
  const moved = preview.nodes.find((node) => node.id === draggingId)
  return moved
    ? { x: moved.x, y: moved.y, width: moved.width, height: moved.height }
    : null
}
