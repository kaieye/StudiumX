import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(withMarkers = true): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-marker',
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
            {
              id: 'child',
              title: 'Child',
              children: [],
              ...(withMarkers
                ? {
                    markers: [
                      { id: 'marker-1', symbol: '★', label: 'Important' },
                      { id: 'marker-2', symbol: '!', label: 'Review' }
                    ]
                  }
                : {})
            }
          ]
        },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

function renderCanvas(withMarkers = true) {
  return render(
    <MindMapCanvas
      document={makeDocument(withMarkers)}
      activeSheetIndex={0}
      onActiveSheetChange={() => undefined}
    />
  )
}

describe('MindMapCanvas marker rendering', () => {
  beforeEach(() => {
    useMindMapViewStore.setState({ selectedNodeId: 'root', editingNodeId: null })
  })

  afterEach(() => {
    useMindMapViewStore.setState({ selectedNodeId: null, editingNodeId: null })
  })

  it('renders topic markers as visible, labelled SVG badges', () => {
    const { container } = renderCanvas()

    expect(container.querySelectorAll('.mindmap-node-marker')).toHaveLength(2)
    expect(container.querySelectorAll('.mindmap-node-marker-badge')).toHaveLength(2)
    expect(container.querySelectorAll('.mindmap-node-marker-symbol')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Important' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Review' })).toBeInTheDocument()
  })

  it('does not render marker badges when the topic has no markers', () => {
    const { container } = renderCanvas(false)

    expect(container.querySelector('.mindmap-node-marker')).not.toBeInTheDocument()
  })
})
