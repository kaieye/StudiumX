import { useMemo, useState } from 'react'

export type DumbbellItem = {
  id: string
  label: string
  before: number
  after: number
}

export type DumbbellChartProps = {
  items: readonly DumbbellItem[]
  title: string
  beforeLabel: string
  afterLabel: string
  formatValue: (value: number) => string
  emptyLabel: string
  maxItems?: number
  /** Hide built-in legend when the parent renders it in a header. */
  hideLegend?: boolean
  /** Stack category label above the track instead of beside it. */
  stackedRows?: boolean
  /**
   * When stacked, place the before→after text on the same line as the
   * category label (right side) instead of under the track.
   */
  valuesBesideLabel?: boolean
}

/**
 * Category-level before/after comparison (Basics dumbbell spirit).
 * Used for planned vs executed focus seconds.
 */
export function DumbbellChart({
  items,
  title,
  beforeLabel,
  afterLabel,
  formatValue,
  emptyLabel,
  maxItems = 6,
  hideLegend = false,
  stackedRows = false,
  valuesBesideLabel = false
}: DumbbellChartProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const rows = useMemo(() => {
    return [...items]
      .filter((item) => item.before > 0 || item.after > 0)
      .sort((a, b) => Math.max(b.before, b.after) - Math.max(a.before, a.after))
      .slice(0, maxItems)
  }, [items, maxItems])

  const max = useMemo(
    () => Math.max(0, ...rows.flatMap((row) => [row.before, row.after])),
    [rows]
  )

  if (rows.length === 0 || max <= 0) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  const rootClass = [
    'dumbbell-chart',
    stackedRows ? 'dumbbell-chart--stacked' : '',
    valuesBesideLabel ? 'dumbbell-chart--values-beside-label' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClass} role="img" aria-label={title}>
      {hideLegend ? null : (
        <div className="dumbbell-chart__legend" aria-hidden="true">
          <span className="dumbbell-chart__swatch dumbbell-chart__swatch--before" />
          <span>{beforeLabel}</span>
          <span className="dumbbell-chart__swatch dumbbell-chart__swatch--after" />
          <span>{afterLabel}</span>
        </div>
      )}
      <ol className="dumbbell-chart__list">
        {rows.map((row) => {
          const left = Math.min(row.before, row.after)
          const right = Math.max(row.before, row.after)
          const leftPct = (left / max) * 100
          const widthPct = Math.max(0.8, ((right - left) / max) * 100)
          const beforePct = (row.before / max) * 100
          const afterPct = (row.after / max) * 100
          return (
            <li
              key={row.id}
              className="dumbbell-chart__row"
              data-active={activeId === row.id}
              onPointerEnter={() => setActiveId(row.id)}
              onPointerLeave={() => setActiveId((current) => (current === row.id ? null : current))}
            >
              {valuesBesideLabel ? (
                <div className="dumbbell-chart__label-row">
                  <bdi dir="auto" className="dumbbell-chart__label">{row.label}</bdi>
                  <span className="dumbbell-chart__values">
                    {formatValue(row.before)}
                    <span aria-hidden="true"> → </span>
                    {formatValue(row.after)}
                  </span>
                </div>
              ) : (
                <bdi dir="auto" className="dumbbell-chart__label">{row.label}</bdi>
              )}
              <div className="dumbbell-chart__track">
                <span
                  className="dumbbell-chart__bridge"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  aria-hidden="true"
                />
                <span
                  className="dumbbell-chart__dot dumbbell-chart__dot--before"
                  style={{ left: `${beforePct}%` }}
                  title={`${beforeLabel}: ${formatValue(row.before)}`}
                />
                <span
                  className="dumbbell-chart__dot dumbbell-chart__dot--after"
                  style={{ left: `${afterPct}%` }}
                  title={`${afterLabel}: ${formatValue(row.after)}`}
                />
              </div>
              {valuesBesideLabel ? null : (
                <span className="dumbbell-chart__values">
                  {formatValue(row.before)}
                  <span aria-hidden="true"> → </span>
                  {formatValue(row.after)}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
