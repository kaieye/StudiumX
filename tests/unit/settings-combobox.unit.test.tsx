import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsComboBox } from '../../src/renderer/src/views/settings/SettingsPrimitives'

describe('SettingsComboBox', () => {
  it('shows every model when the dropdown opens, even when the value matches one of them', () => {
    const onInput = vi.fn()
    const onSelect = vi.fn()
    render(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={onInput}
        onSelect={onSelect}
      />
    )

    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: 'glm-5.1' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'glm-5.2' })).toBeTruthy()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('filters the options as the user types', () => {
    const onInput = vi.fn()
    render(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={onInput}
        onSelect={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'glm-5.2' } })

    expect(onInput).toHaveBeenCalledWith('glm-5.2')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'glm-5.2' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'glm-5.1' })).toBeNull()
  })

  it('commits the chosen model through onSelect and closes the dropdown', () => {
    const onSelect = vi.fn()
    render(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={vi.fn()}
        onSelect={onSelect}
      />
    )

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'glm-5.2' }))

    expect(onSelect).toHaveBeenCalledWith('glm-5.2')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('commits typed text through onInput even before the dropdown is opened', () => {
    const onInput = vi.fn()
    render(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={onInput}
        onSelect={vi.fn()}
      />
    )

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'my-model' } })

    expect(onInput).toHaveBeenCalledWith('my-model')
  })

  it('closes the dropdown on Enter for a free-form model that does not match any option', () => {
    const onSelect = vi.fn()
    render(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={vi.fn()}
        onSelect={onSelect}
      />
    )

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'my-model' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('keeps free-form typed text in the input instead of reverting to the committed value', () => {
    render(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'my-model' } })

    expect(screen.getByRole('combobox')).toHaveValue('my-model')
  })

  it('does not overwrite typed text with a stale committed value while focused', () => {
    const { rerender } = render(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'my-model' } })
    rerender(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox')).toHaveValue('my-model')
  })

  it('does not revert a typed custom model after a stale settings response and blur', async () => {
    const { rerender } = render(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    const input = screen.getByRole('combobox')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'my-model' } })
    // Simulates an earlier IPC settings update completing after the latest edit.
    rerender(
      <SettingsComboBox
        value="glm-5.1"
        options={['glm-5.1', 'glm-5.2']}
        onInput={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    fireEvent.blur(input)

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('my-model'))
  })
})
