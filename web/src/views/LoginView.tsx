import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { createWeChatLoginChallenge } from '../auth/auth-client'
import { AuthScreenLayout } from '@renderer/ui/AuthScreenLayout'
import appIcon from '../../../src/renderer/src/assets/auth/app-icon-rounded.png'
import wechatIcon from '../../../src/renderer/src/assets/auth/wechat-login.png'

const QR_CONTAINER_ID = 'studiumx-wechat-login-widget'

type LoginPhase = 'idle' | 'waiting' | 'error'

/** Browser counterpart of the desktop LoginScreen visual contract. */
export function LoginView() {
  const { loginWithChallenge } = useAuth()
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const qrContainerRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  // The WeChat callback redirects the top-level browser back with the completed
  // challenge id. Resume polling here and let AuthProvider enter the app.
  useEffect(() => {
    const loginId = new URLSearchParams(window.location.search).get('loginId')
    if (!loginId) return

    startedRef.current = true
    setPhase('waiting')
    void loginWithChallenge(loginId)
      .then(() => {
        window.history.replaceState({}, '', window.location.pathname)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : '微信登录失败，请重试。')
        setPhase('error')
        startedRef.current = false
      })
  }, [loginWithChallenge])

  const startLogin = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true
    setError(null)
    setPhase('waiting')

    void createWeChatLoginChallenge()
      .then(({ url, loginId }) => {
        const container = qrContainerRef.current
        if (!container) throw new Error('二维码容器未准备好，请重试。')
        container.replaceChildren()
        const iframe = document.createElement('iframe')
        iframe.src = url
        iframe.title = '微信扫码登录'
        iframe.width = '300'
        iframe.height = '400'
        iframe.frameBorder = '0'
        iframe.scrolling = 'no'
        container.appendChild(iframe)
        return loginWithChallenge(loginId)
      })
      .catch((reason: unknown) => {
        if (!startedRef.current) return
        setError(reason instanceof Error ? reason.message : '微信登录失败，请重试。')
        setPhase('error')
        startedRef.current = false
      })
  }, [loginWithChallenge])

  const cancel = useCallback(() => {
    startedRef.current = false
    qrContainerRef.current?.replaceChildren()
    setError(null)
    setPhase('idle')
  }, [])

  const retry = useCallback(() => {
    qrContainerRef.current?.replaceChildren()
    startedRef.current = false
    startLogin()
  }, [startLogin])

  const hasChallenge = phase === 'waiting'

  return (
    <AuthScreenLayout
      ariaLabel="登录 StudiumX"
      title="欢迎使用 StudiumX"
      error={error}
      stage={
        hasChallenge ? (
          <div className="auth-screen-qr">
            <div id={QR_CONTAINER_ID} ref={qrContainerRef} className="auth-screen-wechat-widget" aria-label="微信登录二维码" />
          </div>
        ) : (
          <img className="auth-screen-app-icon" src={appIcon} alt="" aria-hidden="true" />
        )
      }
      actions={
        hasChallenge ? (
          <div className="auth-screen-actions auth-screen-actions--inline">
            <button type="button" className="auth-screen-button auth-screen-button--ghost" onClick={retry}>刷新二维码</button>
            <button type="button" className="auth-screen-button auth-screen-button--ghost" onClick={cancel}>取消登录</button>
          </div>
        ) : (
          <div className="auth-screen-actions">
            <button type="button" className="auth-screen-button auth-screen-button--wechat" onClick={startLogin}>
              <img className="auth-screen-wechat-icon" src={wechatIcon} alt="" aria-hidden="true" />
              <span>微信扫码登录</span>
            </button>
          </div>
        )
      }
      footer={
        <>
          登录即代表您同意并遵守
          <a className="auth-screen-footer-link" href="/privacy.html" target="_blank" rel="noreferrer">《隐私协议》</a>
          和
          <a className="auth-screen-footer-link" href="/terms.html" target="_blank" rel="noreferrer">《用户服务协议》</a>
        </>
      }
    />
  )
}
