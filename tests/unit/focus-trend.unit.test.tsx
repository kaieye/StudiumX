import { describe, expect, it } from 'vitest'
import { FocusTrendChart, type FocusTrendLabels } from '@renderer/views/workbench/analytics/components/FocusTrendChart'
import { renderUi, screen, setupUser, within } from '../helpers/render'

const labels: FocusTrendLabels = {
  empty: 'No trend activity',
  partial: 'Trend coverage is partial',
  unavailable: 'Trend unavailable',
  error: 'Trend failed',
  chart: 'Focus trend chart',
  dailyGrain: 'Daily',
  weeklyGrain: 'Weekly',
  target: 'Target',
  running: 'Currently running',
  missing: 'Missing history',
  zero: 'Recorded zero',
  partialPoint: 'Partially recorded',
  showTable: 'Show trend data',
  hideTable: 'Hide trend data',
  tableCaption: 'Focus trend data',
  dateColumn: 'Period',
  focusColumn: 'Focus',
  sessionsColumn: 'Sessions',
  statusColumn: 'Status'
}

const formatters = {
  date: (date: string, grain: 'day' | 'week') => `${grain}:${date}`,
  duration: (seconds: number) => `${seconds}s`,
  number: (value: number) => String(value)
}

describe('FocusTrendChart', () => {
  it('keeps missing history distinct from a recorded zero in the table fallback', async () => {
    const user = setupUser()
    renderUi(
      <FocusTrendChart
        state="partial"
        grain="day"
        points={[
          { date: '2026-07-01', focusSeconds: 0, completedFocusSessions: 0, coverage: 'covered' },
          { date: '2026-07-02', focusSeconds: 0, completedFocusSessions: 0, coverage: 'uncovered' },
          { date: '2026-07-03', focusSeconds: 120, completedFocusSessions: 1, coverage: 'covered', completeness: 'partial' }
        ]}
        targetSeconds={300}
        runningOverlay={{ date: '2026-07-03', additionalSeconds: 30, label: 'Active timer' }}
        summary="A three-day trend with one missing day and one running timer."
        labels={labels}
        formatters={formatters}
      />
    )

    expect(screen.getByText(labels.partial)).toBeInTheDocument()
    expect(screen.getByText(/A three-day trend/)).toBeInTheDocument()
    expect(screen.getByText('Active timer')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: labels.showTable }))
    const table = screen.getByRole('table', { name: labels.tableCaption })
    expect(within(table).getByText(labels.zero)).toBeInTheDocument()
    expect(within(table).getAllByText(labels.missing).length).toBeGreaterThan(0)
    expect(within(table).getByText(labels.partialPoint)).toBeInTheDocument()
    expect(within(table).getByText('0s')).toBeInTheDocument()
  })

  it('renders an unavailable state without fabricating chart values', () => {
    renderUi(
      <FocusTrendChart
        state="unavailable"
        grain="week"
        points={[]}
        summary=""
        labels={labels}
        formatters={formatters}
      />
    )
    expect(screen.getByText(labels.unavailable)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: labels.showTable })).not.toBeInTheDocument()
  })
})
