import { describe, expect, it, vi } from 'vitest'

import { forwardSignal } from '../../scripts/dev-process-tree.mjs'

describe('dev process tree signal forwarding', () => {
  it('signals the whole detached process group on macOS/Linux', () => {
    const killProcess = vi.fn()

    forwardSignal(1234, 'SIGINT', {
      platform: 'darwin',
      killProcess
    })

    expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGINT')
  })

  it('falls back to the child pid when the process group is unavailable', () => {
    const killProcess = vi.fn(() => {
      throw Object.assign(new Error('no process group'), { code: 'ESRCH' })
    })

    forwardSignal(1234, 'SIGTERM', {
      platform: 'linux',
      killProcess
    })

    expect(killProcess).toHaveBeenNthCalledWith(1, -1234, 'SIGTERM')
    expect(killProcess).toHaveBeenNthCalledWith(2, 1234, 'SIGTERM')
  })

  it('uses taskkill recursively on Windows', () => {
    const spawnProcess = vi.fn(() => ({ unref: vi.fn() }))

    forwardSignal(1234, 'SIGINT', {
      platform: 'win32',
      spawnProcess
    })

    expect(spawnProcess).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '1234', '/t', '/f'],
      { stdio: 'ignore', windowsHide: true }
    )
  })
})
