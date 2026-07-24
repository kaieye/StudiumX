import { describe, expect, it } from 'vitest'
import {
  buildAgentFileTouchMetadata,
  classifyFileTouchToolForUi,
  mergeFileTouchEntriesForUi,
  normalizeAgentFileTouchMetadata,
  projectFileTouchesForLearner,
  rebuildFileTouchLedgerFromToolCalls,
  sanitizeFileTouchDisplayPath,
  FILE_TOUCH_UI_CAPTION,
  FILE_TOUCH_UI_TITLE
} from '../../src/shared/context-file-touch-projection'

describe('sanitizeFileTouchDisplayPath', () => {
  it('normalizes relative paths and rejects absolute / breakout', () => {
    expect(sanitizeFileTouchDisplayPath('src\\\\main\\\\ai\\\\x.ts')).toBe('src/main/ai/x.ts')
    expect(sanitizeFileTouchDisplayPath('./lessons/intro.md')).toBe('lessons/intro.md')
    expect(sanitizeFileTouchDisplayPath('a/./b/../c.md')).toBe('a/c.md')
    expect(sanitizeFileTouchDisplayPath('/etc/passwd')).toBeNull()
    expect(sanitizeFileTouchDisplayPath('C:\\Windows\\system32')).toBeNull()
    expect(sanitizeFileTouchDisplayPath('../escape.md')).toBeNull()
  })

  it('drops secret-shaped path segments after redaction', () => {
    expect(
      sanitizeFileTouchDisplayPath('secrets/sk-proj-abcdefghijklmnopqrstuvwxyz0123456789.md')
    ).toBeNull()
  })
})

describe('mergeFileTouchEntriesForUi', () => {
  it('keeps modified sticky and drops oldest over budget', () => {
    const merged = mergeFileTouchEntriesForUi(
      [
        { path: 'a.md', kind: 'read', order: 1 },
        { path: 'a.md', kind: 'modified', order: 2 },
        { path: 'b.md', kind: 'read', order: 3 },
        { path: 'c.md', kind: 'read', order: 4 }
      ],
      { maxEntries: 2 }
    )
    expect(merged).toEqual([
      { path: 'b.md', kind: 'read', order: 3 },
      { path: 'c.md', kind: 'read', order: 4 }
    ])
    const sticky = mergeFileTouchEntriesForUi([
      { path: 'a.md', kind: 'read', order: 1 },
      { path: 'a.md', kind: 'modified', order: 2 },
      { path: 'a.md', kind: 'read', order: 3 }
    ])
    expect(sticky).toEqual([{ path: 'a.md', kind: 'modified', order: 3 }])
  })
})

describe('projectFileTouchesForLearner', () => {
  it('projects ledger-shaped data as reference rows with learner labels', () => {
    const presentation = projectFileTouchesForLearner({
      entries: [
        { path: 'lessons/intro.md', kind: 'read', order: 1 },
        { path: 'notes/out.md', kind: 'modified', order: 2 }
      ]
    })
    expect(presentation.empty).toBe(false)
    expect(presentation.title).toBe(FILE_TOUCH_UI_TITLE)
    expect(presentation.caption).toBe(FILE_TOUCH_UI_CAPTION)
    expect(presentation.role).toBe('reference_projection')
    expect(presentation.rows).toEqual([
      expect.objectContaining({
        displayPath: 'lessons/intro.md',
        kind: 'read',
        kindLabel: '已读取'
      }),
      expect.objectContaining({
        displayPath: 'notes/out.md',
        kind: 'modified',
        kindLabel: '已修改'
      })
    ])
  })

  it('accepts durable metadata shape and drops absolute paths', () => {
    const presentation = projectFileTouchesForLearner({
      role: 'reference_projection',
      files: [
        { path: 'ok.md', kind: 'read' },
        { path: '/etc/passwd', kind: 'read' }
      ]
    })
    expect(presentation.rows.map((r) => r.displayPath)).toEqual(['ok.md'])
  })
})

describe('rebuildFileTouchLedgerFromToolCalls', () => {
  it('records successful single-path tools and skips errors / multi-path tools', () => {
    const ledger = rebuildFileTouchLedgerFromToolCalls([
      {
        id: '1',
        name: 'read_workspace_file',
        arguments: JSON.stringify({ path: 'lessons/a.md' }),
        result: 'content'
      },
      {
        id: '2',
        name: 'write_workspace_file',
        arguments: JSON.stringify({ path: 'notes/b.md', content: 'x' }),
        result: 'ok'
      },
      {
        id: '3',
        name: 'read_workspace_file',
        arguments: JSON.stringify({ path: 'lessons/a.md' }),
        result: 'error: denied',
        isError: true
      },
      {
        id: '4',
        name: 'web_search',
        arguments: JSON.stringify({ query: 'x' }),
        result: '[]'
      }
    ])
    expect(ledger.entries).toEqual([
      { path: 'lessons/a.md', kind: 'read', order: 0 },
      { path: 'notes/b.md', kind: 'modified', order: 1 }
    ])
  })

  it('classifies known tool names', () => {
    expect(classifyFileTouchToolForUi('read_file')).toBe('read')
    expect(classifyFileTouchToolForUi('edit_workspace_file')).toBe('modified')
    expect(classifyFileTouchToolForUi('web_search')).toBeNull()
    expect(classifyFileTouchToolForUi('apply_patch')).toBeNull()
  })
})

describe('buildAgentFileTouchMetadata / normalize', () => {
  it('builds and normalizes reference_projection metadata', () => {
    const meta = buildAgentFileTouchMetadata({
      entries: [{ path: 'x.md', kind: 'read', order: 0 }]
    })
    expect(meta).toEqual({
      role: 'reference_projection',
      files: [{ path: 'x.md', kind: 'read' }]
    })
    expect(normalizeAgentFileTouchMetadata(meta)).toEqual(meta)
    expect(normalizeAgentFileTouchMetadata({ role: 'other', files: [] })).toBeUndefined()
  })
})
