import { spawn } from 'node:child_process'

/**
 * Forward a termination signal to the complete process tree created by the
 * dev launcher. On POSIX, electron-vite and Electron share the detached
 * child's process group. Windows uses taskkill's tree mode instead.
 *
 * The injectable dependencies keep this boundary deterministic and testable
 * without starting real processes.
 */
export function forwardSignal(
  pid,
  signal,
  {
    platform = process.platform,
    killProcess = process.kill,
    spawnProcess = spawn
  } = {}
) {
  if (!pid) return

  if (platform === 'win32') {
    const taskkill = spawnProcess(
      'taskkill',
      ['/pid', String(pid), '/t', '/f'],
      { stdio: 'ignore', windowsHide: true }
    )
    taskkill.unref?.()
    return
  }

  try {
    // A detached child is the process-group leader. Negative PIDs address the
    // group, ensuring electron-vite and its Electron child exit together.
    killProcess(-pid, signal)
  } catch {
    // If the group disappeared between lookup and delivery, still try the
    // direct child so this helper remains safe for non-detached callers.
    try {
      killProcess(pid, signal)
    } catch {
      // The process already exited; there is nothing left to terminate.
    }
  }
}
