/** Flip-clock display — true rotateX flap (2.html), driven by Web Animations API. */

import { useEffect, useLayoutEffect, useRef } from 'react'

/** Full flip duration (matches 2.html 500ms). */
const FLIP_MS = 560

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function setDataT(el: HTMLElement | null, value: string): void {
  if (el) el.dataset.t = value
}

function cancelAnimations(anims: Animation[]): void {
  for (const anim of anims) {
    try {
      // Prefer not to commitStyles: under perspective it can bake a matrix with a
      // tiny translateX, which reads as a lateral hop when we then set rotateX(0).
      anim.cancel()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Single digit column — DOM matches 2.html createCol:
 *   flap
 *     face--next  (back of plate = next lower half, pre-rotated -180)
 *     face--curr  (front of plate = curr upper half)
 *   face--next    (static top = next upper half)
 *   face--curr    (static bottom = curr lower half)
 *
 * Flip: one plate rotates rotateX(0 → -180). Front folds down; back becomes
 * the new lower half. Not two independent height animations.
 */
function FlipDigit({ value }: { value: string }) {
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const flapRef = useRef<HTMLSpanElement | null>(null)
  const flipNextRef = useRef<HTMLSpanElement | null>(null)
  const flipCurrRef = useRef<HTMLSpanElement | null>(null)
  const staticNextRef = useRef<HTMLSpanElement | null>(null)
  const staticCurrRef = useRef<HTMLSpanElement | null>(null)

  const currRef = useRef(value)
  const flippingRef = useRef(false)
  const pendingRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const animsRef = useRef<Animation[]>([])

  useLayoutEffect(() => {
    const v = currRef.current
    setDataT(flipNextRef.current, v)
    setDataT(flipCurrRef.current, v)
    setDataT(staticNextRef.current, v)
    setDataT(staticCurrRef.current, v)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
      cancelAnimations(animsRef.current)
      animsRef.current = []
    }
  }, [])

  useEffect(() => {
    if (value === currRef.current) return
    if (flippingRef.current) {
      pendingRef.current = value
      return
    }

    const paintCurr = (digit: string): void => {
      setDataT(flipCurrRef.current, digit)
      setDataT(staticCurrRef.current, digit)
    }
    const paintNext = (digit: string): void => {
      setDataT(flipNextRef.current, digit)
      setDataT(staticNextRef.current, digit)
    }

    const restFlap = (): void => {
      const flap = flapRef.current
      if (!flap) return
      // Keep a pure on-axis rotate so perspective never injects X translation.
      flap.style.transform = 'translate3d(0, 0, 0) rotateX(0deg)'
    }

    const settle = (to: string): void => {
      const flap = flapRef.current

      // Digits first while the plate is still at end-of-flip (or mid-cancel).
      // Matching glyphs on static + flap faces make the silent reset invisible.
      paintCurr(to)
      paintNext(to)

      cancelAnimations(animsRef.current)
      animsRef.current = []
      restFlap()

      currRef.current = to
      flippingRef.current = false
      rootRef.current?.classList.remove('is-flipping')
      flap?.classList.remove('is-flipping')

      const pending = pendingRef.current
      pendingRef.current = null
      if (pending != null && pending !== currRef.current) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (pending !== currRef.current) run(pending)
          })
        })
      }
    }

    const run = (to: string): void => {
      flippingRef.current = true
      // 2.html: setNext then flip
      paintNext(to)

      const flap = flapRef.current
      if (!flap || typeof flap.animate !== 'function') {
        settle(to)
        return
      }

      cancelAnimations(animsRef.current)
      animsRef.current = []

      flap.style.transform = 'translate3d(0, 0, 0) rotateX(0deg)'
      rootRef.current?.classList.add('is-flipping')
      flap.classList.add('is-flipping')

      // Flush so WAAPI always interpolates from rest.
      void flap.offsetWidth

      const anim = flap.animate(
        [
          { transform: 'translate3d(0, 0, 0) rotateX(0deg)' },
          { transform: 'translate3d(0, 0, 0) rotateX(-180deg)' }
        ],
        {
          duration: FLIP_MS,
          easing: 'cubic-bezier(0.45, 0.05, 0.55, 0.95)',
          fill: 'forwards'
        }
      )
      animsRef.current = [anim]

      if (timerRef.current != null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        settle(to)
      }, FLIP_MS)
    }

    run(value)
  }, [value])

  return (
    <span ref={rootRef} className="workbench-clock__digit">
      <span ref={flapRef} className="workbench-clock__flap">
        <span
          ref={flipNextRef}
          className="workbench-clock__face workbench-clock__face--next"
        />
        <span
          ref={flipCurrRef}
          className="workbench-clock__face workbench-clock__face--curr"
        />
      </span>
      <span
        ref={staticNextRef}
        className="workbench-clock__face workbench-clock__face--next"
      />
      <span
        ref={staticCurrRef}
        className="workbench-clock__face workbench-clock__face--curr"
      />
    </span>
  )
}

/**
 * Six-digit HHmmss flip clock.
 * `previousTime` kept for call-site compatibility.
 */
export function ClockDisplay({
  time,
  previousTime: _previousTime
}: {
  time: Date
  previousTime: Date | null
}) {
  const hours = pad2(time.getHours())
  const minutes = pad2(time.getMinutes())
  const seconds = pad2(time.getSeconds())
  const digits = [...hours, ...minutes, ...seconds]

  return (
    <time
      className="workbench-clock__display"
      dateTime={time.toISOString()}
      aria-label={`当前时间 ${hours}:${minutes}:${seconds}`}
    >
      {digits.map((digit, index) => (
        <FlipDigit key={index} value={digit} />
      ))}
    </time>
  )
}
