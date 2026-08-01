import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, once: vi.fn() },
  dialog: { showMessageBox: vi.fn() }
}))

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {}
  }
}))

import { createAppUpdaterController } from '../../src/main/app-updater'

type Handler = (payload: unknown) => void

function createHarness(options: { packaged?: boolean; check?: () => Promise<unknown> } = {}) {
  const handlers = new Map<string, Handler>()
  const setInterval = vi.fn<(callback: () => void, delay: number) => ReturnType<typeof setInterval>>()
  const clearInterval = vi.fn<(timer: ReturnType<typeof setInterval>) => void>()
  const intervalToken = {} as ReturnType<typeof setInterval>
  setInterval.mockReturnValue(intervalToken)
  const app = {
    isPackaged: options.packaged ?? true,
    once: vi.fn()
  }
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(options.check ?? (() => Promise.resolve(undefined))),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler)
    }),
    quitAndInstall: vi.fn()
  }
  const dialog = {
    showMessageBox: vi.fn(() => Promise.resolve({ response: 1 }))
  }
  const logger = { warn: vi.fn() }
  const controller = createAppUpdaterController({
    app,
    updater,
    dialog,
    scheduler: { setInterval, clearInterval },
    logger
  })

  return { app, updater, dialog, logger, handlers, intervalToken, setInterval, clearInterval, controller }
}

describe('createAppUpdaterController', () => {
  it('does nothing for unpackaged development runs', () => {
    const harness = createHarness({ packaged: false })

    harness.controller.start()

    expect(harness.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(harness.updater.on).not.toHaveBeenCalled()
    expect(harness.setInterval).not.toHaveBeenCalled()
  })

  it('checks immediately and schedules future production checks', async () => {
    const harness = createHarness()

    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.updater.autoDownload).toBe(true)
    expect(harness.updater.autoInstallOnAppQuit).toBe(true)
    expect(harness.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(harness.setInterval).toHaveBeenCalledWith(expect.any(Function), 6 * 60 * 60 * 1_000)
    expect(harness.app.once).toHaveBeenCalledWith('before-quit', expect.any(Function))

    const scheduledCheck = harness.setInterval.mock.calls[0]?.[0]
    scheduledCheck?.()
    expect(harness.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('does not overlap update checks while a previous check is in flight', async () => {
    let resolveCheck: (() => void) | undefined
    const harness = createHarness({
      check: () =>
        new Promise<void>((resolve) => {
          resolveCheck = resolve
        })
    })

    harness.controller.start()
    const scheduledCheck = harness.setInterval.mock.calls[0]?.[0]
    scheduledCheck?.()
    expect(harness.updater.checkForUpdates).toHaveBeenCalledTimes(1)

    resolveCheck?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
    scheduledCheck?.()
    expect(harness.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('shares the scheduled check with an explicit user-triggered check', async () => {
    let resolveCheck: (() => void) | undefined
    const harness = createHarness({
      check: () =>
        new Promise<void>((resolve) => {
          resolveCheck = resolve
        })
    })

    harness.controller.start()
    const explicitCheck = harness.controller.checkNow()
    expect(harness.updater.checkForUpdates).toHaveBeenCalledTimes(1)

    resolveCheck?.()
    await explicitCheck
  })

  it('confirms a manually requested check when the installed version is current', async () => {
    const harness = createHarness()

    await harness.controller.checkNow()

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: 'StudiumX 已是最新版本',
      message: '当前安装的版本已经是最新版本。'
    }))
  })

  it('acknowledges a discovered update immediately instead of waiting silently for download completion', async () => {
    const harness = createHarness({
      check: () => Promise.resolve({ updateInfo: { version: '0.0.2' } })
    })

    await harness.controller.checkNow()

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: '发现 StudiumX 更新',
      message: expect.stringContaining('0.0.2')
    }))
  })

  it('reports a manually requested check failure instead of only logging it', async () => {
    const harness = createHarness({ check: () => Promise.reject(new Error('offline')) })

    await harness.controller.checkNow()

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: '无法检查 StudiumX 更新'
    }))
  })

  it('prompts once after a download and restarts only after user confirmation', async () => {
    const harness = createHarness()
    harness.dialog.showMessageBox.mockResolvedValue({ response: 0 })
    harness.controller.start()

    harness.handlers.get('update-downloaded')?.({})
    await Promise.resolve()
    await Promise.resolve()
    harness.handlers.get('update-downloaded')?.({})
    await Promise.resolve()

    expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(harness.updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does not prompt or start another check after shutdown begins', async () => {
    const harness = createHarness()
    harness.controller.start()

    const stop = harness.app.once.mock.calls[0]?.[1]
    stop?.()
    harness.handlers.get('update-downloaded')?.({})
    const scheduledCheck = harness.setInterval.mock.calls[0]?.[0]
    scheduledCheck?.()
    await Promise.resolve()

    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled()
    expect(harness.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('logs failed checks and stops future checks during quit', async () => {
    const failure = new Error('offline')
    const harness = createHarness({ check: () => Promise.reject(failure) })
    harness.controller.start()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.logger.warn).toHaveBeenCalledWith('[updater] Update check failed:', failure)

    const stop = harness.app.once.mock.calls[0]?.[1]
    stop?.()
    expect(harness.clearInterval).toHaveBeenCalledWith(harness.intervalToken)
  })
})
