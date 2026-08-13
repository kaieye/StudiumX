/**
 * Mind map data model — mirrors XMind's content structure (sheet → rootTopic →
 * recursive topic tree) so `.xmind` interop needs only ZIP codec + field
 * mapping, not structural translation. See docs/mindmap/design.md §2.
 */

/** Current document schema version (see `MindMapDocument.schemaVersion`). */
export const MIND_MAP_DOCUMENT_SCHEMA_VERSION = 1

/**
 * Layout structure class, values aligned with XMind's `structureClass`
 * (`org.xmind.ui.logic.*`).
 */
export type MindMapStructureClass =
  | 'org.xmind.ui.logic.right' // 右侧逻辑图
  | 'org.xmind.ui.logic.balanced' // 两侧均衡
  | 'org.xmind.ui.logic.left' // 左侧逻辑图
  | 'org.xmind.ui.logic.map' // 思维导图（双向发散）
  | 'org.xmind.ui.logic.down' // 向下组织图
  | 'org.xmind.ui.logic.up' // 向上组织图
  | 'org.xmind.ui.map' // 思维导图（Xmind 原生结构类）
  | 'org.xmind.ui.map.clockwise' // 思维导图（顺时针）
  | 'org.xmind.ui.map.anticlockwise' // 思维导图（逆时针）
  | 'org.xmind.ui.org-chart.down' // 组织结构图（向下）
  | 'org.xmind.ui.org-chart.up' // 组织结构图（向上）
  | 'org.xmind.ui.tree.right' // 树形图（向右）
  | 'org.xmind.ui.tree.left' // 树形图（向左）
  | 'org.xmind.ui.brace.right' // 括号图（向右）
  | 'org.xmind.ui.brace.left' // 括号图（向左）
  | 'org.xmind.ui.timeline.horizontal' // 时间轴（水平）
  | 'org.xmind.ui.timeline.vertical' // 时间轴（垂直）
  | 'org.xmind.ui.spreadsheet' // 矩阵图（行）
  | 'org.xmind.ui.spreadsheet.column' // 矩阵图（列）
  | 'org.xmind.ui.fishbone.rightHeaded' // 鱼骨图（头向右）
  | 'org.xmind.ui.fishbone.leftHeaded' // 鱼骨图（头向左）

/** Structure class used when an XMind topic omits one (forward compatible). */
export const DEFAULT_MIND_MAP_STRUCTURE_CLASS: MindMapStructureClass =
  'org.xmind.ui.logic.balanced'

export type MindMapNode = {
  id: string
  title: string
  /** 备注/说明（可选）。 */
  note?: string
  /** 该分支是否折叠展开子节点。 */
  collapsed?: boolean
  /** 子树局部布局覆盖（可选，默认继承 sheet）。 */
  structureClass?: MindMapStructureClass
  /** Stable workspace asset ids attached to this topic (interop-only in v1). */
  assetIds?: string[]
  /**
   * Topic numbering metadata carried across the XMind import boundary and
   * migrated into the v2 topic. Interop-only in v1: the native canvas
   * numbering feature lives on the v2 model.
   */
  numbering?: {
    pattern?: 'none' | 'arabic' | 'uppercase' | 'lowercase' | 'roman'
    tiered?: boolean
    restartAt?: number
  }
  /** 附加（attached）子分支。 */
  children: MindMapNode[]
}

/** A relationship connector represented by XMind's sheet-level relationship list. */
export type MindMapRelationship = {
  id: string
  from: string
  to: string
  /** XMind relationship title, projected to the v2 element label. */
  label?: string
}

export type MindMapSheet = {
  id: string
  title: string
  structureClass: MindMapStructureClass
  /** 中心主题（rootTopic）。 */
  root: MindMapNode
  /** Sheet-level relationship connectors retained for XMind/v2 interop. */
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

/** 列表投影：一个文档一行，不含完整 sheet 内容。 */
export type MindMapSummary = {
  id: string
  title: string
  updatedAt: string
  sheetCount: number
}