import { describe, expect, it, vi } from 'vitest'

import type { SyncApiClient } from '../../src/renderer/src/sync/sync-api-client'
import { loginWithWechatQr } from '../../src/renderer/src/sync/wechat-qr-login'

function client(overrides: Partial<SyncApiClient> = {}): SyncApiClient {
  return {
    getWechatLoginUrl: vi.fn().mockResolvedValue({
      url: 'https://open.weixin.qq.com/connect/qrconnect?state=test',
      loginId: 'login-1',
      state: 'state-1'
    }),
    pollLoginStatus: vi.fn().mockResolvedValue({
      status: 'completed',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1' }
    }),
    ...overrides
  } as SyncApiClient
}

describe('loginWithWechatQr', () => {
  it('opens the remote WeChat URL through the injected system-browser opener and polls to completion', async () => {
    const api = client()
    const openLoginUrl = vi.fn().mockResolvedValue({ ok: true })

    const result = await loginWithWechatQr(api, undefined, undefined, openLoginUrl)

    expect(openLoginUrl).toHaveBeenCalledWith(
      'https://open.weixin.qq.com/connect/qrconnect?state=test'
    )
    expect(api.pollLoginStatus).toHaveBeenCalledWith('login-1')
    expect(result).toEqual({
      ok: true,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1' }
    })
  })

  it('does not poll when the system browser rejects the login URL', async () => {
    const api = client()
    const openLoginUrl = vi.fn().mockResolvedValue({ ok: false, message: 'external links disabled' })

    const result = await loginWithWechatQr(api, undefined, undefined, openLoginUrl)

    expect(api.pollLoginStatus).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      error: '无法打开系统浏览器：external links disabled'
    })
  })

  it('does not open a browser when the remote login-url request fails', async () => {
    const api = client({
      getWechatLoginUrl: vi.fn().mockRejectedValue(new Error('network down'))
    })
    const openLoginUrl = vi.fn().mockResolvedValue({ ok: true })

    const result = await loginWithWechatQr(api, undefined, undefined, openLoginUrl)

    expect(openLoginUrl).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: '获取登录链接失败：network down' })
  })
})
