import { describe, expect, it } from 'vitest'

import {
  mindMapDocumentToMarkdown,
  mindMapDocumentToOpml,
  mindMapMarkdownToDocument,
  mindMapOpmlToDocument
} from '../../src/shared/mindmap'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

function document(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'v2-doc',
    revision: 2,
    title: 'Public exports',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1' },
    assets: [],
    sheets: [{
      id: 'sheet-v2',
      title: 'Sheet',
      root: { id: 'root-v2', title: 'Root', note: 'Keep this note', children: [] },
      elements: [],
      layout: { structureClass: 'studiumx.layout.logic.right' }
    }]
  }
}

describe('mind-map public pure import/export API', () => {
  it('exposes Markdown and OPML converters from the package entry point', () => {
    const source = document()

    expect(mindMapDocumentToMarkdown(source)).toContain('- Root')
    expect(mindMapDocumentToOpml(source)).toContain('_studiumx_topic_id="root-v2"')
    expect(mindMapMarkdownToDocument(mindMapDocumentToMarkdown(source))).toMatchObject({
      ok: true,
      document: { title: 'Public exports' }
    })
    expect(mindMapOpmlToDocument(mindMapDocumentToOpml(source))).toMatchObject({
      ok: true,
      document: { title: 'Public exports' }
    })
  })
})
