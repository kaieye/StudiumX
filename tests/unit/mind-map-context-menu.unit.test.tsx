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
    edit: vi.fn(),
    deleteNode: vi.fn(),
    toggleCollapse: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    copyStyle: vi.fn(),
    pasteStyle: vi.fn(),
    resetStyle: vi.fn(),
    applyQuickStyle: vi.fn(),
    insertAbove: vi.fn(),
    outdent: vi.fn()
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

    fireEvent.click(screen.getByRole('button', { name: 'Important' }))
    expect(menuActions.applyQuickStyle).toHaveBeenCalledWith('topic', 'important')
  })
})
