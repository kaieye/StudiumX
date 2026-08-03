import { fireEvent, render, screen } from '@testing-library/react'
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
})
