import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import { MindMapTopicPopover } from '../../src/renderer/src/views/mindmap/MindMapTopicPopover'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'

const NOW = '2026-08-15T00:00:00.000Z'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-notes-test',
    revision: 1,
    title: 'Notes test',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root',
          title: 'Root topic',
          note: 'Existing note',
          children: []
        },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

describe('MindMapTopicPopover', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    useMindMapViewStore.setState({
      current: makeDocument(),
      activeSheetId: 'sheet-1',
      selectedNodeId: 'root'
    })
  })

  afterEach(() => {
    useMindMapViewStore.setState({
      current: null,
      activeSheetId: null,
      selectedNodeId: null,
      updateNode: useMindMapViewStore.getState().updateNode
    })
  })

  it('renders the selected topic note in a floating dialog and focuses the editor', () => {
    const anchor = document.createElement('div')
    anchor.className = 'mindmap-node-group'
    anchor.dataset.nodeId = 'root'
    document.body.append(anchor)

    render(<MindMapTopicPopover nodeId="root" section="note" onClose={() => undefined} />)

    expect(screen.getByRole('dialog', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.getByText('Root topic')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Node note' })).toHaveValue('Existing note')
  })

  it('writes note edits through the canonical updateNode command path', () => {
    const updateNode = vi.fn()
    const originalUpdateNode = useMindMapViewStore.getState().updateNode
    useMindMapViewStore.setState({ updateNode })

    try {
      render(<MindMapTopicPopover nodeId="root" section="note" onClose={() => undefined} />)
      fireEvent.change(screen.getByRole('textbox', { name: 'Node note' }), {
        target: { value: 'Updated note' }
      })
      expect(updateNode).toHaveBeenCalledWith('root', { note: 'Updated note' })
    } finally {
      useMindMapViewStore.setState({ updateNode: originalUpdateNode })
    }
  })

  it('closes on Escape and pointer activity outside the card', () => {
    const onClose = vi.fn()
    render(<MindMapTopicPopover nodeId="root" section="note" onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not treat the opening pointer event as an outside click', () => {
    const onClose = vi.fn()
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    try {
      render(<MindMapTopicPopover nodeId="root" section="note" onClose={onClose} />)

      // The listener is intentionally armed on the next frame. A synchronous
      // document listener would close the card for the pointer event that
      // opened it in the real toolbar click path.
      fireEvent.pointerDown(document.body)
      expect(onClose).not.toHaveBeenCalled()

      for (const callback of frames) callback(0)
      fireEvent.pointerDown(document.body)
      expect(onClose).toHaveBeenCalledOnce()
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })
})
