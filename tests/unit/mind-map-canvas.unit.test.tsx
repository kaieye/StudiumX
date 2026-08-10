import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
})
