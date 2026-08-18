import { describe, expect, it } from 'vitest'

import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import { buildMindMapSourceRefreshCommand } from '../../src/shared/mindmap/commands/mind-map-source-refresh'
import type {
  MindMapDocumentV2,
  MindMapSourceRef,
  MindMapTopicV2
} from '../../src/shared/mindmap/domain/types'

const confirmedAt = '2026-08-09T12:00:00.000Z'

function source(id: string, overrides: Partial<MindMapSourceRef> = {}): MindMapSourceRef {
  return {
    id,
    workspacePath: `notes/${id}.md`,
    breadcrumb: [id],
    contentHash: 'old-hash',
    stale: true,
    ...overrides
  }
}

function topic(
  id: string,
  sourceRefs: MindMapSourceRef[] = [],
  overrides: Partial<MindMapTopicV2> = {}
): MindMapTopicV2 {
  return { id, title: id, children: [], sourceRefs, ...overrides }
}

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'map-1',
    revision: 7,
    title: 'Source refresh',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'studiumx-default' },
    assets: [],
    sheets: [
      {
        id: 'sheet-1',
        title: 'First',
        root: topic('root-1', [source('shared'), source('unrelated', { stale: false, contentHash: 'same' })], {
          note: 'keep root note',
          children: [topic('child-1', [source('shared', { workspacePath: 'notes\\shared.md' })])]
        }),
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      },
      {
        id: 'sheet-2',
        title: 'Second',
        root: topic('root-2', [source('shared')], { note: 'keep second note' }),
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.left' }
      }
    ]
  }
}

function collectSourceRefs(document: MindMapDocumentV2, sourceId: string): MindMapSourceRef[] {
  const refs: MindMapSourceRef[] = []
  const visit = (node: MindMapTopicV2): void => {
    for (const sourceRef of node.sourceRefs ?? []) {
      if (sourceRef.id === sourceId) refs.push(sourceRef)
    }
    for (const child of node.children) visit(child)
  }
  for (const sheet of document.sheets) visit(sheet.root)
  return refs
}

describe('buildMindMapSourceRefreshCommand', () => {
  it('updates every repeated occurrence across sheets while preserving unrelated metadata', () => {
    const document = makeDocument()
    const original = structuredClone(document)
    const built = buildMindMapSourceRefreshCommand(
      document,
      [{ sourceRef: source('shared', { contentHash: 'new-hash', stale: false }) }],
      confirmedAt
    )

    expect(built).toMatchObject({ ok: true, appliedSourceIds: ['shared'] })
    if (!built.ok || built.command === null) throw new Error('expected a refresh command')
    expect(built.command.type).toBe('transaction')
    expect(built.command.commands).toHaveLength(3)

    const applied = applyMindMapCommand(document, built.command)
    expect(applied.ok).toBe(true)
    if (!applied.ok) throw new Error(applied.error.message)

    expect(collectSourceRefs(applied.document, 'shared')).toHaveLength(3)
    for (const sourceRef of collectSourceRefs(applied.document, 'shared')) {
      expect(sourceRef).toMatchObject({
        id: 'shared',
        workspacePath: 'notes/shared.md',
        contentHash: 'new-hash',
        lastConfirmedAt: confirmedAt,
        stale: false
      })
    }
    expect(applied.document.sheets[0]!.root.note).toBe('keep root note')
    expect(applied.document.sheets[0]!.root.children[0]!.sourceRefs).toEqual([
      expect.objectContaining({ id: 'shared', contentHash: 'new-hash' })
    ])
    expect(applied.document.sheets[0]!.root.sourceRefs).toEqual([
      expect.objectContaining({ id: 'shared', contentHash: 'new-hash' }),
      expect.objectContaining({ id: 'unrelated', contentHash: 'same', stale: false })
    ])
    expect(applied.document.sheets[1]!.title).toBe('Second')

    const undone = applyMindMapCommand(applied.document, applied.inverse)
    expect(undone.ok).toBe(true)
    if (!undone.ok) throw new Error(undone.error.message)
    expect(undone.document).toEqual(original)
  })

  it('rejects unknown source ids before constructing a command', () => {
    const built = buildMindMapSourceRefreshCommand(
      makeDocument(),
      [{ sourceRef: source('missing', { contentHash: 'new-hash' }) }],
      confirmedAt
    )
    expect(built).toEqual({ ok: false, code: 'source_unknown', sourceId: 'missing' })
  })

  it('rejects conflicting metadata for a repeated source id', () => {
    const document = makeDocument()
    document.sheets[1]!.root.sourceRefs = [source('shared', { blockId: 'different' })]
    const built = buildMindMapSourceRefreshCommand(
      document,
      [{ sourceRef: source('shared', { contentHash: 'new-hash' }) }],
      confirmedAt
    )
    expect(built).toEqual({ ok: false, code: 'source_conflict', sourceId: 'shared' })
  })
})
