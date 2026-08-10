import { render, screen } from '@testing-library/react'
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
    id: 'mind-map-callout',
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
            { id: 'visible', title: 'Visible topic', children: [] },
            {
              id: 'collapsed',
              title: 'Collapsed topic',
              collapsed: true,
              children: [{ id: 'hidden', title: 'Hidden topic', children: [] }]
            }
          ]
        },
        elements,
        layout: { structureClass: 'org.xmind.ui.logic.right' }
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

describe('MindMapCanvas callout rendering', () => {
  beforeEach(() => {
    useMindMapViewStore.setState({ selectedNodeId: 'root', editingNodeId: null })
  })

  afterEach(() => {
    useMindMapViewStore.setState({ selectedNodeId: null, editingNodeId: null })
  })

  it('renders a callout with a leader anchored to its visible topic', () => {
    const { container } = renderCanvas([
      {
        id: 'callout-1',
        type: 'callout',
        topicId: 'visible',
        text: 'Review this definition',
        position: { x: 420, y: 80 }
      }
    ])

    expect(container.querySelectorAll('.mindmap-callout')).toHaveLength(1)
    expect(container.querySelectorAll('.mindmap-callout-leader')).toHaveLength(1)
    expect(container.querySelector('.mindmap-callout-text')).toHaveTextContent('Review this definition')
    expect(screen.getByRole('note', { name: 'Review this definition' })).toBeInTheDocument()
  })

  it('skips callouts whose topic is missing or hidden by collapse', () => {
    const { container } = renderCanvas([
      { id: 'missing', type: 'callout', topicId: 'not-in-tree', text: 'Missing topic' },
      { id: 'hidden', type: 'callout', topicId: 'hidden', text: 'Hidden topic' }
    ])

    expect(container.querySelectorAll('.mindmap-callout')).toHaveLength(0)
    expect(screen.queryByText('Missing topic')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden topic')).not.toBeInTheDocument()
  })

  it('does not render a callout layer when no callout elements are present', () => {
    const { container } = renderCanvas([])

    expect(container.querySelector('.mindmap-callout-group')).not.toBeInTheDocument()
  })
})
