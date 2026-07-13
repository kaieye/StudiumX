import type { ReactNode } from 'react'
import type { AnalyticsDataState } from '../types'

export type CoreStateLabels = {
  empty: string
  partial: string
  unavailable: string
  error: string
}

export type CoreSectionStateProps = {
  state: AnalyticsDataState
  labels: CoreStateLabels
  warnings?: readonly string[]
  children: ReactNode
}

export function CoreSectionState({ state, labels, warnings = [], children }: CoreSectionStateProps) {
  if (state === 'empty' || state === 'unavailable' || state === 'error') {
    return (
      <div className={`core-analytics-state core-analytics-state--${state}`} role={state === 'error' ? 'alert' : 'status'}>
        <span className="core-analytics-state__mark" aria-hidden="true">
          {state === 'error' ? '!' : state === 'unavailable' ? '—' : '○'}
        </span>
        <p>{labels[state]}</p>
      </div>
    )
  }

  return (
    <>
      {state === 'partial' ? (
        <div className="core-analytics-warning" role="status">
          <span aria-hidden="true">!</span>
          <span>{labels.partial}</span>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="core-analytics-warning-list" aria-label={labels.partial}>
          {warnings.map((warning, index) => (
            <li key={`${warning}-${index}`}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {children}
    </>
  )
}

export type CoreTableColumn<Row> = {
  key: string
  label: string
  render: (row: Row) => ReactNode
}

export function CoreDataTable<Row>({
  caption,
  columns,
  rows,
  getRowKey
}: {
  caption: string
  columns: readonly CoreTableColumn<Row>[]
  rows: readonly Row[]
  getRowKey: (row: Row) => string
}) {
  return (
    <div className="core-analytics-table-wrap">
      <table className="core-analytics-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
