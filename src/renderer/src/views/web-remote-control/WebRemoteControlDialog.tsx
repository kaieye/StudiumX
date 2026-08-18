/**
 * Desktop Web Remote Control dialog + sidebar trigger (security boundary: SECURITY.md).
 * Desktop remote-control dialog: header · scan card · channel rail · QR · status · stop/refresh/copy.
 */

import {
  Copy,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  Square,
  X
} from 'lucide-react'
import QRCode from 'qrcode'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type {
  WebRemoteControlRuntimeStatus,
  WebRemoteControlStartPayload,
  WebRemoteControlStatus
} from '../../../../shared/web-remote-control'
import { WebRemoteChannelPanel, type RemoteChannelProviderId } from './WebRemoteChannelPanel'

type WebRemoteApi = {
  start: (payload?: WebRemoteControlStartPayload) => Promise<WebRemoteControlRuntimeStatus>
  stop: () => Promise<void>
  resetPairing: (payload?: WebRemoteControlStartPayload) => Promise<WebRemoteControlRuntimeStatus>
  getStatus: () => Promise<WebRemoteControlRuntimeStatus>
  onStatusChanged: (handler: (status: WebRemoteControlRuntimeStatus) => void) => () => void
}

function getWebRemoteApi(): WebRemoteApi | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { studiumxWebRemoteControl?: WebRemoteApi }).studiumxWebRemoteControl ?? null
}

function statusDotClass(status: WebRemoteControlStatus): string {
  if (status === 'active') return 'wrc-dot wrc-dot--success'
  if (status === 'error') return 'wrc-dot wrc-dot--danger'
  if (status === 'idle') return 'wrc-dot wrc-dot--muted'
  return 'wrc-dot wrc-dot--warning'
}

function triggerIconClass(status: WebRemoteControlStatus | 'unknown'): string {
  if (status === 'error') return 'wrc-trigger-icon--danger'
  if (status === 'active') return 'wrc-trigger-icon--success'
  if (status === 'starting' || status === 'connecting' || status === 'running') {
    return 'wrc-trigger-icon--warning'
  }
  return 'wrc-trigger-icon--muted'
}

export type WebRemoteControlDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspacePath?: string
  workspaceId?: string
  initialTaskId?: string
}

export function WebRemoteControlDialog({
  open,
  onOpenChange,
  workspacePath,
  workspaceId,
  initialTaskId
}: WebRemoteControlDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const [status, setStatus] = useState<WebRemoteControlRuntimeStatus>({
    status: 'idle',
    mobileConnected: false
  })
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [manageChannelsOpen, setManageChannelsOpen] = useState(false)
  const [channelEntryProvider, setChannelEntryProvider] =
    useState<RemoteChannelProviderId | null>(null)

  const startPayload = useMemo(
    (): WebRemoteControlStartPayload => ({
      workspacePath,
      workspaceId,
      initialTaskId
    }),
    [workspacePath, workspaceId, initialTaskId]
  )

  const refresh = useCallback(async () => {
    const api = getWebRemoteApi()
    if (!api) {
      setLocalError(t('webRemoteControl.apiMissing'))
      return
    }
    try {
      setStatus(await api.getStatus())
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }, [t])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const api = getWebRemoteApi()
    setBusy(true)
    setLocalError(null)
    setCopied(false)
    ;(async () => {
      try {
        if (!api) {
          if (!cancelled) setLocalError(t('webRemoteControl.apiMissing'))
          return
        }
        const current = await api.getStatus()
        const live =
          current.status === 'running' ||
          current.status === 'connecting' ||
          current.status === 'active' ||
          current.status === 'starting'
        const next = live ? current : await api.start(startPayload)
        if (!cancelled) setStatus(next)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setLocalError(message)
          setStatus({ status: 'error', mobileConnected: false, error: message })
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()

    const off = api?.onStatusChanged((next) => {
      if (!cancelled) setStatus(next)
    })
    const timer = window.setInterval(() => {
      void refresh()
    }, 1500)

    return () => {
      cancelled = true
      off?.()
      window.clearInterval(timer)
    }
  }, [open, startPayload, refresh, t])

  const connectUrl = status.connectUrl || status.qrUrl || ''

  useEffect(() => {
    let cancelled = false
    if (!connectUrl) {
      setQrDataUrl(null)
      return
    }
    void QRCode.toDataURL(connectUrl, {
      margin: 1,
      width: 320,
      color: { dark: '#182033', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch((error) => {
        if (!cancelled) {
          setQrDataUrl(null)
          setLocalError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [connectUrl])

  useEffect(() => {
    if (!open) {
      setManageChannelsOpen(false)
      setChannelEntryProvider(null)
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (manageChannelsOpen) {
        setManageChannelsOpen(false)
        setChannelEntryProvider(null)
        return
      }
      onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange, manageChannelsOpen])

  const copyLink = async (): Promise<void> => {
    if (!connectUrl) return
    try {
      await navigator.clipboard.writeText(connectUrl)
      setLocalError(null)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }

  const stop = async (): Promise<void> => {
    const api = getWebRemoteApi()
    if (!api) return
    setBusy(true)
    try {
      await api.stop()
      setStatus({ status: 'idle', mobileConnected: false })
      onOpenChange(false)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const resetPairing = async (): Promise<void> => {
    if (!window.confirm(t('webRemoteControl.refreshQr.confirmDescription'))) return
    const api = getWebRemoteApi()
    if (!api) return
    setBusy(true)
    try {
      const next = await api.resetPairing(startPayload)
      setStatus(next)
      setLocalError(null)
      setCopied(false)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const statusLabel = t(`webRemoteControl.status.${status.status}`, { defaultValue: status.status })
  const statusDetail = t(`webRemoteControl.statusDetail.${status.status}`, { defaultValue: '' })
  const deviceTag = status.mobileConnected
    ? t('webRemoteControl.statusTag.phone')
    : status.status === 'idle'
      ? t('webRemoteControl.status.idle')
      : status.status === 'error'
        ? t('webRemoteControl.status.error')
        : t('webRemoteControl.statusTag.ready')
  const failureText = status.failure?.message || localError || status.error || null

  return createPortal(
    <div
      className="import-dialog-backdrop wrc-backdrop"
      role="presentation"
      data-testid="web-remote-control-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <section
        className={`wrc-dialog${manageChannelsOpen ? ' is-manage-view' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="web-remote-control-dialog"
      >
        {!manageChannelsOpen ? (
          <button
            type="button"
            className="settings-close-button wrc-dialog-close"
            onClick={() => onOpenChange(false)}
            aria-label={t('common.cancel')}
          >
            <X size={16} />
          </button>
        ) : null}

        <div
          className={`wrc-dialog-scroll${manageChannelsOpen ? ' is-manage' : ''}`}
          data-testid="web-remote-control-dialog-scroll"
        >
          {manageChannelsOpen ? (
            <WebRemoteChannelPanel
              workspacePath={workspacePath}
              workspaceId={workspaceId}
              manageOpen
              onManageOpenChange={setManageChannelsOpen}
              entryProvider={channelEntryProvider}
              onEntryProviderChange={setChannelEntryProvider}
            />
          ) : (
            <>
          <header className="wrc-dialog-header">
            <div className="wrc-dialog-header-icon" aria-hidden="true">
              <Smartphone size={20} strokeWidth={1.9} />
            </div>
            <div className="wrc-dialog-header-text">
              <h2 id={titleId}>{t('webRemoteControl.title')}</h2>
              <p>{t('webRemoteControl.description')}</p>
            </div>
          </header>

          <div className="wrc-main-grid" data-testid="web-remote-control-main-grid">
            {/* Left: scan / connection card */}
            <section className="wrc-card wrc-scan-card" data-testid="web-remote-control-scan-card">
              <div className="wrc-card-heading">
                <QrCode className="wrc-card-heading-icon" size={16} strokeWidth={1.9} />
                <div>
                  <div className="wrc-card-heading-title">{t('webRemoteControl.mobileQr.title')}</div>
                  <p className="wrc-card-heading-desc">{t('webRemoteControl.mobileQr.description')}</p>
                </div>
              </div>

              <div className="wrc-connection-card" data-testid="web-remote-control-connection-card">
                <div className="wrc-connection-top">
                  <div className="wrc-connection-meta">
                    <div className="wrc-connection-title-row">
                      <span className="wrc-connection-title">{statusLabel}</span>
                      <span className="wrc-status-chip">
                        <span className={statusDotClass(status.status)} />
                        <span className="wrc-status-chip-label">{deviceTag}</span>
                      </span>
                    </div>
                    {statusDetail ? <p className="wrc-connection-detail">{statusDetail}</p> : null}
                  </div>
                  {busy ? (
                    <Loader2 className="wrc-spin" size={16} aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      className="ghost-button wrc-inline-btn"
                      onClick={() => void stop()}
                      disabled={status.status === 'idle'}
                    >
                      <Square size={14} />
                      {t('webRemoteControl.stop')}
                    </button>
                  )}
                </div>

                {failureText ? (
                  <div className="wrc-error-box" role="alert">
                    <p>{failureText}</p>
                    {status.failure?.reason ? (
                      <p className="wrc-error-reason">{status.failure.reason}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="wrc-copy-row" data-testid="web-remote-control-copy-link-row">
                  <p className="wrc-copy-help">{t('webRemoteControl.copyLink.description')}</p>
                  <div className="wrc-copy-actions">
                    <button
                      type="button"
                      className="ghost-button wrc-inline-btn"
                      onClick={() => void resetPairing()}
                      disabled={busy}
                    >
                      <RefreshCw size={14} />
                      {t('webRemoteControl.refreshQrLabel')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button wrc-inline-btn"
                      onClick={() => void copyLink()}
                      disabled={!connectUrl || busy}
                    >
                      <Copy size={14} />
                      {copied ? t('webRemoteControl.copyLink.copied') : t('webRemoteControl.copyLinkLabel')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="wrc-qr-frame" aria-label={t('webRemoteControl.qrAlt')}>
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={t('webRemoteControl.qrAlt')}
                    className="wrc-qr-image"
                    width={256}
                    height={256}
                  />
                ) : (
                  <div className="wrc-qr-loading">
                    <Loader2 className="wrc-spin" size={22} />
                    <span>{t('webRemoteControl.generating')}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Right: platform channel cards */}
            <WebRemoteChannelPanel
              workspacePath={workspacePath}
              workspaceId={workspaceId}
              manageOpen={false}
              onManageOpenChange={setManageChannelsOpen}
              entryProvider={channelEntryProvider}
              onEntryProviderChange={setChannelEntryProvider}
            />
          </div>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  )
}

export type WorkspaceWebRemoteControlTriggerProps = {
  workspacePath?: string
  workspaceId?: string
  initialTaskId?: string
  compact?: boolean
  className?: string
}

/** Sidebar footer entry: opens remote control dialog. */
export function WorkspaceWebRemoteControlTrigger({
  workspacePath,
  workspaceId,
  initialTaskId,
  compact = true,
  className
}: WorkspaceWebRemoteControlTriggerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [liveStatus, setLiveStatus] = useState<WebRemoteControlStatus | 'unknown'>('idle')

  useEffect(() => {
    const api = getWebRemoteApi()
    if (!api) return
    void api
      .getStatus()
      .then((s) => setLiveStatus(s.status))
      .catch(() => undefined)
    return api.onStatusChanged((s) => setLiveStatus(s.status))
  }, [])

  const live = liveStatus !== 'idle' && liveStatus !== 'error' && liveStatus !== 'unknown'
  const tooltip =
    liveStatus === 'active'
      ? t('webRemoteControl.triggerStatus.connected')
      : liveStatus === 'running'
        ? t('webRemoteControl.triggerStatus.waiting')
        : liveStatus === 'starting' || liveStatus === 'connecting'
          ? t(`webRemoteControl.triggerStatus.${liveStatus}`)
          : liveStatus === 'error'
            ? t('webRemoteControl.triggerStatus.error')
            : t('webRemoteControl.triggerStatus.idle')

  return (
    <>
      <button
        className={`icon-button${live ? ' is-active-remote' : ''}${className ? ` ${className}` : ''}`}
        type="button"
        aria-label={t('webRemoteControl.trigger')}
        title={`${t('webRemoteControl.trigger')} — ${tooltip}`}
        onClick={() => setOpen(true)}
        data-testid="web-remote-control-trigger"
      >
        <Smartphone size={16} className={triggerIconClass(liveStatus)} />
        {!compact ? <span className="collapsible-label">{t('webRemoteControl.trigger')}</span> : null}
      </button>
      <WebRemoteControlDialog
        open={open}
        onOpenChange={setOpen}
        workspacePath={workspacePath}
        workspaceId={workspaceId}
        initialTaskId={initialTaskId}
      />
    </>
  )
}
