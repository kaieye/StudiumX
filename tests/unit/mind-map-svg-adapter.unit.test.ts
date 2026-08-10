import { describe, expect, it } from 'vitest'

import { mindMapLayoutToSvgInput } from '../../src/renderer/src/views/mindmap/mind-map-svg-adapter'
import type { MindMapLayoutResult } from '../../src/renderer/src/views/mindmap/mind-map-layout'

function sampleLayout(): MindMapLayoutResult {
  return {
    nodes: [
      {
        id: 'root',
        title: 'Root',
        x: -80,
        y: 0,
        width: 160,
        height: 40,
        depth: 0,
        collapsed: false,
        note: 'not part of static SVG input'
      },
      {
        id: 'child',
        title: 'Child',
        x: 160,
        y: 80,
        width: 160,
        height: 40,
        depth: 1,
        collapsed: true
      }
    ],
    edges: [{ from: 'root', to: 'child' }],
    relationships: [],
    callouts: [],
    summaries: []
  }
}

describe('mindMapLayoutToSvgInput', () => {
  it('maps the visible layout without renderer-only fields or mutation', () => {
    const layout = sampleLayout()
    const before = structuredClone(layout)

    expect(mindMapLayoutToSvgInput('Sheet title', layout)).toEqual({
      title: 'Sheet title',
      nodes: [
        {
          id: 'root',
          title: 'Root',
          x: -80,
          y: 0,
          width: 160,
          height: 40,
          collapsed: false
        },
        {
          id: 'child',
          title: 'Child',
          x: 160,
          y: 80,
          width: 160,
          height: 40,
          collapsed: true
        }
      ],
      edges: [{ from: 'root', to: 'child' }]
    })
    expect(layout).toEqual(before)
  })

  it('adds visible relationship elements to the exported edge list', () => {
    const layout = sampleLayout()

    expect(
      mindMapLayoutToSvgInput('Sheet title', layout, [
        {
          id: 'relationship-1',
          type: 'relationship',
          from: 'root',
          to: 'child',
          label: 'supports'
        },
        {
          id: 'relationship-hidden',
          type: 'relationship',
          from: 'root',
          to: 'missing',
          label: 'not exported'
        }
      ])
    ).toMatchObject({
      edges: [
        { from: 'root', to: 'child' },
        { from: 'root', to: 'child', label: 'supports' }
      ]
    })
  })
})
