import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'

// electron-updater is published as CommonJS. Import its default namespace so
// Electron's native ESM loader can load it reliably in both development and
// packaged builds.
const { autoUpdater } = electronUpdater

let hasStarted = false

/**
 * Checks the GitHub Release feed after a packaged app starts. Electron-updater
 * downloads an available release in the background and the user chooses when
 * to restart after the download has completed.
 *
 * Development runs deliberately do not contact GitHub: there is no generated
 * update manifest and a local build must never replace itself with a release.
 */
export function startAppUpdateCheck(): void {
  if (hasStarted || !app.isPackaged) return
  hasStarted = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', () => {
    void dialog
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
        if (response === 0) autoUpdater.quitAndInstall()
      })
      .catch((error: unknown) => {
        console.warn('[updater] Unable to show the update prompt:', error)
      })
  })

  autoUpdater.on('error', (error) => {
    // A failed check must not block startup. The next launch retries it.
    console.warn('[updater] Update check failed:', error)
  })

  void autoUpdater.checkForUpdates().catch((error: unknown) => {
    console.warn('[updater] Unable to start update check:', error)
  })
}
