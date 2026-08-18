import { describe, expect, it } from 'vitest'

import {
  buildMindMapProposalReviewPreview,
  transitionMindMapProposal,
  type MindMapDocumentV2,
  type MindMapSourceRef
} from '../../src/shared/mindmap/commands'

const sourceRef: MindMapSourceRef = {
  id: 'source-1',
  workspacePath: 'notes/biology.md',
  breadcrumb: ['Biology', 'Cells'],
  blockId: 'block-1',
  contentHash: 'hash-1'
}

function documentV2(withSourceRef = false): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-review',
    revision: 4,
    title: 'Review preview',
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
            {
              id: 'topic-1',
              title: 'Topic',
              ...(withSourceRef ? { sourceRefs: [sourceRef] } : {}),
              children: []
            }
          ]
        },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

describe('mind-map proposal request-only review seam', () => {
  it('creates a canonical request and an empty, local-only pending review shell', () => {
    const document = documentV2()
    const result = buildMindMapProposalReviewPreview({
      document,
      scope: 'selection',
      sheetId: 'sheet-1',
      selectedTopicIds: ['topic-1']
    })

    expect(result).toEqual({
      ok: true,
      preview: {
        request: {
          schemaVersion: 1,
          scope: 'selection',
          documentId: 'doc-review',
          sheetId: 'sheet-1',
          selectedTopicIds: ['topic-1'],
          sourceRefs: []
        },
        state: {
          proposalId: 'request-preview:doc-review:sheet-1:selection',
          itemIds: [],
          decisions: {},
          status: 'pending'
        }
      }
    })

    if (!result.ok) return
    const accepted = transitionMindMapProposal(result.preview.state, { type: 'accept' })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    expect(accepted.state.status).toBe('accepted')
    expect(document.sheets[0]?.root.children).toHaveLength(1)
  })

  it('forwards fail-closed request errors without creating review state', () => {
    const result = buildMindMapProposalReviewPreview({
      document: documentV2(),
      scope: 'selection',
      sheetId: 'sheet-1'
    })

    expect(result).toEqual({
      ok: false,
      code: 'empty_scope',
      message: 'selection scope requires at least one selected topic'
    })
  })

  it('derives canonical source refs for source-scope previews from the active sheet', () => {
    const result = buildMindMapProposalReviewPreview({
      document: documentV2(true),
      scope: 'source',
      sheetId: 'sheet-1'
    })

    expect(result).toMatchObject({
      ok: true,
      preview: {
        request: {
          scope: 'source',
          sheetId: 'sheet-1',
          sourceRefs: [sourceRef]
        },
        state: {
          proposalId: 'request-preview:doc-review:sheet-1:source',
          status: 'pending'
        }
      }
    })
  })

  it('fails closed when source refs in the current sheet are ambiguous', () => {
    const document = documentV2(true)
    const sheet = document.sheets[0]!
    sheet.root.sourceRefs = [sourceRef]

    const result = buildMindMapProposalReviewPreview({
      document,
      scope: 'source',
      sheetId: 'sheet-1'
    })

    expect(result).toMatchObject({ ok: false, code: 'duplicate_id' })
  })
})
