/**
 * Mind map data model v2 — native StudiumX domain model.
 *
 * v2 moves away from mirroring XMind's content structure directly:
 * - each sheet owns a topic tree plus a flat `elements` collection whose
 *   items reference stable topic ids (relationships, boundaries, summaries,
 *   callouts, free topics) instead of being crammed into `children`;
 * - documents gain `revision` (for optimistic concurrency), `theme`,
 *   `assets` and optional interop metadata.
 *
 * See docs/mindmap/studiumx-mind-map-plan.md §6 and §7.1.
 */
import type { MindMapStructureClass } from '../mind-map-types'

/** Current document schema version for the v2 model. */
export const MIND_MAP_DOCUMENT_SCHEMA_VERSION_V2 = 2

/** A 2D point in document (canvas) coordinates. */
export type MindMapPoint = { x: number; y: number }

/** Document-level theme tokens. */
export type MindMapTheme = {
  id: string
  name?: string
  background?: string
  branchColors?: string[]
  textColor?: string
  lineColor?: string
  fontFamily?: string
  shape?: string
  /** When false, all branches use theme.lineColor instead of rainbow colors. Defaults to true. */
  rainbowBranches?: boolean
  /** P4: Color scheme identifier (e.g. 'dawn', 'freshness'). Decoupled from theme. */
  colorSchemeId?: string
  /** P4: Layered default topic styles (Xmind core feature). Priority: node style > topicStyles[depth] > CSS default. */
  topicStyles?: {
    central?: MindMapTopicStyleOverride
    main?: MindMapTopicStyleOverride
    sub?: MindMapTopicStyleOverride
  }
}

/** Default theme used when migrating a v1 document (no theme concept in v1). */
export const DEFAULT_MIND_MAP_THEME: MindMapTheme = {
  id: 'studiumx-default',
  name: 'StudiumX Default'
}

/** Reference to a workspace asset (attachment/image). Assets are never inlined. */
export type MindMapAssetRef = {
  id: string
  fileName: string
  mimeType?: string
  sizeBytes?: number
  sha256?: string
  createdAt?: string
}

/** Optional interop baggage kept at the document boundary (e.g. XMind). */
export type MindMapInteropMetadata = {
  xmind?: {
    sourcePath?: string
    sourceVersion?: string
    importedAt?: string
    /** Size-bounded, non-executable extension bag from foreign formats. */
    extensions?: Record<string, unknown>
  }
  /** Records the schema version this document was migrated from. */
  migratedFrom?: {
    schemaVersion: number
  }
}

/** Per-sheet layout settings. */
export type MindMapLayoutSettings = {
  structureClass: MindMapStructureClass
  direction?: 'ltr' | 'rtl'
  compact?: boolean
  /** Base spacing between sibling subtrees. */
  spacing?: number
  /** Connector line style: curve (default), elbow, or straight. */
  lineStyle?: 'curve' | 'straight' | 'elbow' | 'rounded-elbow' | 'bight' | 'fold' | 'rounded-fold'
  /**
   * Per-sheet branch line-width scale (P2 §5.1).
   * 1 = default width; the five UI tokens map to 0.5, 0.75, 1, 1.5 and 2.
   * Multiplies the depth-based {@link edgeStrokeWidth}.
   */
  lineWidthScale?: number
  /** Branch line pattern: solid (default), dash, or hand-drawn variants. */
  linePattern?: 'solid' | 'dash' | 'hand-drawn-solid' | 'hand-drawn-dash'
  /** When true, branch lines taper from the parent width toward the child. */
  tapered?: boolean
}

/** Per-sheet viewport (camera) state. */
export type MindMapViewport = {
  x: number
  y: number
  zoom: number
}

/** User planning state attached to a topic. */
export type MindMapPlanningMetadata = {
  taskStatus?: 'not-started' | 'todo' | 'doing' | 'done'
  dueAt?: string
  /** 0..100 progress. */
  progress?: number
  priority?: number
}

/** Marker/icon reference — StudiumX-owned, accessible, limited set. */
export type MindMapMarker = {
  id: string
  symbol: string
  label?: string
}

/** Web link attached to a topic. */
export type MindMapLink = {
  id: string
  url: string
  title?: string
}

/**
 * Source anchor pointing back into the StudiumX workspace (notes, lessons,
 * glossary, files). Line numbers are hints, never identity.
 */
export type MindMapSourceRef = {
  id: string
  workspacePath?: string
  /** Human-readable breadcrumb (e.g. ["Unit 3", "Acids and Bases"]). */
  breadcrumb?: string[]
  blockId?: string
  contentHash?: string
  lastConfirmedAt?: string
  /** Set when the anchored source changed after the last confirmation. */
  stale?: boolean
}

/** Local style override applied on top of the inherited theme. */
export type MindMapTopicStyleOverride = {
  fill?: string
  stroke?: string
  /** Topic outline pattern. `none` hides the outline while retaining color/width overrides. */
  borderStyle?: 'none' | 'solid' | 'dash' | 'hand-drawn-solid' | 'hand-drawn-dash'
  /** Topic outline width in SVG/CSS pixels. */
  borderWidth?: number
  textColor?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  fontStyle?: 'normal' | 'italic'
  /** Independent underline/strikethrough flags serialized as a stable CSS/XMind token. */
  textDecoration?: 'none' | 'underline' | 'line-through' | 'line-through underline'
  /** Visual casing only; it never changes the canonical topic title text. */
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  /** Horizontal label alignment within the topic shape. */
  textAlign?: 'left' | 'center' | 'right'
  shape?: string
  /** Topic fill pattern: solid fill, hand-drawn, diagonal or horizontal hatching. */
  fillPattern?: 'solid' | 'hand-drawn' | 'diagonal' | 'horizontal'
  /** Node width sizing mode. Omitted means the default automatic sizing. */
  widthMode?: 'auto' | 'fixed'
  /** Fixed node width in SVG/CSS pixels, used only when widthMode is fixed. */
  width?: number
  /**
   * v1 compat: XMind structure-class override carried over from the v1 node
   * model so migration does not silently drop per-node layout overrides.
   */
  structureClass?: MindMapStructureClass
}

/** A topic (node) in a sheet's topic tree. */
export type MindMapTopicV2 = {
  id: string
  title: string
  note?: string
  collapsed?: boolean
  children: MindMapTopicV2[]
  labels?: string[]
  markers?: MindMapMarker[]
  links?: MindMapLink[]
  sourceRefs?: MindMapSourceRef[]
  /** Stable ids into the document-level workspace asset table. */
  assetIds?: string[]
  planning?: MindMapPlanningMetadata
  style?: MindMapTopicStyleOverride
  /** Manual (free) position override for the topic. */
  manualPosition?: MindMapPoint
}

/** Shared fields for every element in a sheet's `elements` collection. */
export type MindMapElementBase = {
  id: string
  type: MindMapElementType
  label?: string
  style?: MindMapElementStyle
}

export type MindMapElementType =
  | 'relationship'
  | 'boundary'
  | 'summary'
  | 'callout'
  | 'free-topic'

/** A labelled connector between two topics. */
export type MindMapRelationship = MindMapElementBase & {
  type: 'relationship'
  from: string
  to: string
}

/** A boundary enclosing a topic subtree. */
export type MindMapBoundary = MindMapElementBase & {
  type: 'boundary'
  /** Root node id of the bounded subtree. */
  topicId: string
  /** Optional explicit node ids inside the boundary (must all be in the tree). */
  children?: string[]
}

/** A brace-style summary over a contiguous sibling range. */
export type MindMapSummary = MindMapElementBase & {
  type: 'summary'
  from: string
  to: string
}

/** An annotation attached to a topic. */
export type MindMapCallout = MindMapElementBase & {
  type: 'callout'
  topicId: string
  text: string
  position?: MindMapPoint
}

/** A freely-positioned topic (references the topic node it renders). */
export type MindMapFreeTopic = MindMapElementBase & {
  type: 'free-topic'
  topicId: string
  position: MindMapPoint
}

/** Discriminated union of sheet elements. All id refs point to stable node ids. */
export type MindMapElement =
  | MindMapRelationship
  | MindMapBoundary
  | MindMapSummary
  | MindMapCallout
  | MindMapFreeTopic

/** Relationship endpoint arrow token (XMind `org.xmind.arrowShape.*`). */
export type MindMapElementArrowShape =
  | 'none'
  | 'dot'
  | 'triangle'
  | 'spearhead'
  | 'square'
  | 'diamond'
  | 'herringbone'
  | 'double-arrow'
  | 'anti-triangle'
  | 'attached'
  | 'hook'

/** Relationship connector shape token (XMind `org.xmind.relationshipShape.*`). */
export type MindMapElementLineShape =
  | 'curved'
  | 'straight'
  | 'angled'
  | 'zigzag'
  | 'flexible-curved'
  | 'flexible-angled'
  | 'flexible-zigzag'

/** Element stroke pattern token (XMind line-pattern `solid/dash/dot/dash-dot/dash-dot-dot`). */
export type MindMapElementLinePattern =
  | 'solid'
  | 'dash'
  | 'dot'
  | 'dash-dot'
  | 'dash-dot-dot'

/** Outline shape token for boundary/summary/callout containers. */
export type MindMapElementOutlineShape =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'polygon'
  | 'scallops'
  | 'waves'
  | 'tension'
  | 'bracket'

/** Style override for elements. */
export type MindMapElementStyle = {
  stroke?: string
  strokeWidth?: number
  fill?: string
  textColor?: string
  fontFamily?: string
  fontSize?: number
  dashed?: boolean
  /** Relationship connector curve; omitted means the theme/default curve. */
  lineShape?: MindMapElementLineShape
  /** Relationship endpoint arrows. */
  beginArrow?: MindMapElementArrowShape
  endArrow?: MindMapElementArrowShape
  /** Stroke dash token for relationship/boundary/summary/callout lines. */
  linePattern?: MindMapElementLinePattern
  /** Boundary/summary/callout outline shape; omitted means the element default. */
  outlineShape?: MindMapElementOutlineShape
}

/** A sheet: topic tree + flat element collection + layout/camera. */
export type MindMapSheetV2 = {
  id: string
  title: string
  root: MindMapTopicV2
  elements: MindMapElement[]
  layout: MindMapLayoutSettings
  viewport?: MindMapViewport
}

/** Top-level v2 mind map document. */
export type MindMapDocumentV2 = {
  schemaVersion: typeof MIND_MAP_DOCUMENT_SCHEMA_VERSION_V2
  id: string
  revision: number
  title: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  theme: MindMapTheme
  sheets: MindMapSheetV2[]
  assets: MindMapAssetRef[]
  interop?: MindMapInteropMetadata
}
