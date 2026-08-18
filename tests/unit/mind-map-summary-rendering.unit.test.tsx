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
    id: 'mind-map-summary',
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
            { id: 'child-b', title: 'Middle topic', children: [] },
            { id: 'child-c', title: 'Last topic', children: [] },
            {
              id: 'collapsed',
              title: 'Collapsed topic',
              collapsed: true,
              children: [{ id: 'hidden', title: 'Hidden topic', children: [] }]
            }
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

describe('MindMapCanvas summary rendering', () => {
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

  it('renders a labelled brace summary between visible topics', () => {
    const { container } = renderCanvas([
      {
        id: 'summary-1',
        type: 'summary',
        from: 'child-a',
        to: 'child-c',
        sourceTopicIds: ['child-a', 'child-b', 'child-c'],
        label: 'Core ideas'
      }
    ])

    expect(container.querySelectorAll('.mindmap-summary-group')).toHaveLength(1)
    expect(container.querySelectorAll('.mindmap-summary-brace')).toHaveLength(1)
    expect(container.querySelector('.mindmap-summary-label')).toHaveTextContent('Core ideas')
    expect(screen.getByRole('button', { name: 'Core ideas' })).toBeInTheDocument()
  })

  it('skips summaries whose endpoints are missing or hidden by collapse', () => {
    const { container } = renderCanvas([
      { id: 'missing', type: 'summary', from: 'child-a', to: 'not-in-tree', label: 'Missing' },
      {
        id: 'hidden',
        type: 'summary',
        from: 'child-a',
        to: 'child-c',
        sourceTopicIds: ['child-a', 'child-b', 'hidden'],
        label: 'Hidden'
      }
    ])

    expect(container.querySelectorAll('.mindmap-summary-group')).toHaveLength(0)
    expect(screen.queryByText('Missing')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('uses endpoint titles as accessible name when a summary has no label', () => {
    renderCanvas([{ id: 'summary-untitled', type: 'summary', from: 'child-a', to: 'child-c' }])

    expect(screen.getByRole('button', { name: 'First topic → Last topic' })).toBeInTheDocument()
    expect(document.querySelector('.mindmap-summary-label')).not.toBeInTheDocument()
  })

  it('does not render a summary layer when no summary elements are present', () => {
    const { container } = renderCanvas([])

    expect(container.querySelector('.mindmap-summary-group')).not.toBeInTheDocument()
  })
  it('consumes every applicable persisted summary style field', () => {
    const { container } = renderCanvas([{
      id: 'styled-summary', type: 'summary', from: 'child-a', to: 'child-c', label: 'Styled',
      style: { stroke: '#123456', strokeWidth: 3, textColor: '#334455',
        fontFamily: 'Georgia, serif', fontSize: 17, dashed: true }
    }])
    expect(container.querySelector('.mindmap-summary-brace')).toHaveStyle({
      stroke: '#123456', strokeWidth: '3', strokeDasharray: '5 4'
    })
    expect(container.querySelector('.mindmap-summary-label')).toHaveStyle({
      fill: '#334455', fontFamily: 'Georgia, serif', fontSize: '17px'
    })
  })

})
