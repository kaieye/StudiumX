export type TrayLocale = 'zh-CN' | 'en-US'
export type TrayCloseAction = 'quit' | 'tray'
export type TrayCloseOutcome = 'hide' | 'close'

export type TrayMenuLabels = {
  show: string
  quit: string
}

export type TrayLifecycleConfiguration = {
  closeAction: TrayCloseAction
  locale: TrayLocale
  trayEnabled: boolean
  labels: TrayMenuLabels
}

const trayLabels: Record<TrayLocale, TrayMenuLabels> = {
  'zh-CN': { show: '显示 StudiumX', quit: '退出' },
  'en-US': { show: 'Show StudiumX', quit: 'Quit' }
}

/**
 * Pure state policy for the one application tray lifecycle. It owns the
 * configured close behavior, menu language, and real-quit override while the
 * TrayManager remains the sole Electron adapter.
 */
export class TrayLifecycle {
  private closeAction: TrayCloseAction = 'quit'
  private locale: TrayLocale = 'zh-CN'
  private quitting = false

  configure(closeAction: TrayCloseAction, locale: TrayLocale = this.locale): TrayLifecycleConfiguration {
    this.closeAction = closeAction
    this.locale = locale
    return this.configuration()
  }

  closeOutcome(): TrayCloseOutcome {
    return this.closeAction === 'tray' && !this.quitting ? 'hide' : 'close'
  }

  beginQuit(): void {
    this.quitting = true
  }

  setQuitting(value: boolean): void {
    this.quitting = value
  }

  isQuitting(): boolean {
    return this.quitting
  }

  configuration(): TrayLifecycleConfiguration {
    return {
      closeAction: this.closeAction,
      locale: this.locale,
      trayEnabled: true,
      labels: trayLabels[this.locale]
    }
  }
}

/** Shared application state used by TrayManager and the existing quit setter. */
export const applicationTrayLifecycle = new TrayLifecycle()