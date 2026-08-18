import type {
  MindMapElement,
  MindMapLayoutSettings,
  MindMapTheme,
  MindMapTopicV2
} from './domain/types'

/**
 * Native StudiumX mind-map data model: sheets, root topics, and recursive topic trees.
 * See docs/mindmap/design.md §2.
 */

/** Current document schema version (see `MindMapDocument.schemaVersion`). */
export const MIND_MAP_DOCUMENT_SCHEMA_VERSION = 1

/**
 * Layout structure class, values aligned with StudiumX's `structureClass`
 * (`studiumx.layout.logic.*`).
 */
export type MindMapStructureClass =
  | 'studiumx.layout.logic.right' // 右侧逻辑图
  | 'studiumx.layout.logic.balanced' // 两侧均衡
  | 'studiumx.layout.logic.left' // 左侧逻辑图
  | 'studiumx.layout.logic.map' // 思维导图（双向发散）
  | 'studiumx.layout.logic.down' // 向下组织图
  | 'studiumx.layout.logic.up' // 向上组织图
  | 'studiumx.layout.map' // 思维导图（StudiumX 原生结构类）
  | 'studiumx.layout.map.clockwise' // 思维导图（顺时针）
  | 'studiumx.layout.map.anticlockwise' // 思维导图（逆时针）
  | 'studiumx.layout.org-chart.down' // 组织结构图（向下）
  | 'studiumx.layout.org-chart.up' // 组织结构图（向上）
  | 'studiumx.layout.tree.right' // 树形图（向右）
  | 'studiumx.layout.tree.left' // 树形图（向左）
  | 'studiumx.layout.brace.right' // 括号图（向右）
  | 'studiumx.layout.brace.left' // 括号图（向左）
  | 'studiumx.layout.timeline.horizontal' // 时间轴（水平）
  | 'studiumx.layout.timeline.vertical' // 时间轴（垂直）
  | 'studiumx.layout.spreadsheet' // 矩阵图（行）
  | 'studiumx.layout.spreadsheet.column' // 矩阵图（列）
  | 'studiumx.layout.fishbone.rightHeaded' // 鱼骨图（头向右）
  | 'studiumx.layout.fishbone.leftHeaded' // 鱼骨图（头向左）

/** Structure class used when a topic omits one (forward compatible). */
export const DEFAULT_MIND_MAP_STRUCTURE_CLASS: MindMapStructureClass =
  'studiumx.layout.logic.right'

/** Shape assigned to new topics unless a sheet selects another default. */
export const DEFAULT_MIND_MAP_TOPIC_SHAPE = 'rounded-rect' as const

export type MindMapNode = {
  id: string
  title: string
  /** 备注/说明（可选）。 */
  note?: string
  /** 该分支是否折叠展开子节点。 */
  collapsed?: boolean
  /** 子树局部布局覆盖（可选，默认继承 sheet）。 */
  structureClass?: MindMapStructureClass
  /** Stable workspace asset ids attached to this topic. */
  assetIds?: string[]
  /**
   * Topic numbering metadata preserved by the native document model. The v2
   * canvas provides the corresponding numbering controls.
   */
  numbering?: {
    pattern?: 'none' | 'arabic' | 'uppercase' | 'lowercase' | 'roman'
    tiered?: boolean
    restartAt?: number
  }
  /** 附加（attached）子分支。 */
  children: MindMapNode[]
}

/** A relationship connector represented by a sheet-level relationship list. */
export type MindMapRelationship = {
  id: string
  from: string
  to: string
  /** Optional relationship title. */
  label?: string
}

export type MindMapSheet = {
  id: string
  title: string
  structureClass: MindMapStructureClass
  /** 中心主题（rootTopic）。 */
  root: MindMapNode
  /** Sheet-level relationship connectors. */
  relationships?: MindMapRelationship[]
}

/** 顶层文档：一个 .studiumx-mindmap 文件对应一个文档，可含多 sheet。 */
export type MindMapDocument = {
  schemaVersion: typeof MIND_MAP_DOCUMENT_SCHEMA_VERSION
  id: string
  title: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  sheets: MindMapSheet[]
}

/** 列表投影：一个文档一行，仅带首个 sheet 的卡片预览投影。 */
export type MindMapSummary = {
  id: string
  title: string
  updatedAt: string
  sheetCount: number
  /**
   * Lightweight first-sheet projection used by the library cards. It keeps
   * previews on the list response without shipping sheet elements or assets.
   */
  preview?: MindMapCardPreview
}

/** Data required to render a card without opening the canonical document.
 *
 * `elements` carries the first sheet's drawing/relationship/summary/
 * boundary/callout elements so the home-page preview can mirror the canvas
 * (shapes, free connectors, braces, …) instead of only the topic tree. Asset
 * images stay behind the canonical read boundary and are not projected. */
export type MindMapCardPreview = {
  theme: MindMapTheme
  root: MindMapTopicV2
  layout: MindMapLayoutSettings
  elements?: MindMapElement[]
}
