import { describe, expect, it } from 'vitest'

import {
  buildXmindImportCompatibilityReport,
  documentToXmindContent,
  mindMapDocumentToMarkdown,
  mindMapDocumentToOpml,
  mindMapMarkdownToDocument,
  mindMapOpmlToDocument,
  xmindContentToDocument
} from '../../src/shared/mindmap'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { MindMapDocument } from '../../src/shared/mindmap/mind-map-types'

function v2Document(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'v2-doc',
    revision: 2,
    title: 'Public exports',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1' },
    assets: [],
    sheets: [
      {
        id: 'sheet-v2',
        title: 'Sheet',
        root: {
          id: 'root-v2',
          title: 'Root',
          note: 'Keep this note',
          children: []
        },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ]
  }
}

function v1Document(): MindMapDocument {
  return {
    schemaVersion: 1,
    id: 'v1-doc',
    title: 'XMind round trip',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    sheets: [
      {
        id: 'sheet-v1',
        title: 'Interop',
        structureClass: 'org.xmind.ui.logic.right',
        root: {
          id: 'root-v1',
          title: 'Root',
          note: 'Interop note',
          children: []
        }
      }
    ]
  }
}

describe('mind-map public pure interop API', () => {
  it('exposes Markdown and OPML converters from the package entry point', () => {
    const document = v2Document()

    expect(mindMapDocumentToMarkdown(document)).toContain('- Root')
    expect(mindMapDocumentToOpml(document)).toContain('_studiumx_topic_id="root-v2"')
    expect(mindMapMarkdownToDocument(mindMapDocumentToMarkdown(document))).toMatchObject({
      ok: true,
      document: { title: 'Public exports' }
    })
    expect(mindMapOpmlToDocument(mindMapDocumentToOpml(document))).toMatchObject({
      ok: true,
      document: { title: 'Public exports' }
    })
  })

  it('keeps XMind metadata visible through converter and compatibility report exports', () => {
    const content = documentToXmindContent(v1Document())
    const report = buildXmindImportCompatibilityReport(content)
    const roundTripped = xmindContentToDocument(content, {
      nowIso: '2026-08-09T01:00:00.000Z'
    })

    expect(report.dropped).toEqual([])
    expect(roundTripped.sheets[0]).toMatchObject({
      id: 'sheet-v1',
      title: 'Interop',
      root: { id: 'root-v1', title: 'Root', note: 'Interop note' }
    })
  })
})
