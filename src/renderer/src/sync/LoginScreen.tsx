/**
 * Full-screen login interface.
 *
 * The official WeChat login widget renders the QR challenge in this card. We
 * must not re-encode the server's qrconnect URL with a generic QR library: the
 * phone confirmation flow belongs to WeChat's widget. The desktop client only
 * polls the associated loginId and stores the server-issued session.
 */

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
  requestWechatQrLoginChallenge,
  type WechatQrLoginChallenge
} from './wechat-qr-login'
import { preloadWechatLoginSdk, WechatLoginWidget } from './WechatLoginWidget'
import { useAppStore } from '../app-shell/appStore'
import { AuthScreenLayout } from '../ui/AuthScreenLayout'

const PRIVACY_POLICY_URL = 'https://studiumx.cn/privacy.html'
const TERMS_OF_SERVICE_URL = 'https://studiumx.cn/terms.html'

export function LoginScreen() {
  const { t } = useTranslation()
  const openExternal = useAppStore((state) => state.openExternal)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<WechatQrLoginChallenge | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    preloadWechatLoginSdk()
    return () => abortRef.current?.abort()
  }, [])

  const handleWechatLogin = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError(null)
    setChallenge(null)

    try {
      ensureDeviceId()
      const client = createSyncApiClient({
        baseUrl: getSyncState().baseUrl,
        getAccessToken: () => null,
        onTokenExpired: clearSyncAuth
      })
      const challengeResult = await requestWechatQrLoginChallenge(client)
      if (controller.signal.aborted) return
      if (!challengeResult.ok) {
        setError(challengeResult.error)
        return
      }

      // The widget renders WeChat's own QR challenge in this card. Do not turn
      // challenge.url into a second, generic QR code.
      setChallenge(challengeResult.challenge)
      // Polling continues in the background. Re-enable the controls so a
      // user can refresh an expired QR or cancel while waiting for WeChat.
      setBusy(false)

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

      setChallenge(null)
      setError(result.error)
    } catch (err) {
      if (!controller.signal.aborted) {
        setChallenge(null)
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (abortRef.current === controller) {
        setBusy(false)
        abortRef.current = null
      }
    }
  }, [t])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setChallenge(null)
  }, [])

  const handleWidgetError = useCallback((message: string) => {
    setChallenge(null)
    setError(message)
    abortRef.current?.abort()
  }, [])

  return (
    <AuthScreenLayout
      ariaLabel={t('auth.title', { defaultValue: '登录 StudiumX' })}
      title={t('auth.welcome', { defaultValue: '欢迎使用 StudiumX' })}
      error={error}
      stage={
        challenge ? (
          <div className="auth-screen-qr">
            <WechatLoginWidget challenge={challenge} onError={handleWidgetError} />
          </div>
        ) : (
          <img
            className="auth-screen-app-icon"
            src={appIconRounded}
            alt=""
            aria-hidden="true"
          />
        )
      }
      actions={
        challenge ? (
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
        )
      }
      footer={
        <>
          {t('auth.termsAgreementPrefix', {
            defaultValue: '登录即代表您同意并遵守'
          })}
          <a
            className="auth-screen-footer-link"
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault()
              void openExternal(PRIVACY_POLICY_URL)
            }}
          >
            {t('auth.privacyPolicy', { defaultValue: '《隐私协议》' })}
          </a>
          {t('auth.termsAgreementJoin', { defaultValue: '和' })}
          <a
            className="auth-screen-footer-link"
            href={TERMS_OF_SERVICE_URL}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault()
              void openExternal(TERMS_OF_SERVICE_URL)
            }}
          >
            {t('auth.userServiceAgreement', { defaultValue: '《用户服务协议》' })}
          </a>
        </>
      }
    />
  )
}
