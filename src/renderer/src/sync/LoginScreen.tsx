/**
 * Full-screen login interface.
 *
 * The official WeChat login widget renders the QR challenge in this card. We
 * must not re-encode the server's qrconnect URL with a generic QR library: the
 * phone confirmation flow belongs to WeChat's widget. The desktop client only
 * polls the associated loginId and stores the server-issued session.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { AuthLoginScreen } from '../ui/AuthLoginScreen'


export function LoginScreen({ onCancel }: { onCancel?: () => void }) {
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
  }, [])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setChallenge(null)
    onCancel?.()
  }, [onCancel])

  const handleWidgetError = useCallback((message: string) => {
    setChallenge(null)
    setError(message)
    abortRef.current?.abort()
  }, [])

  return (
    <AuthLoginScreen
      hasChallenge={Boolean(challenge)}
      busy={busy}
      error={error}
      challengeStage={challenge ? <WechatLoginWidget challenge={challenge} onError={handleWidgetError} /> : undefined}
      showCancel={Boolean(onCancel)}
      onLogin={() => { void handleWechatLogin() }}
      onCancel={handleCancel}
      onOpenExternal={openExternal}
    />
  )
}
