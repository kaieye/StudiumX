import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import { MindMapImageEditor } from '../../src/renderer/src/views/mindmap/MindMapImageEditor'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'

const NOW = '2026-08-15T00:00:00.000Z'

function makeDocument(placement?: 'top' | 'bottom' | 'left' | 'right'): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-image-placement',
    revision: 1,
    title: 'Image placement',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet',
        root: {
          id: 'root',
          title: 'Root',
          ...(placement ? { imagePlacement: placement } : {}),
          children: []
        },
        elements: [],
        images: [{ id: 'img-1', type: 'image', assetId: 'asset-1', width: 160, height: 88, topicId: 'root' }],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: [{ id: 'asset-1', fileName: 'diagram.png', mimeType: 'image/png' }]
  }
}

const originalTeachingSystemDescriptor = Object.getOwnPropertyDescriptor(window, 'teachingSystem')

describe('MindMapImageEditor placement control', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: {
        readMindMapAsset: vi.fn(async () => ({
          asset: makeDocument().assets[0]!,
          dataUrl: 'data:image/png;base64,AAAA'
        }))
      }
    })
  })

  afterEach(() => {
    useMindMapViewStore.setState({
      current: null,
      activeSheetId: null,
      selectedNodeId: null
    })
    if (originalTeachingSystemDescriptor) {
      Object.defineProperty(window, 'teachingSystem', originalTeachingSystemDescriptor)
    } else {
      delete (window as unknown as { teachingSystem?: unknown }).teachingSystem
    }
    vi.restoreAllMocks()
  })

  function seedStore(placement?: 'top' | 'bottom' | 'left' | 'right'): void {
    useMindMapViewStore.setState({
      current: makeDocument(placement),
      activeSheetId: 'sheet-1',
      selectedNodeId: 'root'
    })
  }

  it('offers top/bottom/left/right placement options and defaults to bottom', () => {
    seedStore()
    render(<MindMapImageEditor />)

    const group = screen.getByRole('radiogroup', { name: 'Image position' })
    const options = Array.from(group.querySelectorAll('[role="radio"]'))
    expect(options).toHaveLength(4)
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      'Image above text',
      'Image below text',
      'Image left of text',
      'Image right of text'
    ])
    // No explicit placement -> bottom is the active default.
    expect(options[1]).toHaveClass('is-active')
  })

  it('reflects the stored placement as active', () => {
    seedStore('right')
    render(<MindMapImageEditor />)

    const options = Array.from(screen.getByRole('radiogroup').querySelectorAll('[role="radio"]'))
    expect(options[3]).toHaveClass('is-active')
  })

  it('writes a placement change through the topic.update command', () => {
    seedStore()
    const dispatchCommand = vi.fn()
    const originalDispatch = useMindMapViewStore.getState().dispatchCommand
    useMindMapViewStore.setState({ dispatchCommand })

    try {
      render(<MindMapImageEditor />)
      const right = screen.getByRole('radio', { name: 'Image right of text' })
      fireEvent.click(right)

      expect(dispatchCommand).toHaveBeenCalledWith(
        {
          type: 'topic.update',
          sheetId: 'sheet-1',
          topicId: 'root',
          patch: { imagePlacement: 'right' }
        },
        expect.objectContaining({ label: 'Set topic image placement' })
      )
    } finally {
      useMindMapViewStore.setState({ dispatchCommand: originalDispatch })
    }
  })
})
