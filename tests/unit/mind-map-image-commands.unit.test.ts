import { describe, expect, it } from 'vitest'
import type {
  MindMapDocumentV2,
  MindMapImageElement,
  MindMapSheetV2
} from '../../src/shared/mindmap/domain/types'
import { migrateTopicAssetsToImages } from '../../src/shared/mindmap/migrations'
import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import { validateMindMapDocumentV2 } from '../../src/shared/mindmap/domain/invariants'

const NOW = '2026-08-15T00:00:00.000Z'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'Images',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'S',
        root: { id: 'root', title: 'Root', children: [] },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: [{ id: 'asset-1', fileName: 'a.png', mimeType: 'image/png' }]
  }
}

const freeImage = (overrides: Partial<MindMapImageElement> = {}): MindMapImageElement => ({
  id: 'img-1',
  type: 'image',
  assetId: 'asset-1',
  width: 160,
  height: 88,
  position: { x: 40, y: 60 },
  ...overrides
})

describe('mind map image commands', () => {
  it('creates a free image element', () => {
    const result = applyMindMapCommand(makeDocument(), {
      type: 'image.create',
      sheetId: 'sheet-1',
      image: freeImage()
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.document.sheets[0]!.images).toEqual([freeImage()])
  })

  it('rejects an image whose asset does not exist', () => {
    const result = applyMindMapCommand(makeDocument(), {
      type: 'image.create',
      sheetId: 'sheet-1',
      image: freeImage({ assetId: 'missing' })
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ASSET_NOT_FOUND')
  })

  it('attaches an image to a topic and clears the free position', () => {
    const created = applyMindMapCommand(makeDocument(), {
      type: 'image.create',
      sheetId: 'sheet-1',
      image: freeImage()
    })
    if (!created.ok) throw new Error('create failed')
    const attached = applyMindMapCommand(created.document, {
      type: 'image.update',
      sheetId: 'sheet-1',
      imageId: 'img-1',
      patch: { topicId: 'root', position: null }
    })
    expect(attached.ok).toBe(true)
    if (attached.ok) {
      expect(attached.document.sheets[0]!.images![0]).toMatchObject({
        id: 'img-1',
        topicId: 'root',
        position: undefined
      })
      expect(validateMindMapDocumentV2(attached.document).ok).toBe(true)
    }
  })

  it('moves an attached image to a free position', () => {
    const doc: MindMapDocumentV2 = {
      ...makeDocument(),
      sheets: [{
        ...makeDocument().sheets[0]!,
        images: [freeImage({ topicId: 'root' })]
      }]
    }
    const result = applyMindMapCommand(doc, {
      type: 'image.update',
      sheetId: 'sheet-1',
      imageId: 'img-1',
      patch: { topicId: null, position: { x: 1, y: 2 } }
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.document.sheets[0]!.images![0]).toMatchObject({
        topicId: undefined,
        position: { x: 1, y: 2 }
      })
    }
  })

  it('resizes an image', () => {
    const result = applyMindMapCommand(makeDocument(), {
      type: 'image.create',
      sheetId: 'sheet-1',
      image: freeImage()
    })
    if (!result.ok) throw new Error('create failed')
    const resized = applyMindMapCommand(result.document, {
      type: 'image.update',
      sheetId: 'sheet-1',
      imageId: 'img-1',
      patch: { width: 200, height: 120 }
    })
    expect(resized.ok).toBe(true)
    if (resized.ok) {
      expect(resized.document.sheets[0]!.images![0]).toMatchObject({ width: 200, height: 120 })
    }
  })

  it('removes an image', () => {
    const doc: MindMapDocumentV2 = {
      ...makeDocument(),
      sheets: [{
        ...makeDocument().sheets[0]!,
        images: [freeImage()]
      }]
    }
    const result = applyMindMapCommand(doc, {
      type: 'image.remove',
      sheetId: 'sheet-1',
      imageId: 'img-1'
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.document.sheets[0]!.images ?? []).toHaveLength(0)
  })

  it('blocks removing an asset that an image still references', () => {
    const doc: MindMapDocumentV2 = {
      ...makeDocument(),
      sheets: [{
        ...makeDocument().sheets[0]!,
        images: [freeImage()]
      }]
    }
    const result = applyMindMapCommand(doc, { type: 'asset.remove', assetId: 'asset-1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_PATCH')
  })
})

describe('migrateTopicAssetsToImages', () => {
  it('promotes topic assetIds into attached image elements and clears the legacy fields', () => {
    const doc: MindMapDocumentV2 = {
      ...makeDocument(),
      sheets: [{
        ...makeDocument().sheets[0]!,
        root: {
          id: 'root',
          title: 'Root',
          assetIds: ['asset-1'],
          imagePlacement: 'right',
          children: []
        }
      }]
    }
    const migrated = migrateTopicAssetsToImages(doc)
    const sheet = migrated.sheets[0]!
    expect(sheet.images![0]).toMatchObject({
      type: 'image',
      assetId: 'asset-1',
      topicId: 'root',
      width: 160,
      height: 88
    })
    expect(sheet.root.assetIds).toBeUndefined()
    expect(sheet.root.imagePlacement).toBeUndefined()
  })

  it('is idempotent for documents without legacy assetIds', () => {
    const doc = makeDocument()
    expect(migrateTopicAssetsToImages(doc)).toBe(doc)
  })
})

describe('mind map image invariants', () => {
  it('reports an image referencing a missing asset id', () => {
    const doc: MindMapDocumentV2 = {
      ...makeDocument(),
      sheets: [{
        ...makeDocument().sheets[0]!,
        images: [freeImage({ assetId: 'missing' })]
      }]
    }
    const result = validateMindMapDocumentV2(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('missing asset id'))).toBe(true)
    }
  })

  it('reports an attached image referencing a missing topic id', () => {
    const doc: MindMapDocumentV2 = {
      ...makeDocument(),
      sheets: [{
        ...makeDocument().sheets[0]!,
        images: [freeImage({ topicId: 'ghost' })]
      }]
    }
    const result = validateMindMapDocumentV2(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('missing node id "ghost"'))).toBe(true)
    }
  })
})

import { mindMapDocumentV2Schema, mindMapImageElementSchema } from '../../src/shared/mindmap/domain/schema'

describe('mind map image schema', () => {
  it('accepts a valid image element and rejects a non-positive size', () => {
    expect(mindMapImageElementSchema.safeParse(freeImage()).success).toBe(true)
    expect(mindMapImageElementSchema.safeParse(freeImage({ width: 0 })).success).toBe(false)
    expect(mindMapImageElementSchema.safeParse(freeImage({ assetId: '' })).success).toBe(false)
  })

  it('accepts a document with an images collection', () => {
    const doc: MindMapDocumentV2 = {
      ...makeDocument(),
      sheets: [{
        ...(makeDocument().sheets[0] as MindMapSheetV2),
        images: [freeImage()]
      }]
    }
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)
  })
})

describe('mind map image + topic cleanup', () => {
  it('removing a topic also removes its attached images', () => {
    const doc: MindMapDocumentV2 = {
      ...makeDocument(),
      sheets: [{
        ...(makeDocument().sheets[0] as MindMapSheetV2),
        root: {
          id: 'root',
          title: 'Root',
          children: [{ id: 'child', title: 'Child', children: [] }]
        },
        images: [freeImage({ id: 'img-1', topicId: 'child' })]
      }]
    }
    const result = applyMindMapCommand(doc, {
      type: 'topic.remove',
      sheetId: 'sheet-1',
      topicId: 'child'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.document.sheets[0]!.images ?? []).toHaveLength(0)
      expect(validateMindMapDocumentV2(result.document).ok).toBe(true)
    }
  })
})
