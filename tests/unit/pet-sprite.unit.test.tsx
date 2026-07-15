import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderUi } from '../helpers/render'
import { PetSprite } from '../../src/renderer/src/views/pet/PetSprite'

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true)
  }
}

describe('PetSprite', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('advances sprite frames when motion is allowed', () => {
    vi.useFakeTimers()
    vi.mocked(window.matchMedia).mockReturnValue(mediaQuery(false))
    const { container } = renderUi(
      <PetSprite appearance="boba" label="Boba" size={112} state="running-right" />
    )
    const sprite = container.querySelector<HTMLElement>('.pet-sprite')!

    expect(sprite.dataset.frame).toBe('0')
    act(() => vi.advanceTimersByTime(121))
    expect(sprite.dataset.frame).toBe('1')
  })

  it('keeps the first frame when reduced motion is requested', () => {
    vi.useFakeTimers()
    vi.mocked(window.matchMedia).mockReturnValue(mediaQuery(true))
    const { container } = renderUi(
      <PetSprite appearance="boba" label="Boba" size={112} state="running-right" />
    )
    const sprite = container.querySelector<HTMLElement>('.pet-sprite')!

    act(() => vi.advanceTimersByTime(5_000))
    expect(sprite.dataset.frame).toBe('0')
  })
})
