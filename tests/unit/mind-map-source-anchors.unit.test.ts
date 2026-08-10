import { describe, expect, it } from 'vitest'

import {
  buildMindMapSourceRefDisplay,
  buildMindMapSourceRefRefreshDiff,
  confirmMindMapSourceRefRefresh,
  isMindMapSourceRefStale,
  parseMindMapSourceRefsJson,
  serializeMindMapSourceRefs
} from '../../src/shared/mindmap/domain/source-anchors'
import type { MindMapSourceRef } from '../../src/shared/mindmap/domain/types'

const anchor: MindMapSourceRef = {
  id: 'source-1',
  workspacePath: 'notes/chemistry.md',
  blockId: 'block-1',
  contentHash: 'hash-v1',
  lastConfirmedAt: '2026-08-09T00:00:00.000Z'
}

describe('isMindMapSourceRefStale', () => {
  it('marks an anchor stale when the current content hash changed', () => {
    expect(isMindMapSourceRefStale(anchor, 'hash-v2')).toBe(true)
  })

  it('keeps an anchor fresh when the content hash is unchanged', () => {
    expect(isMindMapSourceRefStale(anchor, 'hash-v1')).toBe(false)
  })

  it('preserves an explicit stale flag until a user refreshes the anchor', () => {
    expect(isMindMapSourceRefStale({ ...anchor, stale: true }, 'hash-v1')).toBe(true)
  })

  it('treats missing hashes as unknown rather than silently stale', () => {
    expect(isMindMapSourceRefStale({ ...anchor, contentHash: undefined }, 'hash-v2')).toBe(false)
    expect(isMindMapSourceRefStale(anchor)).toBe(false)
  })
})

describe('source anchor refresh diff', () => {
  it('returns a review-only diff for hash and locator changes without mutating either ref', () => {
    const previous: MindMapSourceRef = {
      ...anchor,
      workspacePath: './notes/chemistry.md',
      breadcrumb: ['Unit 3', 'Acids']
    }
    const refreshed: MindMapSourceRef = {
      ...anchor,
      workspacePath: 'lessons/chemistry.md',
      breadcrumb: ['Unit 3', 'Acids and Bases'],
      blockId: 'block-2',
      contentHash: 'hash-v2'
    }
    const previousBefore = structuredClone(previous)
    const refreshedBefore = structuredClone(refreshed)

    const result = buildMindMapSourceRefRefreshDiff(previous, refreshed)

    expect(result).toEqual({
      ok: true,
      diff: {
        sourceRefId: 'source-1',
        status: 'stale',
        requiresReview: true,
        changes: [
          { field: 'workspacePath', before: 'notes/chemistry.md', after: 'lessons/chemistry.md' },
          { field: 'breadcrumb', before: ['Unit 3', 'Acids'], after: ['Unit 3', 'Acids and Bases'] },
          { field: 'blockId', before: 'block-1', after: 'block-2' },
          { field: 'contentHash', before: 'hash-v1', after: 'hash-v2' }
        ],
        before: previous,
        after: refreshed
      }
    })
    expect(previous).toEqual(previousBefore)
    expect(refreshed).toEqual(refreshedBefore)
  })

  it('keeps an unchanged hashed source fresh and treats missing hashes as unknown', () => {
    expect(buildMindMapSourceRefRefreshDiff(anchor, { ...anchor })).toEqual({
      ok: true,
      diff: {
        sourceRefId: 'source-1',
        status: 'fresh',
        requiresReview: false,
        changes: [],
        before: anchor,
        after: anchor
      }
    })

    const unknown = buildMindMapSourceRefRefreshDiff(
      { ...anchor, contentHash: undefined },
      { ...anchor, contentHash: 'hash-v2' }
    )
    expect(unknown).toMatchObject({
      ok: true,
      diff: {
        status: 'unknown',
        requiresReview: true,
        changes: [{ field: 'contentHash', after: 'hash-v2' }]
      }
    })
  })

  it('fails closed for mismatched source identities and only clears stale after confirmation', () => {
    expect(
      buildMindMapSourceRefRefreshDiff(anchor, { ...anchor, id: 'source-2' })
    ).toEqual({
      ok: false,
      code: 'source_id_mismatch',
      message: 'Cannot refresh source "source-1" with source "source-2"'
    })

    const refreshed = confirmMindMapSourceRefRefresh(
      { ...anchor, stale: true },
      { ...anchor, contentHash: 'hash-v2', stale: true },
      '2026-08-09T01:00:00.000Z'
    )
    expect(refreshed).toEqual({
      ...anchor,
      contentHash: 'hash-v2',
      lastConfirmedAt: '2026-08-09T01:00:00.000Z',
      stale: false
    })
  })
})

describe('source anchor serialization', () => {
  it('round-trips optional anchor metadata and the explicit stale flag', () => {
    const refs = [
      {
        ...anchor,
        breadcrumb: ['Unit 3', 'Acids and Bases'],
        stale: true
      }
    ]

    const serialized = serializeMindMapSourceRefs(refs)
    expect(serialized.endsWith('\n')).toBe(true)
    expect(parseMindMapSourceRefsJson(serialized)).toEqual({ ok: true, refs })
  })

  it('returns structured errors for invalid JSON and schema values', () => {
    expect(parseMindMapSourceRefsJson('{')).toEqual({
      ok: false,
      code: 'json_parse',
      message: 'source refs are not valid JSON'
    })
    expect(parseMindMapSourceRefsJson(JSON.stringify([{ id: '' }]))).toEqual({
      ok: false,
      code: 'schema_invalid',
      message: 'source refs failed schema validation'
    })
  })

  it('rejects unknown fields instead of silently dropping anchor metadata', () => {
    expect(() =>
      serializeMindMapSourceRefs([
        { ...anchor, unexpected: 'foreign-value' } as typeof anchor
      ])
    ).toThrow(/Invalid mind map source refs/)
    expect(parseMindMapSourceRefsJson(JSON.stringify([{ ...anchor, unexpected: true }]))).toEqual({
      ok: false,
      code: 'schema_invalid',
      message: 'source refs failed schema validation'
    })
  })
})

describe('source anchor display model', () => {
  it('normalizes Windows lesson paths and preserves a stable source locator', () => {
    expect(
      buildMindMapSourceRefDisplay(
        {
          id: 'lesson-source',
          workspacePath: 'lessons\\Unit 1\\intro.md',
          breadcrumb: ['Unit 1', 'Introduction'],
          blockId: 'intro-block',
          contentHash: 'hash-v1'
        },
        'hash-v1'
      )
    ).toEqual({
      id: 'lesson-source',
      kind: 'lesson',
      status: 'fresh',
      stale: false,
      title: 'Introduction',
      breadcrumb: ['Unit 1', 'Introduction'],
      workspacePath: 'lessons/Unit 1/intro.md',
      blockId: 'intro-block',
      canOpen: true
    })
  })

  it('marks a notes source stale when the current content hash changed', () => {
    expect(
      buildMindMapSourceRefDisplay(
        { ...anchor, workspacePath: 'notes/chemistry.md' },
        'hash-v2'
      )
    ).toMatchObject({
      kind: 'notes',
      status: 'stale',
      stale: true,
      title: 'chemistry',
      workspacePath: 'notes/chemistry.md',
      canOpen: true
    })
  })

  it('classifies course lesson paths and the root notes document using workspace conventions', () => {
    expect(
      buildMindMapSourceRefDisplay({
        id: 'course-lesson-source',
        workspacePath: 'Courses/foundations/lesson-1.html'
      })
    ).toMatchObject({ kind: 'lesson', workspacePath: 'Courses/foundations/lesson-1.html' })

    expect(
      buildMindMapSourceRefDisplay({
        id: 'root-notes-source',
        workspacePath: 'NOTES.md'
      })
    ).toMatchObject({ kind: 'notes', workspacePath: 'NOTES.md' })
  })

  it('classifies root and nested glossary paths without claiming unrelated files', () => {
    expect(
      buildMindMapSourceRefDisplay({
        id: 'root-glossary-source',
        workspacePath: 'GLOSSARY.md'
      })
    ).toMatchObject({ kind: 'glossary', workspacePath: 'GLOSSARY.md' })

    expect(
      buildMindMapSourceRefDisplay({
        id: 'nested-glossary-source',
        workspacePath: 'glossary/terms.md'
      })
    ).toMatchObject({ kind: 'glossary', workspacePath: 'glossary/terms.md' })

    expect(
      buildMindMapSourceRefDisplay({
        id: 'markdown-glossary-source',
        workspacePath: 'GLOSSARY.markdown'
      })
    ).toMatchObject({ kind: 'glossary', workspacePath: 'GLOSSARY.markdown' })

    expect(
      buildMindMapSourceRefDisplay({
        id: 'unrelated-glossary-source',
        workspacePath: 'reference/glossary.md'
      })
    ).toMatchObject({ kind: 'workspace', workspacePath: 'reference/glossary.md' })
  })

  it('reports unknown when either side lacks a content hash', () => {
    expect(
      buildMindMapSourceRefDisplay({ ...anchor, contentHash: undefined }, 'hash-v2')
    ).toMatchObject({ status: 'unknown', stale: false })
    expect(buildMindMapSourceRefDisplay(anchor)).toMatchObject({ status: 'unknown', stale: false })
  })

  it('prefers the last non-empty breadcrumb, then file basename, then id', () => {
    expect(
      buildMindMapSourceRefDisplay({
        id: 'source-breadcrumb',
        workspacePath: 'notes/chemistry.md',
        breadcrumb: ['Unit 3', ' Acids and Bases ']
      }).title
    ).toBe('Acids and Bases')
    expect(
      buildMindMapSourceRefDisplay({ id: 'source-file', workspacePath: 'notes/chemistry.markdown' }).title
    ).toBe('chemistry')
    expect(buildMindMapSourceRefDisplay({ id: 'source-id' }).title).toBe('source-id')
  })

  it('keeps an explicit stale state even when the current hash matches', () => {
    expect(buildMindMapSourceRefDisplay({ ...anchor, stale: true }, 'hash-v1')).toMatchObject({
      status: 'stale',
      stale: true
    })
  })

  it('does not mutate the source reference while building display data', () => {
    const ref: MindMapSourceRef = {
      ...anchor,
      workspacePath: './notes/chemistry.md',
      breadcrumb: ['Chemistry']
    }
    const original = structuredClone(ref)

    expect(buildMindMapSourceRefDisplay(ref, 'hash-v1')).toMatchObject({
      workspacePath: 'notes/chemistry.md'
    })
    expect(ref).toEqual(original)
  })

  it('requires a workspace path before reporting that a source can open', () => {
    expect(buildMindMapSourceRefDisplay({ id: 'missing-path' })).toMatchObject({
      kind: 'workspace',
      canOpen: false,
      title: 'missing-path'
    })
  })
})
