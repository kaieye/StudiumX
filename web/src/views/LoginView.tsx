/**
 * WeChat login page for StudiumX Web (plan §7.1 / §8 Phase 2).
 *
 * Flow per `WECHAT_AUTH.md` (web = 网页扫码授权, `snsapi_login`):
 *   1. Show the WeChat Open Platform QR (`open.weixin.qq.com/connect/qrconnect`,
 *      scope `snsapi_login`). Rendered inline via the official `WxLogin` JS SDK
 *      when available, with a redirect-to-qrconnect fallback.
 *   2. User scans + authorizes in WeChat mobile.
 *   3. WeChat redirects the page back to `redirect_uri?code=...&state=...`
 *      (redirect-based - WECHAT_AUTH.md specifies no QR-polling).
 *   4. This view consumes `code` from the URL and calls `login(code)`
 *      (AuthProvider -> POST /auth/wechat/login) -> session stored -> the
 *      public-only route wrapper redirects to the dashboard.
 *
 * CSRF: a random `state` is generated per attempt, stored in sessionStorage,
 * and verified on the callback. The WeChat `access_token`/`openid` never reach
 * the client or storage (plan §9.3).
 *
 * Config (Vite env): `VITE_WECHAT_APP_ID`, `VITE_WECHAT_REDIRECT_URI`
 * (defaults to `${origin}/login`). Without an AppID the embedded QR cannot be
 * rendered; the redirect link + a dev notice are shown instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

const WECHAT_APP_ID: string = import.meta.env.VITE_WECHAT_APP_ID ?? ''
const WECHAT_QRCONNECT_URL = 'https://open.weixin.qq.com/connect/qrconnect'
const WX_LOGIN_SDK_URL = 'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js'
const QR_CONTAINER_ID = 'wx-login-qrcode'
const STATE_STORAGE_KEY = 'studiumx.wechat.oauthState'

type LoginPhase = 'idle' | 'exchanging' | 'error'

interface WxLoginOptions {
  id: string
  appid: string
  scope: string
  redirect_uri: string
  state: string
  style?: string
  href?: string
}
type WxLoginCtor = (options: WxLoginOptions) => void

function getRedirectUri(): string {
  const configured: string = import.meta.env.VITE_WECHAT_REDIRECT_URI ?? ''
  if (configured.length > 0) return configured
  return `${window.location.origin}/login`
}

function buildQrConnectUrl(state: string): string {
  const params = new URLSearchParams({
    appid: WECHAT_APP_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'snsapi_login',
    state
  })
  return `${WECHAT_QRCONNECT_URL}?${params.toString()}#wechat_redirect`
}

function generateState(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function readStoredState(): string {
  const existing = sessionStorage.getItem(STATE_STORAGE_KEY)
  if (existing) return existing
  const fresh = generateState()
  sessionStorage.setItem(STATE_STORAGE_KEY, fresh)
  return fresh
}

/** Remove ?code=&state= from the address bar so a refresh does not replay. */
function cleanUrl(): void {
  window.history.replaceState({}, '', window.location.pathname)
}

export function LoginView() {
  const { login } = useAuth()
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [error, setError] = useState<string>('')
  const [state, setState] = useState<string>(readStoredState)
  const [sdkReady, setSdkReady] = useState<boolean>(false)
  const qrContainerRef = useRef<HTMLDivElement>(null)
  const sdkInjectedRef = useRef<boolean>(false)

  // 1) Consume the WeChat redirect callback (?code=&state=).
  const consumeCallback = useCallback(
    async (oauthState: string): Promise<void> => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const returnedState = params.get('state')
      if (!code) return

      // CSRF guard: state must match the one we issued for this attempt.
      if (returnedState && returnedState !== oauthState) {
        setError('登录状态校验失败（state 不匹配），请重新扫码登录。')
        setPhase('error')
        sessionStorage.removeItem(STATE_STORAGE_KEY)
        cleanUrl()
        return
      }

      setPhase('exchanging')
      sessionStorage.removeItem(STATE_STORAGE_KEY)
      cleanUrl()
      try {
        await login(code)
        // Success: AuthProvider flips `status` to 'authenticated'; the
        // public-only route wrapper (App.tsx) redirects to the dashboard.
      } catch (err) {
        setError(err instanceof Error ? err.message : '微信登录失败，请重试。')
        setPhase('error')
      }
    },
    [login]
  )

  useEffect(() => {
    void consumeCallback(state)
  }, [consumeCallback, state])

  // 2) Render the embedded WeChat QR via the official WxLogin SDK (best-effort).
  useEffect(() => {
    if (phase !== 'idle' || !WECHAT_APP_ID || sdkInjectedRef.current) return
    sdkInjectedRef.current = true
    const script = document.createElement('script')
    script.src = WX_LOGIN_SDK_URL
    script.async = true
    script.onload = () => {
      const ctor = (window as unknown as { WxLogin?: WxLoginCtor }).WxLogin
      if (ctor && qrContainerRef.current) {
        ctor({
          id: QR_CONTAINER_ID,
          appid: WECHAT_APP_ID,
          scope: 'snsapi_login',
          redirect_uri: getRedirectUri(),
          state,
          style: '',
          href: ''
        })
        setSdkReady(true)
      }
    }
    // onerror: leave the redirect fallback visible (no embedded QR).
    document.head.appendChild(script)
  }, [phase, state])

  const handleRedirectLogin = useCallback(() => {
    sessionStorage.setItem(STATE_STORAGE_KEY, state)
    window.location.href = buildQrConnectUrl(state)
  }, [state])

  const handleRetry = useCallback(() => {
    setError('')
    const fresh = generateState()
    sessionStorage.setItem(STATE_STORAGE_KEY, fresh)
    setState(fresh)
    sdkInjectedRef.current = false
    setSdkReady(false)
    setPhase('idle')
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">登录 StudiumX Web</h1>
          <p className="mt-1 text-sm text-neutral-500">使用微信扫码登录</p>
        </div>

        {phase === 'exchanging' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
            <span className="text-sm text-neutral-500">正在登录…</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-center text-sm text-red-600" role="alert">
              {error}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
            >
              重新登录
            </button>
          </div>
        )}

        {phase === 'idle' && (
          <div className="flex flex-col items-center gap-5">
            {WECHAT_APP_ID ? (
              <>
                <div
                  id={QR_CONTAINER_ID}
                  ref={qrContainerRef}
                  className="flex h-64 w-64 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50"
                >
                  {!sdkReady && (
                    <div className="flex flex-col items-center gap-2 text-neutral-400">
                      <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-400" />
                      <span className="text-xs">二维码加载中…</span>
                    </div>
                  )}
                </div>
                <p className="text-center text-xs text-neutral-400">
                  请使用微信扫描二维码完成授权登录
                </p>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-center text-xs text-amber-700">
                微信登录未配置。<br />
                请设置 <code>VITE_WECHAT_APP_ID</code> 与{' '}
                <code>VITE_WECHAT_REDIRECT_URI</code>（微信开放平台 snsapi_login）。
              </div>
            )}

            <button
              type="button"
              onClick={handleRedirectLogin}
              disabled={!WECHAT_APP_ID}
              className="w-full rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              在新页面打开微信登录
            </button>
            <p className="text-center text-xs text-neutral-400">
              授权后将自动返回并完成登录。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
