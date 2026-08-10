import { describe, expect, it } from 'vitest'

import { mindMapDocumentToMarkdown } from '../../src/shared/mindmap/markdown-export'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

function sampleDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 3,
    title: 'Study map',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1' },
    assets: [],
    sheets: [
      {
        id: 'sheet-1',
        title: 'Biology',
        root: {
          id: 'root-1',
          title: 'Cells',
          note: 'A\nshort note',
          children: [
            {
              id: 'child-1',
              title: 'Membrane',
              children: [
                { id: 'leaf-1', title: 'Selective\tbarrier', children: [] }
              ]
            }
          ]
        },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      },
      {
        id: 'sheet-2',
        title: 'Chemistry',
        root: { id: 'root-2', title: 'Atoms', children: [] },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.map' }
      }
    ]
  }
}

describe('mindMapDocumentToMarkdown', () => {
  it('exports document and multi-sheet topic hierarchy with notes', () => {
    expect(mindMapDocumentToMarkdown(sampleDocument())).toBe(
      '# Study map\n\n## Biology\n- Cells\n  > A short note\n  - Membrane\n    - Selective barrier\n\n## Chemistry\n- Atoms\n'
    )
  })

  it('can omit notes without changing the topic tree', () => {
    expect(mindMapDocumentToMarkdown(sampleDocument(), { includeNotes: false })).toContain(
      '## Biology\n- Cells\n  - Membrane'
    )
    expect(mindMapDocumentToMarkdown(sampleDocument(), { includeNotes: false })).not.toContain('short note')
  })

  it('flattens line breaks and whitespace without mutating the document', () => {
    const document = sampleDocument()
    const before = structuredClone(document)

    const markdown = mindMapDocumentToMarkdown(document)

    expect(document).toEqual(before)
    expect(markdown).not.toContain('\\n')
    expect(markdown).not.toContain('\\t')
    expect(markdown).toContain('- Selective barrier')
  })
})
