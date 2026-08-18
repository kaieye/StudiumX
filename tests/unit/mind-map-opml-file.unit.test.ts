import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportMindMapOpmlFile } from '../../src/main/mindmap/opml-file'
import { importMindMapOpmlFile } from '../../src/main/mindmap/opml-import-file'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

function sampleDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 4,
    title: 'Cell Biology / notes',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1' },
    assets: [],
    sheets: [
      {
        id: 'sheet-1',
        title: 'Basics',
        root: {
          id: 'root-1',
          title: 'Cells',
          note: 'A note',
          children: [
            {
              id: 'child-1',
              title: 'Membrane',
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

describe('exportMindMapOpmlFile', () => {
  it('writes deterministic OPML into the selected directory', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-opml-'))
    const result = await exportMindMapOpmlFile(sampleDocument(), destination)

    expect(result.path).toBe(join(destination, 'cell-biology-notes.opml'))
    await expect(readFile(result.path, 'utf8')).resolves.toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<opml version="2.0">\n' +
      '  <head>\n' +
      '    <title>Cell Biology / notes</title>\n' +
      '  </head>\n' +
      '  <body>\n' +
      '    <outline text="Basics" _studiumx_sheet_id="sheet-1">\n' +
      '      <outline text="Cells" _studiumx_topic_id="root-1" description="A note">\n' +
      '        <outline text="Membrane" _studiumx_topic_id="child-1" />\n' +
      '      </outline>\n' +
      '    </outline>\n' +
      '  </body>\n' +
      '</opml>\n'
    )
  })

  it('uses a safe fallback name for titles without ASCII slug characters', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-opml-'))
    const result = await exportMindMapOpmlFile(
      { ...sampleDocument(), title: '中文' },
      destination
    )

    expect(result.path).toBe(join(destination, 'mind-map.opml'))
  })
})

describe('importMindMapOpmlFile', () => {
  it('reads and parses the OPML tree emitted by StudiumX', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-opml-import-'))
    const sourcePath = join(directory, 'course.opml')
    await writeFile(
      sourcePath,
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<opml version="2.0">\n' +
        '  <head><title>Cell Biology</title></head>\n' +
        '  <body>\n' +
        '    <outline text="Basics" _studiumx_sheet_id="sheet-1">\n' +
        '      <outline text="Cells" _studiumx_topic_id="root-1" description="A note">\n' +
        '        <outline text="Membrane" _studiumx_topic_id="child-1" />\n' +
        '      </outline>\n' +
        '    </outline>\n' +
        '  </body>\n' +
        '</opml>\n',
      'utf8'
    )

    await expect(importMindMapOpmlFile(sourcePath)).resolves.toMatchObject({
      schemaVersion: 2,
      title: 'Cell Biology',
      sheets: [
        {
          id: 'sheet-1',
          title: 'Basics',
          root: {
            id: 'root-1',
            title: 'Cells',
            note: 'A note',
            children: [{ id: 'child-1', title: 'Membrane' }]
          }
        }
      ]
    })
  })

  it('rejects directories and final symlinks before parsing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-opml-import-'))
    await expect(importMindMapOpmlFile(directory)).rejects.toThrow(
      'OPML source must be a regular file'
    )

    const sourcePath = join(directory, 'course.opml')
    const linkPath = join(directory, 'course-link.opml')
    await writeFile(sourcePath, '<opml version="2.0"><body><outline text="Root" /></body></opml>', 'utf8')
    await symlink(sourcePath, linkPath)
    await expect(importMindMapOpmlFile(linkPath)).rejects.toThrow(
      'OPML source must be a regular file'
    )
  })

  it('reports malformed OPML without creating a partial document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-opml-import-'))
    const sourcePath = join(directory, 'invalid.opml')
    await writeFile(sourcePath, '<!DOCTYPE opml><opml />', 'utf8')

    await expect(importMindMapOpmlFile(sourcePath)).rejects.toThrow(
      'OPML import failed (INVALID_FORMAT)'
    )
  })

  it('bounds the selected file before parsing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-opml-import-'))
    const sourcePath = join(directory, 'oversized.opml')
    await writeFile(sourcePath, Buffer.alloc(2 * 1024 * 1024 + 1, 0x3c))

    await expect(importMindMapOpmlFile(sourcePath)).rejects.toThrow(
      'OPML source exceeds the 2097152 byte safety limit'
    )
  })
})
