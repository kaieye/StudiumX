import { useMemo, useState } from 'react'

export type DivergingBarItem = {
  id: string
  label: string
  value: number
  /** Visual polarity; defaults from sign of value. */
  polarity?: 'positive' | 'negative' | 'neutral'
}

export type DivergingBarChartProps = {
  items: readonly DivergingBarItem[]
  title: string
  formatValue: (value: number) => string
  emptyLabel: string
}

/**
 * Category bars that can grow left (negative) or right (positive).
 * Used for completed vs interrupted/canceled session structure.
 */
export function DivergingBarChart({
  items,
  title,
  formatValue,
  emptyLabel
}: DivergingBarChartProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const rows = useMemo(() => {
    return items
      .filter((item) => Number.isFinite(item.value) && item.value !== 0)
      .map((item) => {
        const polarity =
          item.polarity ??
          (item.value > 0 ? 'positive' : item.value < 0 ? 'negative' : 'neutral')
        return { ...item, polarity, magnitude: Math.abs(item.value) }
      })
  }, [items])

  const max = useMemo(() => Math.max(0, ...rows.map((row) => row.magnitude)), [rows])

  if (rows.length === 0 || max <= 0) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  return (
    <div className="diverging-bars" role="img" aria-label={title}>
      <ol className="diverging-bars__list">
        {rows.map((row) => {
          const ratio = max > 0 ? row.magnitude / max : 0
          return (
            <li
              key={row.id}
              className="diverging-bars__row"
              data-polarity={row.polarity}
              data-active={activeId === row.id}
              onPointerEnter={() => setActiveId(row.id)}
              onPointerLeave={() => setActiveId((current) => (current === row.id ? null : current))}
            >
              <span className="diverging-bars__label"><bdi dir="auto">{row.label}</bdi></span>
              <div className="diverging-bars__plot" aria-hidden="true">
                <div className="diverging-bars__half diverging-bars__half--left">
                  {row.polarity === 'negative' ? (
                    <span className="diverging-bars__fill" style={{ width: `${Math.max(4, ratio * 100)}%` }} />
                  ) : null}
                </div>
                <div className="diverging-bars__axis" />
                <div className="diverging-bars__half diverging-bars__half--right">
                  {row.polarity !== 'negative' ? (
                    <span className="diverging-bars__fill" style={{ width: `${Math.max(4, ratio * 100)}%` }} />
                  ) : null}
                </div>
              </div>
              <span className="diverging-bars__value">{formatValue(row.magnitude)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
