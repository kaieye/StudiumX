/**
 * WeChat扫码登录编排 (desktop challenge/poll flow).
 *
 * Mirrors the Livo reference flow but stays renderer-side to reuse the
 * existing StudiumX sync-store + sync-api-client:
 *   1. GET /auth/wechat/login-url?client=desktop  -> { url, loginId, state }
 *   2. window.open(url) - 用户在弹窗中扫码
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

const POLL_INTERVAL_MS = 1000
const POLL_MAX_ATTEMPTS = 300 // 5 分钟，与服务端 challenge TTL 对齐

/**
 * 执行一次完整的微信扫码登录。
 *
 * @param client 已配置 baseUrl 的 sync api client
 * @param onProgress 可选的进度回调 (用于 UI 显示 "等待扫码...")
 * @param signal 可选的 AbortSignal，用户关闭弹窗或取消时中止轮询
 */
export async function loginWithWechatQr(
  client: SyncApiClient,
  onProgress?: (status: string) => void,
  signal?: AbortSignal,
): Promise<WechatQrLoginResult> {
  let loginUrlRes
  try {
    loginUrlRes = await client.getWechatLoginUrl()
  } catch (err) {
    return { ok: false, error: `获取登录链接失败：${err instanceof Error ? err.message : String(err)}` }
  }

  // 打开扫码弹窗。window.open 在 Electron renderer 中会创建新窗口。
  const popup = window.open(loginUrlRes.url, 'studiumx-wechat-login', 'width=500,height=650')
  if (!popup) {
    return { ok: false, error: '无法打开登录窗口，请检查浏览器弹窗拦截设置' }
  }

  const { loginId } = loginUrlRes

  try {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) {
        return { ok: false, error: '登录已取消' }
      }
      // 弹窗被用户关闭 -> 取消
      if (popup.closed) {
        return { ok: false, error: '登录已取消 - 窗口已关闭' }
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
        try {
          popup.close()
        } catch {
          /* ignore */
        }
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
  } finally {
    if (!popup.closed) {
      try {
        popup.close()
      } catch {
        /* ignore */
      }
    }
  }
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
