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
    // Without target override, stale 25-minute shell would claim 60%
    const wrong = createStudySpaceViewModel(snapshot, offlinePresence, Date.now(), {
      timerClockMode: 'countup'
    })
    expect(wrong.timerProgress).toBe(60)
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

