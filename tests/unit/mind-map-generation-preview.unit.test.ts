import { describe, expect, it } from 'vitest'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import {
  createMindMapGenerationPreview,
  expandMindMapGenerationPreviewCommand,
  extractCompletedMindMapProposalItems,
  newCompletedMindMapProposalItems,
  projectMindMapGenerationPreviewCommand
} from '../../src/renderer/src/views/mindmap/mind-map-generation-preview'

const NOW = '2026-08-17T00:00:00.000Z'

function document(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [{
      id: 'sheet-1',
      title: 'Overview',
      root: { id: 'root-1', title: 'Root', children: [] },
      elements: [],
      layout: { structureClass: 'studiumx.layout.logic.right' }
    }],
    assets: []
  }
}

function proposalText(items: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    proposalId: 'proposal-1',
    scope: 'sheet',
    items
  })
}

describe('mind-map generation preview stream parser', () => {
  it('waits for closed item objects across chunks and ignores braces inside strings', () => {
    const raw = proposalText([
      {
        id: 'insert-1',
        command: {
          type: 'topic.insert',
          sheetId: 'sheet-1',
          parentId: 'root-1',
          node: { id: 'topic-1', title: 'A { brace } and a "quote"', children: [] }
        }
      },
      {
        id: 'rename-1',
        command: { type: 'document.rename', title: 'Finished' }
      }
    ])
    const boundary = raw.indexOf('brace') + 3

    expect(extractCompletedMindMapProposalItems(raw.slice(0, boundary))).toEqual([])
    expect(extractCompletedMindMapProposalItems(raw)).toEqual([
      expect.objectContaining({ id: 'insert-1', command: expect.objectContaining({ type: 'topic.insert' }) }),
      expect.objectContaining({ id: 'rename-1', command: expect.objectContaining({ type: 'document.rename' }) })
    ])
  })

  it('refuses a complete item whose command fails the shared strict schema', () => {
    const items = extractCompletedMindMapProposalItems(proposalText([{
      id: 'bad-command',
      command: {
        type: 'topic.insert',
        sheetId: 'sheet-1',
        parentId: 'root-1',
        node: { id: 'topic-1', title: 'Topic', children: [] },
        unexpected: true
      }
    }]))

    expect(items).toEqual([])
  })

  it('is idempotent when a cumulative stream is inspected more than once', () => {
    const raw = proposalText([{
      id: 'rename-1',
      command: { type: 'document.rename', title: 'Finished' }
    }])
    const admitted = new Set<string>()
    const first = newCompletedMindMapProposalItems(raw, admitted)
    first.forEach((item) => admitted.add(item.id))

    expect(first.map((item) => item.id)).toEqual(['rename-1'])
    expect(newCompletedMindMapProposalItems(raw, admitted)).toEqual([])
  })
})

describe('mind-map generation preview projection', () => {
  it('expands nested topic inserts from parent to child and projects one node at a time', () => {
    const command = {
      type: 'topic.insert' as const,
      sheetId: 'sheet-1',
      parentId: 'root-1',
      node: {
        id: 'branch',
        title: 'Branch',
        children: [{
          id: 'detail',
          title: 'Detail',
          children: [{ id: 'example', title: 'Example', children: [] }]
        }]
      }
    }

    const steps = expandMindMapGenerationPreviewCommand(command)
    expect(steps.map((step) => step.type === 'topic.insert' ? `${step.parentId}:${step.node.id}` : step.type))
      .toEqual(['root-1:branch', 'branch:detail', 'detail:example'])
    expect(steps.every((step) => step.type !== 'topic.insert' || step.node.children.length === 0)).toBe(true)

    let preview = createMindMapGenerationPreview('generation-1', document())
    for (const step of steps) {
      const projection = projectMindMapGenerationPreviewCommand(preview, step)
      expect(projection.applied).toBe(true)
      preview = projection.preview
    }

    const branch = preview.document.sheets[0]!.root.children[0]!
    expect(branch.id).toBe('branch')
    expect(branch.children[0]!.id).toBe('detail')
    expect(branch.children[0]!.children[0]!.id).toBe('example')
    expect(preview.latestNodeIds).toEqual(['example'])
    expect(preview.revision).toBe(3)
  })

  it('leaves the preview unchanged when a schema-validated command is not applicable to its clone', () => {
    const preview = createMindMapGenerationPreview('generation-1', document())
    const projection = projectMindMapGenerationPreviewCommand(preview, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'missing-topic',
      patch: { title: 'Never shown' }
    })

    expect(projection.applied).toBe(false)
    expect(projection.preview).toBe(preview)
    expect(document().sheets[0]!.root.children).toEqual([])
  })
})
