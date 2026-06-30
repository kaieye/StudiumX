import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import type { Logger } from './logger'

// 1x1 accent-blue PNG; Electron scales it up for the tray. Good enough as a
// placeholder until a real icon asset is bundled.
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mN4+P+/HgAFDwIAB6s5FQAAAABJRU5ErkJggg=='

/**
 * Manages the system tray icon and the close-to-tray behavior. When
 * closeAction === 'tray', the main window's close event is intercepted to
 * hide instead of quit, keeping the app alive in the tray.
 */
export class TrayManager {
  private tray: Tray | null = null
  private window: BrowserWindow | null = null
  private closeAction: 'quit' | 'tray' = 'quit'
  private readonly logger: Logger | null

  constructor(logger: Logger | null = null) {
    this.logger = logger
  }

  attach(window: BrowserWindow): void {
    this.window = window
    window.on('close', (event: Electron.Event) => {
      if (this.closeAction === 'tray' && !appIsQuitting) {
        event.preventDefault()
        window.hide()
      }
    })
  }

  configure(closeAction: 'quit' | 'tray'): void {
    this.closeAction = closeAction
    if (closeAction === 'tray') {
      this.ensureTray()
    } else if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  private ensureTray(): void {
    if (this.tray) return
    this.tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL))
    this.tray.setToolTip('TeachOS')
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示 TeachOS', click: () => this.show() },
        { type: 'separator' },
        { label: '退出', click: () => this.quit() }
      ])
    )
    this.tray.on('click', () => this.show())
    this.logger?.info('Tray initialized')
  }

  private show(): void {
    const window = this.window
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  private quit(): void {
    appIsQuitting = true
    app.quit()
  }
}

// Module-level flag so the close handler can distinguish a real quit from
// a hide-to-tray. Set true just before app.quit() from the tray menu.
let appIsQuitting = false

export function setAppIsQuitting(value: boolean): void {
  appIsQuitting = value
}

export function isAppQuitting(): boolean {
  return appIsQuitting
}

