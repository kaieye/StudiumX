import { describe, expect, it } from 'vitest'

import {
  buildXmindExportCompatibilityReport,
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

  it('exposes the pure v2 export compatibility report from the package entry point', () => {
    const doc = v2Document()
    doc.theme = {
      id: 'theme-1',
      background: '#FFFFFF',
      branchColors: ['#FF6B6B'],
      rainbowBranches: true
    }
    doc.sheets[0]!.root = {
      id: 'root-v2',
      title: 'Root',
      note: 'Keep this note',
      style: { borderStyle: 'hand-drawn-dash' as const },
      children: []
    }

    const report = buildXmindExportCompatibilityReport(doc)

    expect(report.preserved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sheets[].theme.map.svg:fill',
          count: 1
        }),
        expect.objectContaining({
          path: 'topics[].note',
          count: 1
        })
      ])
    )
    expect(report.approximated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'topics[].style.border-line-pattern',
          reason: 'Hand-drawn border is approximated as a dashed XMind border'
        })
      ])
    )
  })
})
