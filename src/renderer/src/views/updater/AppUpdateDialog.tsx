import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, RotateCcw, X, Zap } from 'lucide-react'
import type { AppUpdateAction, AppUpdateState } from '../../../../shared/teaching-types'
import appIcon from '../../assets/auth/app-icon-rounded.png'

/**
 * In-app desktop update dialog. Subscribes to the main-process update state
 * stream and renders the current lifecycle stage (ask to download, live
 * download progress, restart-ready, or a surfaced error) as a modal card.
 * The scheduled background check stays silent; only manual checks, an actual
 * download, or a failure ever bring the dialog up.
 */
export function AppUpdateDialog() {
  const { t } = useTranslation()
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const autoDismissTimer = useRef<number | null>(null)

  // The Web adapter deliberately exposes desktop-only updater methods as
  // throwing stubs, so the `if (!api?.onAppUpdateEvent)` guard alone is not
  // enough: subscribing on Web would throw and tear down the shared renderer
  // UI via the error boundary. The updater is a desktop-only surface; skip it
  // entirely when hosted by the browser shell.
  const isWeb = typeof window !== 'undefined' && window.teachingSystem?.platform === 'web'

  useEffect(() => {
    if (isWeb) return
    const api = window.teachingSystem
    if (!api?.onAppUpdateEvent) return
    const unsubscribe = api.onAppUpdateEvent((next) => {
      if (autoDismissTimer.current !== null) {
        window.clearTimeout(autoDismissTimer.current)
        autoDismissTimer.current = null
      }
      if (next.kind === 'idle') {
        setState(null)
        return
      }
      setState(next)
      if (next.kind === 'not-available') {
        autoDismissTimer.current = window.setTimeout(() => setState(null), 4000)
      }
    })
    return () => {
      unsubscribe()
      if (autoDismissTimer.current !== null) window.clearTimeout(autoDismissTimer.current)
    }
  }, [isWeb])

  // Current installed version, shown in the dialog's check-for-updates menu.
  useEffect(() => {
    if (isWeb) return
    const getAppVersion = window.teachingSystem?.getAppVersion
    if (!getAppVersion) return
    let cancelled = false
    void getAppVersion()
      .then((value) => {
        if (!cancelled) setAppVersion(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isWeb])

  const act = (action: AppUpdateAction): void => {
    if (isWeb) return
    void window.teachingSystem?.appUpdateAction(action).catch(() => {})
  }

  const dismiss = (): void => act('dismiss')

  useEffect(() => {
    if (!state || state.kind === 'checking') return
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!state || isWeb) return null

  const dismissible = state.kind !== 'checking'
  const version = state.kind === 'available' || state.kind === 'downloading' || state.kind === 'downloaded' ? state.version : ''

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (dismissible && event.target === event.currentTarget) dismiss()
  }

  return createPortal(
    <div className="app-update-backdrop" role="presentation" onMouseDown={handleBackdropMouseDown}>
      <section className="app-update-dialog" role="dialog" aria-modal="true" aria-label={t('appUpdate.title')}>
        {dismissible && (
          <button className="app-update-close" type="button" aria-label={t('appUpdate.close')} onClick={dismiss}>
            <X size={15} />
          </button>
        )}

        <div className="app-update-header">
          <span className={`app-update-icon app-update-icon--${state.kind}`}>
            {state.kind === 'menu' && <Zap size={20} />}
            {state.kind === 'checking' && <Loader2 size={20} className="spin" />}
            {state.kind === 'available' && <Zap size={20} />}
            {state.kind === 'downloading' && <Download size={20} />}
            {state.kind === 'downloaded' && <CheckCircle2 size={20} />}
            {state.kind === 'not-available' && <CheckCircle2 size={20} />}
            {state.kind === 'error' && <AlertCircle size={20} />}
          </span>
          <span className="app-update-logo">
            <img src={appIcon} alt="" />
          </span>
        </div>

        <div className="app-update-body">
          {state.kind === 'menu' ? (
            <>
              <h2>{t('appUpdate.menu.title')}</h2>
              <p>{t('appUpdate.menu.body', { version: appVersion ?? '—' })}</p>
            </>
          ) : (
            <>
              <h2>{t(`appUpdate.${state.kind}.title`)}</h2>
              <p>{t(`appUpdate.${state.kind}.body`, { version, message: state.kind === 'error' ? state.message : undefined })}</p>
            </>
          )}
        </div>

        {state.kind === 'downloading' && (
          <UpdateProgressBar
            percent={state.progress.percent}
            transferred={state.progress.transferred}
            total={state.progress.total}
            bytesPerSecond={state.progress.bytesPerSecond}
          />
        )}

        <div className="app-update-actions">
          {state.kind === 'menu' && (
            <button className="app-update-primary" type="button" onClick={() => act('check')}>
              <RefreshCw size={14} />
              {t('appUpdate.checkUpdates')}
            </button>
          )}
          {state.kind === 'available' && (
            <>
              <button className="app-update-ghost" type="button" onClick={dismiss}>
                {t('appUpdate.later')}
              </button>
              <button className="app-update-primary" type="button" onClick={() => act('download')}>
                <Download size={14} />
                {t('appUpdate.download')}
              </button>
            </>
          )}
          {state.kind === 'downloading' && (
            <button className="app-update-ghost" type="button" onClick={dismiss}>
              {t('appUpdate.background')}
            </button>
          )}
          {state.kind === 'downloaded' && (
            <>
              <button className="app-update-ghost" type="button" onClick={dismiss}>
                {t('appUpdate.restartLater')}
              </button>
              <button className="app-update-primary" type="button" onClick={() => act('restart')}>
                <Zap size={14} />
                {t('appUpdate.restart')}
              </button>
            </>
          )}
          {state.kind === 'error' && (
            <>
              <button className="app-update-ghost" type="button" onClick={dismiss}>
                {t('appUpdate.close')}
              </button>
              <button className="app-update-primary" type="button" onClick={() => act('retry')}>
                <RotateCcw size={14} />
                {t('appUpdate.retry')}
              </button>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  )
}

function UpdateProgressBar({
  percent,
  transferred,
  total,
  bytesPerSecond
}: {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}) {
  const clampedPercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
  return (
    <div className="app-update-progress">
      <div className="app-update-progress-track">
        <div className="app-update-progress-fill" style={{ width: `${clampedPercent}%` }} />
      </div>
      <div className="app-update-progress-meta">
        <span>{Math.round(clampedPercent)}%</span>
        <span>
          {formatBytes(transferred)} / {formatBytes(total)}
        </span>
      </div>
      <div className="app-update-speed">{formatBytes(bytesPerSecond)}/s</div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}
