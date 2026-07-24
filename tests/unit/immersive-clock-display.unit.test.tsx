import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClockDisplay } from '../../src/renderer/src/views/workbench/immersive-clock-display'

function atTime(h: number, m: number, s: number): Date {
  return new Date(2026, 6, 24, h, m, s)
}

function digitOf(digitIndex: number): HTMLElement {
  return document.querySelectorAll('.workbench-clock__digit')[digitIndex]! as HTMLElement
}

function flapOf(digitIndex: number): HTMLElement {
  return digitOf(digitIndex).querySelector('.workbench-clock__flap')! as HTMLElement
}

function staticCurr(digitIndex: number): HTMLElement {
  return digitOf(digitIndex).querySelector(
    ':scope > .workbench-clock__face--curr'
  )! as HTMLElement
}

describe('ClockDisplay flip animation (WAAPI rotateX plate)', () => {
  const animations: Array<{ cancel: ReturnType<typeof vi.fn> }> = []

  beforeEach(() => {
    animations.length = 0
    HTMLElement.prototype.animate = vi.fn(function animate(
      this: HTMLElement,
      _keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions
    ) {
      const duration =
        typeof options === 'number' ? options : Number(options?.duration ?? 0)
      const delay = typeof options === 'number' ? 0 : Number(options?.delay ?? 0)
      const anim = {
        cancel: vi.fn(),
        commitStyles: vi.fn(),
        finished: new Promise<void>((resolve) => {
          window.setTimeout(resolve, duration + delay)
        })
      }
      animations.push(anim)
      return anim as unknown as Animation
    }) as typeof HTMLElement.prototype.animate
  })

  afterEach(() => {
    // @ts-expect-error cleanup stub
    delete HTMLElement.prototype.animate
  })

  it('rotates a single flap plate and settles curr digit', async () => {
    const { rerender } = render(
      <ClockDisplay time={atTime(12, 0, 0)} previousTime={null} />
    )

    expect(staticCurr(5).dataset.t).toBe('0')
    expect(flapOf(5).className).not.toMatch(/is-flipping/)

    rerender(<ClockDisplay time={atTime(12, 0, 1)} previousTime={atTime(12, 0, 0)} />)

    await waitFor(
      () => {
        expect(digitOf(5).className).toMatch(/is-flipping/)
        expect(flapOf(5).className).toMatch(/is-flipping/)
        expect(animations.length).toBeGreaterThanOrEqual(1)
      },
      { timeout: 200 }
    )

    // During flip, settled static bottom still shows the old digit.
    expect(staticCurr(5).dataset.t).toBe('0')

    await waitFor(
      () => {
        expect(digitOf(5).className).not.toMatch(/is-flipping/)
        expect(staticCurr(5).dataset.t).toBe('1')
      },
      { timeout: 1000 }
    )
  }, 10_000)
})
