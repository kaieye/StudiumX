/**
 * OS powerMonitor signal → STC-206 timer wake mapping (renderer).
 *
 * Main only broadcasts suspend/resume; durable pin / reconcile stay on the
 * existing applyTimerWakeAction path (ADR-0117 invoke CAS + ADR-0094 #5).
 *
 * Mapping (fail-closed, no new timer engine):
 * - suspend → pagehide-like pin (best-effort wall sample, never finish)
 * - resume  → visibility_resume-like re-sample (long gap → needs_reconcile)
 */

import type { SystemPowerEvent } from '../../../shared/teaching-ipc-contract'
import type { TimerWakeSignal } from './planning-timer-sleep-hooks'

export type SystemPowerSubscribeApi = {
  onSystemPower?: (handler: (event: SystemPowerEvent) => void) => () => void
}

/** Map main systemPower payload to existing TimerWakeSignal kinds. */
export function mapSystemPowerToTimerWakeSignal(
  event: SystemPowerEvent | null | undefined
): TimerWakeSignal | null {
  if (!event || (event.kind !== 'suspend' && event.kind !== 'resume')) return null
  if (!Number.isFinite(event.atMs)) return null
  if (event.kind === 'suspend') {
    return { kind: 'pagehide', nowMs: event.atMs }
  }
  return {
    kind: 'visibility_resume',
    nowMs: event.atMs,
    visibilityState: 'visible'
  }
}

/**
 * Subscribe once to OS power events and forward as timer wake signals.
 * No-op when preload API is missing (browser/dev without bridge).
 */
export function subscribePlanningTimerOsPower(input: {
  api?: SystemPowerSubscribeApi | null
  onWake: (signal: TimerWakeSignal) => void
}): () => void {
  const subscribe = input.api?.onSystemPower
  if (typeof subscribe !== 'function') return () => {}
  try {
    return subscribe((event) => {
      const signal = mapSystemPowerToTimerWakeSignal(event)
      if (!signal) return
      input.onWake(signal)
    })
  } catch {
    // Browser adapters expose unsupported event bridges as throwing methods.
    // Timer wake handling is an optional native enhancement, so a missing
    // bridge must not prevent the shared study UI from mounting.
    return () => {}
  }
}
