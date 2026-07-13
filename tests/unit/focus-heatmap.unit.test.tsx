import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { FocusHeatmap, type FocusHeatmapLabels } from '@renderer/views/workbench/analytics/components/FocusHeatmap'
import { renderUi, screen, setupUser, within } from '../helpers/render'

const labels: FocusHeatmapLabels = {
  empty: 'No focus activity',
  partial: 'Some focus history is incomplete',
  unavailable: 'Focus history unavailable',
  error: 'Focus history failed',
  grid: 'Focus activity heatmap',
  instructions: 'Use arrow keys by day or week. Enter opens details.',
  chartView: 'Heatmap view',
  tableView: 'Data table view',
  dataStart: (date) => `Recorded data begins ${date}`,
  today: 'Today',
  selected: 'Selected',
  future: 'Future',
  missing: 'Missing history',
  zero: 'Recorded zero',
  partialCell: 'Partially recorded',
  covered: 'Recorded activity',
  drilldownTitle: (date) => `Details for ${date}`,
  closeDrilldown: 'Close details',
  dateColumn: 'Date',
  focusColumn: 'Focus',
  sessionsColumn: 'Sessions',
  tasksColumn: 'Tasks',
  statusColumn: 'Status',
  tableCaption: 'Daily focus data'
}

const formatters = {
  date: (date: string) => date,
  month: (date: string) => `Month ${date.slice(5, 7)}`,
  duration: (seconds: number) => `${seconds}s`,
  number: (value: number) => String(value)
}

const cells = Array.from({ length: 10 }, (_, index) => {
  const day = String(index + 1).padStart(2, '0')
  const date = `2026-07-${day}`
  return {
    date,
    focusSeconds: index === 1 ? 0 : 60 * index,
    completedFocusSessions: index,
    tasksCompleted: index % 2,
    intensity: (index % 5) as 0 | 1 | 2 | 3 | 4,
    coverage: index === 2 ? 'uncovered' as const : 'covered' as const,
    completeness: index === 3 ? 'partial' as const : 'complete' as const,
    tooltip: index === 2 ? 'No retained fact' : `${60 * index}s focus`
  }
})

function renderHeatmap(overrides: Partial<ComponentProps<typeof FocusHeatmap>> = {}) {
  return renderUi(
    <FocusHeatmap
      state="available"
      cells={cells}
      localToday="2026-07-10"
      selectedDate="2026-07-01"
      dataStartDate="2026-07-01"
      weekdayLabels={['M', 'T', 'W', 'T2', 'F', 'S', 'S2']}
      labels={labels}
      formatters={formatters}
      {...overrides}
    />
  )
}

describe('FocusHeatmap', () => {
  it('uses one tabbable grid entry and roves its active descendant with day/week keys', async () => {
    const user = setupUser()
    const onSelectedDateChange = vi.fn()
    renderHeatmap({ onSelectedDateChange })

    const grid = screen.getByRole('grid', { name: labels.grid })
    const gridCells = screen.getAllByRole('gridcell')
    expect(grid).toHaveAttribute('tabindex', '0')
    for (const cell of gridCells) expect(cell).not.toHaveAttribute('tabindex')

    grid.focus()
    await user.keyboard('{ArrowRight}')
    expect(grid).toHaveAttribute('aria-activedescendant', expect.stringContaining('cell-1'))
    expect(onSelectedDateChange).toHaveBeenLastCalledWith('2026-07-02')

    await user.keyboard('{ArrowDown}')
    expect(grid).toHaveAttribute('aria-activedescendant', expect.stringContaining('cell-8'))
    expect(onSelectedDateChange).toHaveBeenLastCalledWith('2026-07-09')

    await user.keyboard('{Home}')
    expect(onSelectedDateChange).toHaveBeenLastCalledWith('2026-07-01')
    await user.keyboard('{End}')
    expect(onSelectedDateChange).toHaveBeenLastCalledWith('2026-07-10')
  })

  it('opens drilldown with Enter and restores focus to the grid with Escape', async () => {
    const user = setupUser()
    renderHeatmap()
    const grid = screen.getByRole('grid', { name: labels.grid })

    grid.focus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: 'Details for 2026-07-01' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: labels.closeDrilldown })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(grid).toHaveFocus()
  })

  it('distinguishes missing, zero, and partial days and exposes a table alternative', async () => {
    const user = setupUser()
    renderHeatmap({ state: 'partial' })

    expect(screen.getByText(labels.partial)).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: /2026-07-02.*Recorded zero/ })).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: /2026-07-03.*Missing history/ })).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: /2026-07-04.*Partially recorded/ })).toBeInTheDocument()
    expect(screen.getByText('Recorded data begins 2026-07-01')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: labels.tableView }))
    const table = screen.getByRole('table', { name: labels.tableCaption })
    expect(within(table).getAllByText('Missing history').length).toBeGreaterThan(0)
    expect(within(table).getByText('Recorded zero')).toBeInTheDocument()
    expect(within(table).getByText('Partially recorded')).toBeInTheDocument()
  })
})
