import { useMemo, useState } from 'react'
import { categoricalColor } from './palette'

export type RankBarItem = {
  id: string
  label: string
  value: number
}

export type RankBarChartProps = {
  items: readonly RankBarItem[]
  title: string
  formatValue: (value: number) => string
  emptyLabel: string
  /** Max rows to render; defaults to 8. */
  maxItems?: number
}

/**
 * Horizontal ranking bars (Glance chunky / Basics tick-row spirit).
 * Length encodes magnitude; labels stay readable for long task names.
 */
export function RankBarChart({
  items,
  title,
  formatValue,
  emptyLabel,
  maxItems = 8
}: RankBarChartProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const rows = useMemo(() => {
    return [...items]
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, maxItems)
  }, [items, maxItems])

  const max = useMemo(() => Math.max(0, ...rows.map((row) => row.value)), [rows])

  if (rows.length === 0 || max <= 0) {
    return <p className="analytics-chart-empty">{emptyLabel}</p>
  }

  return (
    <div className="rank-bars" role="img" aria-label={title}>
      <ol className="rank-bars__list">
        {rows.map((row, index) => {
          const ratio = max > 0 ? row.value / max : 0
          return (
            <li
              key={row.id}
              className="rank-bars__row"
              data-active={activeId === row.id}
              onPointerEnter={() => setActiveId(row.id)}
              onPointerLeave={() => setActiveId((current) => (current === row.id ? null : current))}
            >
              <div className="rank-bars__meta">
                <bdi dir="auto" className="rank-bars__label">{row.label}</bdi>
                <span className="rank-bars__value">{formatValue(row.value)}</span>
              </div>
              <div className="rank-bars__track" aria-hidden="true">
                <span
                  className="rank-bars__fill"
                  style={{
                    width: `${Math.max(2, ratio * 100)}%`,
                    background: categoricalColor(index)
                  }}
                />
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
