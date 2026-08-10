import { describe, expect, it } from 'vitest'

import { filterMindMapTopicTree } from '../../src/shared/mindmap/domain/tree-filter'
import type { MindMapTopicV2 } from '../../src/shared/mindmap/domain/types'

function topic(
  id: string,
  title: string,
  children: MindMapTopicV2[] = [],
  extra: Partial<MindMapTopicV2> = {}
): MindMapTopicV2 {
  return { id, title, children, ...extra }
}

function fixture(): MindMapTopicV2 {
  return topic('root', 'Course', [
    topic('algebra', 'Algebra', [topic('equations', 'Equations')]),
    topic('physics', 'Physics', [
      topic('mechanics', 'Mechanics', [topic('newton', "Newton's laws")]),
      topic('optics', 'Optics')
    ]),
    topic('chemistry', 'Chemistry', [topic('acids', 'Acids and bases')])
  ])
}

describe('filterMindMapTopicTree', () => {
  it('matches titles case-insensitively and removes unrelated branches', () => {
    const result = filterMindMapTopicTree(fixture(), 'aLgEbRa')

    expect(result).toMatchObject({
      id: 'root',
      children: [{ id: 'algebra', title: 'Algebra', children: [] }]
    })
  })

  it('keeps every ancestor on the path to a descendant match', () => {
    const result = filterMindMapTopicTree(fixture(), 'NEWTON')

    expect(result).toEqual(
      topic('root', 'Course', [
        topic('physics', 'Physics', [
          topic('mechanics', 'Mechanics', [topic('newton', "Newton's laws")])
        ])
      ])
    )
  })

  it('does not keep non-matching descendants below an otherwise matching topic', () => {
    const result = filterMindMapTopicTree(fixture(), 'physics')

    expect(result).toEqual(topic('root', 'Course', [topic('physics', 'Physics')]))
  })

  it('returns a deep clone of the complete tree for an empty query', () => {
    const source = fixture()
    const result = filterMindMapTopicTree(source, '   ')

    expect(result).toEqual(source)
    expect(result).not.toBe(source)
    expect(result?.children).not.toBe(source.children)

    if (result === null) throw new Error('expected an empty query to return the tree')
    result.children[0].title = 'Changed in filtered view'
    expect(source.children[0].title).toBe('Algebra')
  })

  it('returns null when no topic title matches', () => {
    const source = fixture()
    const before = structuredClone(source)

    expect(filterMindMapTopicTree(source, 'thermodynamics')).toBeNull()
    expect(source).toEqual(before)
  })

  it('preserves topic metadata and child ordering without mutating the source', () => {
    const source = topic(
      'root',
      'Root',
      [
        topic('first', 'First', [], {
          labels: ['important'],
          planning: { taskStatus: 'doing', progress: 50 },
          manualPosition: { x: 10, y: 20 }
        }),
        topic('second', 'Second', [], { note: 'keep this note' })
      ],
      { collapsed: false, style: { fill: '#fff' } }
    )
    const before = structuredClone(source)

    const result = filterMindMapTopicTree(source, 'second')

    expect(result).toEqual(
      topic('root', 'Root', [topic('second', 'Second', [], { note: 'keep this note' })], {
        collapsed: false,
        style: { fill: '#fff' }
      })
    )
    expect(source).toEqual(before)
  })
})
