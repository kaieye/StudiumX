import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapLineTool } from '../../src/renderer/src/views/mindmap/MindMapLineTool'
import type { MindMapCanvasLineTool } from '../../src/renderer/src/views/mindmap/mind-map-line-tool'

describe('MindMapLineTool', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms the default straight arrow on a normal click', () => {
    const onToolChange = vi.fn()
    render(<MindMapLineTool onToolChange={onToolChange} />)

    const trigger = screen.getByRole('button', { name: 'Line' })
    expect(trigger).toHaveAttribute('aria-pressed', 'false')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)

    expect(onToolChange).toHaveBeenCalledWith({
      active: true,
      lineShape: 'straight',
      endArrow: 'triangle'
    })
    expect(trigger).toHaveAccessibleName('Line: Straight arrow')
    expect(trigger).toHaveAttribute('aria-pressed', 'true')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the line-style palette on a long press without arming a line', () => {
    vi.useFakeTimers()
    const onToolChange = vi.fn()
    render(<MindMapLineTool onToolChange={onToolChange} />)

    const trigger = screen.getByRole('button', { name: 'Line' })
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 })
    act(() => {
      vi.advanceTimersByTime(450)
    })

    const menu = screen.getByRole('menu', { name: 'Choose line' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: 'Curved arrow' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Straight arrow' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Curved line' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Straight line' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Angled arrow' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Zigzag arrow' })).toBeInTheDocument()

    fireEvent.pointerUp(trigger, { button: 0, pointerId: 1 })
    fireEvent.click(trigger)
    expect(onToolChange).not.toHaveBeenCalled()

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Straight line' }))
    expect(onToolChange).toHaveBeenCalledWith({
      active: true,
      lineShape: 'straight',
      endArrow: 'none'
    })
    expect(screen.queryByRole('menu', { name: 'Choose line' })).not.toBeInTheDocument()
    expect(trigger).toHaveAccessibleName('Line: Straight line')
    expect(trigger).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens with the keyboard and marks the selected controlled preset', () => {
    const onToolChange = vi.fn()
    const activeTool: MindMapCanvasLineTool = {
      active: true,
      lineShape: 'angled',
      endArrow: 'triangle'
    }
    render(<MindMapLineTool activeTool={activeTool} onToolChange={onToolChange} />)

    const trigger = screen.getByRole('button', { name: 'Line: Angled arrow' })
    expect(trigger).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: 'Choose line' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Angled arrow' }))
      .toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: 'Curved line' }))
      .toHaveAttribute('aria-checked', 'false')

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Curved line' }))
    expect(onToolChange).toHaveBeenCalledWith({
      active: true,
      lineShape: 'curved',
      endArrow: 'none'
    })
    expect(screen.queryByRole('menu', { name: 'Choose line' })).not.toBeInTheDocument()
    // The parent still owns the controlled value, so the trigger remains angled
    // until the parent re-renders with the callback result.
    expect(trigger).toHaveAccessibleName('Line: Angled arrow')
  })
})
