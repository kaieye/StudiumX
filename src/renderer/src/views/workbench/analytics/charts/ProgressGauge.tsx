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
  const [hoverLabel, setHoverLabel] = useState<string | null>(null)

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
  const activeTooltip = hoverLabel ?? null

  return (
    <div
      className={compact ? 'progress-gauge progress-gauge--compact' : 'progress-gauge'}
      data-tone={tone}
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
              onPointerEnter={trackTooltip ? () => setHoverLabel(trackTooltip) : undefined}
              onPointerLeave={trackTooltip ? () => setHoverLabel(null) : undefined}
              onFocus={trackTooltip ? () => setHoverLabel(trackTooltip) : undefined}
              onBlur={trackTooltip ? () => setHoverLabel(null) : undefined}
            >
              {trackTooltip ? <title>{trackTooltip}</title> : null}
            </circle>
          ) : null}
          {fillLen > 0.5 ? (
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
              onPointerEnter={fillTooltip ? () => setHoverLabel(fillTooltip) : undefined}
              onPointerLeave={fillTooltip ? () => setHoverLabel(null) : undefined}
              onFocus={fillTooltip ? () => setHoverLabel(fillTooltip) : undefined}
              onBlur={fillTooltip ? () => setHoverLabel(null) : undefined}
            >
              {fillTooltip ? <title>{fillTooltip}</title> : null}
            </circle>
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
