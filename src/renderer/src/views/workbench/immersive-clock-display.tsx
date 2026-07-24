/** Flip-clock display — structure and timing aligned 1:1 with D:\2.html. */

import { useCallback, useEffect, useRef, useState } from 'react'

const FLIP_DURATION_MS = 500

/**
 * Single digit column (createCol in 2.html):
 *   digit
 *     flap
 *       face-next  (flap back  = next lower half, pre-rotated -180)
 *       face       (flap front = current upper half)
 *     face-next    (static top = next upper half)
 *     face         (static bottom = current lower half)
 */
function FlipDigit({ value }: { value: string }) {
  const [curr, setCurr] = useState(value)
  const [next, setNext] = useState(value)
  const [flipping, setFlipping] = useState(false)
  const currRef = useRef(value)
  const flippingRef = useRef(false)
  const pendingRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const runFlip = useCallback((to: string) => {
    if (to === currRef.current) return
    if (flippingRef.current) {
      pendingRef.current = to
      return
    }

    flippingRef.current = true
    // Mirror flipCard(): setNext then toggleActive in the same turn so both
    // land on one paint (React 18 batches these setStates).
    setNext(to)
    setFlipping(true)

    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      // Remove is-flipping (transition: 0s → silent reset), then setCurr.
      setFlipping(false)
      currRef.current = to
      setCurr(to)
      flippingRef.current = false

      const pending = pendingRef.current
      pendingRef.current = null
      if (pending != null && pending !== to) {
        runFlip(pending)
      }
    }, FLIP_DURATION_MS)
  }, [clearTimer])

  useEffect(() => {
    if (value === currRef.current) return
    runFlip(value)
  }, [value, runFlip])

  useEffect(() => () => clearTimer(), [clearTimer])

  return (
    <span className="workbench-clock__digit">
      <span className={`workbench-clock__flap${flipping ? ' is-flipping' : ''}`}>
        <span className="workbench-clock__face workbench-clock__face--next" data-t={next} />
        <span className="workbench-clock__face workbench-clock__face--curr" data-t={curr} />
      </span>
      <span className="workbench-clock__face workbench-clock__face--next" data-t={next} />
      <span className="workbench-clock__face workbench-clock__face--curr" data-t={curr} />
    </span>
  )
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Six-digit HHmmss flip clock (same as 2.html).
 * `previousTime` kept for call-site compatibility; flip state is per-digit.
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
