import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import type { Logger } from './logger'
import { applicationTrayLifecycle, type TrayLocale, type TrayMenuLabels } from './tray-lifecycle'

// 1x1 accent-blue PNG; Electron scales it up for the tray. Good enough as a
// placeholder until a real icon asset is bundled.
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

  private ensureTray(): void {
    if (this.tray) return
    this.tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL))
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