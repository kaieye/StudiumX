import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(
  elements: MindMapDocumentV2['sheets'][number]['elements'] = []
): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-boundary',
    revision: 1,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root',
          title: 'Root',
          children: [
            { id: 'child-a', title: 'First topic', children: [] },
            { id: 'child-b', title: 'Second topic', children: [] }
          ]
        },
        elements,
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function renderCanvas(elements: MindMapDocumentV2['sheets'][number]['elements']) {
  return render(
    <MindMapCanvas
      document={makeDocument(elements)}
      activeSheetIndex={0}
      onActiveSheetChange={() => undefined}
    />
  )
}

describe('MindMapCanvas boundary rendering', () => {
  beforeEach(() => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['root'] },
      selectedNodeId: 'root',
      editingNodeId: null
    })
  })

  afterEach(() => {
    useMindMapViewStore.setState({
      selection: { kind: 'canvas' },
      selectedNodeId: null,
      editingNodeId: null
    })
  })

  it('renders a labelled boundary frame around its topic subtree', () => {
    const { container } = renderCanvas([
      { id: 'boundary-1', type: 'boundary', topicId: 'child-a', label: 'Core range' }
    ])

    expect(container.querySelectorAll('.mindmap-boundary-group')).toHaveLength(1)
    expect(container.querySelectorAll('.mindmap-boundary')).toHaveLength(1)
    expect(container.querySelector('.mindmap-boundary-label')).toHaveTextContent('Core range')
    expect(screen.getByRole('button', { name: 'Core range' })).toBeInTheDocument()
  })

  it('renders a transparent hit band that selects the boundary on pointer down', () => {
    const { container } = renderCanvas([
      { id: 'boundary-1', type: 'boundary', topicId: 'child-a', label: 'Core range' }
    ])
    const hit = container.querySelector<SVGPathElement>('.mindmap-boundary-hit')
    if (!hit) throw new Error('expected boundary hit target')

    // The visible frame and its translucent fill stay pointer-events:none so
    // empty space inside the boundary keeps pan/marquee gestures; the hit band
    // along the outline is what makes the AI-added element selectable and
    // therefore deletable.
    expect(hit).toHaveAttribute('fill', 'none')
    expect(hit).toHaveAttribute('stroke', 'transparent')
    expect(Number(hit.getAttribute('stroke-width'))).toBeGreaterThanOrEqual(12)
    expect(hit).toHaveAttribute('pointer-events', 'stroke')

    fireEvent.pointerDown(hit, { button: 0, pointerId: 64 })
    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'element',
      elementId: 'boundary-1',
      elementType: 'boundary'
    })
  })

  it('does not render a boundary layer when no boundary elements are present', () => {
    const { container } = renderCanvas([])

    expect(container.querySelector('.mindmap-boundary-group')).not.toBeInTheDocument()
  })
})
