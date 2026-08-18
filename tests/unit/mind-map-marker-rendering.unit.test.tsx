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
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function makeDocumentWithPanelMarkers(): MindMapDocumentV2 {
  return {
    ...makeDocument(false),
    sheets: [
      {
        ...makeDocument(false).sheets[0],
        root: {
          ...makeDocument(false).sheets[0].root,
          children: [
            {
              id: 'child',
              title: 'Child',
              children: [],
              markers: [
                { id: 'priority-3', symbol: 'priority-3', label: 'Priority 3' },
                { id: 'task-done', symbol: 'task-done', label: 'Done' },
                { id: 'flag-red', symbol: 'flag-red', label: 'Flag red' }
              ]
            }
          ]
        }
      }
    ]
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

  it('renders the real SVG icon for markers picked from the markers panel', () => {
    const { container } = render(
      <MindMapCanvas document={makeDocumentWithPanelMarkers()} activeSheetIndex={0} onActiveSheetChange={() => undefined} />
    )

    const markers = container.querySelectorAll('.mindmap-node-marker')
    expect(markers).toHaveLength(3)

    // Known markers render their SVG icon instead of a circle + raw symbol text.
    expect(container.querySelectorAll('.mindmap-node-marker svg')).toHaveLength(3)
    expect(container.querySelectorAll('.mindmap-node-marker-badge')).toHaveLength(0)
    expect(container.querySelectorAll('.mindmap-node-marker-symbol')).toHaveLength(0)
    expect(container.querySelector('.mindmap-node-marker')?.textContent).not.toContain('priority-3')

    expect(screen.getByRole('img', { name: 'Priority 3' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Flag red' })).toBeInTheDocument()
  })

  it('falls back to a labelled badge for unrecognized glyph markers', () => {
    const { container } = renderCanvas()

    expect(container.querySelectorAll('.mindmap-node-marker-badge')).toHaveLength(2)
    expect(container.querySelectorAll('.mindmap-node-marker-symbol')).toHaveLength(2)
    expect(container.querySelectorAll('.mindmap-node-marker svg')).toHaveLength(0)
  })
})
