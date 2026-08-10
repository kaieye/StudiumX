import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MindMapOutline } from '../../src/renderer/src/views/mindmap/MindMapOutline'
import type { MindMapSheetV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function makeSheet(): MindMapSheetV2 {
  return {
    id: 'sheet-1',
    title: 'Course plan',
    root: {
      id: 'root',
      title: 'Course',
      children: [
        {
          id: 'chapter',
          title: 'Chapter',
          children: [{ id: 'topic', title: 'Topic', children: [] }]
        },
        { id: 'review', title: 'Review', collapsed: true, children: [{ id: 'hidden', title: 'Hidden', children: [] }] }
      ]
    },
    elements: [],
    layout: { structureClass: 'org.xmind.ui.logic.right' }
  }
}

describe('MindMapOutline', () => {
  it('renders a tree with visible descendants and roving selection tab stops', () => {
    render(
      <MindMapOutline
        sheet={makeSheet()}
        selectedNodeId="chapter"
        onSelect={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    )

    expect(screen.getByRole('tree', { name: 'Course plan outline' })).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem').map((item) => item.textContent)).toEqual([
      'Course',
      'Chapter',
      'Topic',
      'Review'
    ])
    expect(screen.getAllByRole('treeitem').map((item) => item.tabIndex)).toEqual([-1, 0, -1, -1])
    expect(screen.getByRole('treeitem', { name: 'Review' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('selects a topic from the outline and toggles its collapsed state', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onToggleCollapse = vi.fn()

    render(
      <MindMapOutline
        sheet={makeSheet()}
        selectedNodeId={null}
        onSelect={onSelect}
        onToggleCollapse={onToggleCollapse}
      />
    )

    await user.click(screen.getByRole('treeitem', { name: 'Chapter' }))
    expect(onSelect).toHaveBeenCalledWith('chapter')

    const collapseRootButton = screen.getAllByRole('button')[0]!
    await user.click(collapseRootButton)
    expect(onSelect).toHaveBeenLastCalledWith('root')
    expect(onToggleCollapse).toHaveBeenCalledWith('root')
  })

  it('uses tree keyboard semantics without leaking handled keys to the global editor shortcuts', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onToggleCollapse = vi.fn()

    render(
      <MindMapOutline
        sheet={makeSheet()}
        selectedNodeId="review"
        onSelect={onSelect}
        onToggleCollapse={onToggleCollapse}
      />
    )

    const review = screen.getByRole('treeitem', { name: 'Review' })
    review.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('review')

    await user.keyboard('{ArrowRight}')
    expect(onToggleCollapse).toHaveBeenCalledWith('review')
  })
})
