import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
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
        layout: { structureClass: 'studiumx.layout.logic.right' }
      },
      {
        id: 'sheet-2',
        title: 'Plan',
        root: { id: 'root-2', title: 'Plan', children: [] },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      },
      {
        id: 'sheet-3',
        title: 'Review',
        root: { id: 'root-3', title: 'Review', children: [] },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function renderTabs(activeSheetId = 'sheet-1', document = makeDocument()) {
  const callbacks = {
    onActivate: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onRemove: vi.fn()
  }
  render(
    <MindMapSheetTabs
      document={document}
      activeSheetId={activeSheetId}
      {...callbacks}
    />
  )
  return callbacks
}

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})

describe('MindMapSheetTabs', () => {
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

  it('activates and focuses adjacent sheets with arrow keys, including wraparound', () => {
    const callbacks = renderTabs()
    const tabs = screen.getAllByRole('tab')

    tabs[0]!.focus()
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-2')
    expect(document.activeElement).toBe(tabs[1])

    fireEvent.keyDown(tabs[1]!, { key: 'ArrowLeft' })
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-1')
    expect(document.activeElement).toBe(tabs[0])

    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' })
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-3')
    expect(document.activeElement).toBe(tabs[2])
  })

  it('jumps to the first and last sheets with Home and End', () => {
    const callbacks = renderTabs('sheet-2')
    const tabs = screen.getAllByRole('tab')

    tabs[1]!.focus()
    fireEvent.keyDown(tabs[1]!, { key: 'Home' })
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-1')
    expect(document.activeElement).toBe(tabs[0])

    fireEvent.keyDown(tabs[0]!, { key: 'End' })
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-3')
    expect(document.activeElement).toBe(tabs[2])
  })

  it('starts inline renaming when a sheet title is clicked, without save or action buttons', async () => {
    const user = userEvent.setup()
    const callbacks = renderTabs()

    await user.click(screen.getByRole('tab', { name: 'Overview' }))

    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-1')
    const input = screen.getByRole('textbox', { name: 'Rename sheet' })
    expect(input).toHaveValue('Overview')
    expect(screen.queryByRole('button', { name: /Duplicate sheet/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove sheet/ })).not.toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'Course overview')
    await user.keyboard('{Enter}')

    expect(callbacks.onRename).toHaveBeenCalledWith('sheet-1', 'Course overview')
    expect(screen.queryByRole('textbox', { name: 'Rename sheet' })).not.toBeInTheDocument()
  })

  it('opens rename, duplicate, and remove actions from the title context menu', () => {
    const callbacks = renderTabs()
    const plan = screen.getByRole('tab', { name: 'Plan' })

    fireEvent.contextMenu(plan, { clientX: 100, clientY: 120 })

    expect(screen.getByRole('menu', { name: 'Actions for Plan' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Rename sheet' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Duplicate sheet' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove sheet' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate sheet' }))
    expect(callbacks.onDuplicate).toHaveBeenCalledWith('sheet-2')

    fireEvent.contextMenu(plan, { clientX: 100, clientY: 120 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename sheet' }))
    expect(callbacks.onActivate).toHaveBeenLastCalledWith('sheet-2')
    expect(screen.getByRole('textbox', { name: 'Rename sheet' })).toHaveValue('Plan')

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename sheet' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Rename sheet' })).not.toBeInTheDocument()

    const review = screen.getByRole('tab', { name: 'Review' })
    fireEvent.contextMenu(review, { clientX: 100, clientY: 120 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove sheet' }))
    expect(callbacks.onRemove).toHaveBeenCalledWith('sheet-3')
  })

  it('disables removal in the context menu when the document has only one sheet', () => {
    const document = makeDocument()
    document.sheets = [document.sheets[0]!]
    renderTabs('sheet-1', document)

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Overview' }), {
      clientX: 100,
      clientY: 120
    })

    expect(screen.getByRole('menuitem', { name: 'Remove sheet' })).toBeDisabled()
  })
})
