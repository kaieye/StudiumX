import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render, waitFor } from '@testing-library/react'

import type { SyncApiClient } from '../../src/renderer/src/sync/sync-api-client'
import {
  loginWithWechatQr,
  pollWechatQrLogin,
  requestWechatQrLoginChallenge
} from '../../src/renderer/src/sync/wechat-qr-login'
import {
  parseWechatLoginWidgetConfig,
  preloadWechatLoginSdk,
  WechatLoginWidget
} from '../../src/renderer/src/sync/WechatLoginWidget'

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

describe('WeChat QR login', () => {
  it('extracts official WxLogin options from the server challenge URL', () => {
    const result = parseWechatLoginWidgetConfig({
      url: 'https://open.weixin.qq.com/connect/qrconnect?appid=wx-app&redirect_uri=https%3A%2F%2Fapi.studiumx.cn%2Fauth%2Fwechat%2Fcallback&scope=snsapi_login&state=url-state#wechat_redirect',
      loginId: 'login-1',
      state: 'url-state'
    })

    expect(result).toEqual({
      appId: 'wx-app',
      redirectUri: 'https://api.studiumx.cn/auth/wechat/callback',
      state: 'url-state'
    })
  })

  it('rejects a challenge that is not the WeChat qrconnect endpoint', () => {
    expect(parseWechatLoginWidgetConfig({
      url: 'https://example.com/login?appid=wx-app&redirect_uri=https%3A%2F%2Fapi.studiumx.cn%2Fcallback&state=state',
      loginId: 'login-1',
      state: 'state'
    })).toBeNull()
  })

  it('rejects a qrconnect URL whose OAuth state does not match the login challenge', () => {
    expect(parseWechatLoginWidgetConfig({
      url: 'https://open.weixin.qq.com/connect/qrconnect?appid=wx-app&redirect_uri=https%3A%2F%2Fapi.studiumx.cn%2Fcallback&scope=snsapi_login&state=url-state',
      loginId: 'login-1',
      state: 'different-state'
    })).toBeNull()
  })

  it('mounts the official WxLogin widget instead of encoding the URL itself', async () => {
    const wxLogin = vi.fn()
    window.WxLogin = wxLogin as unknown as typeof window.WxLogin

    render(createElement(WechatLoginWidget, {
      challenge: {
      url: 'https://open.weixin.qq.com/connect/qrconnect?appid=wx-app&redirect_uri=https%3A%2F%2Fapi.studiumx.cn%2Fauth%2Fwechat%2Fcallback&scope=snsapi_login&state=url-state#wechat_redirect',
      loginId: 'login-1',
      state: 'url-state'
      }
    }))

    await waitFor(() => {
      expect(wxLogin).toHaveBeenCalledWith({
        id: 'studiumx-wechat-login-widget',
        appid: 'wx-app',
        scope: 'snsapi_login',
        redirect_uri: 'https://api.studiumx.cn/auth/wechat/callback',
        state: 'url-state',
        style: '',
        href: '',
        self_redirect: true
      })
    })

    delete window.WxLogin
  })

  it('starts fetching the fixed official SDK before a QR challenge is requested', async () => {
    document.getElementById('studiumx-wechat-login-sdk')?.remove()
    delete window.WxLogin

    preloadWechatLoginSdk()

    const script = document.getElementById('studiumx-wechat-login-sdk')
    expect(script).toBeInstanceOf(HTMLScriptElement)
    expect((script as HTMLScriptElement).src).toBe(
      'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js'
    )

    script?.dispatchEvent(new Event('error'))
    await Promise.resolve()
  })

  it('returns the challenge for an in-card QR without opening a system browser', async () => {
    const api = client()

    const result = await requestWechatQrLoginChallenge(api)

    expect(result).toEqual({
      ok: true,
      challenge: {
        url: 'https://open.weixin.qq.com/connect/qrconnect?state=test',
        loginId: 'login-1',
        state: 'state-1'
      }
    })
    expect(api.pollLoginStatus).not.toHaveBeenCalled()
  })

  it('polls an already rendered in-card QR challenge to completion', async () => {
    const api = client()

    const result = await pollWechatQrLogin(api, 'login-1')

    expect(api.getWechatLoginUrl).not.toHaveBeenCalled()
    expect(api.pollLoginStatus).toHaveBeenCalledWith('login-1')
    expect(result).toEqual({
      ok: true,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1' }
    })
  })

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
