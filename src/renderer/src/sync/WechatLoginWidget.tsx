/**
 * In-card WeChat website-login widget.
 *
 * WeChat's qrconnect URL is a browser authorization entry point, not a value
 * that can be re-encoded with a generic QR library. The official WxLogin SDK
 * creates the WeChat-owned QR challenge inside this container. The renderer
 * never receives a WeChat secret or treats the iframe as an auth authority;
 * completion still comes from polling the server-side loginId.
 */

import { useEffect, useRef } from 'react'
import type { WechatQrLoginChallenge } from './wechat-qr-login'

const WX_LOGIN_SDK_URL = 'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js'
const WX_LOGIN_SDK_SCRIPT_ID = 'studiumx-wechat-login-sdk'
const WECHAT_QRCONNECT_HOST = 'open.weixin.qq.com'
const WECHAT_QRCONNECT_PATH = '/connect/qrconnect'

type WxLoginOptions = {
  id: string
  appid: string
  scope: string
  redirect_uri: string
  state: string
  style?: string
  href?: string
  self_redirect?: boolean
}

type WxLoginConstructor = new (options: WxLoginOptions) => unknown

declare global {
  interface Window {
    WxLogin?: WxLoginConstructor
  }
}

let sdkPromise: Promise<void> | null = null

function loadWxLoginSdk(): Promise<void> {
  if (typeof window.WxLogin === 'function') return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(WX_LOGIN_SDK_SCRIPT_ID)
    if (existing instanceof HTMLScriptElement) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('微信登录组件加载失败')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = WX_LOGIN_SDK_SCRIPT_ID
    script.src = WX_LOGIN_SDK_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('微信登录组件加载失败'))
    document.head.appendChild(script)
  }).catch((error) => {
    sdkPromise = null
    throw error
  })

  return sdkPromise
}

/** Start fetching the fixed official SDK while the login screen is idle. */
export function preloadWechatLoginSdk(): void {
  void loadWxLoginSdk().catch(() => {
    // The widget will present a user-visible error and allow a retry when it
    // is actually opened. Avoid an unhandled rejection during idle preload.
  })
}

export type WechatLoginWidgetConfig = {
  appId: string
  redirectUri: string
  state: string
}

/**
 * Convert the server-issued qrconnect URL into the official SDK options.
 * Keeping this validation local prevents an arbitrary server URL from being
 * used as a frame or script source.
 */
export function parseWechatLoginWidgetConfig(
  challenge: WechatQrLoginChallenge,
): WechatLoginWidgetConfig | null {
  let parsed: URL
  try {
    parsed = new URL(challenge.url)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== WECHAT_QRCONNECT_HOST) return null
  if (parsed.pathname !== WECHAT_QRCONNECT_PATH) return null

  const appId = parsed.searchParams.get('appid')?.trim() ?? ''
  const redirectUri = parsed.searchParams.get('redirect_uri')?.trim() ?? ''
  const urlState = parsed.searchParams.get('state')?.trim() ?? ''
  const state = challenge.state.trim()
  if (!appId || !redirectUri || !state || urlState !== state) return null
  if (parsed.searchParams.get('scope') !== 'snsapi_login') return null

  let safeRedirect: URL
  try {
    safeRedirect = new URL(redirectUri)
  } catch {
    return null
  }
  if (safeRedirect.protocol !== 'https:') return null

  return { appId, redirectUri: safeRedirect.toString(), state }
}

type WechatLoginWidgetProps = {
  challenge: WechatQrLoginChallenge
  onReady?: () => void
  onError?: (message: string) => void
}

export function WechatLoginWidget({ challenge, onReady, onError }: WechatLoginWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)
  onReadyRef.current = onReady
  onErrorRef.current = onError

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.replaceChildren()
    const config = parseWechatLoginWidgetConfig(challenge)
    if (!config) {
      onErrorRef.current?.('微信登录配置无效，请刷新二维码后重试。')
      return
    }

    let active = true
    void loadWxLoginSdk()
      .then(() => {
        if (!active || !container || typeof window.WxLogin !== 'function') return

        new window.WxLogin({
          id: container.id,
          appid: config.appId,
          scope: 'snsapi_login',
          redirect_uri: config.redirectUri,
          state: config.state,
          style: '',
          href: '',
          self_redirect: true,
        })
        onReadyRef.current?.()
      })
      .catch((error: unknown) => {
        if (active) {
          onErrorRef.current?.(error instanceof Error ? error.message : '微信登录组件加载失败')
        }
      })

    return () => {
      active = false
      container.replaceChildren()
    }
  }, [challenge])

  return (
    <div
      id="studiumx-wechat-login-widget"
      ref={containerRef}
      className="auth-screen-wechat-widget"
      aria-label="微信登录二维码"
    />
  )
}
