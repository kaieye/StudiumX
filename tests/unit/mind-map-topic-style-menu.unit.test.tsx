import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapTopicColorPicker, MindMapTopicStyleMenu } from '../../src/renderer/src/views/mindmap/MindMapTopicStyleMenu'

describe('MindMapTopicStyleMenu', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('keeps color options out of the inspector until the compact trigger is requested', () => {
    render(
      <MindMapTopicColorPicker
        id="fill-color"
        label="Fill Color"
        value={{ state: 'concrete', value: '#123456' }}
        presets={['#123456', '#4A90D9']}
        fallback="#4A90D9"
        onChange={vi.fn()}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Fill Color #123456' })
    expect(screen.queryByRole('dialog', { name: 'Fill Color' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Fill Color' })
    expect(within(dialog).getByRole('listbox', { name: 'Fill Color' })).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: '#123456' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('option', { name: '#4A90D9' })).toHaveAttribute('aria-selected', 'false')
  })

  it('keeps custom color selection in the menu and closes after it is applied', () => {
    const onChange = vi.fn()
    render(
      <MindMapTopicColorPicker
        id="text-color"
        label="Text Color"
        value={{ state: 'inherited' }}
        displayValue={{ state: 'concrete', value: '#333333' }}
        presets={['#333333']}
        fallback="#333333"
        onChange={onChange}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Text Color #333333' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Text Color' })
    fireEvent.change(within(dialog).getByLabelText('Custom Color'), { target: { value: '#123456' } })

    expect(onChange).toHaveBeenCalledWith('#123456')
    expect(screen.queryByRole('dialog', { name: 'Text Color' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('supports focus entry, wrapped arrow navigation, Escape, and outside dismissal', async () => {
    render(
      <MindMapTopicStyleMenu
        id="fill-pattern"
        label="Fill Pattern"
        value={{ state: 'inherited' }}
        displayValue={{ state: 'concrete', value: 'solid' }}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'diagonal', label: 'Diagonal' }
        ]}
        onChange={vi.fn()}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Fill Pattern Solid' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Fill Pattern' })
    const solid = within(dialog).getByRole('option', { name: 'Solid' })
    const diagonal = within(dialog).getByRole('option', { name: 'Diagonal' })

    await waitFor(() => expect(solid).toHaveFocus())
    fireEvent.keyDown(solid, { key: 'ArrowUp' })
    expect(diagonal).toHaveFocus()
    fireEvent.keyDown(diagonal, { key: 'ArrowUp' })
    expect(solid).toHaveFocus()
    fireEvent.keyDown(solid, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Fill Pattern' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Fill Pattern' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens above its trigger when the inspector scroll surface has more room above', async () => {
    render(
      <div className="mindmap-inspector-tab-content">
        <div style={{ height: 400 }} />
        <MindMapTopicStyleMenu
          id="text-color"
          label="Text Color"
          value={{ state: 'inherited' }}
          displayValue={{ state: 'concrete', value: 'black' }}
          options={[{ value: 'black', label: 'Black' }]}
          onChange={vi.fn()}
        />
      </div>
    )

    const scrollSurface = document.querySelector<HTMLElement>('.mindmap-inspector-tab-content')!
    const menu = document.querySelector<HTMLElement>('.mindmap-topic-style-menu')!
    const popoverHeight = 140
    Object.defineProperty(scrollSurface, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 300 })
    })
    Object.defineProperty(menu, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 220, bottom: 250 })
    })
    const originalQuerySelector = menu.querySelector.bind(menu)
    vi.spyOn(menu, 'querySelector').mockImplementation((selector) => {
      const result = originalQuerySelector(selector)
      if (selector === '.mindmap-topic-style-menu__popover' && result instanceof HTMLElement) {
        Object.defineProperty(result, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({ height: popoverHeight })
        })
      }
      return result
    })

    fireEvent.click(screen.getByRole('button', { name: 'Text Color Black' }))
    const dialog = screen.getByRole('dialog', { name: 'Text Color' })
    expect(dialog).toHaveClass('is-above')
    expect(dialog).toHaveStyle({ maxHeight: '215px' })
  })

  it('writes an option, returns focus, and clears an explicit field', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MindMapTopicStyleMenu
        id="border-width"
        label="Border Width"
        value={{ state: 'inherited' }}
        displayValue={{ state: 'concrete', value: 1 }}
        options={[
          { value: 1, label: '1' },
          { value: 3, label: '3' }
        ]}
        onChange={onChange}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Border Width 1' })
    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Border Width' })).getByRole('option', { name: '3' }))
    expect(onChange).toHaveBeenCalledWith(3)
    await waitFor(() => expect(trigger).toHaveFocus())

    rerender(
      <MindMapTopicStyleMenu
        id="border-width"
        label="Border Width"
        value={{ state: 'concrete', value: 3 }}
        options={[
          { value: 1, label: '1' },
          { value: 3, label: '3' }
        ]}
        onChange={onChange}
      />
    )
    const selectedTrigger = screen.getByRole('button', { name: 'Border Width 3' })
    fireEvent.click(selectedTrigger)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Border Width' })).getByRole('button', { name: 'Clear field override' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})
