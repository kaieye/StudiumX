import { describe, expect, it } from 'vitest'
import { createActiveRangeYAxis } from '../../src/renderer/src/views/workbench/analytics/charts/ActiveRangeChart'

describe('createActiveRangeYAxis', () => {
  it('adds one hour of padding around the visible capsules', () => {
    const axis = createActiveRangeYAxis([
      { id: 'morning', category: '2026-07-24', start: 10.25, end: 11.5, activeSeconds: 4500 },
      { id: 'evening', category: '2026-07-25', start: 18, end: 18.5, activeSeconds: 1800 }
    ], 24)

    expect(axis).toMatchObject({ min: 9, max: 20 })
    expect(axis.ticks[0]).toBe(9)
    expect(axis.ticks.at(-1)).toBe(20)
  })

  it('keeps the hour axis within its 0–24 bounds', () => {
    const axis = createActiveRangeYAxis([
      { id: 'start', category: '2026-07-24', start: 0, end: 0.5, activeSeconds: 1800 },
      { id: 'end', category: '2026-07-25', start: 23.5, end: 24, activeSeconds: 1800 }
    ], 24)

    expect(axis).toMatchObject({ min: 0, max: 24 })
  })

  it('uses the full natural range when no data is visible', () => {
    expect(createActiveRangeYAxis([], 24)).toEqual({ min: 0, max: 24, ticks: [0, 24] })
  })
})
