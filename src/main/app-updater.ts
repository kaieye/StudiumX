import { app, BrowserWindow, Notification } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppUpdateAction, AppUpdateState } from '../shared/teaching-types'
import { teachingEventChannels } from '../shared/teaching-ipc-contract'

// electron-updater is published as CommonJS. Import its default namespace so
// Electron's native ESM loader can load it reliably in both development and
// packaged builds.
const { autoUpdater } = electronUpdater

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

type UpdateInfo = { version?: string }

type ProgressInfo = { percent: number; transferred: number; total: number; bytesPerSecond: number }

type UpdateDownloadedEvent = { version?: string }

type UpdateChecker = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  on(event: 'update-not-available', listener: (info: UpdateInfo) => void): unknown
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): unknown
  on(event: 'update-downloaded', listener: (event: UpdateDownloadedEvent) => void): unknown
  on(event: 'error', listener: (error: Error, message?: string) => void): unknown
  quitAndInstall(): void
}

type PackagedApp = {
  isPackaged: boolean
  once(event: 'before-quit', listener: () => void): unknown
}

type UpdateScheduler = {
  setInterval(callback: () => void, delay: number): ReturnType<typeof setInterval>
  clearInterval(timer: ReturnType<typeof setInterval>): void
}

type UpdateLogger = Pick<Console, 'warn'>

type UpdateEmitter = (state: AppUpdateState) => void

type UpdateNotify = () => void

type UpdateCheckOutcome =
  | { kind: 'available'; version?: string }
  | { kind: 'not-available' }
  | { kind: 'failed' }

export type AppUpdaterController = {
  start(): void
  stop(): void
  /** Runs one explicit update check and reports its result through the state stream. No network request is made in development. */
  checkNow(): Promise<void>
  /** Handles a renderer update-dialog action (check/download/restart/retry/dismiss). */
  act(action: AppUpdateAction): Promise<void>
  /** Opens the update dialog without starting a network check. */
  openDialog(): void
}

export type AppUpdaterDependencies = {
  app: PackagedApp
  updater: UpdateChecker
  scheduler?: UpdateScheduler
  logger?: UpdateLogger
  /** Broadcasts the current update lifecycle state to the renderer. */
  emit?: UpdateEmitter
  /** Called when a download finishes so main can nudge a hidden window. */
  notifyUpdateReady?: UpdateNotify
}

/**
 * Builds the packaged-app update lifecycle.
 *
 * The initial check is intentionally non-blocking, then a long-running app
 * checks again every six hours. Updates are surfaced to the renderer through a
 * state stream (checking → available → downloading → downloaded / error) so the
 * user sees real download progress and any failure instead of a silent native
 * prompt. Downloads are gated behind an explicit user action; nothing is
 * auto-downloaded. Development runs and unpackaged builds stay fully offline.
 */
export function createAppUpdaterController({
  app: currentApp,
  updater,
  scheduler = globalThis,
  logger = console,
  emit = () => {},
  notifyUpdateReady = () => {}
}: AppUpdaterDependencies): AppUpdaterController {
  let hasStarted = false
  let hasStopped = false
  let checkInFlight = false
  let activeCheck: Promise<UpdateCheckOutcome> | null = null
  let downloadInFlight = false
  let interval: ReturnType<typeof setInterval> | undefined
  /** Set while a user-initiated check is outstanding so its result is surfaced. */
  let manualCheckPending = false
  /** Version of the update currently being offered, used to label progress. */
  let pendingVersion: string | undefined
  /** Latest version whose download completed, so re-checks remind instead of re-asking. */
  let downloadedVersion: string | undefined

  const checkForUpdates = (): Promise<UpdateCheckOutcome> => {
    if (hasStopped || !currentApp.isPackaged) return Promise.resolve({ kind: 'not-available' })
    if (checkInFlight) {
      const inFlightCheck = activeCheck
      return inFlightCheck ?? Promise.resolve({ kind: 'not-available' })
    }
    checkInFlight = true
    const nextCheck = updater
      .checkForUpdates()
      .then((result): UpdateCheckOutcome => {
        if (result === null || result === undefined) return { kind: 'not-available' }
        const version = updateVersion(result)
        pendingVersion = version
        // If this version was already downloaded, remind the user to restart
        // rather than asking to download it a second time.
        emit(
          version !== undefined && version === downloadedVersion
            ? { kind: 'downloaded', version }
            : { kind: 'available', version: version ?? '' }
        )
        return { kind: 'available', version }
      })
      .catch((error: unknown): UpdateCheckOutcome => {
        // A failed check must not block startup. The next scheduled check retries it.
        logger.warn('[updater] Update check failed:', error)
        if (manualCheckPending) emit({ kind: 'error', message: errorMessage(error) })
        return { kind: 'failed' }
      })
      .finally(() => {
        checkInFlight = false
        activeCheck = null
      })
    activeCheck = nextCheck
    return nextCheck
  }

  const startDownload = async (): Promise<void> => {
    if (downloadInFlight || hasStopped || !currentApp.isPackaged) return
    downloadInFlight = true
    try {
      emit({
        kind: 'downloading',
        version: pendingVersion ?? '',
        progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }
      })
      await updater.downloadUpdate()
    } catch (error) {
      logger.warn('[updater] Download failed:', error)
      emit({ kind: 'error', message: errorMessage(error) })
    } finally {
      downloadInFlight = false
    }
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

    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true

    updater.on('update-not-available', () => {
      if (hasStopped) return
      pendingVersion = undefined
      // Only a manual check shows the "already up to date" notice; the
      // scheduled background check stays silent so it never flashes a dialog.
      emit(manualCheckPending ? { kind: 'not-available' } : { kind: 'idle' })
    })

    updater.on('download-progress', (info) => {
      if (hasStopped) return
      emit({
        kind: 'downloading',
        version: pendingVersion ?? '',
        progress: {
          percent: info.percent,
          transferred: info.transferred,
          total: info.total,
          bytesPerSecond: info.bytesPerSecond
        }
      })
    })

    updater.on('update-downloaded', (event) => {
      if (hasStopped) return
      const version = versionFromDownloadedEvent(event) ?? pendingVersion ?? ''
      pendingVersion = version
      downloadedVersion = version
      emit({ kind: 'downloaded', version })
      notifyUpdateReady()
    })

    updater.on('error', (error) => {
      // Download failures are already surfaced via startDownload(); this
      // covers unexpected updater errors without blocking the app.
      logger.warn('[updater] Update error:', error)
    })

    void checkForUpdates()
    interval = scheduler.setInterval(() => {
      void checkForUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)
    currentApp.once('before-quit', stop)
  }

  const runManualCheck = async (): Promise<void> => {
    if (hasStopped) return
    if (!currentApp.isPackaged) {
      emit({ kind: 'error', message: '当前运行的是开发版本，无法连接发行版更新服务。请使用已打包的 StudiumX 检查更新。' })
      return
    }
    // Flag the manual check before start() runs its initial check, so a
    // user-triggered check that shares the in-flight background request still
    // surfaces its result instead of staying silent.
    manualCheckPending = true
    emit({ kind: 'checking', manual: true })
    start()
    try {
      await checkForUpdates()
    } finally {
      manualCheckPending = false
    }
  }

  const act = async (action: AppUpdateAction): Promise<void> => {
    if (hasStopped) return
    switch (action) {
      case 'check':
      case 'retry':
        await runManualCheck()
        break
      case 'download':
        if (!currentApp.isPackaged) return
        await startDownload()
        break
      case 'restart':
        if (!currentApp.isPackaged) return
        updater.quitAndInstall()
        break
      case 'dismiss':
        emit({ kind: 'idle' })
        break
    }
  }

  const openDialog = (): void => {
    if (hasStopped) return
    emit({ kind: 'menu' })
  }

  return {
    start,
    stop,
    checkNow: runManualCheck,
    act,
    openDialog
  }
}

function updateVersion(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('updateInfo' in result)) return undefined
  const updateInfo = result.updateInfo
  if (!updateInfo || typeof updateInfo !== 'object' || !('version' in updateInfo)) return undefined
  return versionString(updateInfo.version)
}

function versionFromDownloadedEvent(event: UpdateDownloadedEvent): string | undefined {
  return versionString(event.version)
}

function versionString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function broadcastUpdateState(state: AppUpdateState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(teachingEventChannels.appUpdateEvent, state)
  }
}

function notifyUpdateReady(): void {
  const anyWindowVisible = BrowserWindow.getAllWindows().some((window) => window.isVisible())
  if (anyWindowVisible || !Notification.isSupported()) return
  new Notification({
    title: 'StudiumX 更新已就绪',
    body: '新版本已下载完成，打开 StudiumX 即可重启完成更新。'
  }).show()
}

let controller: AppUpdaterController | undefined

function createController(): AppUpdaterController {
  controller ??= createAppUpdaterController({
    app,
    updater: autoUpdater,
    emit: broadcastUpdateState,
    notifyUpdateReady
  })
  return controller
}

/**
 * Starts automatic updates for the production application singleton.
 * Development runs deliberately do not contact GitHub: there is no generated
 * update manifest and a local build must never replace itself with a release.
 */
export function startAppUpdateCheck(): void {
  createController().start()
}

/**
 * Handles an explicit renderer request to check for an app update. The same
 * in-flight request is shared with the scheduled checker, so rapid clicks do
 * not create concurrent release-feed requests.
 */
export function checkForAppUpdates(): Promise<void> {
  return createController().checkNow()
}

/**
 * Forwards a renderer update-dialog action (check/download/restart/retry/dismiss)
 * to the packaged-app updater.
 */
export function actOnAppUpdate(action: AppUpdateAction): Promise<void> {
  return createController().act(action)
}

/**
 * Opens the update dialog without starting a network check. The renderer uses
 * this as the "refresh" entry point; the dialog itself owns the check button.
 */
export function openAppUpdateDialog(): void {
  createController().openDialog()
}
