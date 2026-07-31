import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'

// electron-updater is published as CommonJS. Import its default namespace so
// Electron's native ESM loader can load it reliably in both development and
// packaged builds.
const { autoUpdater } = electronUpdater

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

type UpdateEvent = 'update-downloaded' | 'error'

type UpdateChecker = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  on(event: UpdateEvent, listener: (payload: unknown) => void): unknown
  quitAndInstall(): void
}

type PackagedApp = {
  isPackaged: boolean
  once(event: 'before-quit', listener: () => void): unknown
}

type UpdateDialog = {
  showMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue>
}

type UpdateScheduler = {
  setInterval(callback: () => void, delay: number): ReturnType<typeof setInterval>
  clearInterval(timer: ReturnType<typeof setInterval>): void
}

type UpdateLogger = Pick<Console, 'warn'>

export type AppUpdaterController = {
  start(): void
  stop(): void
  /** Runs one explicit update check. No network request is made in development. */
  checkNow(): Promise<void>
}

export type AppUpdaterDependencies = {
  app: PackagedApp
  updater: UpdateChecker
  dialog: UpdateDialog
  scheduler?: UpdateScheduler
  logger?: UpdateLogger
}

/**
 * Builds the packaged-app update lifecycle.
 *
 * The initial check is intentionally non-blocking, then a long-running app
 * checks again every six hours. This mirrors the production desktop updater
 * cadence while keeping development runs and unpackaged builds fully offline.
 */
export function createAppUpdaterController({
  app: currentApp,
  updater,
  dialog: currentDialog,
  scheduler = globalThis,
  logger = console
}: AppUpdaterDependencies): AppUpdaterController {
  let hasStarted = false
  let checkInFlight = false
  let activeCheck: Promise<void> | null = null
  let updatePromptShown = false
  let hasStopped = false
  let interval: ReturnType<typeof setInterval> | undefined

  const checkForUpdates = (): Promise<void> => {
    if (hasStopped || !currentApp.isPackaged) return Promise.resolve()
    if (checkInFlight) {
      const inFlightCheck = activeCheck
      return inFlightCheck ?? Promise.resolve()
    }
    checkInFlight = true
    const nextCheck = (updater
      .checkForUpdates()
      .catch((error: unknown): void => {
        // A failed check must not block startup. The next scheduled check retries it.
        logger.warn('[updater] Update check failed:', error)
      }) as Promise<void>)
      .finally(() => {
        checkInFlight = false
        activeCheck = null
      })
    activeCheck = nextCheck
    return nextCheck
  }

  const stop = (): void => {
    hasStopped = true
    if (interval === undefined) return
    scheduler.clearInterval(interval)
    interval = undefined
  }

  const start = (): void => {
    if (hasStarted || hasStopped || !currentApp.isPackaged) return
    hasStarted = true

    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true

    updater.on('update-downloaded', () => {
      // electron-updater can re-emit this event after a retry. Keep one
      // restart prompt per application session.
      if (hasStopped || updatePromptShown) return
      updatePromptShown = true

      void currentDialog
        .showMessageBox({
          type: 'info',
          buttons: ['立即重启更新', '稍后'],
          defaultId: 0,
          cancelId: 1,
          title: 'StudiumX 更新已就绪',
          message: '新版本已下载完成，重启后即可完成更新。',
          detail: '选择“稍后”时，StudiumX 会在下次退出后自动安装更新。'
        })
        .then(({ response }) => {
          if (response === 0) updater.quitAndInstall()
        })
        .catch((error: unknown) => {
          logger.warn('[updater] Unable to show the update prompt:', error)
        })
    })

    updater.on('error', (error) => {
      // A failed check or download must never block the app from opening.
      logger.warn('[updater] Update error:', error)
    })

    void checkForUpdates()
    interval = scheduler.setInterval(() => {
      void checkForUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)
    currentApp.once('before-quit', stop)
  }

  return {
    start,
    stop,
    checkNow(): Promise<void> {
      if (hasStopped || !currentApp.isPackaged) return Promise.resolve()
      start()
      return checkForUpdates()
    }
  }
}

let controller: AppUpdaterController | undefined

/**
 * Starts automatic updates for the production application singleton.
 * Development runs deliberately do not contact GitHub: there is no generated
 * update manifest and a local build must never replace itself with a release.
 */
export function startAppUpdateCheck(): void {
  controller ??= createAppUpdaterController({
    app,
    updater: autoUpdater,
    dialog
  })
  controller.start()
}

/**
 * Handles an explicit renderer request to check for an app update. The same
 * in-flight request is shared with the scheduled checker, so rapid clicks do
 * not create concurrent release-feed requests.
 */
export function checkForAppUpdates(): Promise<void> {
  controller ??= createAppUpdaterController({
    app,
    updater: autoUpdater,
    dialog
  })
  controller.start()
  return controller.checkNow()
}
