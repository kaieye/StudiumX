/**
 * Pure simulation window preference labels (sole-authority demotion).
 */
import { describe, expect, it } from 'vitest'
import {
  buildSimulationWindowPreferencesPatch,
  normalizeSimulationTimeLabel,
  normalizeSimulationWindow,
  projectSimulationWindowFromPreferences
} from '../../src/renderer/src/study-space/planning-simulation-window-ui'

describe('planning-simulation-window-ui', () => {
  it('normalizes HH:MM and pads hours', () => {
    expect(normalizeSimulationTimeLabel('9:00')).toBe('09:00')
    expect(normalizeSimulationTimeLabel('09:30')).toBe('09:30')
    expect(normalizeSimulationTimeLabel('23:59')).toBe('23:59')
    expect(normalizeSimulationTimeLabel('24:00')).toBeNull()
    expect(normalizeSimulationTimeLabel('9:60')).toBeNull()
    expect(normalizeSimulationTimeLabel('abc')).toBeNull()
    expect(normalizeSimulationTimeLabel(null)).toBeNull()
  })

  it('requires start < end', () => {
    expect(normalizeSimulationWindow({ simulationStartTime: '09:00', simulationEndTime: '12:00' })).toEqual({
      start: '09:00',
      end: '12:00'
    })
    expect(normalizeSimulationWindow({ simulationStartTime: '12:00', simulationEndTime: '09:00' })).toBeNull()
    expect(normalizeSimulationWindow({ simulationStartTime: '09:00', simulationEndTime: '09:00' })).toBeNull()
  })

  it('projects preferences fail-closed when unset/invalid', () => {
    expect(projectSimulationWindowFromPreferences(undefined)).toBeNull()
    expect(projectSimulationWindowFromPreferences({})).toBeNull()
    expect(
      projectSimulationWindowFromPreferences({ simulationStartTime: '09:00' })
    ).toBeNull()
    expect(
      projectSimulationWindowFromPreferences({
        simulationStartTime: '10:30',
        simulationEndTime: '14:00'
      })
    ).toEqual({ start: '10:30', end: '14:00' })
  })

  it('builds set_preferences patch', () => {
    expect(buildSimulationWindowPreferencesPatch({ start: '08:00', end: '11:00' })).toEqual({
      simulationStartTime: '08:00',
      simulationEndTime: '11:00'
    })
  })
})
