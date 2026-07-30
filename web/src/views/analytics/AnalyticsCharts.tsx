/**
 * Web-specific, self-styled analytics chart components.
 *
 * The desktop `analytics/charts/` subcomponents (DonutChart, ProgressGauge, …)
 * are PURE SVG with zero native deps (porting-features.md §1), so they compile
 * under the Web build - BUT their layout is driven by class names defined only
 * in the desktop `analytics-page.css` (75 KB), which the Web app does not load.
 * Importing them verbatim would render unstyled. Per the porting guidance
 * ("a compiling, working web view beats maximal code reuse"), these reimplement
 * the needed visuals as small Tailwind/inline-SVG components. The pure
 * `@renderer` color palette (`categoricalColor`) IS reused for visual parity.
 */

import { categoricalColor } from '@renderer/views/workbench/analytics/charts/palette'

/** A single-value progress ring for a [0,1] completion ratio. */
export function CompletionRing({
  ratio,
  centerValue,
  centerLabel,
  emptyLabel
}: {
  ratio: number | null
  centerValue: string
  centerLabel: string
  emptyLabel: string
}) {
  const SIZE = 148
  const RADIUS = 62
  const STROKE = 14
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS
  const hasRatio = ratio !== null && Number.isFinite(ratio)
  const fraction = hasRatio ? Math.max(0, Math.min(1, ratio as number)) : 0
  const dash = fraction * CIRCUMFERENCE
  const accent = categoricalColor(2) // slate blue-gray from the shared Morandi palette
  const track = '#E5E7EB'

  const centerFigure = hasRatio ? centerValue : '-'
  const figureClass = hasRatio
    ? 'text-3xl font-semibold text-neutral-900'
    : 'text-2xl font-semibold text-neutral-400'

  return (
    <div
      className="flex flex-col items-center gap-3 py-2"
      role="img"
      aria-label={`${centerLabel} ${centerFigure}`}
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={track} strokeWidth={STROKE} />
          {hasRatio ? (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={accent}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <strong className={figureClass}>{centerFigure}</strong>
          <span className="text-xs text-neutral-500">{centerLabel}</span>
        </div>
      </div>
      <span className="text-sm text-neutral-500">{emptyLabel}</span>
    </div>
  )
}

/** A labelled metric tile for the stat-card grid. */
export function StatCard({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-neutral-400">{hint}</p> : null}
    </div>
  )
}
