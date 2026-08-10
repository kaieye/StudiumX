import { describe, expect, it } from 'vitest'
import {
  MIND_MAP_IMPORT_ACCEPT,
  mindMapImportFormatForFileName
} from '../../src/renderer/src/views/mindmap/mind-map-import-format'

describe('mindMapImportFormatForFileName', () => {
  it('routes supported native import formats case-insensitively', () => {
    expect(mindMapImportFormatForFileName('course.XMIND')).toBe('xmind')
    expect(mindMapImportFormatForFileName('course.md')).toBe('markdown')
    expect(mindMapImportFormatForFileName('course.MARKDOWN')).toBe('markdown')
    expect(mindMapImportFormatForFileName('course.OPML')).toBe('opml')
  })

  it('uses the final extension and rejects ambiguous or unsupported names', () => {
    expect(mindMapImportFormatForFileName('/tmp/archive.course.md')).toBe('markdown')
    expect(mindMapImportFormatForFileName('course.md.bak')).toBeNull()
    expect(mindMapImportFormatForFileName('course')).toBeNull()
    expect(mindMapImportFormatForFileName('.xmind')).toBe('xmind')
    expect(mindMapImportFormatForFileName('   ')).toBeNull()
    expect(mindMapImportFormatForFileName(null)).toBeNull()
  })

  it('keeps the file-input filter aligned with the supported formats', () => {
    expect(MIND_MAP_IMPORT_ACCEPT).toBe('.xmind,.md,.markdown,.opml')
  })
})
