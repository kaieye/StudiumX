/**
 * Full-screen login interface.
 *
 * Visual language mirrors Livo's AuthLoginPage (centred glass card, brand
 * title, single primary OAuth button, terms footer) but is adapted to
 * StudiumX's local-first product floor:
 *
 * - Reuses the existing renderer-side WeChat QR login flow
 *   (`loginWithWechatQr` + `sync-store`); no new IPC or remote surface.
 * - Login is *optional*. A "continue in local mode" action dismisses the
 *   card so the app stays fully usable offline (teaching authority is local).
 * - The session check (`checkSyncSession`) is driven by AuthGate and only
 *   contacts the server when a token already exists, so first launch makes
 *   no network call.
 */

import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GraduationCap, Loader2 } from 'lucide-react'
import { createSyncApiClient } from './sync-api-client'
import {
  clearSyncAuth,
  ensureDeviceId,
  getSyncState,
  setSyncAuth,
  type SyncAuthUser
} from './sync-store'
import { loginWithWechatQr } from './wechat-qr-login'
import { clearContinueLocal, setContinueLocal } from './auth-gate-store'

export function LoginScreen() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const handleWechatLogin = useCallback(async () => {
    setBusy(true)
    setError(null)
    setProgress(t('auth.login.opening', { defaultValue: '正在打开系统浏览器…' }))
    const controller = new AbortController()
    abortRef.current = controller

    try {
      ensureDeviceId()
      const client = createSyncApiClient({
        baseUrl: getSyncState().baseUrl,
        getAccessToken: () => null,
        onTokenExpired: clearSyncAuth
      })
      const result = await loginWithWechatQr(
        client,
        (status) => setProgress(status),
        controller.signal
      )
      if (result.ok) {
        setSyncAuth({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: (result.user as SyncAuthUser | undefined) ?? null
        })
        // Logging in abandons any prior "continue local" choice.
        clearContinueLocal()
        setProgress(null)
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setProgress(null)
      abortRef.current = null
    }
  }, [t])

  const handleContinueLocal = useCallback(() => {
    setContinueLocal(true)
  }, [])

  return (
    <div className="auth-screen" role="dialog" aria-modal="true" aria-label={t('auth.title', { defaultValue: '登录 StudiumX' })}>
      <div className="auth-screen-card">
        <div className="auth-screen-brand">
          <span className="auth-screen-logo">
            <GraduationCap size={34} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <h1 className="auth-screen-title">
            {t('auth.welcome', { defaultValue: '欢迎使用 StudiumX' })}
          </h1>
          <p className="auth-screen-subtitle">
            {t('auth.loginPrompt', {
              defaultValue: '登录以同步学习计划；也可继续使用本地模式。'
            })}
          </p>
        </div>

        {error && (
          <div className="auth-screen-alert auth-screen-alert--error" role="alert">
            {error}
          </div>
        )}
        {progress && (
          <div className="auth-screen-alert auth-screen-alert--info" role="status">
            {progress}
          </div>
        )}

        <div className="auth-screen-actions">
          <button
            type="button"
            className="auth-screen-button auth-screen-button--wechat"
            onClick={handleWechatLogin}
            disabled={busy}
          >
            <svg className="auth-screen-wechat-icon" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
              <path d="M680.832 390.656c10.24 0 20.48 0.512 30.208 1.536-27.136-126.464-162.304-220.672-317.44-220.672-175.616 0-318.464 119.808-318.464 267.264 0 86.528 47.104 157.696 125.952 213.504l-31.488 94.72 110.08-55.296c39.424 7.68 70.656 15.872 110.08 15.872 9.984 0 19.968-0.512 29.696-1.536-6.144-21.504-9.728-43.776-9.728-67.072 0.512-137.728 118.272-248.32 271.104-248.32z m-172.032-86.016c23.552 0 39.424 15.872 39.424 39.424s-15.872 39.424-39.424 39.424c-23.552 0-47.104-15.872-47.104-39.424s23.552-39.424 47.104-39.424z m-212.992 78.848c-23.552 0-47.104-15.872-47.104-39.424s23.552-39.424 47.104-39.424c23.552 0 39.424 15.872 39.424 39.424s-15.872 39.424-39.424 39.424z m606.72 114.176c0-126.464-126.464-229.376-267.264-229.376-148.48 0-267.776 102.912-267.776 229.376 0 126.976 119.296 229.376 267.776 229.376 31.488 0 63.488-7.68 94.72-15.872l86.528 47.104-23.552-78.848c63.488-47.104 109.568-110.08 109.568-181.76z m-356.352-39.424c-15.872 0-31.488-15.872-31.488-31.488s15.872-31.488 31.488-31.488c23.552 0 39.424 15.872 39.424 31.488s-15.872 31.488-39.424 31.488z m173.056 0c-15.872 0-31.488-15.872-31.488-31.488s15.872-31.488 31.488-31.488c23.552 0 39.424 15.872 39.424 31.488s-15.872 31.488-39.424 31.488z" />
            </svg>
            <span>
              {busy
                ? t('auth.signingIn', { defaultValue: '登录中…' })
                : t('auth.signInWithWechat', { defaultValue: '微信扫码登录' })}
            </span>
            {busy && <Loader2 size={16} className="auth-screen-spinner" aria-hidden="true" />}
          </button>

          <button
            type="button"
            className="auth-screen-button auth-screen-button--ghost"
            onClick={handleContinueLocal}
            disabled={busy}
          >
            {t('auth.continueLocal', { defaultValue: '以本地模式继续' })}
          </button>
        </div>

        <p className="auth-screen-footer">
          {t('auth.termsHint', {
            defaultValue: '教学资产始终以本地工作区为权威；登录仅用于跨设备同步。'
          })}
        </p>
      </div>
    </div>
  )
}
