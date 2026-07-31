/**
 * WeChat扫码登录编排 (desktop challenge/poll flow).
 *
 * Mirrors the Livo reference flow but stays renderer-side to reuse the
 * existing StudiumX sync-store + sync-api-client:
 *   1. GET /auth/wechat/login-url?client=desktop  -> { url, loginId, state }
 *   2. 通过受控 preload IPC 在系统浏览器中打开 URL，用户扫码
 *   3. 轮询 GET /auth/desktop/poll?loginId= 直到 completed / expired
 *   4. completed 时返回 { accessToken, refreshToken, user }
 *
 * 服务器作为微信回调目标，完成 challenge 后桌面端通过轮询拿到令牌，
 * 这与 Livo (Redis challenge) 的语义一致，但 StudiumX-Server 无需 Redis。
 */

import type { SyncApiClient, SyncPollResponse } from './sync-api-client'

export type WechatQrLoginResult =
  | { ok: true; accessToken: string; refreshToken: string; user?: unknown }
  | { ok: false; error: string }

export type WechatLoginUrlOpener = (url: string) => Promise<{ ok: boolean; message?: string }>

const POLL_INTERVAL_MS = 1000
const POLL_MAX_ATTEMPTS = 300 // 5 分钟，与服务端 challenge TTL 对齐

/**
 * 执行一次完整的微信扫码登录。
 *
 * @param client 已配置 baseUrl 的 sync api client
 * @param onProgress 可选的进度回调 (用于 UI 显示 "等待扫码...")
 * @param signal 可选的 AbortSignal，取消时中止轮询
 * @param openLoginUrl 可替换的 URL opener；默认经 preload IPC 在系统浏览器打开
 */
export async function loginWithWechatQr(
  client: SyncApiClient,
  onProgress?: (status: string) => void,
  signal?: AbortSignal,
  openLoginUrl: WechatLoginUrlOpener = (url) => window.teachingSystem.openExternal(url),
): Promise<WechatQrLoginResult> {
  let loginUrlRes
  try {
    loginUrlRes = await client.getWechatLoginUrl()
  } catch (err) {
    return { ok: false, error: `获取登录链接失败：${err instanceof Error ? err.message : String(err)}` }
  }

  // 主窗口的 window.open 会被 Electron 的安全策略拒绝并转交系统浏览器，
  // 因而不能依赖 WindowProxy / popup.closed。显式走 preload IPC，打开后仅轮询服务端。
  try {
    const opened = await openLoginUrl(loginUrlRes.url)
    if (!opened.ok) {
      return { ok: false, error: `无法打开系统浏览器${opened.message ? `：${opened.message}` : ''}` }
    }
  } catch (err) {
    return { ok: false, error: `无法打开系统浏览器：${err instanceof Error ? err.message : String(err)}` }
  }

  const { loginId } = loginUrlRes

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      return { ok: false, error: '登录已取消' }
    }
    let result: SyncPollResponse
    try {
      result = await client.pollLoginStatus(loginId)
    } catch (err) {
      // 网络错误时继续重试，不立即失败
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
