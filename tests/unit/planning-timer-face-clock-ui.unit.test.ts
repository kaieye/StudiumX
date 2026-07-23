/**
 * Pure face-clock projection: idle/preview dial follows applied plan (not hard-coded 25:00).
 * Exam continuous paints wall start (e.g. 09:00) and counts up.
 */
import { describe, expect, it } from 'vitest'
import {
  formatDurationClockParts,
  formatExamWallClock,
  formatExamWallClockParts,
  parseSimulationTimeToSeconds,
  projectPlanPreviewSeconds,
  projectWorkbenchTimerFaceClock,
  projectWorkbenchTimerFaceMeta
} from '../../src/renderer/src/study-space/planning-timer-face-clock-ui'

describe('projectPlanPreviewSeconds', () => {
  it('uses focus minutes for classic pomodoro', () => {
    expect(projectPlanPreviewSeconds({
      selectedMode: 'focus',
      focusMinutes: 50,
      breakMinutes: 10,
      appliedPlan: { kind: 'pomodoro', clockMode: 'countdown', focusMinutes: 50, breakMinutes: 10 }
    })).toBe(50 * 60)
  })

  it('seeds exam continuous at 0 elapsed (wall base paints start time)', () => {
    expect(projectPlanPreviewSeconds({
      selectedMode: 'focus',
      focusMinutes: 25,
      breakMinutes: 5,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      appliedPlan: {
        kind: 'continuous',
        clockMode: 'countup',
        continuousTarget: true,
        focusMinutes: 180,
        breakMinutes: 0
      }
    })).toBe(0)
  })

  it('seeds open countup at 0 instead of focusMinutes cache', () => {
    expect(projectPlanPreviewSeconds({
      selectedMode: 'focus',
      focusMinutes: 25,
      breakMinutes: 5,
      appliedPlan: {
        kind: 'continuous',
        clockMode: 'countup',
        continuousTarget: false,
        focusMinutes: 25,
        breakMinutes: 5
      }
    })).toBe(0)
  })

  it('uses break minutes for break mode on pomodoro', () => {
    expect(projectPlanPreviewSeconds({
      selectedMode: 'break',
      focusMinutes: 25,
      breakMinutes: 5,
      appliedPlan: { kind: 'pomodoro', clockMode: 'countdown', focusMinutes: 25, breakMinutes: 5 }
    })).toBe(5 * 60)
  })
})

describe('projectWorkbenchTimerFaceMeta', () => {
  it('does not paint 25/5 · window chrome on the dial', () => {
    expect(projectWorkbenchTimerFaceMeta({
      selectedMode: 'focus',
      focusMinutes: 25,
      breakMinutes: 5,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      appliedPlan: { kind: 'pomodoro', clockMode: 'countdown', focusMinutes: 25, breakMinutes: 5 }
    })).toBeNull()
  })
})

describe('exam wall clock helpers', () => {
  it('parses HH:MM to seconds from midnight', () => {
    expect(parseSimulationTimeToSeconds('09:00')).toBe(9 * 3600)
    expect(parseSimulationTimeToSeconds('09:30')).toBe(9 * 3600 + 30 * 60)
    expect(parseSimulationTimeToSeconds('bad')).toBeNull()
  })

  it('formats wall base + elapsed with separate seconds line parts', () => {
    expect(formatExamWallClockParts(9 * 3600, 0)).toEqual({ primary: '09:00', seconds: '00' })
    expect(formatExamWallClockParts(9 * 3600, 65)).toEqual({ primary: '09:01', seconds: '05' })
    expect(formatExamWallClock(9 * 3600, 0)).toBe('09:00')
    expect(formatExamWallClock(9 * 3600, 65, { alwaysSeconds: true })).toBe('09:01:05')
  })

  it('formats duration as minutes primary + SS secondary', () => {
    expect(formatDurationClockParts(0)).toEqual({ primary: '00', seconds: '00' })
    expect(formatDurationClockParts(65)).toEqual({ primary: '01', seconds: '05' })
    expect(formatDurationClockParts(180 * 60 + 7)).toEqual({ primary: '180', seconds: '07' })
  })
})

describe('projectWorkbenchTimerFaceClock', () => {
  it('keeps live remaining while running', () => {
    const model = projectWorkbenchTimerFaceClock({
      timerState: 'running',
      timerMode: 'focus',
      selectedMode: 'focus',
      remainingSeconds: 742,
      focusMinutes: 25,
      breakMinutes: 5,
      appliedPlan: { kind: 'pomodoro', clockMode: 'countdown', focusMinutes: 25, breakMinutes: 5 }
    })
    expect(model.displaySeconds).toBe(742)
    expect(model.faceMeta).toBeNull()
    expect(model.wallBaseSeconds ?? null).toBeNull()
  })

  it('previews exam wall start on idle face with countup mode', () => {
    const model = projectWorkbenchTimerFaceClock({
      timerState: 'idle',
      timerMode: 'focus',
      selectedMode: 'focus',
      remainingSeconds: 25 * 60,
      focusMinutes: 180,
      breakMinutes: 0,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      appliedPlan: {
        kind: 'continuous',
        clockMode: 'countup',
        continuousTarget: true,
        focusMinutes: 180,
        breakMinutes: 0
      }
    })
    expect(model.displaySeconds).toBe(0)
    expect(model.clockMode).toBe('countup')
    expect(model.wallBaseSeconds).toBe(9 * 3600)
    expect(formatExamWallClockParts(model.wallBaseSeconds!, model.displaySeconds)).toEqual({
      primary: '09:00',
      seconds: '00'
    })
  })

  it('counts up from wall start while exam session is running', () => {
    const model = projectWorkbenchTimerFaceClock({
      timerState: 'running',
      timerMode: 'focus',
      selectedMode: 'focus',
      remainingSeconds: 125,
      focusMinutes: 180,
      breakMinutes: 0,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      appliedPlan: {
        kind: 'continuous',
        clockMode: 'countup',
        continuousTarget: true,
        focusMinutes: 180,
        breakMinutes: 0
      },
      activeSessionClockMode: 'countup'
    })
    expect(model.clockMode).toBe('countup')
    expect(model.displaySeconds).toBe(125)
    expect(formatExamWallClockParts(model.wallBaseSeconds!, model.displaySeconds)).toEqual({
      primary: '09:02',
      seconds: '05'
    })
  })
})
