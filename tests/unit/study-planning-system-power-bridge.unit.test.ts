/**
 * System power bridge + OS→wake mapping (IMPL-B / ADR-0129 §4).
 * Fake emitter only — no real OS sleep in CI.
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  installSystemPowerBridge,
  type SystemPowerWindowLike
} from '../../src/main/system-power-bridge'
import { teachingEventChannels } from '../../src/shared/teaching-ipc-contract'
import {
  mapSystemPowerToTimerWakeSignal,
  subscribePlanningTimerOsPower
} from '../../src/renderer/src/study-space/planning-timer-os-power'
import {
  projectTimerSessionAfterWake,
  shouldHandleTimerWakeSignal
} from '../../src/renderer/src/study-space/planning-timer-sleep-hooks'
import {
  createClassicPomodoroPlan,
  startTimerSession,
  type TimerSessionRecord
} from '../../src/shared/study-planning'

const t0 = 5_000_000

function startFocus(nowMs = t0): TimerSessionRecord {
  return startTimerSession({
    id: 'os-wake-1',
    nowMs,
    plan: createClassicPomodoroPlan(),
    taskId: 'task-a'
  }).session!
}

function fakeWindow(): SystemPowerWindowLike & { sends: Array<{ channel: string; payload: unknown }> } {
  const sends: Array<{ channel: string; payload: unknown }> = []
  return {
    sends,
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        sends.push({ channel, payload })
      }
    }
  }
}

describe('system-power-bridge (main fan-out)', () => {
  it('broadcasts suspend/resume to all live windows on channel systemPower', () => {
    const source = new EventEmitter()
    const w1 = fakeWindow()
    const w2 = fakeWindow()
    let clock = t0
    const dispose = installSystemPowerBridge({
      source,
      getWindows: () => [w1, w2],
      nowMs: () => clock
    })

    source.emit('suspend')
    expect(w1.sends).toEqual([
      { channel: teachingEventChannels.systemPower, payload: { kind: 'suspend', atMs: t0 } }
    ])
    expect(w2.sends).toHaveLength(1)
    expect(w2.sends[0]?.payload).toEqual({ kind: 'suspend', atMs: t0 })

    clock = t0 + 60_000
    source.emit('resume')
    expect(w1.sends[1]?.payload).toEqual({ kind: 'resume', atMs: t0 + 60_000 })
    expect(w2.sends).toHaveLength(2)

    dispose()
    source.emit('suspend')
    expect(w1.sends).toHaveLength(2)
  })

  it('skips destroyed windows and is idempotent dispose', () => {
    const source = new EventEmitter()
    const live = fakeWindow()
    const dead: SystemPowerWindowLike = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn()
      }
    }
    const dispose = installSystemPowerBridge({
      source,
      getWindows: () => [live, dead],
      nowMs: () => t0
    })
    source.emit('resume')
    expect(live.sends).toHaveLength(1)
    expect(dead.webContents.send).not.toHaveBeenCalled()
    dispose()
    dispose()
  })
})

describe('planning-timer-os-power (renderer map + subscribe)', () => {
  it('maps suspend→pagehide and resume→visibility_resume', () => {
    expect(mapSystemPowerToTimerWakeSignal({ kind: 'suspend', atMs: t0 })).toEqual({
      kind: 'pagehide',
      nowMs: t0
    })
    expect(mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs: t0 + 1 })).toEqual({
      kind: 'visibility_resume',
      nowMs: t0 + 1,
      visibilityState: 'visible'
    })
    expect(mapSystemPowerToTimerWakeSignal(null)).toBeNull()
    expect(mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs: Number.NaN })).toBeNull()
  })

  it('subscribe forwards mapped wake signals and unsubscribes', () => {
    const wakes: unknown[] = []
    let handler: ((e: { kind: 'suspend' | 'resume'; atMs: number }) => void) | null = null
    const off = vi.fn()
    const api = {
      onSystemPower: (h: (e: { kind: 'suspend' | 'resume'; atMs: number }) => void) => {
        handler = h
        return off
      }
    }
    const dispose = subscribePlanningTimerOsPower({
      api,
      onWake: (s) => wakes.push(s)
    })
    expect(handler).toBeTruthy()
    handler!({ kind: 'suspend', atMs: t0 })
    handler!({ kind: 'resume', atMs: t0 + 100 })
    expect(wakes).toEqual([
      { kind: 'pagehide', nowMs: t0 },
      { kind: 'visibility_resume', nowMs: t0 + 100, visibilityState: 'visible' }
    ])
    dispose()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('subscribe no-ops when API missing', () => {
    const dispose = subscribePlanningTimerOsPower({
      api: null,
      onWake: () => {
        throw new Error('should not fire')
      }
    })
    dispose()
  })

  it('OS suspend pin + long resume still needs_reconcile (no silent credit)', () => {
    const session = startFocus(t0)
    const suspendSignal = mapSystemPowerToTimerWakeSignal({ kind: 'suspend', atMs: t0 + 1000 })!
    expect(shouldHandleTimerWakeSignal(suspendSignal)).toBe(true)
    const pin = projectTimerSessionAfterWake({ session, signal: suspendSignal })
    expect(pin.type).toBe('advance_ok')
    if (pin.type === 'advance_ok') {
      expect(pin.pinDurableAdvance).toBe(true)
      expect(pin.needsReconcile).toBe(false)
    }

    // >120 min wall gap after suspend sample
    const longMs = t0 + 121 * 60 * 1000
    const resumeSignal = mapSystemPowerToTimerWakeSignal({ kind: 'resume', atMs: longMs })!
    const wake = projectTimerSessionAfterWake({ session, signal: resumeSignal })
    expect(wake.type).toBe('advance_ok')
    if (wake.type === 'advance_ok') {
      expect(wake.needsReconcile).toBe(true)
      expect(wake.pinDurableAdvance).toBe(true)
    }
  })
})
