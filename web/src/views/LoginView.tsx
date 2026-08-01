import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { createWeChatLoginChallenge } from '../auth/auth-client'
import { AuthLoginScreen } from '@renderer/ui/AuthLoginScreen'

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
    <AuthLoginScreen
      hasChallenge={hasChallenge}
      error={error}
      challengeStage={
        hasChallenge ? (
          <div id={QR_CONTAINER_ID} ref={qrContainerRef} className="auth-screen-wechat-widget" aria-label="微信登录二维码" />
        ) : undefined
      }
      onLogin={() => { void (hasChallenge ? retry() : startLogin()) }}
      onCancel={cancel}
    />
  )
}
