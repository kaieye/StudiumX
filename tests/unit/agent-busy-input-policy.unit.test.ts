import { describe, expect, it } from 'vitest'
import {
  canInjectQueuedInput,
  DEFAULT_BUSY_INPUT_ACTION,
  resolveBusyInputAction
} from '../../src/main/ai/agent-busy-input-policy'

describe('agent busy input policy', () => {
  it('defaults busy user input to queue and never treats queue as abort', () => {
    expect(DEFAULT_BUSY_INPUT_ACTION).toBe('queue')
    const decision = resolveBusyInputAction({
      busy: true,
      phase: 'provider'
    })
    expect(decision).toEqual({
      action: 'queue',
      reason: 'busy_default_queue',
      steerAllowed: false,
      abortsRun: false
    })
  })

  it('accepts idle input and keeps interrupt as the only abort path', () => {
    expect(resolveBusyInputAction({ busy: false, phase: 'idle' }).action).toBe('accept')
    const interrupt = resolveBusyInputAction({
      busy: true,
      phase: 'provider',
      preferredAction: 'interrupt'
    })
    expect(interrupt).toMatchObject({ action: 'interrupt', abortsRun: true })
    const steer = resolveBusyInputAction({
      busy: true,
      phase: 'turn_boundary',
      preferredAction: 'steer'
    })
    expect(steer).toMatchObject({ action: 'steer', abortsRun: false, steerAllowed: true })
  })

  it('forbids steer inject during write/privileged tools and demotes to queue', () => {
    for (const phase of ['write_tool', 'privileged_tool'] as const) {
      const decision = resolveBusyInputAction({
        busy: true,
        phase,
        preferredAction: 'steer'
      })
      expect(decision).toMatchObject({
        action: 'queue',
        reason: 'busy_write_no_steer',
        steerAllowed: false,
        abortsRun: false
      })
      expect(canInjectQueuedInput(phase, 'steer')).toBe(false)
    }
  })

  it('demotes unsafe steer preference to queue and routes stranded input to queue', () => {
    expect(resolveBusyInputAction({
      busy: true,
      phase: 'tool_batch',
      preferredAction: 'steer'
    })).toMatchObject({ action: 'queue', reason: 'steer_demoted_to_queue', abortsRun: false })

    expect(resolveBusyInputAction({
      busy: true,
      phase: 'provider',
      inputKind: 'stranded'
    })).toMatchObject({ action: 'queue', reason: 'stranded_to_queue', abortsRun: false })

    expect(resolveBusyInputAction({
      busy: true,
      phase: 'provider',
      inputKind: 'stranded',
      queueAtCapacity: true
    })).toMatchObject({ action: 'reject', reason: 'stranded_queue_full' })
  })

  it('only allows steer injection at turn_boundary', () => {
    expect(canInjectQueuedInput('turn_boundary', 'steer')).toBe(true)
    expect(canInjectQueuedInput('provider', 'steer')).toBe(false)
    expect(canInjectQueuedInput('tool_batch', 'follow_up')).toBe(false)
    expect(canInjectQueuedInput('idle', 'follow_up')).toBe(true)
    expect(canInjectQueuedInput('turn_boundary', 'follow_up')).toBe(true)
  })
})
