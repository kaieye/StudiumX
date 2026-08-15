import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import {
  MindMapContextMenu,
  type MindMapContextMenuActions
} from '../../src/renderer/src/views/mindmap/MindMapContextMenu'

function actions(): MindMapContextMenuActions {
  return {
    addChild: vi.fn(),
    addSibling: vi.fn(),
    deleteNode: vi.fn(),
    toggleCollapse: vi.fn(),
    toggleSiblingCollapse: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    copyStyle: vi.fn(),
    pasteStyle: vi.fn(),
    resetStyle: vi.fn(),
    insertAbove: vi.fn(),
    outdent: vi.fn(),
    insertMarkers: vi.fn(),
    insertNotes: vi.fn(),
    insertFormula: vi.fn(),
    insertLink: vi.fn(),
    insertImage: vi.fn()
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})

describe('MindMapContextMenu style clipboard', () => {
  it('offers copy style and keeps paste style disabled until a snapshot exists', () => {
    const menuActions = actions()
    const { rerender } = render(
      <MindMapContextMenu
        state={{ visible: true, x: 10, y: 10, nodeId: 'topic' }}
        actions={menuActions}
        canPaste={false}
        canPasteStyle={false}
        isCollapsed={false}
        isRoot={false}
        onClose={() => undefined}
      />
    )

    expect(screen.getByRole('button', { name: 'Add child node' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add sibling node' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Duplicate node' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete node' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse current child nodes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse all sibling child nodes' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all sibling child nodes' }))
    expect(menuActions.toggleSiblingCollapse).toHaveBeenCalledWith('topic')

    fireEvent.click(screen.getByRole('button', { name: 'Copy Style' }))
    expect(menuActions.copyStyle).toHaveBeenCalledWith('topic')

    rerender(
      <MindMapContextMenu
        state={{ visible: true, x: 10, y: 10, nodeId: 'topic' }}
        actions={menuActions}
        canPaste={false}
        canPasteStyle
        isCollapsed={false}
        isRoot={false}
        onClose={() => undefined}
      />
    )
    expect(screen.getByRole('button', { name: 'Paste Style' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset Style' }))
    expect(menuActions.resetStyle).toHaveBeenCalledWith('topic')
  })
})

describe('MindMapContextMenu insert submenu', () => {
  it('reveals the Insert submenu matching the top capsule button and dispatches to the target node', () => {
    const menuActions = actions()
    render(
      <MindMapContextMenu
        state={{ visible: true, x: 10, y: 10, nodeId: 'topic' }}
        actions={menuActions}
        canPaste={false}
        canPasteStyle={false}
        isCollapsed={false}
        isRoot={false}
        onClose={() => undefined}
      />
    )

    // The submenu trigger is a menuitem, not a button.
    expect(screen.getByRole('menuitem', { name: 'Insert' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Markers' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert' }))

    expect(screen.getByRole('menuitem', { name: 'Markers' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Formula (LaTeX)' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Links' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Images' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Markers' }))
    expect(menuActions.insertMarkers).toHaveBeenCalledWith('topic')

    // onClose is a no-op in this test, so the submenu portal stays open.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Images' }))
    expect(menuActions.insertImage).toHaveBeenCalledWith('topic')
  })
})
