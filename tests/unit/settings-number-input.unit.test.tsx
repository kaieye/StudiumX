import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NumberInput } from '../../src/renderer/src/views/settings/SettingsPrimitives'

describe('NumberInput', () => {
  it('does not persist the minimum value when the user temporarily clears the field', () => {
    const onChange = vi.fn()
    render(<NumberInput value={8} min={1} max={12} step={1} onChange={onChange} />)

    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '' } })

    expect(input).toHaveValue(null)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(input)
    expect(input).toHaveValue(8)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('persists a valid edited value', () => {
    const onChange = vi.fn()
    render(<NumberInput value={8} min={1} max={12} step={1} onChange={onChange} />)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '10' } })

    expect(onChange).toHaveBeenCalledWith(10)
  })
})
