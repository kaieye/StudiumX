/**
 * Shared v2 → v1 projection (ADR-0173 §3 compatibility).
 *
 * The main-process `.xmind` export path and the v1 interop converters still
 * speak the v1 schema, so before exporting we project the v2 document (which
 * the repository and IPC contract operate on) back to the v1 shape.
 * Most elements/layout/theme/assets are outside the v1 schema and are
 * intentionally dropped here; sheet-level relationships are the first
 * advanced element explicitly projected for XMind interop.
 */
import type {
  MindMapDocumentV2,
  MindMapRelationship as MindMapRelationshipV2,
  MindMapSheetV2,
  MindMapTopicV2
} from './domain/types'
import type {
  MindMapDocument,
  MindMapNode,
  MindMapRelationship as MindMapRelationshipV1,
  MindMapSheet
} from './mind-map-types'

export function convertTopicToV1(topic: MindMapTopicV2): MindMapNode {
  return {
    id: topic.id,
    title: topic.title,
    ...(topic.note !== undefined ? { note: topic.note } : {}),
    ...(topic.collapsed !== undefined ? { collapsed: topic.collapsed } : {}),
    ...(topic.style?.structureClass !== undefined
      ? { structureClass: topic.style.structureClass }
      : {}),
    ...(topic.assetIds !== undefined ? { assetIds: [...topic.assetIds] } : {}),
    children: topic.children.map(convertTopicToV1)
  }
}

function convertRelationshipToV1(
  relationship: MindMapRelationshipV2
): MindMapRelationshipV1 {
  return {
    id: relationship.id,
    from: relationship.from,
    to: relationship.to,
    ...(relationship.label !== undefined ? { label: relationship.label } : {})
  }
}

export function convertSheetToV1(sheet: MindMapSheetV2): MindMapSheet {
  const relationships = sheet.elements
    .filter(
      (element): element is MindMapRelationshipV2 => element.type === 'relationship'
    )
    .map(convertRelationshipToV1)

  return {
    id: sheet.id,
    title: sheet.title,
    structureClass: sheet.layout.structureClass,
    root: convertTopicToV1(sheet.root),
    ...(relationships.length > 0 ? { relationships } : {})
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
