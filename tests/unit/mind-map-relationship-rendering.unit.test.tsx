import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(withRelationship = true): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-relationship',
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
            { id: 'child-a', title: 'Child A', children: [] },
            { id: 'child-b', title: 'Child B', children: [] }
          ]
        },
        elements: withRelationship
          ? [{ id: 'rel-1', type: 'relationship', from: 'child-a', to: 'child-b', label: 'depends on' }]
          : [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

function renderCanvas(withRelationship = true) {
  return render(
    <MindMapCanvas
      document={makeDocument(withRelationship)}
      activeSheetIndex={0}
      onActiveSheetChange={() => undefined}
    />
  )
}

describe('MindMapCanvas relationship rendering', () => {
  beforeEach(() => {
    useMindMapViewStore.setState({ selectedNodeId: 'root', editingNodeId: null })
  })

  afterEach(() => {
    useMindMapViewStore.setState({ selectedNodeId: null, editingNodeId: null })
  })

  it('renders a labelled relationship connector without replacing tree edges', () => {
    const { container } = renderCanvas()

    expect(container.querySelectorAll('.mindmap-edge')).toHaveLength(2)
    expect(container.querySelectorAll('.mindmap-relationship')).toHaveLength(1)
    expect(container.querySelector('.mindmap-relationship-label')).toHaveTextContent('depends on')
    expect(screen.getByLabelText('depends on')).toBeInTheDocument()
  })

  it('does not render a relationship layer when the sheet has no relationships', () => {
    const { container } = renderCanvas(false)

    expect(container.querySelector('.mindmap-relationship')).not.toBeInTheDocument()
    expect(screen.queryByText('depends on')).not.toBeInTheDocument()
  })
})
