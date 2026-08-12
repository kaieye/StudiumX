import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-1',
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
          children: [{ id: 'child', title: 'Child', children: [] }]
        },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

function renderCanvas() {
  return render(
    <MindMapCanvas
      document={makeDocument()}
      activeSheetIndex={0}
      onActiveSheetChange={() => undefined}
    />
  )
}

describe('MindMapCanvas accessibility', () => {
  beforeEach(() => {
    useMindMapViewStore.setState({ selectedNodeId: 'root', editingNodeId: null })
  })

  afterEach(() => {
    useMindMapViewStore.setState({ selectedNodeId: null, editingNodeId: null })
  })

  it('exposes each rendered topic as an accessible, roving button', () => {
    renderCanvas()

    expect(screen.getByRole('img', { name: 'Overview' })).toBeInTheDocument()
    const root = screen.getByRole('button', { name: 'Root' })
    const child = screen.getByRole('button', { name: 'Child' })

    expect(root).toHaveAttribute('aria-pressed', 'true')
    expect(root).toHaveAttribute('tabindex', '0')
    expect(child).toHaveAttribute('aria-pressed', 'false')
    expect(child).toHaveAttribute('tabindex', '-1')
  })

  it('lets pointer users select an accessible topic without entering edit mode', () => {
    renderCanvas()

    const child = screen.getByRole('button', { name: 'Child' })
    child.focus()
    fireEvent.pointerDown(child)

    expect(useMindMapViewStore.getState().selectedNodeId).toBe('child')
    expect(useMindMapViewStore.getState().editingNodeId).toBeNull()
    expect(child).toHaveAttribute('aria-pressed', 'true')
    expect(child).toHaveAttribute('tabindex', '0')
  })

  it('renders one selection decoration on the topic instead of a second outer ring', () => {
    const { container } = renderCanvas()

    expect(container.querySelectorAll('.mindmap-node-ring')).toHaveLength(0)
    const selected = container.querySelector('.mindmap-node-group.is-selected')
    expect(selected).not.toBeNull()
    expect(selected).toHaveStyle({ outline: 'none' })
    expect(selected?.querySelector('.mindmap-node-rect')).toHaveStyle({ stroke: 'var(--mm-focus)' })
  })

  it('keeps hover from drawing a second topic highlight beside the selected topic', () => {
    renderCanvas()

    const root = screen.getByRole('button', { name: 'Root' })
    const child = screen.getByRole('button', { name: 'Child' })
    fireEvent.pointerEnter(child)

    expect(root.querySelector('.mindmap-node-rect')).toHaveStyle({ stroke: 'var(--mm-focus)' })
    expect(child.querySelector('.mindmap-node-rect')).not.toHaveStyle({ stroke: 'var(--mm-focus)' })
  })

  it('keeps the viewport center fixed when toolbar zoom reaches 25%', () => {
    const document = makeDocument()
    const onViewportChange = vi.fn()
    const renderWithAction = (viewportAction: { id: number; type: 'zoom-out' } | null) => (
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onViewportChange={onViewportChange}
        viewportAction={viewportAction}
      />
    )
    const { rerender } = render(renderWithAction(null))
    const initialViewport = onViewportChange.mock.calls.at(-1)?.[0]
    if (!initialViewport) throw new Error('expected an initial canvas viewport')
    onViewportChange.mockClear()

    // Eight 1 / 1.2 steps clamp the canvas to its 25% minimum zoom.
    for (let id = 1; id <= 8; id += 1) {
      rerender(renderWithAction({ id, type: 'zoom-out' }))
    }

    const zoomedViewport = onViewportChange.mock.calls.at(-1)?.[0]
    if (!zoomedViewport) throw new Error('expected a zoomed canvas viewport')

    expect(zoomedViewport.width).toBeCloseTo(3200)
    expect(zoomedViewport.height).toBeCloseTo(2400)
    expect(zoomedViewport.x + zoomedViewport.width / 2).toBeCloseTo(
      initialViewport.x + initialViewport.width / 2
    )
    expect(zoomedViewport.y + zoomedViewport.height / 2).toBeCloseTo(
      initialViewport.y + initialViewport.height / 2
    )
  })
})
