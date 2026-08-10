import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportMindMapMarkdownFile } from '../../src/main/mindmap/markdown-file'
import { importMindMapMarkdownFile } from '../../src/main/mindmap/markdown-import-file'
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
          children: []
        },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ]
  }
}

describe('exportMindMapMarkdownFile', () => {
  it('writes deterministic Markdown into the selected directory', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-md-'))
    const result = await exportMindMapMarkdownFile(sampleDocument(), destination)

    expect(result.path).toBe(join(destination, 'cell-biology-notes.md'))
    await expect(readFile(result.path, 'utf8')).resolves.toBe(
      '# Cell Biology / notes\n\n## Basics\n- Cells\n  > A note\n'
    )
  })

  it('uses a safe fallback name for titles without ASCII slug characters', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-md-'))
    const result = await exportMindMapMarkdownFile(
      { ...sampleDocument(), title: '中文' },
      destination
    )

    expect(result.path).toBe(join(destination, 'mind-map.md'))
  })
})

describe('importMindMapMarkdownFile', () => {
  it('reads and parses the Markdown tree emitted by StudiumX', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-md-import-'))
    const sourcePath = join(directory, 'course.md')
    await writeFile(
      sourcePath,
      '# Cell Biology\n\n## Basics\n- Cells\n  > A note\n  - Membrane\n',
      'utf8'
    )

    await expect(importMindMapMarkdownFile(sourcePath)).resolves.toMatchObject({
      schemaVersion: 2,
      title: 'Cell Biology',
      sheets: [
        {
          title: 'Basics',
          root: {
            title: 'Cells',
            note: 'A note',
            children: [{ title: 'Membrane' }]
          }
        }
      ]
    })
  })

  it('rejects directories and final symlinks before parsing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-md-import-'))
    await expect(importMindMapMarkdownFile(directory)).rejects.toThrow(
      'Markdown source must be a regular file'
    )

    const sourcePath = join(directory, 'course.md')
    const linkPath = join(directory, 'course-link.md')
    await writeFile(sourcePath, '# Course\n\n## Sheet\n- Root\n', 'utf8')
    await symlink(sourcePath, linkPath)
    await expect(importMindMapMarkdownFile(linkPath)).rejects.toThrow(
      'Markdown source must be a regular file'
    )
  })

  it('reports malformed Markdown without creating a partial document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-md-import-'))
    const sourcePath = join(directory, 'invalid.md')
    await writeFile(sourcePath, 'plain prose is not a mind map\n', 'utf8')

    await expect(importMindMapMarkdownFile(sourcePath)).rejects.toThrow(
      'Markdown import failed (INVALID_FORMAT) at line 1'
    )
  })

  it('bounds the selected file before parsing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-md-import-'))
    const sourcePath = join(directory, 'oversized.md')
    await writeFile(sourcePath, Buffer.alloc(2 * 1024 * 1024 + 1, 0x23))

    await expect(importMindMapMarkdownFile(sourcePath)).rejects.toThrow(
      'Markdown source exceeds the 2097152 byte safety limit'
    )
  })
})
