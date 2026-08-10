import { describe, expect, it } from 'vitest'
import {
  buildMindMapTextReplacementPatch,
  searchMindMapTopics
} from '../../src/renderer/src/views/mindmap/mind-map-search'
import type { MindMapTopicV2 } from '../../src/shared/mindmap/domain/types'

function makeTree(): MindMapTopicV2 {
  return {
    id: 'root',
    title: 'Study Plan',
    note: 'A note about revision',
    labels: ['Learning', 'Plan'],
    links: [{ id: 'root-link', url: 'https://example.test/revision', title: 'Revision guide' }],
    children: [
      {
        id: 'child',
        title: 'Practice',
        note: 'Solve examples',
        labels: ['Exercises'],
        links: [{ id: 'child-link', url: 'https://example.test/practice' }],
        children: []
      },
      { id: 'leaf', title: 'Review', children: [] }
    ]
  }
}

describe('mind map in-memory search', () => {
  it('scans title, note, labels and link text in preorder', () => {
    const root = makeTree()
    const matches = searchMindMapTopics(root, 'revision')

    expect(matches).toEqual([
      { nodeId: 'root', title: 'Study Plan', fields: ['note', 'link'] }
    ])
  })

  it('is case-insensitive and returns no results for blank or missing queries', () => {
    const root = makeTree()

    expect(searchMindMapTopics(root, '  PRACTICE  ')).toEqual([
      { nodeId: 'child', title: 'Practice', fields: ['title', 'link'] }
    ])
    expect(searchMindMapTopics(root, '   ')).toEqual([])
    expect(searchMindMapTopics(root, 'does-not-exist')).toEqual([])
  })

  it('escapes regular-expression characters and does not mutate the tree', () => {
    const root: MindMapTopicV2 = {
      id: 'root',
      title: 'Use (draft) + plan',
      children: []
    }
    const before = structuredClone(root)

    expect(searchMindMapTopics(root, '(draft) +')).toEqual([
      { nodeId: 'root', title: 'Use (draft) + plan', fields: ['title'] }
    ])
    expect(root).toEqual(before)
  })
})

describe('mind map text replacement patches', () => {
  it('replaces occurrences across all searchable fields without mutating the topic', () => {
    const topic = makeTree()
    const before = structuredClone(topic)
    const patch = buildMindMapTextReplacementPatch(topic, 'revision', 'review')

    expect(patch).toEqual({
      note: 'A note about review',
      links: [{ id: 'root-link', url: 'https://example.test/review', title: 'review guide' }]
    })
    expect(topic).toEqual(before)
  })

  it('removes empty optional values after replacement', () => {
    const topic: MindMapTopicV2 = {
      id: 'topic',
      title: 'Keep',
      note: 'remove me',
      labels: ['remove me', 'Keep label'],
      links: [{ id: 'link', url: 'https://example.test/keep', title: 'remove me' }],
      children: []
    }

    expect(buildMindMapTextReplacementPatch(topic, 'remove me', '')).toEqual({
      note: null,
      labels: ['Keep label'],
      links: [{ id: 'link', url: 'https://example.test/keep' }]
    })
  })

  it('preserves replacement strings that contain replace-token syntax', () => {
    const topic: MindMapTopicV2 = { id: 'topic', title: 'price', children: [] }

    expect(buildMindMapTextReplacementPatch(topic, 'price', '$& now')).toEqual({
      title: '$& now'
    })
  })

  it('returns null when the query is blank or no searchable text changes', () => {
    const topic = makeTree()

    expect(buildMindMapTextReplacementPatch(topic, '   ', 'x')).toBeNull()
    expect(buildMindMapTextReplacementPatch(topic, 'not present', 'x')).toBeNull()
    expect(
      buildMindMapTextReplacementPatch(
        { id: 'empty-link-title', title: 'Keep', links: [{ id: 'link', url: 'https://example.test', title: '' }], children: [] },
        'not present',
        'x'
      )
    ).toBeNull()
  })
})
