/**
 * WeChat 扫码登录编排（desktop challenge / polling flow）。
 *
 * The server issues a short-lived WeChat login URL and a loginId. The UI may
 * render that URL as an in-app QR code, while this module owns the common
 * challenge and polling protocol. The account settings flow retains its
 * system-browser fallback for callers that do not have room to render a QR.
 */

import type { SyncApiClient, SyncPollResponse } from './sync-api-client'

export type WechatQrLoginResult =
  | { ok: true; accessToken: string; refreshToken: string; user?: unknown }
  | { ok: false; error: string }

export type WechatQrLoginChallenge = {
  url: string
  loginId: string
}

export type WechatQrLoginChallengeResult =
  | { ok: true; challenge: WechatQrLoginChallenge }
  | { ok: false; error: string }

export type WechatLoginUrlOpener = (url: string) => Promise<{ ok: boolean; message?: string }>

const POLL_INTERVAL_MS = 1000
const POLL_MAX_ATTEMPTS = 300 // 5 分钟，与服务端 challenge TTL 对齐

/** Fetch the one-time WeChat URL that is encoded into the QR code. */
export async function requestWechatQrLoginChallenge(
  client: SyncApiClient,
): Promise<WechatQrLoginChallengeResult> {
  try {
    const response = await client.getWechatLoginUrl()
    return {
      ok: true,
      challenge: {
        url: response.url,
        loginId: response.loginId,
      },
    }
  } catch (err) {
    return { ok: false, error: `获取登录链接失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Poll a previously issued challenge until the mobile authorization finishes. */
export async function pollWechatQrLogin(
  client: SyncApiClient,
  loginId: string,
  onProgress?: (status: string) => void,
  signal?: AbortSignal,
): Promise<WechatQrLoginResult> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      return { ok: false, error: '登录已取消' }
    }
    let result: SyncPollResponse
    try {
      result = await client.pollLoginStatus(loginId)
    } catch {
      // 网络错误时继续重试，不立即失败。
      onProgress?.(`等待网络… (${attempt + 1}/${POLL_MAX_ATTEMPTS})`)
      await delay(POLL_INTERVAL_MS, signal)
      continue
    }

    if (result.status === 'completed' && result.accessToken && result.refreshToken) {
      return {
        ok: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      }
    }
    if (result.status === 'expired') {
      return { ok: false, error: '登录会话已过期，请重新扫码' }
    }

    onProgress?.(`等待扫码确认… (${attempt + 1}/${POLL_MAX_ATTEMPTS})`)
    await delay(POLL_INTERVAL_MS, signal)
  }
  return { ok: false, error: '登录超时，请重试' }
}

/**
 * Compatibility flow for surfaces that cannot render a QR card themselves.
 * The login gate uses `requestWechatQrLoginChallenge` + `pollWechatQrLogin`
 * directly so it never opens the system browser.
 */
export async function loginWithWechatQr(
  client: SyncApiClient,
  onProgress?: (status: string) => void,
  signal?: AbortSignal,
  openLoginUrl: WechatLoginUrlOpener = (url) => window.teachingSystem.openExternal(url),
): Promise<WechatQrLoginResult> {
  const challengeResult = await requestWechatQrLoginChallenge(client)
  if (!challengeResult.ok) return challengeResult

  try {
    const opened = await openLoginUrl(challengeResult.challenge.url)
    if (!opened.ok) {
      return { ok: false, error: `无法打开系统浏览器${opened.message ? `：${opened.message}` : ''}` }
    }
  } catch (err) {
    return { ok: false, error: `无法打开系统浏览器：${err instanceof Error ? err.message : String(err)}` }
  }

  return pollWechatQrLogin(client, challengeResult.challenge.loginId, onProgress, signal)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
