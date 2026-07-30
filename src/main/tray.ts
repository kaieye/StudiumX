import { app, BrowserWindow, Menu, Tray, nativeImage, type NativeImage } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Logger } from './logger'
import { applicationTrayLifecycle, type TrayLocale, type TrayMenuLabels } from './tray-lifecycle'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// 1x1 accent-blue PNG used only as a last-resort fallback when the bundled
// platform tray asset cannot be loaded.
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mN4+P+/HgAFDwIAB6s5FQAAAABJRU5ErkJggg=='

/**
 * Electron adapter for the pure tray lifecycle policy. It owns all BrowserWindow,
 * Tray, Menu, and app side effects at the existing desktop seam.
 */
export class TrayManager {
  private tray: Tray | null = null
  private window: BrowserWindow | null = null
  private readonly logger: Logger | null

  constructor(logger: Logger | null = null) {
    this.logger = logger
  }

  attach(window: BrowserWindow): void {
    this.window = window
    window.on('close', (event: Electron.Event) => {
      if (applicationTrayLifecycle.closeOutcome() !== 'hide') return
      event.preventDefault()
      window.hide()
    })
  }

  configure(closeAction: 'quit' | 'tray', locale: TrayLocale = applicationTrayLifecycle.configuration().locale): void {
    const configuration = applicationTrayLifecycle.configure(closeAction, locale)
    if (configuration.trayEnabled) {
      this.ensureTray()
      this.rebuildMenu(configuration.labels)
    } else if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  /**
   * Resolve a platform-appropriate tray icon.
   *
   * macOS menu-bar icons are monochrome "template" images that the system
   * recolors to match the current light/dark appearance, so the template asset
   * is loaded and marked as a template. Windows/Linux instead use a filled,
   * brand-colored icon. Both fall back to the embedded data URL when the
   * bundled asset is missing, so the tray always stays usable.
   */
  private resolveTrayIcon(): NativeImage {
    const dir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../build')
    const isMac = process.platform === 'darwin'
    const fileName = isMac ? 'trayTemplate.png' : 'trayIcon.png'
    const image = nativeImage.createFromPath(join(dir, fileName))
    if (image.isEmpty()) {
      this.logger?.warn(`Tray icon asset missing (${fileName}); using fallback`)
      return nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
    }
    if (isMac) image.setTemplateImage(true)
    return image
  }

  private ensureTray(): void {
    if (this.tray) return
    this.tray = new Tray(this.resolveTrayIcon())
    this.tray.setToolTip('StudiumX')
    this.tray.on('click', () => this.show())
    this.logger?.info('Tray initialized')
  }

  private rebuildMenu(labels: TrayMenuLabels): void {
    if (!this.tray) return
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: labels.show, click: () => this.show() },
        { type: 'separator' },
        { label: labels.quit, click: () => this.quit() }
      ])
    )
  }

  private show(): void {
    const window = this.window
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  private quit(): void {
    applicationTrayLifecycle.beginQuit()
    app.quit()
  }
}

/** Preserves the existing main-process quit setter import contract. */
export function setAppIsQuitting(value: boolean): void {
  applicationTrayLifecycle.setQuitting(value)
}

export function isAppQuitting(): boolean {
  return applicationTrayLifecycle.isQuitting()
}
