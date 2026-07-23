import { describe, expect, it } from 'vitest'
import { createStudySpaceViewModel } from '../../src/renderer/src/study-space/viewModel'
import { defaultStudySnapshot } from '../../src/renderer/src/study-space/constants'
import { projectTimerProgressPercent } from '../../src/renderer/src/study-space/planning-timer-display'

const offlinePresence = {
  status: 'offline' as const,
  peers: [],
  events: [],
  relay: '',
  topic: '',
  lastHeartbeatAt: 0,
  lastRemoteMessageAt: 0
}

describe('study space timer progress (exam / countup)', () => {
  it('fills ring against session targetSeconds for countup exam, not focusMinutes 25', () => {
    // 15 minutes elapsed into a 3h exam window
    const elapsed = 15 * 60
    const target = 180 * 60
    const snapshot = {
      ...defaultStudySnapshot,
      focusMinutes: 25,
      breakMinutes: 0,
      timerMode: 'focus' as const,
      timerState: 'running' as const,
      remainingSeconds: elapsed,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00'
    }
    const vm = createStudySpaceViewModel(snapshot, offlinePresence, Date.now(), {
      timerClockMode: 'countup',
      timerTargetSeconds: target
    })
    // 15 / 180 = 8.333… → 8%
    expect(vm.timerProgress).toBe(8)
    // Open continuous / missing target: indeterminate — no fake focusMinutes ring
    const openContinuous = createStudySpaceViewModel(snapshot, offlinePresence, Date.now(), {
      timerClockMode: 'countup'
    })
    expect(openContinuous.timerProgress).toBe(0)
  })

  it('projectTimerProgressPercent uses targetSeconds for countup', () => {
    expect(
      projectTimerProgressPercent({
        remainingSeconds: 15 * 60,
        targetSeconds: 180 * 60,
        focusMinutes: 25,
        breakMinutes: 0,
        timerMode: 'focus',
        clockMode: 'countup'
      })
    ).toBe(8)
  })

  it('open continuous countup returns 0% without positive target (no focusMinutes fake ring)', () => {
    expect(
      projectTimerProgressPercent({
        remainingSeconds: 15 * 60,
        targetSeconds: null,
        focusMinutes: 25,
        breakMinutes: 0,
        timerMode: 'focus',
        clockMode: 'countup',
        timerState: 'running'
      })
    ).toBe(0)
    expect(
      projectTimerProgressPercent({
        remainingSeconds: 15 * 60,
        targetSeconds: 0,
        focusMinutes: 25,
        breakMinutes: 0,
        timerMode: 'focus',
        clockMode: 'countup',
        timerState: 'paused'
      })
    ).toBe(0)
    expect(
      projectTimerProgressPercent({
        remainingSeconds: 0,
        targetSeconds: undefined,
        focusMinutes: 25,
        breakMinutes: 0,
        timerMode: 'focus',
        clockMode: 'countup',
        timerState: 'idle'
      })
    ).toBe(0)
  })

  it('idle countup stays 0% when remainingSeconds is seeded to total', () => {
    const snapshot = {
      ...defaultStudySnapshot,
      focusMinutes: 180,
      breakMinutes: 0,
      timerMode: 'focus' as const,
      timerState: 'idle' as const,
      remainingSeconds: 180 * 60
    }
    const vm = createStudySpaceViewModel(snapshot, offlinePresence, Date.now(), {
      timerClockMode: 'countup',
      timerTargetSeconds: 180 * 60
    })
    expect(vm.timerProgress).toBe(0)
  })

  it('paused countup still fills from elapsed remainingSeconds', () => {
    const snapshot = {
      ...defaultStudySnapshot,
      focusMinutes: 25,
      breakMinutes: 0,
      timerMode: 'focus' as const,
      timerState: 'paused' as const,
      remainingSeconds: 15 * 60
    }
    const vm = createStudySpaceViewModel(snapshot, offlinePresence, Date.now(), {
      timerClockMode: 'countup',
      timerTargetSeconds: 180 * 60
    })
    expect(vm.timerProgress).toBe(8)
  })
})

