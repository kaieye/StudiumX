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
  | 'org.xmind.ui.logic.right' // 右侧逻辑图（XMind 默认）
  | 'org.xmind.ui.logic.balanced' // 两侧均衡
  | 'org.xmind.ui.logic.left' // 左侧逻辑图
  | 'org.xmind.ui.logic.map' // 思维导图（双向发散）
  | 'org.xmind.ui.logic.down' // 向下组织图
  | 'org.xmind.ui.logic.up' // 向上组织图

/** Structure class used when an XMind topic omits one (forward compatible). */
export const DEFAULT_MIND_MAP_STRUCTURE_CLASS: MindMapStructureClass =
  'org.xmind.ui.logic.right'

export type MindMapNode = {
  id: string
  title: string
  /** 备注/说明（可选）。 */
  note?: string
  /** 该分支是否折叠展开子节点。 */
  collapsed?: boolean
  /** 子树局部布局覆盖（可选，默认继承 sheet）。 */
  structureClass?: MindMapStructureClass
  /** 附加（attached）子分支。 */
  children: MindMapNode[]
}

export type MindMapSheet = {
  id: string
  title: string
  structureClass: MindMapStructureClass
  /** 中心主题（rootTopic）。 */
  root: MindMapNode
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