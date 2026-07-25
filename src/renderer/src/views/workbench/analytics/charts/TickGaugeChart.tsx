import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type TickGaugeChartProps = {
  /** Fraction in [0, 1]. Null/undefined renders empty. */
  progress: number | null | undefined
  title: string
  /** Optional center secondary line under the big percent. */
  centerLabel?: string
  /** Optional bottom caption under the dial. */
  remainingLabel?: string
  /** Optional footer legend under the whole gauge. */
  footerLabel?: string
  emptyLabel: string
}

const VIEW_W = 400
const VIEW_H = 320
const CX = 200
const CY = 186
const R0 = 132
const A0 = -195
const SWEEP = 210
const MILESTONES = [25, 50, 75, 100] as const

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}

/** Deterministic 0–1 noise (lieflat rnd spirit) so tick lengths stay stable. */
function rnd(i: number, k: number): number {
  return Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r]
}

/**
 * Lieflat Basics F11 "How far to the quarter's goal" tick gauge:
 * 100 ballot ticks on a 210° dial, inked = earned, tip bead + center %.
 */
export function TickGaugeChart({
  progress,
  title,
  centerLabel,
  remainingLabel,
  footerLabel,
  emptyLabel
}: TickGaugeChartProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const reduced = prefersReducedMotion()
  /** SVG box that tracks the hub card so the dial scales with the window. */
  const [boxPx, setBoxPx] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    const measure = () => {
      const styles = getComputedStyle(node)
      const padX = (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0)
      const padY = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
      const availableW = Math.max(0, node.clientWidth - padX)
      const availableH = Math.max(0, node.clientHeight - padY)
      // Fit the 400×320 viewBox into the available box.
      // If height is still content-driven (~0), size by width alone so the dial can grow.
      const scaleW = availableW / VIEW_W
      const scaleH = availableH > 48 ? availableH / VIEW_H : scaleW
      const scale = Math.max(0, Math.min(scaleW, scaleH))
      const width = Math.max(0, Math.floor(VIEW_W * scale))
      const height = Math.max(0, Math.floor(VIEW_H * scale))
      setBoxPx((current) => (current.width === width && current.height === height ? current : { width, height }))
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const safe = useMemo(() => {
    if (progress === null || progress === undefined || !Number.isFinite(progress)) return null
    return Math.max(0, Math.min(1, progress))
  }, [progress])

  const ticks = useMemo(() => {
    if (safe === null) return []
    const goal = Math.round(safe * 100)
    return Array.from({ length: 100 }, (_, k) => {
      const angle = A0 + (k / 100) * SWEEP
      const inked = k < goal
      const len = inked ? 17 + rnd(k + 1, 3) * 8 : 7 + rnd(k + 1, 7) * 3.2
      const [x1, y1] = polar(CX, CY, R0, angle)
      const [x2, y2] = polar(CX, CY, R0 + len, angle)
      return { k, inked, x1, y1, x2, y2 }
    })
  }, [safe])

  if (safe === null) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  const goal = Math.round(safe * 100)
  const tipAngle = A0 + (goal / 100) * SWEEP
  const [tipX, tipY] = polar(CX, CY, R0 + 28, tipAngle)

  return (
    <div className="tick-gauge" ref={rootRef} role="img" aria-labelledby={titleId}>
      <span id={titleId} className="tick-gauge__a11y-title">
        {title}
      </span>
      <svg
        className="tick-gauge__svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        aria-hidden="true"
        style={boxPx.width > 0 ? { width: boxPx.width, height: boxPx.height } : undefined}
      >
        <g className="tick-gauge__ticks">
          {ticks.map((tick) => (
            <line
              key={tick.k}
              className={tick.inked ? 'tick-gauge__tick tick-gauge__tick--inked' : 'tick-gauge__tick'}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              style={
                reduced
                  ? undefined
                  : { animationDelay: `${tick.k * 0.012}s` }
              }
            />
          ))}
        </g>

        {MILESTONES.map((mark) => {
          const angle = A0 + (mark / 100) * SWEEP
          const [dx, dy] = polar(CX, CY, R0 - 8, angle)
          const [tx, ty] = polar(CX, CY, R0 - 22, angle)
          return (
            <g key={mark} className="tick-gauge__milestone">
              <circle cx={dx} cy={dy} r={1} />
              <text x={tx} y={ty + 3} textAnchor="middle">
                {mark}
              </text>
            </g>
          )
        })}

        <circle className="tick-gauge__tip" cx={tipX} cy={tipY} r={2.4} />

        <text className="tick-gauge__value" x={CX} y={CY + (centerLabel || remainingLabel || footerLabel ? -4 : 8)} textAnchor="middle">
          {`${goal}%`}
        </text>
        {centerLabel ? (
          <text className="tick-gauge__center-label" x={CX} y={CY + 16} textAnchor="middle">
            {centerLabel}
          </text>
        ) : null}
        {remainingLabel ? (
          <text className="tick-gauge__remaining" x={CX} y={CY + 34} textAnchor="middle">
            {remainingLabel}
          </text>
        ) : null}
        {footerLabel ? (
          <text className="tick-gauge__footer" x={200} y={300} textAnchor="middle">
            {footerLabel}
          </text>
        ) : null}
      </svg>
    </div>
  )
}
