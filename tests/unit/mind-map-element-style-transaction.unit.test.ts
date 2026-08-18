import { describe, expect, it } from 'vitest'
import type { MindMapDocumentV2, MindMapElement } from '../../src/shared/mindmap/domain/types'
import type { MindMapCommand } from '../../src/shared/mindmap/commands/mind-map-command-types'
import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import { MindMapUndoRedoStack } from '../../src/shared/mindmap/commands/mind-map-undo-redo'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(): MindMapDocumentV2 {
  const elements: MindMapElement[] = [
    {
      id: 'relationship-1',
      type: 'relationship',
      from: 'a',
      to: 'b',
      label: 'depends on',
      style: { stroke: '#64748b', strokeWidth: 1.5 }
    },
    {
      id: 'boundary-1',
      type: 'boundary',
      topicId: 'root-1',
      children: ['a', 'b'],
      label: 'Core concepts',
      style: { fill: '#e0f2fe', dashed: true }
    },
    {
      id: 'summary-1',
      type: 'summary',
      from: 'a',
      to: 'b',
      label: 'Together',
      style: { stroke: '#0f766e', strokeWidth: 2 }
    }
  ]

  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'Style transaction',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root-1',
          title: 'Overview',
          children: [
            { id: 'a', title: 'A', children: [] },
            { id: 'b', title: 'B', children: [] }
          ]
        },
        elements,
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function makeDocumentWithDuplicateTopicIdsAcrossSheets(): MindMapDocumentV2 {
  const document = makeDocument()
  document.sheets.push({
    id: 'sheet-2',
    title: 'Details',
    root: {
      id: 'root-2',
      title: 'Details',
      children: [
        { id: 'a', title: 'A on details', children: [], style: { textColor: '#111827' } },
        { id: 'b', title: 'B on details', children: [], style: { fill: '#fef3c7' } }
      ]
    },
    elements: [],
    layout: { structureClass: 'studiumx.layout.logic.right' }
  })
  return document
}

const styleTransaction: MindMapCommand = {
  type: 'transaction',
  commands: [
    {
      type: 'element.update',
      sheetId: 'sheet-1',
      elementId: 'relationship-1',
      patch: { style: { stroke: '#2563eb', strokeWidth: 3, dashed: true } }
    },
    {
      type: 'element.update',
      sheetId: 'sheet-1',
      elementId: 'boundary-1',
      patch: { style: { fill: '#dbeafe', stroke: '#1d4ed8', strokeWidth: 2 } }
    },
    {
      type: 'element.update',
      sheetId: 'sheet-1',
      elementId: 'summary-1',
      patch: { style: { stroke: '#9333ea', strokeWidth: 4, dashed: true } }
    }
  ]
}

describe('M3 relationship/boundary/summary style transaction', () => {
  it('applies all element styles atomically and inverse restores every style', () => {
    const document = makeDocument()
    const result = applyMindMapCommand(document, styleTransaction)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.document.sheets[0]!.elements.map((element) => element.style)).toEqual([
      { stroke: '#2563eb', strokeWidth: 3, dashed: true },
      { fill: '#dbeafe', stroke: '#1d4ed8', strokeWidth: 2 },
      { stroke: '#9333ea', strokeWidth: 4, dashed: true }
    ])

    const undone = applyMindMapCommand(result.document, result.inverse)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.document).toEqual(document)
  })

  it('rejects the whole batch and leaves prior element styles unchanged when one update is invalid', () => {
    const document = makeDocument()
    const invalidTransaction: MindMapCommand = {
      type: 'transaction',
      commands: [
        ...(styleTransaction.type === 'transaction' ? styleTransaction.commands.slice(0, 2) : []),
        {
          type: 'element.update',
          sheetId: 'sheet-1',
          elementId: 'summary-1',
          patch: { style: { strokeWidth: -1 } }
        }
      ]
    }

    const result = applyMindMapCommand(document, invalidTransaction)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRANSACTION')
    expect(document.sheets[0]!.elements.map((element) => element.style)).toEqual([
      { stroke: '#64748b', strokeWidth: 1.5 },
      { fill: '#e0f2fe', dashed: true },
      { stroke: '#0f766e', strokeWidth: 2 }
    ])
  })

  it('scopes selection styles to the addressed sheet and restores local overrides on undo', () => {
    const document = makeDocumentWithDuplicateTopicIdsAcrossSheets()
    const result = applyMindMapCommand(document, {
      type: 'selection.set-style',
      sheetId: 'sheet-2',
      topicIds: ['a', 'b'],
      style: { fill: '#dbeafe', textColor: '#1d4ed8' }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.document.sheets[0]!.root.children.map((topic) => topic.style)).toEqual([
      undefined,
      undefined
    ])
    expect(result.document.sheets[1]!.root.children.map((topic) => topic.style)).toEqual([
      { fill: '#dbeafe', textColor: '#1d4ed8' },
      { fill: '#dbeafe', textColor: '#1d4ed8' }
    ])

    const undone = applyMindMapCommand(result.document, result.inverse)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.document).toEqual(document)
  })

  it('keeps a multi-topic style reset as one undo unit and does not erase unrelated sheets', () => {
    const document = makeDocumentWithDuplicateTopicIdsAcrossSheets()
    const stack = new MindMapUndoRedoStack(document)
    const reset: MindMapCommand = {
      type: 'transaction',
      commands: [
        { type: 'topic.update', sheetId: 'sheet-2', topicId: 'a', patch: { style: null } },
        { type: 'topic.update', sheetId: 'sheet-2', topicId: 'b', patch: { style: null } }
      ]
    }

    const result = stack.execute(reset, { label: 'Reset styles' })
    expect(result.ok).toBe(true)
    expect(stack.undoCount).toBe(1)
    expect(stack.document.sheets[0]!.root.children.map((topic) => topic.style)).toEqual([
      undefined,
      undefined
    ])
    expect(stack.document.sheets[1]!.root.children.map((topic) => topic.style)).toEqual([
      undefined,
      undefined
    ])

    const undone = stack.undo()
    expect(undone?.ok).toBe(true)
    expect(stack.document).toEqual(document)
  })

  it('applies a theme without overwriting explicit topic or element overrides and undoes cleanly', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.style = {
      fill: '#fef3c7',
      textColor: '#713f12'
    }

    const result = applyMindMapCommand(document, {
      type: 'document.apply-theme',
      theme: {
        id: 'theme-dark',
        name: 'Dark',
        background: '#111827',
        textColor: '#f9fafb',
        lineColor: '#93c5fd'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.theme).toEqual({
      id: 'theme-dark',
      name: 'Dark',
      background: '#111827',
      textColor: '#f9fafb',
      lineColor: '#93c5fd'
    })
    expect(result.document.sheets[0]!.root.children[0]!.style).toEqual({
      fill: '#fef3c7',
      textColor: '#713f12'
    })
    expect(result.document.sheets[0]!.elements.map((element) => element.style)).toEqual([
      { stroke: '#64748b', strokeWidth: 1.5 },
      { fill: '#e0f2fe', dashed: true },
      { stroke: '#0f766e', strokeWidth: 2 }
    ])

    const undone = applyMindMapCommand(result.document, result.inverse)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.document).toEqual(document)
  })
})
