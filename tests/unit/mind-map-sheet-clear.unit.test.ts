import { describe, expect, it } from 'vitest'

import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import { MindMapUndoRedoStack } from '../../src/shared/mindmap/commands/mind-map-undo-redo'
import type { MindMapCommandResult } from '../../src/shared/mindmap/commands/mind-map-command-types'
import { validateMindMapDocumentV2 } from '../../src/shared/mindmap/domain/invariants'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'Clear me',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Canvas',
        root: {
          id: 'root-1',
          title: 'Root',
          children: [
            { id: 'a', title: 'A', children: [{ id: 'a1', title: 'A1', children: [] }] },
            { id: 'b', title: 'B', children: [] }
          ]
        },
        elements: [
          // Standalone shapes drawn by the learner.
          { id: 'shape-1', type: 'shape', shape: 'rect', position: { x: 10, y: 20 }, width: 80, height: 40 },
          { id: 'shape-2', type: 'shape', shape: 'ellipse', position: { x: 200, y: 20 }, width: 60, height: 60 },
          // A free connector between two drawn shapes.
          {
            id: 'line-1',
            type: 'connector',
            start: { x: 90, y: 40, anchor: { targetType: 'shape', targetId: 'shape-1' } },
            end: { x: 200, y: 50, anchor: { targetType: 'shape', targetId: 'shape-2' } }
          },
          // Topic-anchored elements.
          { id: 'rel-1', type: 'relationship', from: 'a', to: 'b' },
          { id: 'boundary-1', type: 'boundary', topicId: 'a', children: ['a1'] },
          { id: 'callout-1', type: 'callout', topicId: 'a1', text: 'note', position: { x: 1, y: 2 } },
          { id: 'free-1', type: 'free-topic', topicId: 'a', position: { x: 5, y: 6 } }
        ],
        images: [
          {
            id: 'img-1',
            type: 'image',
            assetId: 'asset-1',
            width: 160,
            height: 88,
            position: { x: 40, y: 60 }
          }
        ],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: [{ id: 'asset-1', fileName: 'a.png', mimeType: 'image/png' }]
  }
}

function expectOk(result: MindMapCommandResult): asserts result is Extract<MindMapCommandResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  }
}

function expectValid(document: MindMapDocumentV2): void {
  const validation = validateMindMapDocumentV2(document)
  expect(validation.ok, validation.ok ? '' : validation.errors.map((e) => e.message).join('; ')).toBe(true)
}

describe('sheet.clear', () => {
  it('removes every non-root topic, element and image while keeping the sheet shell', () => {
    const result = applyMindMapCommand(makeDocument(), {
      type: 'sheet.clear',
      sheetId: 'sheet-1'
    })
    expectOk(result)

    const sheet = result.document.sheets[0]!
    expect(sheet.title).toBe('Canvas')
    expect(sheet.root.id).toBe('root-1')
    expect(sheet.root.title).toBe('Root')
    expect(sheet.root.children).toEqual([])
    expect(sheet.elements).toEqual([])
    expect(sheet.images ?? []).toEqual([])
    // Assets are document-level and shared, so clearing a sheet keeps them.
    expect(result.document.assets).toHaveLength(1)
    expectValid(result.document)
  })

  it('returns SHEET_NOT_FOUND for an unknown sheet', () => {
    const result = applyMindMapCommand(makeDocument(), {
      type: 'sheet.clear',
      sheetId: 'missing'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('SHEET_NOT_FOUND')
  })

  it('is a no-op on an already-empty sheet and still keeps the root', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children = []
    document.sheets[0]!.elements = []
    document.sheets[0]!.images = []

    const result = applyMindMapCommand(document, { type: 'sheet.clear', sheetId: 'sheet-1' })
    expectOk(result)
    expect(result.document.sheets[0]!.root.id).toBe('root-1')
    expect(result.document.sheets[0]!.root.children).toEqual([])
  })

  it('inverse restores the exact prior content', () => {
    const document = makeDocument()
    const result = applyMindMapCommand(document, { type: 'sheet.clear', sheetId: 'sheet-1' })
    expectOk(result)

    const restored = applyMindMapCommand(result.document, result.inverse)
    expectOk(restored)
    expect(restored.document).toEqual(document)
    expectValid(restored.document)
  })

  it('supports undo/redo round-trip through the undo stack', () => {
    const stack = new MindMapUndoRedoStack(makeDocument())

    const executed = stack.execute({ type: 'sheet.clear', sheetId: 'sheet-1' }, { label: 'Clear canvas' })
    expectOk(executed)
    const cleared = stack.document.sheets[0]!
    expect(cleared.root.children).toEqual([])
    expect(cleared.elements).toEqual([])
    expect(cleared.images ?? []).toEqual([])

    const undoResult = stack.undo()
    expectOk(undoResult!)
    expect(stack.document).toEqual(makeDocument())

    const redoResult = stack.redo()
    expectOk(redoResult!)
    expect(stack.document.sheets[0]!.root.children).toEqual([])
    expect(stack.document.sheets[0]!.elements).toEqual([])
    expect(stack.document.sheets[0]!.images ?? []).toEqual([])
  })

  it('restores shape-anchored connectors in the correct order on undo and clears them on redo', () => {
    // shape-2 is referenced by line-1; the inverse must create shapes before
    // connectors and redo must remove connectors before shapes.
    const document = makeDocument()
    const result = applyMindMapCommand(document, { type: 'sheet.clear', sheetId: 'sheet-1' })
    expectOk(result)
    expectValid(result.document)

    const restored = applyMindMapCommand(result.document, result.inverse)
    expectOk(restored)
    expect(restored.document).toEqual(document)

    // Redo = apply the inverse of the inverse transaction.
    const redo = applyMindMapCommand(restored.document, restored.inverse)
    expectOk(redo)
    expect(redo.document.sheets[0]!.root.children).toEqual([])
    expect(redo.document.sheets[0]!.elements).toEqual([])
    expect(redo.document.sheets[0]!.images ?? []).toEqual([])
    expectValid(redo.document)
  })
})
