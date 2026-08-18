import { describe, expect, it } from 'vitest'
import { buildPropagateTopicStyleCommand } from '../../src/renderer/src/views/mindmap/mind-map-commands'
import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-12T00:00:00.000Z'

function documentFixture(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-1',
    revision: 1,
    title: 'Styles',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet',
        root: {
          id: 'root',
          title: 'Root',
          children: [
            {
              id: 'source',
              title: 'Source',
              style: { fill: '#123456', shape: 'none' },
              children: [{ id: 'nested', title: 'Nested', style: { stroke: '#999999' }, children: [] }]
            },
            { id: 'sibling', title: 'Sibling', style: { fill: '#FFFFFF' }, children: [] }
          ]
        },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

describe('mind-map topic style propagation commands', () => {
  it('builds an atomic sibling transaction with an exact style snapshot', () => {
    const document = documentFixture()
    const command = buildPropagateTopicStyleCommand(document.sheets[0]!, 'source', 'siblings')
    expect(command).toEqual({
      type: 'transaction',
      commands: [
        {
          type: 'topic.update',
          sheetId: 'sheet-1',
          topicId: 'sibling',
          patch: { style: { fill: '#123456', shape: 'none' } }
        }
      ]
    })

    const applied = applyMindMapCommand(document, command!)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.document.sheets[0]?.root.children[1]?.style).toEqual({
      fill: '#123456',
      shape: 'none'
    })
    const undone = applyMindMapCommand(applied.document, applied.inverse)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.document).toEqual(document)
  })

  it('returns null when a propagation scope has no targets', () => {
    const document = documentFixture()
    expect(buildPropagateTopicStyleCommand(document.sheets[0]!, 'nested', 'descendants')).toBeNull()
    expect(buildPropagateTopicStyleCommand(document.sheets[0]!, 'missing', 'siblings')).toBeNull()
  })
})
