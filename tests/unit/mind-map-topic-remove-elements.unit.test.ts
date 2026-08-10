import { describe, expect, it } from 'vitest'

import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import { validateMindMapDocumentV2 } from '../../src/shared/mindmap/domain/invariants'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

function documentWithReferencedSubtree(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'References',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        root: {
          id: 'root-1',
          title: 'Root',
          children: [
            {
              id: 'removed-branch',
              title: 'Removed branch',
              children: [{ id: 'removed-leaf', title: 'Removed leaf', children: [] }]
            },
            { id: 'kept-branch', title: 'Kept branch', children: [] }
          ]
        },
        elements: [
          { id: 'relationship-removed', type: 'relationship', from: 'removed-branch', to: 'kept-branch' },
          { id: 'boundary-removed', type: 'boundary', topicId: 'removed-branch', children: ['removed-leaf'] },
          { id: 'summary-removed', type: 'summary', from: 'removed-branch', to: 'removed-leaf' },
          { id: 'callout-removed', type: 'callout', topicId: 'removed-leaf', text: 'Remove me' },
          { id: 'free-topic-removed', type: 'free-topic', topicId: 'removed-branch', position: { x: 1, y: 2 } },
          { id: 'relationship-kept', type: 'relationship', from: 'root-1', to: 'kept-branch' }
        ],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

describe('topic.remove element cleanup', () => {
  it('removes references into the deleted subtree and inverse restores them', () => {
    const document = documentWithReferencedSubtree()
    const result = applyMindMapCommand(document, {
      type: 'topic.remove',
      sheetId: 'sheet-1',
      topicId: 'removed-branch'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const nextSheet = result.document.sheets[0]!
    expect(nextSheet.root.children.map((topic) => topic.id)).toEqual(['kept-branch'])
    expect(nextSheet.elements.map((element) => element.id)).toEqual(['relationship-kept'])
    expect(validateMindMapDocumentV2(result.document)).toEqual({ ok: true })

    const undone = applyMindMapCommand(result.document, result.inverse)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.document).toEqual(document)
  })
})
