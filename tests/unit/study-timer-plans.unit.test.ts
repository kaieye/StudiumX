import { describe, expect, it } from 'vitest'
import { defaultStudySnapshot } from '@renderer/study-space/constants'
import { normalizeStudySnapshot } from '@renderer/study-space/session/session-snapshot'
import {
  applyStudyTimerPlan,
  removeStudyTimerPlan,
  saveStudyTimerPlan
} from '@renderer/study-space/session/transitions'

const plan = {
  id: 'morning-sprint',
  name: '晨间冲刺',
  focusMinutes: 45,
  breakMinutes: 10,
  simulationStartTime: '08:30',
  simulationEndTime: '10:30'
}

describe('study timer plans', () => {
  it('normalizes persisted named plans and rejects invalid time fields', () => {
    const snapshot = normalizeStudySnapshot({
      ...defaultStudySnapshot,
      simulationStartTime: 'not-a-time',
      simulationEndTime: '20:00',
      timerPlans: [
        plan,
        {
          id: '',
          name: '无效时段',
          focusMinutes: 999,
          breakMinutes: -2,
          simulationStartTime: '30:00',
          simulationEndTime: '09:99'
        },
        { id: 'ignored', name: '   ' }
      ]
    })

    expect(snapshot.simulationStartTime).toBe(defaultStudySnapshot.simulationStartTime)
    expect(snapshot.simulationEndTime).toBe('20:00')
    expect(snapshot.timerPlans).toEqual([
      plan,
      {
        id: 'timer-plan-1',
        name: '无效时段',
        focusMinutes: 120,
        breakMinutes: 1,
        simulationStartTime: defaultStudySnapshot.simulationStartTime,
        simulationEndTime: defaultStudySnapshot.simulationEndTime
      }
    ])
  })

  it('saves a plan, immediately applies it to an idle timer, and permits removal', () => {
    const saved = saveStudyTimerPlan(defaultStudySnapshot, plan)

    expect(saved.timerPlans).toEqual([plan])
    expect(saved.focusMinutes).toBe(45)
    expect(saved.breakMinutes).toBe(10)
    expect(saved.simulationStartTime).toBe('08:30')
    expect(saved.simulationEndTime).toBe('10:30')
    expect(saved.remainingSeconds).toBe(45 * 60)

    const applied = applyStudyTimerPlan({ ...saved, focusMinutes: 25, breakMinutes: 5 }, plan)
    expect(applied.focusMinutes).toBe(45)
    expect(applied.breakMinutes).toBe(10)
    expect(removeStudyTimerPlan(saved, plan.id).timerPlans).toEqual([])
  })

  it('keeps an active timer countdown intact while applying a future plan', () => {
    const running = applyStudyTimerPlan({
      ...defaultStudySnapshot,
      timerState: 'running',
      timerMode: 'focus',
      remainingSeconds: 900
    }, plan)

    expect(running.remainingSeconds).toBe(900)
    expect(running.focusMinutes).toBe(45)
    expect(running.breakMinutes).toBe(10)
  })

  it('preserves optional advanced fields on normalize', () => {
    const snapshot = normalizeStudySnapshot({
      ...defaultStudySnapshot,
      timerPlans: [{
        id: 'deep-custom',
        name: '深度自定义',
        focusMinutes: 50,
        breakMinutes: 10,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00',
        longBreakMinutes: 20,
        longBreakEvery: 3,
        breakPolicy: 'automatic'
      }]
    })
    expect(snapshot.timerPlans[0]).toMatchObject({
      id: 'deep-custom',
      longBreakMinutes: 20,
      longBreakEvery: 3,
      breakPolicy: 'automatic'
    })
  })

})
