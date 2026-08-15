/**
 * assetIds → image elements migration.
 *
 * Earlier versions of the v2 model attached images to a topic via a flat
 * `assetIds: string[]` plus a single `imagePlacement` and rendered them as a
 * stacked block. This migration promotes each attached asset into an
 * independent `MindMapImageElement` in the sheet's `images` collection so
 * images become draggable, resizable and re-parentable (the newer model).
 *
 * Deterministic and idempotent: a topic that already has no `assetIds` is left
 * untouched, so re-running the migration over a migrated document is a no-op.
 * The input document is never mutated.
 */
import type {
  MindMapDocumentV2,
  MindMapImageElement,
  MindMapSheetV2,
  MindMapTopicV2
} from '../domain/types'

/** Default rendered size for an image promoted from a legacy topic asset. */
export const MIND_MAP_MIGRATED_IMAGE_WIDTH = 160
export const MIND_MAP_MIGRATED_IMAGE_HEIGHT = 88

/**
 * Convert every topic `assetIds` into attached image elements and clear the
 * legacy fields. Returns a new document; the input is never mutated.
 */
export function migrateTopicAssetsToImages(
  document: MindMapDocumentV2
): MindMapDocumentV2 {
  const hasLegacyAssets = document.sheets.some((sheet) =>
    sheetHasLegacyAssets(sheet.root)
  )
  if (!hasLegacyAssets) return document

  const next: MindMapDocumentV2 = {
    ...document,
    sheets: document.sheets.map((sheet) => migrateSheet(sheet))
  }
  return next
}

function sheetHasLegacyAssets(root: MindMapTopicV2): boolean {
  if (root.assetIds !== undefined && root.assetIds.length > 0) return true
  return root.children.some((child) => sheetHasLegacyAssets(child))
}

function migrateSheet(sheet: MindMapSheetV2): MindMapSheetV2 {
  const images: MindMapImageElement[] = []
  const root = migrateTopic(sheet.root, images)
  const existing = sheet.images ?? []
  return {
    ...sheet,
    root,
    images: [...images, ...existing]
  }
}

function migrateTopic(
  topic: MindMapTopicV2,
  images: MindMapImageElement[]
): MindMapTopicV2 {
  let next = topic
  if (topic.assetIds !== undefined && topic.assetIds.length > 0) {
    const promoted: MindMapImageElement[] = topic.assetIds.map((assetId, index) => ({
      id: `${topic.id}-img-${index}`,
      type: 'image',
      assetId,
      width: MIND_MAP_MIGRATED_IMAGE_WIDTH,
      height: MIND_MAP_MIGRATED_IMAGE_HEIGHT,
      topicId: topic.id
    }))
    images.push(...promoted)
    const { assetIds: _assetIds, imagePlacement: _imagePlacement, ...rest } = topic
    next = { ...rest, children: topic.children }
  }
  next = {
    ...next,
    children: next.children.map((child) => migrateTopic(child, images))
  }
  return next
}
