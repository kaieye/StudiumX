import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportMindMapSvgFile } from '../../src/main/mindmap/svg-file'
import type { MindMapSvgExportInput } from '../../src/shared/mindmap/svg-export'

function sampleInput(): MindMapSvgExportInput {
  return {
    title: 'Cell Biology / notes',
    nodes: [
      { id: 'root', title: 'Cells', x: -80, y: 0, width: 160, height: 40 },
      { id: 'child', title: 'Membrane', x: 160, y: 80, width: 160, height: 40 }
    ],
    edges: [{ from: 'root', to: 'child' }]
  }
}

describe('exportMindMapSvgFile', () => {
  it('writes a standalone static SVG into the selected directory', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-svg-'))
    const result = await exportMindMapSvgFile(sampleInput(), destination)

    expect(result.path).toBe(join(destination, 'cell-biology-notes.svg'))
    await expect(readFile(result.path, 'utf8')).resolves.toContain(
      '<svg xmlns="http://www.w3.org/2000/svg"'
    )
    await expect(readFile(result.path, 'utf8')).resolves.not.toContain('foreignObject')
  })

  it('uses a safe fallback name for titles without ASCII slug characters', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-svg-'))
    const result = await exportMindMapSvgFile(
      { ...sampleInput(), title: '中文' },
      destination
    )

    expect(result.path).toBe(join(destination, 'mind-map.svg'))
  })
})
