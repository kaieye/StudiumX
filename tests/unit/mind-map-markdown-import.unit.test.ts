import { describe, expect, it } from 'vitest'

import {
  mindMapDocumentToMarkdown,
  mindMapMarkdownToDocument
} from '../../src/shared/mindmap'
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

describe('mindMapMarkdownToDocument', () => {
  it('round-trips the exported title tree and notes with deterministic ids', () => {
    const markdown = mindMapDocumentToMarkdown(sampleDocument())
    const imported = mindMapMarkdownToDocument(markdown, {
      documentId: 'markdown-import',
      nowIso: '2026-08-09T01:00:00.000Z',
      structureClass: 'org.xmind.ui.logic.map'
    })

    expect(imported).toEqual({
      ok: true,
      document: {
        schemaVersion: 2,
        id: 'markdown-import',
        revision: 1,
        title: 'Study map',
        createdAt: '2026-08-09T01:00:00.000Z',
        updatedAt: '2026-08-09T01:00:00.000Z',
        theme: { id: 'studiumx-default', name: 'StudiumX Default' },
        assets: [],
        sheets: [
          {
            id: 'sheet-1',
            title: 'Biology',
            root: {
              id: 'sheet-1-topic-1',
              title: 'Cells',
              note: 'A short note',
              children: [
                {
                  id: 'sheet-1-topic-2',
                  title: 'Membrane',
                  children: [
                    {
                      id: 'sheet-1-topic-3',
                      title: 'Selective barrier',
                      children: []
                    }
                  ]
                }
              ]
            },
            elements: [],
            layout: { structureClass: 'org.xmind.ui.logic.map' }
          },
          {
            id: 'sheet-2',
            title: 'Chemistry',
            root: {
              id: 'sheet-2-topic-1',
              title: 'Atoms',
              children: []
            },
            elements: [],
            layout: { structureClass: 'org.xmind.ui.logic.map' }
          }
        ]
      }
    })

    const repeated = mindMapMarkdownToDocument(markdown)
    expect(repeated.ok).toBe(true)
    if (repeated.ok && imported.ok) {
      expect(repeated.document.sheets).toEqual(
        imported.document.sheets.map((sheet) => ({
          ...sheet,
          layout: { structureClass: 'org.xmind.ui.logic.right' }
        }))
      )
      expect(repeated.document.sheets.flatMap((sheet) => [
        sheet.id,
        sheet.root.id,
        ...sheet.root.children.map((child) => child.id)
      ])).toEqual([
        'sheet-1',
        'sheet-1-topic-1',
        'sheet-1-topic-2',
        'sheet-2',
        'sheet-2-topic-1'
      ])
    }
  })

  it('fails closed for empty, unsupported, and structurally invalid Markdown', () => {
    expect(mindMapMarkdownToDocument('')).toMatchObject({
      ok: false,
      error: { code: 'EMPTY_INPUT' }
    })
    expect(mindMapMarkdownToDocument('## Missing document heading\n- Root')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT', line: 1 }
    })
    expect(mindMapMarkdownToDocument('# Title\n\n### Unsupported\n- Root')).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_FEATURE', line: 3 }
    })
    expect(mindMapMarkdownToDocument('# Title\n\n## Sheet\n- Root\n- Another root')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STRUCTURE', line: 5 }
    })
    expect(mindMapMarkdownToDocument('# Title\n\n## Sheet\n    - Skipped parent')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STRUCTURE', line: 4 }
    })
    expect(mindMapMarkdownToDocument('# Title\n\n## Sheet\n\t- Tab-indented')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT', line: 4 }
    })
    expect(mindMapMarkdownToDocument('# Title\n\n## Sheet\n  > Note without topic')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STRUCTURE', line: 4 }
    })
    expect(mindMapMarkdownToDocument('# Title\n\n## Sheet\n- Root\nprose')).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_FEATURE', line: 5 }
    })
  })

  it('requires a root topic for every sheet and preserves multiple note blocks', () => {
    expect(mindMapMarkdownToDocument('# Title\n\n## Empty sheet')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STRUCTURE', line: 3 }
    })

    const imported = mindMapMarkdownToDocument(
      '# Title\n\n## Sheet\n- Root\n  > first\n  > second\n'
    )
    expect(imported.ok).toBe(true)
    if (imported.ok) {
      expect(imported.document.sheets[0]?.root).toMatchObject({
        title: 'Root',
        note: 'first\nsecond'
      })
    }
  })

  it('enforces parser budgets before building an imported document', () => {
    const oversized = 'x'.repeat(2 * 1024 * 1024 + 1)
    expect(mindMapMarkdownToDocument(oversized)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT' }
    })

    const tooManyLines = '# Title\n' + '\n'.repeat(100_000)
    expect(mindMapMarkdownToDocument(tooManyLines)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT' }
    })

    const longLine = '# Title\n' + 'x'.repeat(16_385)
    expect(mindMapMarkdownToDocument(longLine)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORMAT', line: 2 }
    })
  })
})
