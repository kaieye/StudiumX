/**
 * Main-process OS powerMonitor → renderer fan-out bridge (ADR-0011).
 *
 * Broadcasts suspend/resume as `teachingEventChannels.systemPower` only.
 * Does NOT call DurableStudyPlanningStore / advance TimerSession —
 * pin stays renderer dual-write with existing workspace context.
 */

import { BrowserWindow, powerMonitor } from 'electron'
import {
  teachingEventChannels,
  type SystemPowerEvent
} from '../shared/teaching-ipc-contract'

export type SystemPowerEmitter = {
  on(event: 'suspend' | 'resume', listener: () => void): unknown
  removeListener?(event: 'suspend' | 'resume', listener: () => void): unknown
  off?(event: 'suspend' | 'resume', listener: () => void): unknown
}

export type SystemPowerWindowLike = {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send(channel: string, payload: unknown): void
  }
}

export type InstallSystemPowerBridgeOptions = {
  /** Injected emitter for unit tests (fake EventEmitter). Defaults to Electron powerMonitor. */
  source?: SystemPowerEmitter
  /** Injected window list; defaults to BrowserWindow.getAllWindows(). */
  getWindows?: () => readonly SystemPowerWindowLike[]
  /** Wall clock for payload.atMs. */
  nowMs?: () => number
}

/**
 * Register suspend/resume listeners and broadcast to all live windows.
 * @returns dispose function (idempotent).
 */
export function installSystemPowerBridge(
  options: InstallSystemPowerBridgeOptions = {}
): () => void {
  const source: SystemPowerEmitter = options.source ?? powerMonitor
  const getWindows =
    options.getWindows ??
    (() => BrowserWindow.getAllWindows() as unknown as readonly SystemPowerWindowLike[])
  const nowMs = options.nowMs ?? (() => Date.now())

  let disposed = false

  const broadcast = (kind: SystemPowerEvent['kind']): void => {
    if (disposed) return
    const payload: SystemPowerEvent = { kind, atMs: nowMs() }
    for (const win of getWindows()) {
      if (win.isDestroyed()) continue
      const sender = win.webContents
      if (sender.isDestroyed()) continue
      try {
        sender.send(teachingEventChannels.systemPower, payload)
      } catch {
        // Best-effort: destroyed races are ignored.
      }
    }
  }

  const onSuspend = (): void => {
    broadcast('suspend')
  }
  const onResume = (): void => {
    broadcast('resume')
  }

  source.on('suspend', onSuspend)
  source.on('resume', onResume)

  return () => {
    if (disposed) return
    disposed = true
    const remove = source.removeListener ?? source.off
    if (typeof remove === 'function') {
      try {
        remove.call(source, 'suspend', onSuspend)
        remove.call(source, 'resume', onResume)
      } catch {
        // ignore
      }
    }
  }
}
