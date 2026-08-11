import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import appIconRounded from '../assets/auth/app-icon-rounded.png'
import wechatLoginIcon from '../assets/auth/wechat-login.png'
import { AuthScreenLayout } from './AuthScreenLayout'

const PRIVACY_POLICY_URL = 'https://studiumx.cn/privacy.html'
const TERMS_OF_SERVICE_URL = 'https://studiumx.cn/terms.html'

/**
 * Shared login card used by Electron and Web.
 *
 * Authentication transports remain platform-specific (native sync bridge in
 * Electron, browser HTTP client on Web), but the login DOM, controls, copy,
 * spacing, and legal footer are product chrome and must not fork. Callers
 * provide only the challenge stage and the platform-specific actions.
 */
export interface AuthLoginScreenProps {
  /** Rendered QR/widget content while a challenge is active. */
  challengeStage?: ReactNode
  /** Place this login card above the calling page instead of a standalone surface. */
  overlay?: boolean
  /** Whether a QR challenge is currently visible. */
  hasChallenge: boolean
  /** Error copy shown above the login stage. */
  error?: ReactNode
  /** Disable the primary action while a challenge request is in flight. */
  busy?: boolean
  /** Start or refresh the QR challenge. */
  onLogin: () => void
  /** Cancel the active challenge. */
  onCancel: () => void
  /** Show a cancel action before a QR challenge has been started. */
  showCancel?: boolean
  /** Optional native external-link bridge; browser callers leave this unset. */
  onOpenExternal?: (url: string) => Promise<void>
}

export function AuthLoginScreen({
  challengeStage,
  overlay = false,
  hasChallenge,
  error,
  busy = false,
  onLogin,
  onCancel,
  showCancel = false,
  onOpenExternal
}: AuthLoginScreenProps) {
  const { t } = useTranslation()

  const openExternal = (event: MouseEvent<HTMLAnchorElement>, url: string): void => {
    if (!onOpenExternal) return
    event.preventDefault()
    void onOpenExternal(url)
  }

  return (
    <AuthScreenLayout
      ariaLabel={t('auth.title', { defaultValue: '登录 StudiumX' })}
      overlay={overlay}
      title={t('auth.welcome', { defaultValue: '欢迎使用 StudiumX' })}
      error={error}
      stage={
        hasChallenge ? (
          <div className="auth-screen-qr">{challengeStage}</div>
        ) : (
          <img className="auth-screen-app-icon" src={appIconRounded} alt="" aria-hidden="true" />
        )
      }
      actions={
        hasChallenge ? (
          <div className="auth-screen-actions auth-screen-actions--inline">
            <button
              type="button"
              className="auth-screen-button auth-screen-button--ghost"
              onClick={onLogin}
              disabled={busy}
            >
              {t('auth.login.refreshQr', { defaultValue: '刷新二维码' })}
            </button>
            <button
              type="button"
              className="auth-screen-button auth-screen-button--ghost"
              onClick={onCancel}
            >
              {t('auth.login.cancel', { defaultValue: '取消登录' })}
            </button>
          </div>
        ) : (
          <div className={`auth-screen-actions${showCancel ? ' auth-screen-actions--inline' : ''}`}>
            <button
              type="button"
              className="auth-screen-button auth-screen-button--wechat"
              onClick={onLogin}
              disabled={busy}
            >
              <img className="auth-screen-wechat-icon" src={wechatLoginIcon} alt="" aria-hidden="true" />
              <span>{t('auth.signInWithWechat', { defaultValue: '微信扫码登录' })}</span>
            </button>
            {showCancel ? (
              <button
                type="button"
                className="auth-screen-button auth-screen-button--ghost"
                onClick={onCancel}
              >
                {t('auth.login.cancel', { defaultValue: '取消登录' })}
              </button>
            ) : null}
          </div>
        )
      }
      footer={
        <>
          {t('auth.termsAgreementPrefix', { defaultValue: '登录即代表您同意并遵守' })}
          <a
            className="auth-screen-footer-link"
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => openExternal(event, PRIVACY_POLICY_URL)}
          >
            {t('auth.privacyPolicy', { defaultValue: '《隐私协议》' })}
          </a>
          {t('auth.termsAgreementJoin', { defaultValue: '和' })}
          <a
            className="auth-screen-footer-link"
            href={TERMS_OF_SERVICE_URL}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => openExternal(event, TERMS_OF_SERVICE_URL)}
          >
            {t('auth.userServiceAgreement', { defaultValue: '《用户服务协议》' })}
          </a>
        </>
      }
    />
  )
}
