/**
 * Full-screen login interface.
 *
 * The server supplies a one-time WeChat URL. This screen encodes it as a QR
 * code directly in the login card and polls the associated loginId, so signing
 * in does not hand the user off to the system browser.
 */

import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import appIconRounded from '../assets/auth/app-icon-rounded.png'
import wechatLoginIcon from '../assets/auth/wechat-login.png'
import { createSyncApiClient } from './sync-api-client'
import {
  clearSyncAuth,
  ensureDeviceId,
  getSyncState,
  setSyncAuth,
  type SyncAuthUser
} from './sync-store'
import {
  pollWechatQrLogin,
  requestWechatQrLoginChallenge
} from './wechat-qr-login'

export function LoginScreen() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const handleWechatLogin = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError(null)

    try {
      ensureDeviceId()
      const client = createSyncApiClient({
        baseUrl: getSyncState().baseUrl,
        getAccessToken: () => null,
        onTokenExpired: clearSyncAuth
      })
      const challengeResult = await requestWechatQrLoginChallenge(client)
      if (!challengeResult.ok) {
        setError(challengeResult.error)
        return
      }

      const dataUrl = await QRCode.toDataURL(challengeResult.challenge.url, {
        margin: 1,
        width: 256,
        color: { dark: '#182033', light: '#ffffff' },
        errorCorrectionLevel: 'M'
      })
      if (controller.signal.aborted) return

      setQrDataUrl(dataUrl)
      setBusy(false)

      // The login card deliberately has no polling status UI: the QR remains
      // stable while the server waits for the mobile authorization.
      const result = await pollWechatQrLogin(
        client,
        challengeResult.challenge.loginId,
        undefined,
        controller.signal
      )
      if (controller.signal.aborted) return

      if (result.ok) {
        setSyncAuth({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: (result.user as SyncAuthUser | undefined) ?? null
        })
        return
      }

      setQrDataUrl(null)
      setError(result.error)
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (abortRef.current === controller) {
        setBusy(false)
        abortRef.current = null
      }
    }
  }, [])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setQrDataUrl(null)
  }, [])

  return (
    <div className="auth-screen" role="dialog" aria-modal="true" aria-label={t('auth.title', { defaultValue: '登录 StudiumX' })}>
      <div className="auth-screen-card">
        <div className="auth-screen-brand">
          <h1 className="auth-screen-title">
            {t('auth.welcome', { defaultValue: '欢迎使用 StudiumX' })}
          </h1>
        </div>

        {error && (
          <div className="auth-screen-alert auth-screen-alert--error" role="alert">
            {error}
          </div>
        )}

        <div className="auth-screen-login-stage">
          {qrDataUrl ? (
            <div className="auth-screen-qr">
              <img
                className="auth-screen-qr-image"
                src={qrDataUrl}
                alt={t('auth.login.qrAlt', { defaultValue: '微信登录二维码' })}
              />
              <p className="auth-screen-qr-hint">
                {t('auth.login.qrHint', { defaultValue: '请使用微信扫一扫，确认后将自动登录。' })}
              </p>
            </div>
          ) : (
            <img
              className="auth-screen-app-icon"
              src={appIconRounded}
              alt=""
              aria-hidden="true"
            />
          )}
        </div>

        {qrDataUrl ? (
          <div className="auth-screen-actions auth-screen-actions--inline">
            <button
              type="button"
              className="auth-screen-button auth-screen-button--ghost"
              onClick={handleWechatLogin}
              disabled={busy}
            >
              {t('auth.login.refreshQr', { defaultValue: '刷新二维码' })}
            </button>
            <button
              type="button"
              className="auth-screen-button auth-screen-button--ghost"
              onClick={handleCancel}
            >
              {t('auth.login.cancel', { defaultValue: '取消登录' })}
            </button>
          </div>
        ) : (
          <div className="auth-screen-actions">
            <button
              type="button"
              className="auth-screen-button auth-screen-button--wechat"
              onClick={handleWechatLogin}
              disabled={busy}
            >
              <img
                className="auth-screen-wechat-icon"
                src={wechatLoginIcon}
                alt=""
                aria-hidden="true"
              />
              <span>{t('auth.signInWithWechat', { defaultValue: '微信扫码登录' })}</span>
            </button>
          </div>
        )}

        <p className="auth-screen-footer">
          {t('auth.termsHint', {
            defaultValue: '登录后即可使用学习计划与 StudiumX 的全部功能。'
          })}
        </p>
      </div>
    </div>
  )
}
