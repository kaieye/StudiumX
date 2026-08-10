import { describe, expect, it } from 'vitest'

import { buildMindMapElementAccessibleLabel } from '../../src/shared/mindmap/domain/element-a11y'
import type { MindMapElement } from '../../src/shared/mindmap/domain/types'

const topicTitles = new Map([
  ['root', 'Course'],
  ['chemistry', 'Chemistry'],
  ['acids', 'Acids and Bases'],
  ['review', 'Review']
])

describe('buildMindMapElementAccessibleLabel', () => {
  it('describes a relationship with endpoint titles and its optional label', () => {
    const relationship: MindMapElement = {
      id: 'relationship-1',
      type: 'relationship',
      from: 'chemistry',
      to: 'acids',
      label: 'explains'
    }

    expect(buildMindMapElementAccessibleLabel(relationship, topicTitles)).toBe(
      'Relationship from Chemistry to Acids and Bases: explains'
    )
  })

  it('describes a boundary using its topic title and ignores blank labels', () => {
    const boundary: MindMapElement = {
      id: 'boundary-1',
      type: 'boundary',
      topicId: 'chemistry',
      label: '   '
    }

    expect(buildMindMapElementAccessibleLabel(boundary, topicTitles)).toBe(
      'Boundary around Chemistry'
    )
  })

  it('describes a summary across its source range', () => {
    const summary: MindMapElement = {
      id: 'summary-1',
      type: 'summary',
      from: 'chemistry',
      to: 'review',
      label: 'Key ideas'
    }

    expect(buildMindMapElementAccessibleLabel(summary, topicTitles)).toBe(
      'Summary from Chemistry to Review: Key ideas'
    )
  })

  it('falls back to stable ids when a referenced topic is missing', () => {
    const relationship: MindMapElement = {
      id: 'relationship-2',
      type: 'relationship',
      from: 'missing-from',
      to: 'missing-to'
    }

    expect(buildMindMapElementAccessibleLabel(relationship, topicTitles)).toBe(
      'Relationship from missing-from to missing-to'
    )
  })

  it('covers callouts and free topics through the same stable mapping', () => {
    expect(
      buildMindMapElementAccessibleLabel(
        { id: 'callout-1', type: 'callout', topicId: 'root', text: 'Read this' },
        topicTitles
      )
    ).toBe('Callout on Course')
    expect(
      buildMindMapElementAccessibleLabel(
        { id: 'free-1', type: 'free-topic', topicId: 'root', position: { x: 10, y: 20 } },
        topicTitles
      )
    ).toBe('Free topic Course')
  })

  it('does not mutate the element or title lookup', () => {
    const relationship: MindMapElement = {
      id: 'relationship-3',
      type: 'relationship',
      from: 'chemistry',
      to: 'acids',
      label: '  explains  '
    }
    const before = structuredClone(relationship)

    expect(buildMindMapElementAccessibleLabel(relationship, topicTitles)).toBe(
      'Relationship from Chemistry to Acids and Bases: explains'
    )
    expect(relationship).toEqual(before)
    expect(topicTitles.get('chemistry')).toBe('Chemistry')
  })
})
