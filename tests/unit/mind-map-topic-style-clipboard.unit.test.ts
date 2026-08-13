import { describe, expect, it } from 'vitest'
import {
  applyMindMapCommand,
  type MindMapCommand
} from '../../src/shared/mindmap/commands'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import {
  buildPasteTopicStyleCommand,
  captureTopicStyleClipboard
} from '../../src/renderer/src/views/mindmap/mind-map-topic-style-clipboard'

const NOW = '2026-08-12T00:00:00.000Z'

function documentFixture(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc',
    revision: 1,
    title: 'Style clipboard',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [{
      id: 'sheet',
      title: 'Sheet',
      root: {
        id: 'root',
        title: 'Root',
        style: { fill: '#112233', textAlign: 'right', fontWeight: '700' },
        children: [
          { id: 'a', title: 'A', style: { stroke: '#445566' }, children: [] },
          { id: 'b', title: 'B', style: { textColor: '#778899' }, children: [] }
        ]
      },
      elements: [],
      layout: { structureClass: 'org.xmind.ui.logic.right' }
    }],
    assets: []
  }
}

function execute(document: MindMapDocumentV2, command: MindMapCommand): MindMapDocumentV2 {
  const result = applyMindMapCommand(document, command)
  if (!result.ok) throw new Error(result.error.message)
  return result.document
}

describe('topic style clipboard', () => {
  it('captures only schema-compatible local style fields in a detached snapshot', () => {
    const source = {
      fill: '#112233',
      textAlign: 'right' as const,
      unsupported: 'drop-me'
    }
    const clipboard = captureTopicStyleClipboard(source as never)

    expect(clipboard).toEqual({
      kind: 'topic-style',
      style: { fill: '#112233', textAlign: 'right' }
    })
    source.fill = '#FFFFFF'
    expect(clipboard.style?.fill).toBe('#112233')
  })

  it('pastes one snapshot to a multi-selection as one transaction without changing topic content', () => {
    const document = documentFixture()
    const clipboard = captureTopicStyleClipboard(document.sheets[0]!.root.style)
    const command = buildPasteTopicStyleCommand(document.sheets[0]!, ['a', 'b', 'a'], clipboard)

    expect(command).toMatchObject({ type: 'transaction' })
    const updated = execute(document, command!)
    expect(updated.sheets[0]!.root.children[0]).toMatchObject({
      id: 'a',
      title: 'A',
      style: { fill: '#112233', textAlign: 'right', fontWeight: '700' }
    })
    expect(updated.sheets[0]!.root.children[1]).toMatchObject({
      id: 'b',
      title: 'B',
      style: { fill: '#112233', textAlign: 'right', fontWeight: '700' }
    })
  })

  it('uses a copied empty local style to restore inheritance', () => {
    const document = documentFixture()
    const clipboard = captureTopicStyleClipboard(undefined)
    const command = buildPasteTopicStyleCommand(document.sheets[0]!, ['a'], clipboard)
    const updated = execute(document, command!)

    expect(updated.sheets[0]!.root.children[0]!.style).toBeUndefined()
  })
})
