import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

// The active image-editing work currently passes image placement as the second
// argument to this layout helper. Keep this focused event regression test
// independent of that unrelated in-progress rendering seam.
vi.mock('../../src/renderer/src/views/mindmap/mind-map-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/src/views/mindmap/mind-map-layout')>()
  return {
    ...actual,
    computeTopicImageAndTextRegions: (node: { x: number; y: number; width: number; height: number }) => ({
      text: { x: node.x, y: node.y, width: node.width, height: node.height },
      image: null
    })
  }
})

import { MindMapCanvas } from '../../src/renderer/src/views/mindmap/MindMapCanvas'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'

const document: MindMapDocumentV2 = {
  schemaVersion: 2,
  id: 'mind-map-1',
  revision: 1,
  title: 'Study map',
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  theme: { id: 'default' },
  sheets: [{
    id: 'sheet-1',
    title: 'Overview',
    root: {
      id: 'root',
      title: 'Root',
      children: [{ id: 'child', title: 'Child', children: [] }]
    },
    elements: [],
    layout: { structureClass: 'org.xmind.ui.logic.right' }
  }],
  assets: []
}

describe('MindMapCanvas multi-selection context menu', () => {
  beforeEach(() => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['root', 'child'] },
      selectedNodeId: 'child',
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

  it('keeps a marquee multi-selection when opening a selected topic context menu', () => {
    const onContextMenu = vi.fn()
    render(
      <MindMapCanvas
        document={document}
        activeSheetIndex={0}
        onActiveSheetChange={() => undefined}
        onContextMenu={onContextMenu}
      />
    )

    const child = screen.getByRole('button', { name: 'Child' })
    fireEvent.pointerDown(child, { button: 2, pointerId: 1, clientX: 240, clientY: 120 })
    fireEvent.contextMenu(child, { clientX: 240, clientY: 120 })

    expect(useMindMapViewStore.getState().selection).toEqual({
      kind: 'topic',
      topicIds: ['root', 'child']
    })
    expect(onContextMenu).toHaveBeenCalledWith('child', 240, 120)
  })
})
