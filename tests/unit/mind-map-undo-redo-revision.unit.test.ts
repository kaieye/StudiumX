import { describe, expect, it } from 'vitest'

import { MindMapUndoRedoStack } from '../../src/shared/mindmap/commands/mind-map-undo-redo'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

function documentV2(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'Revision test',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        root: { id: 'root-1', title: 'Root', children: [] },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

describe('MindMapUndoRedoStack durable revision replacement', () => {
  it('updates the present revision without discarding undo/redo history', () => {
    const stack = new MindMapUndoRedoStack(documentV2())
    const update = stack.execute({
      type: 'document.rename',
      title: 'Renamed'
    })

    expect(update.ok).toBe(true)
    expect(stack.document.title).toBe('Renamed')
    expect(stack.undoCount).toBe(1)

    const confirmed = {
      ...stack.document,
      revision: 2,
      updatedAt: '2026-08-09T00:01:00.000Z'
    }
    stack.replacePresent(confirmed)

    expect(stack.document).toEqual(confirmed)
    expect(stack.undoCount).toBe(1)
    expect(stack.canUndo()).toBe(true)

    const undone = stack.undo()
    expect(undone?.ok).toBe(true)
    expect(stack.document.title).toBe('Revision test')
    expect(stack.document.revision).toBe(2)
    expect(stack.canRedo()).toBe(true)

    const redone = stack.redo()
    expect(redone?.ok).toBe(true)
    expect(stack.document.title).toBe('Renamed')
    expect(stack.document.revision).toBe(2)
  })
})
