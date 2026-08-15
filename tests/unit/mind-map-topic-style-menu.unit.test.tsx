import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapTopicColorPicker, MindMapTopicStyleMenu } from '../../src/renderer/src/views/mindmap/MindMapTopicStyleMenu'

describe('MindMapTopicStyleMenu', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('keeps color options out of the inspector until the compact swatch is requested', () => {
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
    expect(within(dialog).getByRole('button', { name: 'Preset color #123456' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: 'Preset color #4A90D9' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('applies a custom color from the native well and keeps the panel open', () => {
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
    // Picking a color keeps the panel open so the learner can keep refining.
    expect(screen.getByRole('dialog', { name: 'Text Color' })).toBeInTheDocument()
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

  it('writes an option and returns focus', async () => {
    const onChange = vi.fn()
    render(
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
  })

  it('renders an alpha slider that rewrites the concrete color to 8-digit hex', () => {
    const onChange = vi.fn()
    render(
      <MindMapTopicColorPicker
        id="fill-color"
        label="Fill Color"
        value={{ state: 'concrete', value: '#123456' }}
        presets={['#123456']}
        fallback="#FFFFFF"
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fill Color #123456' }))
    const dialog = screen.getByRole('dialog', { name: 'Fill Color' })
    const slider = within(dialog).getByRole('slider', { name: 'Background opacity' })
    expect(slider).toHaveValue('100')

    fireEvent.change(slider, { target: { value: '50' } })
    expect(onChange).toHaveBeenLastCalledWith('#12345680')

    fireEvent.change(slider, { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith('#12345600')
  })

  it('strips alpha from the native color well value', () => {
    const onChange = vi.fn()
    render(
      <MindMapTopicColorPicker
        id="fill-color"
        label="Fill Color"
        value={{ state: 'concrete', value: '#12345680' }}
        presets={['#12345680']}
        fallback="#FFFFFF"
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fill Color #12345680' }))
    const dialog = screen.getByRole('dialog', { name: 'Fill Color' })
    expect(within(dialog).getByLabelText('Custom Color')).toHaveValue('#123456')
  })

  it('bases the alpha slider on the effective display color for mixed/inherit values', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MindMapTopicColorPicker
        id="fill-color"
        label="Fill Color"
        value={{ state: 'inherited' }}
        displayValue={{ state: 'concrete', value: '#12345680' }}
        presets={[]}
        fallback="#FFFFFF"
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fill Color #12345680' }))
    expect(within(screen.getByRole('dialog', { name: 'Fill Color' })).getByRole('slider', { name: 'Background opacity' }))
      .toHaveValue('50')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    rerender(
      <MindMapTopicColorPicker
        id="fill-color"
        label="Fill Color"
        value={{ state: 'mixed' }}
        displayValue={{ state: 'mixed' }}
        presets={[]}
        fallback="#FFFFFF"
        onChange={onChange}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Fill Color Mixed' })
    fireEvent.click(trigger)
    const slider = within(screen.getByRole('dialog', { name: 'Fill Color' })).getByRole('slider', { name: 'Background opacity' })
    expect(slider).toHaveValue('100')
    fireEvent.change(slider, { target: { value: '50' } })
    expect(onChange).toHaveBeenLastCalledWith('#FFFFFF80')
  })

  it('records a recently used color and reapplies it from the recent row', () => {
    const onChange = vi.fn()
    const { unmount } = render(
      <MindMapTopicColorPicker
        id="fill-color"
        label="Fill Color"
        value={{ state: 'inherited' }}
        displayValue={{ state: 'concrete', value: '#4A90D9' }}
        presets={['#4A90D9', '#123456']}
        fallback="#4A90D9"
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fill Color #4A90D9' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Fill Color' })).getByRole('button', { name: 'Preset color #123456' }))
    expect(onChange).toHaveBeenCalledWith('#123456')
    unmount()

    // Recent colors are persisted in localStorage and restored on remount.
    onChange.mockClear()
    render(
      <MindMapTopicColorPicker
        id="fill-color"
        label="Fill Color"
        value={{ state: 'concrete', value: '#654321' }}
        presets={['#4A90D9']}
        fallback="#4A90D9"
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fill Color #654321' }))
    const dialog = screen.getByRole('dialog', { name: 'Fill Color' })
    const chip = within(dialog).getByRole('button', { name: 'Recent color #123456' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)
    expect(onChange).toHaveBeenCalledWith('#123456')
  })

  it('does not add recent colors while dragging opacity, but records one on release', () => {
    const onChange = vi.fn()
    render(
      <MindMapTopicColorPicker
        id="fill-color"
        label="Fill Color"
        value={{ state: 'concrete', value: '#123456' }}
        presets={['#123456']}
        fallback="#FFFFFF"
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fill Color #123456' }))
    const dialog = screen.getByRole('dialog', { name: 'Fill Color' })
    const slider = within(dialog).getByRole('slider', { name: 'Background opacity' })

    // Dragging through several alpha values previews live but must not spam
    // the recent list with one entry per tick.
    ;[50, 30, 70, 20].forEach((value) => {
      fireEvent.change(slider, { target: { value: String(value) } })
    })
    expect(within(dialog).queryByRole('group', { name: 'Recent colors' })).not.toBeInTheDocument()

    // Releasing commits a single recent swatch.
    fireEvent.pointerUp(slider)
    const group = within(dialog).getByRole('group', { name: 'Recent colors' })
    expect(within(group).getAllByRole('button')).toHaveLength(1)
  })

  it('caps recent colors at 8 most-recent-first, dedupes, and clears', () => {
    const onChange = vi.fn()
    const presets = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999']
    render(
      <MindMapTopicColorPicker
        id="fill-color"
        label="Fill Color"
        value={{ state: 'concrete', value: '#123456' }}
        presets={presets}
        fallback="#FFFFFF"
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fill Color #123456' }))
    const dialog = screen.getByRole('dialog', { name: 'Fill Color' })
    // 9 preset picks -> capped to 8, most-recent-first.
    presets.forEach((color) => {
      fireEvent.click(within(dialog).getByRole('button', { name: `Preset color ${color}` }))
    })
    const group = within(dialog).getByRole('group', { name: 'Recent colors' })
    const chips = within(group).getAllByRole('button')
    expect(chips).toHaveLength(8)
    expect(chips[0]).toHaveAttribute('aria-label', 'Recent color #999999')
    expect(chips[7]).toHaveAttribute('aria-label', 'Recent color #222222')

    // Re-applying the most-recent preset is deduped (still 8 unique).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preset color #999999' }))
    expect(within(group).getAllByRole('button')).toHaveLength(8)
    expect(within(group).getAllByRole('button').filter(
      (chip) => chip.getAttribute('aria-label') === 'Recent color #999999'
    )).toHaveLength(1)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear recent colors' }))
    expect(within(dialog).queryByRole('group', { name: 'Recent colors' })).not.toBeInTheDocument()
  })

  it('announces inherited field state and selected option without relying on colour', () => {
    render(
      <MindMapTopicStyleMenu
        id="border-style"
        label="Border Style"
        value={{ state: 'inherited' }}
        displayValue={{ state: 'concrete', value: 'solid' }}
        options={[{ value: 'solid', label: 'Solid' }, { value: 'dash', label: 'Dashed' }]}
        onChange={vi.fn()}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Border Style Solid' })
    expect(trigger).toHaveAccessibleDescription('Inherited from theme')

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Border Style' })
    const selected = within(dialog).getByRole('option', { name: 'Solid' })
    expect(selected).toHaveAttribute('aria-selected', 'true')
    expect(selected).toHaveAccessibleDescription('Selected')
  })

  it('announces the explicit none state on the trigger', () => {
    render(
      <MindMapTopicStyleMenu
        id="fill-pattern"
        label="Fill Pattern"
        value={{ state: 'none' }}
        displayValue={{ state: 'none' }}
        options={[{ value: 'solid', label: 'Solid' }]}
        onChange={vi.fn()}
      />
    )
    const trigger = screen.getByRole('button', { name: 'Fill Pattern None' })
    expect(trigger).toHaveAccessibleDescription('Explicit none')
  })
})
