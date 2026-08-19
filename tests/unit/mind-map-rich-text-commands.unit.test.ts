import { describe, expect, it } from 'vitest'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import { MindMapUndoRedoStack } from '../../src/shared/mindmap/commands/mind-map-undo-redo'
import {
  mindMapDocumentV2Schema,
  mindMapTopicV2Schema,
  mindMapShapeSchema
} from '../../src/shared/mindmap/domain/schema'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'Test',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1', name: 'Default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        root: {
          id: 'root-1',
          title: 'Root',
          children: [{ id: 'a', title: 'Alpha', children: [] }]
        },
        elements: [
          {
            id: 'shape-1',
            type: 'shape',
            shape: 'rect',
            position: { x: 100, y: 100 },
            width: 120,
            height: 80,
            label: 'Label'
          }
        ],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

describe('rich text commands', () => {
  it('persists titleFormatting through topic.update and undoes it', () => {
    const document = makeDocument()
    const result = applyMindMapCommand(document, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: {
        title: 'Alpha bold',
        titleFormatting: [{ start: 0, end: 5, bold: true, color: '#ff0000' }]
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const next = result.document
    const topic = next.sheets[0]!.root.children[0]!
    expect(topic.title).toBe('Alpha bold')
    expect(topic.titleFormatting).toEqual([{ start: 0, end: 5, bold: true, color: '#ff0000' }])

    const undone = applyMindMapCommand(next, result.inverse)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    const restored = undone.document.sheets[0]!.root.children[0]!
    expect(restored.title).toBe('Alpha')
    expect(restored.titleFormatting).toBeUndefined()
  })

  it('clears titleFormatting with null and restores via undo', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.titleFormatting = [{ start: 0, end: 5, bold: true }]
    const result = applyMindMapCommand(document, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { titleFormatting: null }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.sheets[0]!.root.children[0]!.titleFormatting).toBeUndefined()
    const undone = applyMindMapCommand(result.document, result.inverse)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.document.sheets[0]!.root.children[0]!.titleFormatting).toEqual([
      { start: 0, end: 5, bold: true }
    ])
  })

  it('persists labelFormatting on a shape and rejects it on other elements', () => {
    const document = makeDocument()
    const result = applyMindMapCommand(document, {
      type: 'element.update',
      sheetId: 'sheet-1',
      elementId: 'shape-1',
      patch: {
        label: 'Bold label',
        labelFormatting: [{ start: 0, end: 4, bold: true }]
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shape = result.document.sheets[0]!.elements[0]!
    expect(shape.label).toBe('Bold label')
    expect(shape.labelFormatting).toEqual([{ start: 0, end: 4, bold: true }])

    // Undo restores the previous label + formatting.
    const undone = applyMindMapCommand(result.document, result.inverse)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.document.sheets[0]!.elements[0]!.label).toBe('Label')
    expect(undone.document.sheets[0]!.elements[0]!.labelFormatting).toBeUndefined()
  })

  it('routes rich text patches through the undo/redo stack', () => {
    const document = makeDocument()
    const stack = new MindMapUndoRedoStack(document)
    const result = stack.execute({
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { titleFormatting: [{ start: 1, end: 3, color: 'green' }] }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(stack.document.sheets[0]!.root.children[0]!.titleFormatting).toEqual([
      { start: 1, end: 3, color: 'green' }
    ])
    const undone = stack.undo()
    expect(undone?.ok).toBe(true)
    expect(stack.document.sheets[0]!.root.children[0]!.titleFormatting).toBeUndefined()
  })

  it('schema accepts titleFormatting and labelFormatting', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.titleFormatting = [
      { start: 0, end: 3, bold: true, color: '#ff0000' }
    ]
    ;(document.sheets[0]!.elements[0] as { labelFormatting?: unknown }).labelFormatting = [
      { start: 0, end: 2, fontSize: 18 }
    ]
    const parsed = mindMapDocumentV2Schema.parse(document)
    expect(parsed.sheets[0]!.root.children[0]!.titleFormatting).toEqual([
      { start: 0, end: 3, bold: true, color: '#ff0000' }
    ])
    const shape = parsed.sheets[0]!.elements[0]!
    expect('labelFormatting' in shape && shape.labelFormatting).toEqual([
      { start: 0, end: 2, fontSize: 18 }
    ])
  })

  it('schema rejects spans whose end precedes start', () => {
    const topic = {
      id: 'x',
      title: 'abc',
      titleFormatting: [{ start: 4, end: 2, bold: true }],
      children: []
    }
    const result = mindMapTopicV2Schema.safeParse(topic)
    expect(result.success).toBe(false)
  })

  it('schema rejects a malformed shape labelFormatting span', () => {
    const shape = {
      id: 's',
      type: 'shape',
      shape: 'rect',
      position: { x: 0, y: 0 },
      width: 10,
      height: 10,
      labelFormatting: [{ start: 0, end: 1, fontSize: -5 }]
    }
    const result = mindMapShapeSchema.safeParse(shape)
    expect(result.success).toBe(false)
  })
})
