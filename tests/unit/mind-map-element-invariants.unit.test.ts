import { describe, expect, it } from 'vitest'

import { validateMindMapSheetV2 } from '../../src/shared/mindmap/domain/invariants'
import type {
  MindMapElement,
  MindMapSheetV2
} from '../../src/shared/mindmap/domain/types'

function baseSheet(elements: MindMapElement[]): MindMapSheetV2 {
  return {
    id: 'sheet-1',
    title: 'Sheet 1',
    root: {
      id: 'root-1',
      title: 'Root',
      children: [{ id: 'child-1', title: 'Child', children: [] }]
    },
    elements,
    layout: { structureClass: 'org.xmind.ui.logic.right' }
  }
}

describe('mind map element reference invariants', () => {
  it('accepts every supported element type when all topic references exist', () => {
    const elements: MindMapElement[] = [
      { id: 'relationship-1', type: 'relationship', from: 'root-1', to: 'child-1' },
      { id: 'boundary-1', type: 'boundary', topicId: 'root-1', children: ['child-1'] },
      { id: 'summary-1', type: 'summary', from: 'root-1', to: 'child-1' },
      { id: 'callout-1', type: 'callout', topicId: 'child-1', text: 'Note' },
      { id: 'free-topic-1', type: 'free-topic', topicId: 'child-1', position: { x: 0, y: 0 } }
    ]

    expect(validateMindMapSheetV2(baseSheet(elements))).toEqual([])
  })

  it.each([
    [
      'summary.from',
      { id: 'summary-1', type: 'summary', from: 'missing', to: 'child-1' }
    ],
    [
      'summary.to',
      { id: 'summary-1', type: 'summary', from: 'root-1', to: 'missing' }
    ],
    [
      'summary.summaryTopicId',
      { id: 'summary-1', type: 'summary', from: 'root-1', to: 'child-1', summaryTopicId: 'missing' }
    ],
    ['callout.topicId', { id: 'callout-1', type: 'callout', topicId: 'missing', text: 'Note' }],
    [
      'free-topic.topicId',
      { id: 'free-topic-1', type: 'free-topic', topicId: 'missing', position: { x: 0, y: 0 } }
    ]
  ] as const)('reports a missing topic reference for %s', (_field, element) => {
    const errors = validateMindMapSheetV2(baseSheet([element]))

    expect(errors.some((error) => error.code === 'ELEMENT_REF_MISSING')).toBe(true)
  })
})
