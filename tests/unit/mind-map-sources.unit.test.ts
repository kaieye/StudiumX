import { describe, expect, it } from 'vitest'
import type { MindMapTopicV2 } from '../../src/shared/mindmap/domain/types'
import {
  collectMindMapSources,
  mindMapSourceDisplayName,
  mindMapSourceLocation
} from '../../src/renderer/src/views/mindmap/mind-map-sources'

function makeRoot(): MindMapTopicV2 {
  return {
    id: 'root',
    title: 'Root',
    sourceRefs: [
      {
        id: 'source-first',
        workspacePath: 'notes\\first.md',
        breadcrumb: ['Unit 1', 'First']
      },
      {
        id: 'source-second',
        workspacePath: 'lessons\\second.md'
      }
    ],
    children: [
      {
        id: 'child',
        title: 'Child',
        sourceRefs: [
          { id: 'source-first', workspacePath: 'notes/first.md', stale: true },
          { id: 'source-third', breadcrumb: ['Third'] }
        ],
        children: [
          {
            id: 'grandchild',
            title: 'Grandchild',
            sourceRefs: [{ id: 'source-second', workspacePath: 'lessons/second.md' }],
            children: []
          }
        ]
      }
    ]
  }
}

describe('collectMindMapSources', () => {
  it('collects source refs in preorder, deduplicates them, and aggregates topic metadata', () => {
    const sources = collectMindMapSources(makeRoot())

    expect(sources.map(({ sourceRef }) => sourceRef.id)).toEqual([
      'source-first',
      'source-second',
      'source-third'
    ])
    expect(sources).toMatchObject([
      {
        sourceRef: { id: 'source-first', stale: true },
        nodeIds: ['root', 'child'],
        nodeTitles: ['Root', 'Child']
      },
      {
        sourceRef: { id: 'source-second' },
        nodeIds: ['root', 'grandchild'],
        nodeTitles: ['Root', 'Grandchild']
      },
      {
        sourceRef: { id: 'source-third' },
        nodeIds: ['child'],
        nodeTitles: ['Child']
      }
    ])
  })

  it('does not mutate the topic tree or its source refs', () => {
    const root = makeRoot()
    const original = structuredClone(root)

    const sources = collectMindMapSources(root)
    sources[0]!.nodeIds.push('not-in-tree')
    sources[0]!.sourceRef.stale = false

    expect(root).toEqual(original)
  })
})

describe('mind map source display helpers', () => {
  it('prefers a breadcrumb, then a normalized workspace basename, then the source id', () => {
    expect(
      mindMapSourceDisplayName(
        {
          id: 'breadcrumb-source',
          workspacePath: 'notes\\chemistry.md',
          breadcrumb: ['Unit 3', 'Acids and Bases']
        },
        'Untitled source'
      )
    ).toBe('Unit 3 / Acids and Bases')

    expect(
      mindMapSourceDisplayName(
        { id: 'path-source', workspacePath: 'lessons\\intro.md' },
        'Untitled source'
      )
    ).toBe('intro.md')

    expect(mindMapSourceDisplayName({ id: 'id-source' }, 'Untitled source')).toBe('id-source')
  })

  it('normalizes Windows paths and removes a leading relative path marker', () => {
    expect(
      mindMapSourceLocation({
        id: 'windows-source',
        workspacePath: '.\\notes\\chemistry.md'
      })
    ).toBe('notes/chemistry.md')
    expect(
      mindMapSourceLocation({ id: 'relative-source', workspacePath: './lessons/intro.md' })
    ).toBe('lessons/intro.md')
  })

  it('uses the untitled label when a source has no displayable identity', () => {
    expect(mindMapSourceDisplayName({ id: '' }, 'Untitled source')).toBe('Untitled source')
    expect(mindMapSourceLocation({ id: 'missing-path' })).toBeNull()
  })
})
