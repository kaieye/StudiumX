/**
 * Renderer-side v2 → v1 projection for back-compat helper consumers.
 *
 * The main-process mind-map IPC now speaks the v2 schema, so the renderer
 * keeps `MindMapDocumentV2` as its session authority. This projector still
 * exists for any legacy v1-shaped consumer (e.g. `.xmind` export adapters).
 * Elements/layout/theme are outside the v1 schema and are intentionally
 * dropped here; the renderer keeps the v2 document as its session authority.
 */
import type {
  MindMapDocumentV2,
  MindMapSheetV2,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'
import type {
  MindMapDocument,
  MindMapNode,
  MindMapSheet
} from '../../../../shared/mindmap/mind-map-types'

export function convertTopicToV1(topic: MindMapTopicV2): MindMapNode {
  return {
    id: topic.id,
    title: topic.title,
    ...(topic.note !== undefined ? { note: topic.note } : {}),
    ...(topic.collapsed !== undefined ? { collapsed: topic.collapsed } : {}),
    ...(topic.style?.structureClass !== undefined
      ? { structureClass: topic.style.structureClass }
      : {}),
    children: topic.children.map(convertTopicToV1)
  }
}

export function convertSheetToV1(sheet: MindMapSheetV2): MindMapSheet {
  return {
    id: sheet.id,
    title: sheet.title,
    structureClass: sheet.layout.structureClass,
    root: convertTopicToV1(sheet.root)
  }
}

export function convertV2ToV1(document: MindMapDocumentV2): MindMapDocument {
  return {
    schemaVersion: 1,
    id: document.id,
    title: document.title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    sheets: document.sheets.map(convertSheetToV1)
  }
}
