import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapTopicShapePicker } from '../../src/renderer/src/views/mindmap/MindMapTopicShapePicker'

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
      target: { value: 'heart' }
    })
    expect(within(dialog).getByRole('option', { name: 'Heart' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('option', { name: 'Cloud' })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('option', { name: 'Heart' }))
    expect(onChange).toHaveBeenCalledWith('heart')
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
})
