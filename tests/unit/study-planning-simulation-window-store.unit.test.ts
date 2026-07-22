/**
 * Store set_preferences accepts simulation window labels.
 */
import { describe, expect, it } from 'vitest'
import { StudyPlanningStore } from '../../src/shared/study-planning'

describe('StudyPlanningStore set_preferences simulation window', () => {
  it('stores valid HH:MM labels on preferences', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const snap = store.readSnapshot()
    const result = store.applyCommand(
      {
        actionId: 'pref-sim-1',
        type: 'set_preferences',
        payload: {
          simulationStartTime: '9:00',
          simulationEndTime: '12:30'
        }
      },
      snap.revision
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.preferences.simulationStartTime).toBe('09:00')
    expect(result.snapshot.preferences.simulationEndTime).toBe('12:30')
  })

  it('ignores invalid simulation labels (does not wipe other prefs)', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const first = store.applyCommand(
      {
        actionId: 'pref-sim-2a',
        type: 'set_preferences',
        payload: { simulationStartTime: '08:00', simulationEndTime: '10:00' }
      },
      store.readSnapshot().revision
    )
    expect(first.ok).toBe(true)
    const second = store.applyCommand(
      {
        actionId: 'pref-sim-2b',
        type: 'set_preferences',
        payload: { simulationStartTime: 'not-a-time', simulationEndTime: '99:99' }
      },
      store.readSnapshot().revision
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // Invalid values ignored; previous window preserved via spread of next.preferences
    expect(second.snapshot.preferences.simulationStartTime).toBe('08:00')
    expect(second.snapshot.preferences.simulationEndTime).toBe('10:00')
  })
})
