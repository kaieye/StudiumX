import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import {
  MIND_MAP_TOPIC_SHAPE_OPTIONS,
  MindMapTopicShapePicker
} from '../../src/renderer/src/views/mindmap/MindMapTopicShapePicker'
import { NodeShapeIcon } from '../../src/renderer/src/views/mindmap/mind-map-shape-icons'

describe('MindMapTopicShapePicker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('keeps the catalogue collapsed, groups it when opened, and selects a filtered shape', () => {
    const onChange = vi.fn()
    render(
      <MindMapTopicShapePicker
        value={{ state: 'inherited' }}
        displayValue={{ state: 'concrete', value: 'rounded-rect' }}
        onChange={onChange}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Shape Rounded Rect' })
    expect(screen.queryByRole('dialog', { name: 'Choose shape' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Choose shape' })
    expect(within(dialog).getByText('Basic')).toBeInTheDocument()
    expect(within(dialog).getByText('Annotation')).toBeInTheDocument()
    expect(within(dialog).getByText('Flowchart')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search shapes' }), {
      target: { value: 'diamond' }
    })
    expect(within(dialog).getByRole('option', { name: 'Diamond' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('option', { name: 'Rounded Rect' })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('option', { name: 'Diamond' }))
    expect(onChange).toHaveBeenCalledWith('diamond')
    expect(screen.queryByRole('dialog', { name: 'Choose shape' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('has keyboard dismissal and reports an empty search without emitting a mutation', () => {
    const onChange = vi.fn()
    render(<MindMapTopicShapePicker value={{ state: 'mixed' }} onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Shape Mixed' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Choose shape' })
    const search = within(dialog).getByRole('searchbox', { name: 'Search shapes' })
    fireEvent.change(search, { target: { value: 'not-a-shape' } })

    expect(within(dialog).getByRole('status')).toHaveTextContent('No shapes found.')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Choose shape' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('announces inherited/none state and selected option without relying on colour', () => {
    const onChange = vi.fn()
    render(
      <MindMapTopicShapePicker
        value={{ state: 'inherited' }}
        displayValue={{ state: 'concrete', value: 'rounded-rect' }}
        onChange={onChange}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Shape Rounded Rect' })
    expect(trigger).toHaveAccessibleDescription('Inherited from theme')

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Choose shape' })
    const selected = within(dialog).getByRole('option', { name: 'Rounded Rect' })
    expect(selected).toHaveAttribute('aria-selected', 'true')
    expect(selected).toHaveAccessibleDescription('Selected')
  })

  it('announces the explicit none state on the trigger', () => {
    render(
      <MindMapTopicShapePicker
        value={{ state: 'none' }}
        displayValue={{ state: 'concrete', value: 'none' }}
        onChange={vi.fn()}
      />
    )
    const trigger = screen.getByRole('button', { name: 'Shape None' })
    expect(trigger).toHaveAccessibleDescription('Explicit none')
  })

  it('does not offer the legacy quotation-mark shape', () => {
    expect(MIND_MAP_TOPIC_SHAPE_OPTIONS.map((option) => option.value)).not.toContain('quote')

    render(<MindMapTopicShapePicker value={{ state: 'mixed' }} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shape Mixed' }))

    expect(screen.queryByRole('option', { name: 'Quote' })).not.toBeInTheDocument()
  })

  it('draws the ellipse option as a true oval outline', () => {
    const { container } = render(<NodeShapeIcon shape="ellipse" />)
    const ellipse = container.querySelector('ellipse')

    expect(ellipse).toHaveAttribute('cx', '16')
    expect(ellipse).toHaveAttribute('cy', '16')
    expect(ellipse).toHaveAttribute('rx', '11.5')
    expect(ellipse).toHaveAttribute('ry', '7.5')
    expect(ellipse).toHaveAttribute('fill', 'none')
    expect(ellipse).toHaveAttribute('stroke', 'currentColor')
  })
})
