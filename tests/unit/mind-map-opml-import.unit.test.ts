import { describe, expect, it } from 'vitest'

import {
  mindMapDocumentToOpml,
  mindMapOpmlToDocument
} from '../../src/shared/mindmap'
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

describe('mindMapOpmlToDocument', () => {
  it('round-trips title, tree, notes, stable ids, and XML escaping', () => {
    const opml = mindMapDocumentToOpml(sampleDocument())
    const imported = mindMapOpmlToDocument(opml, {
      documentId: 'opml-import',
      nowIso: '2026-08-09T01:00:00.000Z'
    })

    expect(imported).toEqual({
      ok: true,
      document: {
        schemaVersion: 2,
        id: 'opml-import',
        revision: 1,
        title: 'Study & review',
        createdAt: '2026-08-09T01:00:00.000Z',
        updatedAt: '2026-08-09T01:00:00.000Z',
        theme: { id: 'studiumx-default', name: 'StudiumX Default' },
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
    })
  })

  it('imports the exporter tree even when private ids are omitted', () => {
    const opml = mindMapDocumentToOpml(sampleDocument(), {
      includeIds: false
    })
    const imported = mindMapOpmlToDocument(opml)

    expect(imported.ok).toBe(true)
    if (imported.ok) {
      expect(imported.document.title).toBe('Study & review')
      expect(imported.document.sheets[0]).toMatchObject({
        id: 'sheet-1',
        title: 'Biology <I>',
        root: {
          id: 'sheet-1-topic-1',
          title: 'Cells',
          note: 'A & B\nwith details',
          children: [
            {
              id: 'sheet-1-topic-2',
              title: 'Membrane "selective"',
              children: []
            }
          ]
        }
      })
    }
  })

  it('falls back to the first sheet title when the head title is absent', () => {
    const imported = mindMapOpmlToDocument(
      '<opml version="2.0"><body><outline text="Sheet"><outline text="Root" /></outline></body></opml>'
    )

    expect(imported.ok).toBe(true)
    if (imported.ok) expect(imported.document.title).toBe('Sheet')
  })

  it('fails closed for duplicate ids and unsafe or malformed XML', () => {
    const duplicateIds =
      '<opml version="2.0"><body>' +
      '<outline text="One" _studiumx_sheet_id="sheet-1"><outline text="Root" _studiumx_topic_id="root-1" /></outline>' +
      '<outline text="Two" _studiumx_sheet_id="sheet-1"><outline text="Other" _studiumx_topic_id="root-2" /></outline>' +
      '</body></opml>'
    expect(mindMapOpmlToDocument(duplicateIds)).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_ID' }
    })
    expect(mindMapOpmlToDocument('<!DOCTYPE opml><opml version="2.0"><body /></opml>')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT' }
    })
    expect(mindMapOpmlToDocument('<opml version="2.0"><body><outline text="A &bogus;" /></body></opml>')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT' }
    })
    expect(mindMapOpmlToDocument('<opml version="2.0"><body></opml>')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT' }
    })
    expect(mindMapOpmlToDocument('<opml version="2.0"><head /></opml>')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STRUCTURE' }
    })
  })

  it('enforces the parser budgets before building an imported document', () => {
    const oversized = 'x'.repeat(2 * 1024 * 1024 + 1)
    expect(mindMapOpmlToDocument(oversized)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT' }
    })

    const deeplyNested =
      '<opml version="2.0"><body>' +
      '<outline text="node">'.repeat(257) +
      '<outline text="leaf" />' +
      '</outline>'.repeat(257) +
      '</body></opml>'
    expect(mindMapOpmlToDocument(deeplyNested)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT' }
    })

    const tooManyNodes =
      '<opml version="2.0"><body>' +
      '<outline text="x" />'.repeat(100_001) +
      '</body></opml>'
    expect(mindMapOpmlToDocument(tooManyNodes)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT' }
    })

    const oversizedAttribute =
      '<opml version="2.0"><body><outline text="' +
      'x'.repeat(16_385) +
      '" /></body></opml>'
    expect(mindMapOpmlToDocument(oversizedAttribute)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT' }
    })
  })
})
