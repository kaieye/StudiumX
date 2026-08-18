import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapShapeTool } from '../../src/renderer/src/views/mindmap/MindMapShapeTool'

describe('MindMapShapeTool', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms a rectangle with a normal click', () => {
    const onShapeChange = vi.fn()
    render(<MindMapShapeTool onShapeChange={onShapeChange} />)

    const trigger = screen.getByRole('button', { name: 'Shape' })
    fireEvent.click(trigger)

    expect(onShapeChange).toHaveBeenCalledWith('rect')
    expect(trigger).toHaveAccessibleName('Shape: Rectangle')
    expect(trigger).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('menu', { name: 'Choose shape' })).not.toBeInTheDocument()
  })

  it('opens its full palette after a long press without also arming the default rectangle', () => {
    vi.useFakeTimers()
    const onShapeChange = vi.fn()
    render(<MindMapShapeTool onShapeChange={onShapeChange} />)

    const trigger = screen.getByRole('button', { name: 'Shape' })
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 })
    act(() => {
      vi.advanceTimersByTime(450)
    })

    const menu = screen.getByRole('menu', { name: 'Choose shape' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Rectangle' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Rounded Rect' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Ellipse' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Diamond' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Parallelogram' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Hexagon' })).toBeInTheDocument()

    fireEvent.pointerUp(trigger, { button: 0, pointerId: 1 })
    fireEvent.click(trigger)
    expect(onShapeChange).not.toHaveBeenCalled()

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Diamond' }))
    expect(onShapeChange).toHaveBeenCalledWith('diamond')
    expect(screen.queryByRole('menu', { name: 'Choose shape' })).not.toBeInTheDocument()
    expect(trigger).toHaveAccessibleName('Shape: Diamond')
  })

  it('provides a keyboard alternative to the long-press menu and marks the selected item', () => {
    render(<MindMapShapeTool activeShape="ellipse" onShapeChange={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'Shape: Ellipse' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const menu = screen.getByRole('menu', { name: 'Choose shape' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Ellipse' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Choose shape' })).not.toBeInTheDocument()
  })
})
