import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapShapeContextMenu } from '../../src/renderer/src/views/mindmap/MindMapShapeContextMenu'

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})

describe('MindMapShapeContextMenu', () => {
  it('offers a delete action that targets the right-clicked shape', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(
      <MindMapShapeContextMenu
        state={{ shapeId: 'shape-1', x: 10, y: 10 }}
        onClose={onClose}
        onDelete={onDelete}
      />
    )

    expect(screen.getByRole('menuitem', { name: 'Delete element' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete element' }))
    expect(onDelete).toHaveBeenCalledWith('shape-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing when no shape is targeted', () => {
    const { container } = render(
      <MindMapShapeContextMenu state={null} onClose={() => undefined} onDelete={() => undefined} />
    )
    expect(container.firstChild).toBeNull()
  })
})
