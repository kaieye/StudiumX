import { useId, useMemo, useState } from 'react'

export type ProgressGaugeProps = {
  /** Progress in [0, 1]. Null/undefined renders empty. */
  progress: number | null | undefined
  title: string
  centerValue: string
  centerLabel?: string
  emptyLabel: string
  tone?: 'default' | 'ok' | 'warn' | 'alert'
  /** Tooltip for the filled arc (e.g. current XP). */
  fillTooltip?: string
  /** Tooltip for the remaining track arc (e.g. next level threshold). */
  trackTooltip?: string
  /** Smaller ring for hero grid cells. */
  compact?: boolean
}

const SIZE = 120
const RADIUS = 48
const STROKE = 10
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Single-value progress ring (Basics tick-gauge spirit).
 * Used for level progress and review accuracy.
 */
export function ProgressGauge({
  progress,
  title,
  centerValue,
  centerLabel,
  emptyLabel,
  tone = 'default',
  fillTooltip,
  trackTooltip,
  compact = false
}: ProgressGaugeProps) {
  const titleId = useId()
  const [hoverRegion, setHoverRegion] = useState<'fill' | 'track' | null>(null)

  const safe = useMemo(() => {
    if (progress === null || progress === undefined || !Number.isFinite(progress)) return null
    return Math.max(0, Math.min(1, progress))
  }, [progress])

  if (safe === null) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  const fillLen = safe * CIRCUMFERENCE
  const trackLen = CIRCUMFERENCE - fillLen
  const hasRegionTooltips = Boolean(fillTooltip || trackTooltip)
  const activeTooltip =
    hoverRegion === 'fill' ? fillTooltip ?? null : hoverRegion === 'track' ? trackTooltip ?? null : null

  return (
    <div
      className={compact ? 'progress-gauge progress-gauge--compact' : 'progress-gauge'}
      data-tone={tone}
      data-hover={hoverRegion ?? 'none'}
    >
      <svg
        className="progress-gauge__svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{title}</title>
        <g transform={`translate(${SIZE / 2} ${SIZE / 2}) rotate(-90)`}>
          {/* Full muted track underlay (non-interactive visual base). */}
          <circle
            className="progress-gauge__track-base"
            r={RADIUS}
            cx={0}
            cy={0}
            fill="none"
            strokeWidth={STROKE}
            aria-hidden="true"
          />
          {trackLen > 0.5 ? (
            <g className={hoverRegion === 'track' ? 'progress-gauge__region progress-gauge__region--float' : 'progress-gauge__region'}>
              <circle
                className="progress-gauge__track"
                r={RADIUS}
                cx={0}
                cy={0}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${trackLen} ${CIRCUMFERENCE}`}
                strokeDashoffset={-fillLen}
                strokeLinecap="butt"
                pointerEvents={trackTooltip ? 'stroke' : 'none'}
                tabIndex={trackTooltip ? 0 : undefined}
                onPointerEnter={trackTooltip ? () => setHoverRegion('track') : undefined}
                onPointerLeave={trackTooltip ? () => setHoverRegion(null) : undefined}
                onFocus={trackTooltip ? () => setHoverRegion('track') : undefined}
                onBlur={trackTooltip ? () => setHoverRegion(null) : undefined}
              >
                {trackTooltip ? <title>{trackTooltip}</title> : null}
              </circle>
            </g>
          ) : null}
          {fillLen > 0.5 ? (
            <g className={hoverRegion === 'fill' ? 'progress-gauge__region progress-gauge__region--float' : 'progress-gauge__region'}>
              <circle
                className="progress-gauge__fill"
                r={RADIUS}
                cx={0}
                cy={0}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${fillLen} ${CIRCUMFERENCE}`}
                strokeLinecap="round"
                pointerEvents={fillTooltip ? 'stroke' : 'none'}
                tabIndex={fillTooltip ? 0 : undefined}
                onPointerEnter={fillTooltip ? () => setHoverRegion('fill') : undefined}
                onPointerLeave={fillTooltip ? () => setHoverRegion(null) : undefined}
                onFocus={fillTooltip ? () => setHoverRegion('fill') : undefined}
                onBlur={fillTooltip ? () => setHoverRegion(null) : undefined}
              >
                {fillTooltip ? <title>{fillTooltip}</title> : null}
              </circle>
            </g>
          ) : null}
        </g>
      </svg>
      <div className="progress-gauge__center" aria-hidden="true">
        <strong>{centerValue}</strong>
        {centerLabel ? <span>{centerLabel}</span> : null}
      </div>
      {hasRegionTooltips ? (
        <p
          className="progress-gauge__tooltip"
          data-visible={activeTooltip ? 'true' : 'false'}
          aria-live="polite"
        >
          {activeTooltip ?? ''}
        </p>
      ) : null}
    </div>
  )
}
