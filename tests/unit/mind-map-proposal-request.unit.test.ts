import { describe, expect, it } from 'vitest'

import {
  buildMindMapProposalRequest,
  mindMapProposalRequestSchema
} from '../../src/shared/mindmap/commands/mind-map-proposal-request'
import type { MindMapDocumentV2, MindMapSourceRef } from '../../src/shared/mindmap/domain/types'

const sourceA: MindMapSourceRef = {
  id: 'source-a',
  workspacePath: 'notes/a.md',
  blockId: 'block-a',
  contentHash: 'hash-a'
}
const sourceB: MindMapSourceRef = {
  id: 'source-b',
  workspacePath: 'lessons/b.md',
  blockId: 'block-b',
  contentHash: 'hash-b'
}
const lessonRef: MindMapSourceRef = {
  id: `lesson:${'a'.repeat(64)}`,
  workspacePath: 'courses/biology/lesson/cell-structure.html',
  contentHash: 'b'.repeat(64)
}

function documentV2(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 3,
    title: 'Proposal context',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:01:00.000Z',
    theme: { id: 'theme-1' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        root: {
          id: 'root-1',
          title: 'Root',
          children: [
            { id: 'topic-a', title: 'A', sourceRefs: [sourceA], children: [] },
            {
              id: 'topic-b',
              title: 'B',
              sourceRefs: [sourceB],
              children: [{ id: 'topic-b-child', title: 'B child', children: [] }]
            }
          ]
        },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      },
      {
        id: 'sheet-2',
        title: 'Sheet 2',
        root: { id: 'root-2', title: 'Other root', children: [] },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

describe('mind-map proposal request builder', () => {
  it('builds a canonical selection request from the active sheet and selected source', () => {
    const result = buildMindMapProposalRequest({
      document: documentV2(),
      scope: 'selection',
      sheetId: 'sheet-1',
      selectedTopicIds: ['topic-a'],
      sourceRefs: [sourceA]
    })

    expect(result).toEqual({
      ok: true,
      request: {
        schemaVersion: 1,
        scope: 'selection',
        documentId: 'doc-1',
        sheetId: 'sheet-1',
        selectedTopicIds: ['topic-a'],
        sourceRefs: [sourceA]
      }
    })
  })

  it('allows a whole-sheet request without a selection and requires refs for source scope', () => {
    const sheet = buildMindMapProposalRequest({
      document: documentV2(),
      scope: 'sheet',
      sheetId: 'sheet-1'
    })
    expect(sheet).toMatchObject({
      ok: true,
      request: {
        scope: 'sheet',
        sheetId: 'sheet-1',
        selectedTopicIds: [],
        sourceRefs: []
      }
    })

    const source = buildMindMapProposalRequest({
      document: documentV2(),
      scope: 'source',
      sheetId: 'sheet-1',
      sourceRefs: [sourceB]
    })
    expect(source).toMatchObject({
      ok: true,
      request: {
        scope: 'source',
        sourceRefs: [sourceB]
      }
    })
  })

  it.each([
    ['empty scope', { scope: '' }],
    ['unknown scope', { scope: 'workspace' }],
    ['missing sheet', { scope: 'sheet', sheetId: 'missing' }],
    ['selection without topics', { scope: 'selection', sheetId: 'sheet-1' }],
    ['source without refs', { scope: 'source', sheetId: 'sheet-1' }]
  ])('rejects %s', (_label, overrides) => {
    const result = buildMindMapProposalRequest({
      document: documentV2(),
      scope: 'sheet',
      sheetId: 'sheet-1',
      ...overrides
    })
    expect(result.ok).toBe(false)
  })

  it.each([
    ['topic outside target sheet', { scope: 'selection', selectedTopicIds: ['root-2'] }],
    ['source outside target sheet', { scope: 'source', sourceRefs: [{ id: 'missing-source' }] }],
    ['source outside selected subtree', {
      scope: 'selection',
      selectedTopicIds: ['topic-a'],
      sourceRefs: [sourceB]
    }]
  ])('rejects %s', (_label, overrides) => {
    const result = buildMindMapProposalRequest({
      document: documentV2(),
      scope: 'sheet',
      sheetId: 'sheet-1',
      ...overrides
    })
    expect(result.ok).toBe(false)
  })

  it('rejects duplicate ids and does not silently accept forged source metadata', () => {
    expect(
      buildMindMapProposalRequest({
        document: documentV2(),
        scope: 'selection',
        sheetId: 'sheet-1',
        selectedTopicIds: ['topic-a', 'topic-a']
      }).ok
    ).toBe(false)

    expect(
      buildMindMapProposalRequest({
        document: documentV2(),
        scope: 'source',
        sheetId: 'sheet-1',
        sourceRefs: [sourceA, { ...sourceA, contentHash: 'forged' }]
      }).ok
    ).toBe(false)

    expect(
      buildMindMapProposalRequest({
        document: documentV2(),
        scope: 'source',
        sheetId: 'sheet-1',
        sourceRefs: [{ ...sourceA, workspacePath: 'notes/other.md' }]
      }).ok
    ).toBe(false)
  })

  it('builds selected-file scope from canonical main-process metadata only', () => {
    const selectedFileRef: MindMapSourceRef = {
      id: 'selected-file:abc123',
      workspacePath: 'notes/biology.md',
      contentHash: 'sha256-content'
    }
    const result = buildMindMapProposalRequest({
      document: documentV2(),
      scope: 'selected-file',
      sheetId: 'sheet-1',
      selectedTopicIds: [],
      sourceRefs: [],
      selectedFileRef
    })

    expect(result).toEqual({
      ok: true,
      request: {
        schemaVersion: 1,
        scope: 'selected-file',
        documentId: 'doc-1',
        sheetId: 'sheet-1',
        selectedTopicIds: [],
        sourceRefs: [],
        selectedFile: selectedFileRef
      }
    })
    expect(mindMapProposalRequestSchema.safeParse((result as { request: unknown }).request).success).toBe(true)
  })

  it('builds notes scope from canonical main-process NOTES.md metadata only', () => {
    const notesRef: MindMapSourceRef = {
      id: 'notes:abc123',
      workspacePath: 'NOTES.md',
      contentHash: 'sha256-content'
    }
    const result = buildMindMapProposalRequest({
      document: documentV2(),
      scope: 'notes',
      sheetId: 'sheet-1',
      selectedTopicIds: [],
      sourceRefs: [],
      notesRef
    })

    expect(result).toEqual({
      ok: true,
      request: {
        schemaVersion: 1,
        scope: 'notes',
        documentId: 'doc-1',
        sheetId: 'sheet-1',
        selectedTopicIds: [],
        sourceRefs: [],
        notes: notesRef
      }
    })
    expect(mindMapProposalRequestSchema.safeParse((result as { request: unknown }).request).success).toBe(true)
  })

  it('builds Lesson scope from canonical main-process Lesson metadata only', () => {
    const result = buildMindMapProposalRequest({
      document: documentV2(),
      scope: 'lesson',
      sheetId: 'sheet-1',
      selectedTopicIds: [],
      sourceRefs: [],
      lessonRef
    })

    expect(result).toEqual({
      ok: true,
      request: {
        schemaVersion: 1,
        scope: 'lesson',
        documentId: 'doc-1',
        sheetId: 'sheet-1',
        selectedTopicIds: [],
        sourceRefs: [],
        lesson: lessonRef
      }
    })
    expect(mindMapProposalRequestSchema.safeParse((result as { request: unknown }).request).success).toBe(true)
  })

  it('rejects forged selected-file refs and other scope context', () => {
    const base = {
      document: documentV2(),
      scope: 'selected-file' as const,
      sheetId: 'sheet-1',
      selectedTopicIds: [] as string[],
      sourceRefs: [] as MindMapSourceRef[],
      selectedFileRef: {
        id: 'selected-file:abc123',
        workspacePath: 'notes/biology.md',
        contentHash: 'sha256-content'
      } satisfies MindMapSourceRef
    }

    for (const workspacePath of ['/private/biology.md', '../biology.md', 'C:\\private\\biology.md', 'bad\u0000name']) {
      expect(
        buildMindMapProposalRequest({ ...base, selectedFileRef: { ...base.selectedFileRef, workspacePath } })
      ).toMatchObject({ ok: false, code: 'invalid_source_refs' })
    }
    expect(
      buildMindMapProposalRequest({ ...base, selectedTopicIds: ['topic-a'] })
    ).toMatchObject({ ok: false, code: 'invalid_selection' })
    expect(
      buildMindMapProposalRequest({ ...base, sourceRefs: [sourceA] })
    ).toMatchObject({ ok: false, code: 'source_out_of_scope' })
    expect(
      buildMindMapProposalRequest({ ...base, selectedFileRef: undefined })
    ).toMatchObject({ ok: false, code: 'invalid_source_refs' })
    expect(
      buildMindMapProposalRequest({
        ...base,
        scope: 'sheet',
        selectedFileRef: base.selectedFileRef
      })
    ).toMatchObject({ ok: false, code: 'source_out_of_scope' })
  })

  it('rejects forged Notes metadata and incompatible scope context', () => {
    const base = {
      document: documentV2(),
      scope: 'notes' as const,
      sheetId: 'sheet-1',
      selectedTopicIds: [] as string[],
      sourceRefs: [] as MindMapSourceRef[],
      notesRef: {
        id: 'notes:abc123',
        workspacePath: 'NOTES.md',
        contentHash: 'sha256-content'
      } satisfies MindMapSourceRef
    }

    for (const notesRef of [
      { ...base.notesRef, workspacePath: 'notes.md' },
      { ...base.notesRef, workspacePath: '../NOTES.md' },
      { ...base.notesRef, id: 'selected-file:abc123' },
      { ...base.notesRef, contentHash: '' }
    ]) {
      expect(buildMindMapProposalRequest({ ...base, notesRef })).toMatchObject({
        ok: false,
        code: 'invalid_source_refs'
      })
    }
    expect(
      buildMindMapProposalRequest({ ...base, selectedTopicIds: ['topic-a'] })
    ).toMatchObject({ ok: false, code: 'invalid_selection' })
    expect(
      buildMindMapProposalRequest({ ...base, sourceRefs: [sourceA] })
    ).toMatchObject({ ok: false, code: 'source_out_of_scope' })
    expect(
      buildMindMapProposalRequest({ ...base, notesRef: undefined })
    ).toMatchObject({ ok: false, code: 'invalid_source_refs' })
    expect(
      buildMindMapProposalRequest({
        ...base,
        scope: 'sheet',
        notesRef: base.notesRef
      })
    ).toMatchObject({ ok: false, code: 'source_out_of_scope' })
  })

  it('rejects forged Lesson metadata and incompatible scope context', () => {
    const base = {
      document: documentV2(),
      scope: 'lesson' as const,
      sheetId: 'sheet-1',
      selectedTopicIds: [] as string[],
      sourceRefs: [] as MindMapSourceRef[],
      lessonRef
    }

    for (const forged of [
      { ...lessonRef, id: 'selected-file:abc123' },
      { ...lessonRef, workspacePath: 'notes/cell-structure.html' },
      { ...lessonRef, workspacePath: '../lessons/cell-structure.html' },
      { ...lessonRef, workspacePath: '/private/lessons/cell-structure.html' },
      { ...lessonRef, contentHash: '' },
      { ...lessonRef, contentHash: undefined },
      { ...lessonRef, extra: true } as unknown as MindMapSourceRef
    ]) {
      expect(buildMindMapProposalRequest({ ...base, lessonRef: forged })).toMatchObject({
        ok: false,
        code: 'invalid_source_refs'
      })
    }
    expect(
      buildMindMapProposalRequest({ ...base, selectedTopicIds: ['topic-a'] })
    ).toMatchObject({ ok: false, code: 'invalid_selection' })
    expect(
      buildMindMapProposalRequest({ ...base, sourceRefs: [sourceA] })
    ).toMatchObject({ ok: false, code: 'source_out_of_scope' })
    expect(
      buildMindMapProposalRequest({ ...base, selectedFileRef: {
        id: 'selected-file:abc123',
        workspacePath: 'notes/biology.md',
        contentHash: 'hash'
      } })
    ).toMatchObject({ ok: false, code: 'source_out_of_scope' })
    expect(
      buildMindMapProposalRequest({ ...base, notesRef: {
        id: 'notes:abc123',
        workspacePath: 'NOTES.md',
        contentHash: 'hash'
      } })
    ).toMatchObject({ ok: false, code: 'source_out_of_scope' })
    expect(
      buildMindMapProposalRequest({ ...base, lessonRef: undefined })
    ).toMatchObject({ ok: false, code: 'invalid_source_refs' })
    expect(
      buildMindMapProposalRequest({
        ...base,
        scope: 'sheet',
        lessonRef
      })
    ).toMatchObject({ ok: false, code: 'source_out_of_scope' })
  })

  it('rejects unknown request fields at the provider boundary', () => {
    expect(
      mindMapProposalRequestSchema.safeParse({
        schemaVersion: 1,
        scope: 'sheet',
        documentId: 'doc-1',
        sheetId: 'sheet-1',
        selectedTopicIds: [],
        sourceRefs: [],
        unexpected: true
      }).success
    ).toBe(false)

    expect(
      mindMapProposalRequestSchema.safeParse({
        schemaVersion: 1,
        scope: 'lesson',
        documentId: 'doc-1',
        sheetId: 'sheet-1',
        selectedTopicIds: [],
        sourceRefs: [],
        lesson: { ...lessonRef, extra: true }
      }).success
    ).toBe(false)
  })

  it('fails closed for a malformed document instead of throwing', () => {
    const result = buildMindMapProposalRequest({
      document: { sheets: null } as unknown as MindMapDocumentV2,
      scope: 'sheet',
      sheetId: 'sheet-1'
    })
    expect(result).toEqual({
      ok: false,
      code: 'invalid_document',
      message: 'current mind-map document is invalid'
    })
  })
})
