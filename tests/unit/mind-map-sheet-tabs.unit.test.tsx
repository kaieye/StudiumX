import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MindMapSheetTabs } from '../../src/renderer/src/views/mindmap/MindMapSheetTabs'
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
        root: { id: 'root-1', title: 'Overview', children: [] },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      },
      {
        id: 'sheet-2',
        title: 'Plan',
        root: { id: 'root-2', title: 'Plan', children: [] },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      },
      {
        id: 'sheet-3',
        title: 'Review',
        root: { id: 'root-3', title: 'Review', children: [] },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

function renderTabs(activeSheetId = 'sheet-1') {
  const callbacks = {
    onActivate: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
    onReorder: vi.fn()
  }
  render(
    <MindMapSheetTabs
      document={makeDocument()}
      activeSheetId={activeSheetId}
      {...callbacks}
    />
  )
  return callbacks
}

describe('MindMapSheetTabs keyboard accessibility', () => {
  it('exposes a horizontal tablist with one roving tab stop', () => {
    renderTabs()

    expect(screen.getByRole('tablist', { name: 'Sheets' })).toHaveAttribute(
      'aria-orientation',
      'horizontal'
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false'
    ])
  })

  it('activates and focuses adjacent sheets with arrow keys, including wraparound', async () => {
    const user = userEvent.setup()
    const callbacks = renderTabs()
    const tabs = screen.getAllByRole('tab')

    await user.click(tabs[0]!)
    await user.keyboard('{ArrowRight}')
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-2')
    expect(document.activeElement).toBe(tabs[1])

    await user.keyboard('{ArrowLeft}')
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-1')
    expect(document.activeElement).toBe(tabs[0])

    await user.keyboard('{ArrowLeft}')
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-3')
    expect(document.activeElement).toBe(tabs[2])
  })

  it('jumps to the first and last sheets with Home and End', async () => {
    const user = userEvent.setup()
    const callbacks = renderTabs('sheet-2')
    const tabs = screen.getAllByRole('tab')

    await user.click(tabs[1]!)
    await user.keyboard('{Home}')
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-1')
    expect(document.activeElement).toBe(tabs[0])

    await user.keyboard('{End}')
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-3')
    expect(document.activeElement).toBe(tabs[2])
  })
})
