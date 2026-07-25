import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { categoricalColor } from './palette'

export type MorphPieItem = {
  id: string
  label: string
  value: number
}

export type MorphPieChartProps = {
  items: readonly MorphPieItem[]
  title: string
  formatValue: (value: number) => string
  emptyLabel: string
  /** Max slices; morph gallery uses 12, ranking cards stay denser at 8. */
  maxItems?: number
}

/**
 * Classic mono donut from lieflat Glance G9 "One dataset, three views" pie frame:
 * - radius ['26%','72%'], center 50/50
 * - fill colors match RankBarChart / review analytics Morandi categorical palette
 * - paper border gaps + outer corner radius 6
 * - external labels + soft leader lines
 *
 * SVG port of glance-gallery morph VIEWS[2] pie option — no ECharts runtime.
 */
const VIEW = 320
const CX = VIEW / 2
const CY = VIEW / 2
// ECharts pie radius is a fraction of min(width,height)/2.
// radius:['26%','72%'] → inner/outer of the half-box.
const HALF = VIEW / 2
const R_INNER = HALF * 0.26
const R_OUTER = HALF * 0.72
const LABEL_R = R_OUTER + 18
const LEADER_R0 = R_OUTER + 4
const LEADER_R1 = R_OUTER + 12
const TAU = Math.PI * 2
const CORNER = 6

type SliceModel = {
  id: string
  label: string
  value: number
  share: number
  p0: number
  p1: number
  color: string
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}

function truncateLabel(label: string, maxChars = 12): string {
  const trimmed = label.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`
}

/**
 * Annular sector with rounded outer corners (itemStyle.borderRadius: 6).
 * Angles: 0 = east, clockwise on screen; slices start at -π/2 (12 o'clock).
 */
function annularSectorPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngle: number,
  endAngle: number,
  cornerRadius = CORNER
): string {
  const sweep = Math.max(0, endAngle - startAngle)
  if (sweep <= 1e-6 || rOuter <= rInner) return ''
  const largeFull = sweep > Math.PI ? 1 : 0

  if (sweep >= TAU - 1e-6) {
    const mid = startAngle + Math.PI
    const x0o = cx + Math.cos(startAngle) * rOuter
    const y0o = cy + Math.sin(startAngle) * rOuter
    const xMo = cx + Math.cos(mid) * rOuter
    const yMo = cy + Math.sin(mid) * rOuter
    const x0i = cx + Math.cos(startAngle) * rInner
    const y0i = cy + Math.sin(startAngle) * rInner
    const xMi = cx + Math.cos(mid) * rInner
    const yMi = cy + Math.sin(mid) * rInner
    return [
      `M ${x0o.toFixed(2)} ${y0o.toFixed(2)}`,
      `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 1 1 ${xMo.toFixed(2)} ${yMo.toFixed(2)}`,
      `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 1 1 ${x0o.toFixed(2)} ${y0o.toFixed(2)}`,
      `L ${x0i.toFixed(2)} ${y0i.toFixed(2)}`,
      `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 1 0 ${xMi.toFixed(2)} ${yMi.toFixed(2)}`,
      `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 1 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)}`,
      'Z'
    ].join(' ')
  }

  const sharp = (): string => {
    const x0o = cx + Math.cos(startAngle) * rOuter
    const y0o = cy + Math.sin(startAngle) * rOuter
    const x1o = cx + Math.cos(endAngle) * rOuter
    const y1o = cy + Math.sin(endAngle) * rOuter
    const x1i = cx + Math.cos(endAngle) * rInner
    const y1i = cy + Math.sin(endAngle) * rInner
    const x0i = cx + Math.cos(startAngle) * rInner
    const y0i = cy + Math.sin(startAngle) * rInner
    return [
      `M ${x0o.toFixed(2)} ${y0o.toFixed(2)}`,
      `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 ${largeFull} 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
      `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
      `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 ${largeFull} 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)}`,
      'Z'
    ].join(' ')
  }

  const radialSpan = rOuter - rInner
  const maxByArc = rOuter * Math.max(0, sweep / 2 - 0.02)
  const cr = Math.max(0, Math.min(cornerRadius, radialSpan * 0.45, maxByArc))
  if (cr < 0.6) return sharp()

  const da = cr / rOuter
  const a0 = startAngle + da
  const a1 = endAngle - da
  if (a1 <= a0) return sharp()

  const large = a1 - a0 > Math.PI ? 1 : 0
  const rOuterInner = rOuter - cr
  const osRadialX = cx + Math.cos(startAngle) * rOuterInner
  const osRadialY = cy + Math.sin(startAngle) * rOuterInner
  const osArcX = cx + Math.cos(a0) * rOuter
  const osArcY = cy + Math.sin(a0) * rOuter
  const oeArcX = cx + Math.cos(a1) * rOuter
  const oeArcY = cy + Math.sin(a1) * rOuter
  const oeRadialX = cx + Math.cos(endAngle) * rOuterInner
  const oeRadialY = cy + Math.sin(endAngle) * rOuterInner
  const ieX = cx + Math.cos(endAngle) * rInner
  const ieY = cy + Math.sin(endAngle) * rInner
  const isX = cx + Math.cos(startAngle) * rInner
  const isY = cy + Math.sin(startAngle) * rInner

  return [
    `M ${osRadialX.toFixed(2)} ${osRadialY.toFixed(2)}`,
    `A ${cr.toFixed(2)} ${cr.toFixed(2)} 0 0 1 ${osArcX.toFixed(2)} ${osArcY.toFixed(2)}`,
    `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 ${large} 1 ${oeArcX.toFixed(2)} ${oeArcY.toFixed(2)}`,
    `A ${cr.toFixed(2)} ${cr.toFixed(2)} 0 0 1 ${oeRadialX.toFixed(2)} ${oeRadialY.toFixed(2)}`,
    `L ${ieX.toFixed(2)} ${ieY.toFixed(2)}`,
    `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 ${largeFull} 0 ${isX.toFixed(2)} ${isY.toFixed(2)}`,
    'Z'
  ].join(' ')
}

export function MorphPieChart({
  items,
  title,
  formatValue,
  emptyLabel,
  maxItems = 8
}: MorphPieChartProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? 1 : 0))
  /** Drawn square side in px; tracks the card so the pie scales with the window. */
  const [sidePx, setSidePx] = useState(0)

  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    const measure = () => {
      const styles = getComputedStyle(node)
      const padX = (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0)
      const padY = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
      const gap = Number.parseFloat(styles.rowGap || styles.gap) || 0
      // Leave room for the readout line under the SVG.
      const readout = 22
      const availableW = Math.max(0, node.clientWidth - padX)
      const availableH = Math.max(0, node.clientHeight - padY - gap - readout)
      // When the card height is still content-driven, height can be ~0; fall back to width.
      const usableH = availableH > 48 ? availableH : availableW
      const next = Math.max(0, Math.floor(Math.min(availableW, usableH)))
      setSidePx((current) => (current === next ? current : next))
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

  const { slices, total, signature } = useMemo(() => {
    const positive = [...items]
      .filter((item) => Number.isFinite(item.value) && item.value > 0)
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
      .slice(0, maxItems)

    const sum = positive.reduce((acc, item) => acc + item.value, 0)
    if (sum <= 0 || positive.length === 0) {
      return { slices: [] as SliceModel[], total: 0, signature: '' }
    }

    // Same categorical Morandi ladder as RankBarChart (复习分析 lesson bars).
    let acc = 0
    const built: SliceModel[] = positive.map((item, index) => {
      const share = item.value / sum
      const p0 = -Math.PI / 2 + acc * TAU
      const p1 = -Math.PI / 2 + (acc + share) * TAU
      acc += share
      return {
        id: item.id,
        label: item.label,
        value: item.value,
        share,
        p0,
        p1,
        color: categoricalColor(index)
      }
    })

    const sig = built.map((slice) => `${slice.id}:${slice.value}`).join('|')
    return { slices: built, total: sum, signature: sig }
  }, [items, maxItems])

  useEffect(() => {
    if (slices.length === 0) {
      setProgress(1)
      return
    }
    if (prefersReducedMotion()) {
      setProgress(1)
      return
    }

    let frame = 0
    let start: number | null = null
    setProgress(0)
    const tick = (now: number) => {
      if (start === null) start = now
      const t = Math.min(1, (now - start) / 900)
      const eased = 1 - (1 - t) ** 3
      setProgress(eased)
      if (t < 1) frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [signature, slices.length])

  if (total <= 0 || slices.length === 0) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  const active = activeId ? (slices.find((slice) => slice.id === activeId) ?? null) : null
  const readout = active
    ? `${active.label} — ${Math.round(active.share * 100)}% · ${formatValue(active.value)}`
    : `${slices.length} · ${formatValue(total)}`

  // Grow outer radius from inner hole (subtle enter, morph pie is not double-encoded).
  const outerNow = R_INNER + (R_OUTER - R_INNER) * progress

  return (
    <div className="morph-pie" ref={rootRef} role="img" aria-labelledby={titleId}>
      <span id={titleId} className="morph-pie__a11y-title">
        {title}
      </span>

      <svg
        className="morph-pie__svg"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        aria-hidden="true"
        style={sidePx > 0 ? { width: sidePx, height: sidePx } : undefined}
      >
        <g className="morph-pie__slices">
          {slices.map((slice) => {
            const isActive = activeId === slice.id
            const dimmed = activeId !== null && !isActive
            const path = annularSectorPath(CX, CY, R_INNER, outerNow, slice.p0, slice.p1)
            if (!path) return null
            return (
              <path
                key={slice.id}
                className="morph-pie__sector"
                d={path}
                fill={slice.color}
                strokeWidth={2}
                strokeLinejoin="round"
                opacity={dimmed ? 0.38 : 1}
                data-active={isActive ? 'true' : 'false'}
                onPointerEnter={() => setActiveId(slice.id)}
                onPointerLeave={() => setActiveId((current) => (current === slice.id ? null : current))}
              >
                <title>
                  {`${slice.label}: ${formatValue(slice.value)} (${Math.round(slice.share * 100)}%)`}
                </title>
              </path>
            )
          })}
        </g>

        {progress > 0.55
          ? slices.map((slice) => {
              // Hide labels on very thin slices unless hovered — keeps half-width cards readable.
              if (slice.share < 0.045 && slices.length > 5 && activeId !== slice.id) return null

              const mid = (slice.p0 + slice.p1) / 2
              const cos = Math.cos(mid)
              const sin = Math.sin(mid)
              const x0 = CX + cos * LEADER_R0
              const y0 = CY + sin * LEADER_R0
              const x1 = CX + cos * LEADER_R1
              const y1 = CY + sin * LEADER_R1
              const x2 = CX + cos * LABEL_R
              const y2 = CY + sin * LABEL_R
              const absCos = Math.abs(cos)
              const anchor = absCos < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end'
              const isActive = activeId === slice.id
              const dimmed = activeId !== null && !isActive
              const labelOpacity = dimmed ? 0.42 : Math.min(1, (progress - 0.55) / 0.45)

              return (
                <g
                  key={`label-${slice.id}`}
                  className="morph-pie__label-group"
                  opacity={labelOpacity}
                  onPointerEnter={() => setActiveId(slice.id)}
                  onPointerLeave={() => setActiveId((current) => (current === slice.id ? null : current))}
                >
                  <polyline
                    className="morph-pie__leader"
                    points={`${x0.toFixed(1)},${y0.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`}
                    fill="none"
                    strokeWidth={1}
                  />
                  <text
                    className="morph-pie__label"
                    x={x2}
                    y={y2}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                  >
                    {truncateLabel(slice.label)}
                  </text>
                </g>
              )
            })
          : null}
      </svg>

      <p className="morph-pie__readout" data-active={active ? 'true' : 'false'} aria-live="polite">
        {readout}
      </p>
    </div>
  )
}
