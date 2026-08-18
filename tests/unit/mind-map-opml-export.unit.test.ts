import { describe, expect, it } from 'vitest'

import { mindMapDocumentToOpml } from '../../src/shared/mindmap/opml-export'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

function sampleDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 4,
    title: 'Study & review',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1' },
    assets: [],
    sheets: [
      {
        id: 'sheet-1',
        title: 'Biology <I>',
        root: {
          id: 'root-1',
          title: 'Cells',
          note: 'A & B\nwith details',
          children: [
            {
              id: 'child-1',
              title: 'Membrane "selective"',
              children: []
            }
          ]
        },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ]
  }
}

describe('mindMapDocumentToOpml', () => {
  it('exports sheets, hierarchy, ids, and escaped notes as OPML 2.0', () => {
    const opml = mindMapDocumentToOpml(sampleDocument())

    expect(opml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<opml version="2.0">\n' +
        '  <head>\n' +
        '    <title>Study &amp; review</title>\n' +
        '  </head>\n' +
        '  <body>\n' +
        '    <outline text="Biology &lt;I&gt;" _studiumx_sheet_id="sheet-1">\n' +
        '      <outline text="Cells" _studiumx_topic_id="root-1" description="A &amp; B&#10;with details">\n' +
        '        <outline text="Membrane &quot;selective&quot;" _studiumx_topic_id="child-1" />\n' +
        '      </outline>\n' +
        '    </outline>\n' +
        '  </body>\n' +
        '</opml>\n'
    )
  })

  it('supports omitting notes and private ids', () => {
    const opml = mindMapDocumentToOpml(sampleDocument(), {
      includeNotes: false,
      includeIds: false
    })

    expect(opml).not.toContain('description=')
    expect(opml).not.toContain('_studiumx_')
    expect(opml).toContain('<outline text="Cells"')
  })

  it('drops XML-invalid controls and does not mutate the document', () => {
    const document = sampleDocument()
    document.sheets[0].root.title = 'Title\u0000\u0008 😀'
    const before = structuredClone(document)

    const opml = mindMapDocumentToOpml(document)

    expect(document).toEqual(before)
    expect(opml).not.toContain('\u0000')
    expect(opml).not.toContain('\u0008')
    expect(opml).toContain('😀')
  })
})
