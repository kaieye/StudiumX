import { spawn } from 'node:child_process'
import { forwardSignal } from './dev-process-tree.mjs'

const electronViteCommand = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
const child = spawn(electronViteCommand, ['dev'], {
  stdio: 'inherit',
  // Put the launcher and the Electron process it creates in their own group so
  // one signal can terminate the complete development process tree.
  detached: process.platform !== 'win32',
  windowsHide: false
})

let stopping = false
let requestedSignal = null
let forceTimer
let groupMonitor

function stop(signal) {
  if (!child.pid) return

  if (stopping) {
    forwardSignal(child.pid, 'SIGKILL')
    return
  }

  stopping = true
  requestedSignal = signal
  forwardSignal(child.pid, signal)

  // electron-vite itself exits as soon as it receives SIGINT, while Electron
  // may still be flushing its own async shutdown. Keep the wrapper alive until
  // the entire process group is gone, with a bounded hard-kill fallback.
  if (process.platform !== 'win32') {
    groupMonitor = setInterval(() => {
      if (!isProcessGroupAlive(child.pid)) finish()
    }, 100)
  }
  forceTimer = setTimeout(() => {
    forwardSignal(child.pid, 'SIGKILL')
    finish()
  }, 5_000)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => stop(signal))
}

child.once('error', (error) => {
  console.error(`Failed to start electron-vite: ${error.message}`)
  finish(1)
})

child.once('exit', (code, signal) => {
  if (!stopping) {
    finish(signal ? 128 + signalNumber(signal) : code ?? 1)
  }
  // During a signal-driven stop, the process-group monitor/fallback owns the
  // final exit so Electron descendants cannot be orphaned when electron-vite
  // exits first.
})

function isProcessGroupAlive(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

function finish(code) {
  if (groupMonitor) clearInterval(groupMonitor)
  if (forceTimer) clearTimeout(forceTimer)
  if (code === undefined) {
    process.exitCode = requestedSignal ? 128 + signalNumber(requestedSignal) : 0
  } else {
    process.exitCode = code
  }
}

function signalNumber(signal) {
  return { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }[signal] ?? 1
}
