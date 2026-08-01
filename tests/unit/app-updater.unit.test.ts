import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, once: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  Notification: { isSupported: vi.fn(() => false) }
}))

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {}
  }
}))

import { createAppUpdaterController } from '../../src/main/app-updater'

type Handler = (...args: unknown[]) => void

function createHarness(options: {
  packaged?: boolean
  check?: (handlers: Map<string, Handler>) => Promise<unknown>
} = {}) {
  const handlers = new Map<string, Handler>()
  const emit = vi.fn()
  const notifyUpdateReady = vi.fn()
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
    checkForUpdates: vi.fn(() =>
      options.check
        ? options.check(handlers)
        : Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '0.0.1' } })
    ),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler)
    }),
    quitAndInstall: vi.fn()
  }
  const logger = { warn: vi.fn() }
  const controller = createAppUpdaterController({
    app,
    updater,
    scheduler: { setInterval, clearInterval },
    logger,
    emit,
    notifyUpdateReady
  })

  return { app, updater, logger, handlers, intervalToken, setInterval, clearInterval, controller, emit, notifyUpdateReady }
}

describe('createAppUpdaterController', () => {
  it('does nothing for unpackaged development runs', () => {
    const harness = createHarness({ packaged: false })

    harness.controller.start()

    expect(harness.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(harness.updater.on).not.toHaveBeenCalled()
    expect(harness.setInterval).not.toHaveBeenCalled()
  })

  it('explains why a manual update check is unavailable in development', async () => {
    const harness = createHarness({ packaged: false })

    await harness.controller.checkNow()

    expect(harness.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(harness.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', message: expect.stringContaining('开发版本') })
    )
  })

  it('checks immediately and schedules future production checks', async () => {
    const harness = createHarness()

    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.updater.autoDownload).toBe(false)
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

  it('surfaces a found update as an ask-to-download state', async () => {
    const harness = createHarness({ check: () => Promise.resolve({ isUpdateAvailable: true, updateInfo: { version: '0.0.2' } }) })

    await harness.controller.checkNow()

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'checking', manual: true })
    expect(harness.emit).toHaveBeenCalledWith({ kind: 'available', version: '0.0.2' })
  })

  it('confirms a manually requested check when the installed version is current', async () => {
    const harness = createHarness({
      check: (handlers) => {
        handlers.get('update-not-available')?.({})
        return Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '0.0.1' } })
      }
    })

    await harness.controller.checkNow()

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'not-available' })
  })

  it('keeps the scheduled background check silent when no update is available', async () => {
    const harness = createHarness({
      check: (handlers) => {
        handlers.get('update-not-available')?.({})
        return Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '0.0.1' } })
      }
    })

    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'idle' })
    expect(harness.emit).not.toHaveBeenCalledWith({ kind: 'not-available' })
  })

  it('does not pop the dialog when the installed version is already current', async () => {
    // electron-updater 6.x resolves with { isUpdateAvailable: false } (not null)
    // when the app is up to date; it must not be misread as a new release.
    const harness = createHarness({
      check: (handlers) => {
        handlers.get('update-not-available')?.({ version: '0.0.7' })
        return Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '0.0.7' } })
      }
    })

    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.emit).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'available' }))
    expect(harness.emit).toHaveBeenCalledWith({ kind: 'idle' })
  })

  it('does not download until the user explicitly asks to', async () => {
    const harness = createHarness({ check: () => Promise.resolve({ isUpdateAvailable: true, updateInfo: { version: '0.0.2' } }) })

    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('starts a download on explicit action and streams progress states', async () => {
    const harness = createHarness({ check: () => Promise.resolve({ isUpdateAvailable: true, updateInfo: { version: '0.0.2' } }) })
    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))

    const download = harness.controller.act('download')
    await Promise.resolve()

    expect(harness.updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(harness.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'downloading', version: '0.0.2', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } })
    )

    harness.handlers.get('download-progress')?.({ percent: 42, transferred: 84, total: 200, bytesPerSecond: 10 })
    expect(harness.emit).toHaveBeenCalledWith({
      kind: 'downloading',
      version: '0.0.2',
      progress: { percent: 42, transferred: 84, total: 200, bytesPerSecond: 10 }
    })
    await download
  })

  it('surfaces a download failure instead of only logging it', async () => {
    const harness = createHarness({ check: () => Promise.resolve({ isUpdateAvailable: true, updateInfo: { version: '0.0.2' } }) })
    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.updater.downloadUpdate.mockRejectedValue(new Error('network'))

    await harness.controller.act('download')

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'error', message: 'network' })
    expect(harness.logger.warn).toHaveBeenCalled()
  })

  it('emits a restart prompt and nudges a hidden window when the download finishes', async () => {
    const harness = createHarness({ check: () => Promise.resolve({ isUpdateAvailable: true, updateInfo: { version: '0.0.2' } }) })
    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))

    harness.handlers.get('update-downloaded')?.({ version: '0.0.2' })

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'downloaded', version: '0.0.2' })
    expect(harness.notifyUpdateReady).toHaveBeenCalledTimes(1)
  })

  it('restarts only after explicit user confirmation', async () => {
    const harness = createHarness()
    harness.controller.start()

    harness.handlers.get('update-downloaded')?.({ version: '0.0.2' })
    expect(harness.updater.quitAndInstall).not.toHaveBeenCalled()

    await harness.controller.act('restart')
    expect(harness.updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('reminds to restart instead of re-asking when an already-downloaded version is found again', async () => {
    const harness = createHarness({ check: () => Promise.resolve({ isUpdateAvailable: true, updateInfo: { version: '0.0.2' } }) })
    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.handlers.get('update-downloaded')?.({ version: '0.0.2' })

    const scheduledCheck = harness.setInterval.mock.calls[0]?.[0]
    scheduledCheck?.()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'downloaded', version: '0.0.2' })
  })

  it('hides the dialog on dismiss while a background download may continue', async () => {
    const harness = createHarness()
    harness.controller.start()

    await harness.controller.act('dismiss')

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'idle' })
  })

  it('opens the update dialog without starting a network check', () => {
    const harness = createHarness()

    harness.controller.openDialog()

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'menu' })
    expect(harness.updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('runs a manual check from the dialog check button', async () => {
    const harness = createHarness({ check: () => Promise.resolve({ isUpdateAvailable: true, updateInfo: { version: '0.0.2' } }) })

    await harness.controller.act('check')

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'checking', manual: true })
    expect(harness.emit).toHaveBeenCalledWith({ kind: 'available', version: '0.0.2' })
  })

  it('explains that a packaged build is required when checking from the dialog in development', async () => {
    const harness = createHarness({ packaged: false })

    await harness.controller.act('check')

    expect(harness.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(harness.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', message: expect.stringContaining('开发版本') })
    )
  })

  it('re-checks when the user retries', async () => {
    const harness = createHarness({ check: () => Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '0.0.1' } }) })
    harness.controller.start()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(harness.updater.checkForUpdates).toHaveBeenCalledTimes(1)

    await harness.controller.act('retry')

    expect(harness.updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(harness.emit).toHaveBeenCalledWith({ kind: 'checking', manual: true })
  })

  it('does not surface states or start another check after shutdown begins', async () => {
    const harness = createHarness()
    harness.controller.start()

    const stop = harness.app.once.mock.calls[0]?.[1]
    stop?.()
    harness.handlers.get('update-downloaded')?.({})
    const scheduledCheck = harness.setInterval.mock.calls[0]?.[0]
    scheduledCheck?.()
    await Promise.resolve()

    expect(harness.emit).not.toHaveBeenCalled()
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

  it('reports a manually requested check failure instead of only logging it', async () => {
    const harness = createHarness({ check: () => Promise.reject(new Error('offline')) })

    await harness.controller.checkNow()

    expect(harness.emit).toHaveBeenCalledWith({ kind: 'error', message: 'offline' })
  })
})
