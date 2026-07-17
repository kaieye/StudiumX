import { BrowserWindow, session, shell } from 'electron'
import { parseCookieHeader } from './music-cookie-store'
import { normalizeQQCookieInput } from './qq-service'

const NETEASE_LOGIN_PARTITION = 'persist:studiumx-netease-login'
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login'
const QQ_LOGIN_PARTITION = 'persist:studiumx-qqmusic-login'
const QQ_LOGIN_URL = 'https://y.qq.com/n/ryqq/profile'

function normalizeQQUin(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  return digits.replace(/^0+/, '') || digits
}

function qqCookieUin(cookie: Record<string, string>): string {
  const raw =
    Number(cookie.login_type) === 2
      ? cookie.wxuin || cookie.uin || cookie.p_uin
      : cookie.uin || cookie.qqmusic_uin || cookie.wxuin || cookie.p_uin
  return normalizeQQUin(raw || '')
}

function qqCookieMusicKey(cookie: Record<string, string>): string {
  return (
    cookie.qm_keyst ||
    cookie.qqmusic_key ||
    cookie.music_key ||
    cookie.p_skey ||
    cookie.skey ||
    cookie.psrf_qqaccess_token ||
    cookie.psrf_qqrefresh_token ||
    cookie.wxrefresh_token ||
    cookie.wxskey ||
    ''
  )
}

function qqCookiePlaybackKey(cookie: Record<string, string>): string {
  return cookie.qm_keyst || cookie.qqmusic_key || cookie.music_key || cookie.wxskey || ''
}

function qqCookieHasLogin(cookieText: string): boolean {
  const cookie = parseCookieHeader(cookieText)
  return Boolean(qqCookieUin(cookie) && qqCookieMusicKey(cookie))
}

function qqCookieHasPlaybackLogin(cookieText: string): boolean {
  const cookie = parseCookieHeader(cookieText)
  return Boolean(qqCookieUin(cookie) && qqCookiePlaybackKey(cookie))
}

function neteaseCookieHasLogin(cookieText: string): boolean {
  const cookie = parseCookieHeader(cookieText)
  return Boolean(cookie.MUSIC_U)
}

function isQQCookieDomain(domain: string | undefined): boolean {
  const value = String(domain || '').toLowerCase()
  return value.includes('qq.com') || value.includes('y.qq.com') || value.includes('tencent')
}

function isNeteaseCookieDomain(domain: string | undefined): boolean {
  const value = String(domain || '').toLowerCase()
  return value.includes('163.com') || value.includes('netease') || value.includes('music.163')
}

function buildCookieHeader(
  cookies: Electron.Cookie[],
  isAllowedDomain: (domain: string | undefined) => boolean,
  priority: string[]
): string {
  const picked = new Map<string, string>()
  for (const cookie of cookies || []) {
    if (!cookie?.name || !isAllowedDomain(cookie.domain)) continue
    picked.set(cookie.name, cookie.value || '')
  }
  const ordered: string[] = []
  for (const name of priority) {
    if (picked.has(name)) {
      ordered.push(`${name}=${picked.get(name)}`)
      picked.delete(name)
    }
  }
  for (const [name, value] of picked) ordered.push(`${name}=${value}`)
  return ordered.join('; ')
}

async function readNeteaseLoginCookieHeader(cookieSession: Electron.Session): Promise<string> {
  const cookies = await cookieSession.cookies.get({})
  return buildCookieHeader(cookies, isNeteaseCookieDomain, [
    'MUSIC_U',
    'MUSIC_A',
    '__csrf',
    'NMTID',
    'os',
    'appver',
    'deviceId'
  ])
}

async function readQQLoginCookieHeader(cookieSession: Electron.Session): Promise<string> {
  const cookies = await cookieSession.cookies.get({})
  return normalizeQQCookieInput(
    buildCookieHeader(cookies, isQQCookieDomain, [
      'uin',
      'qqmusic_uin',
      'wxuin',
      'p_uin',
      'login_type',
      'qm_keyst',
      'qqmusic_key',
      'music_key',
      'wxskey',
      'p_skey',
      'skey',
      'psrf_qqaccess_token',
      'psrf_qqrefresh_token',
      'wxrefresh_token'
    ])
  )
}

function createLoginWindow(
  owner: BrowserWindow | null,
  options: {
    width: number
    height: number
    minWidth: number
    minHeight: number
    title: string
    partition: string
  }
): BrowserWindow {
  const loginWindow = new BrowserWindow({
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    title: options.title,
    parent: owner && !owner.isDestroyed() ? owner : undefined,
    modal: Boolean(owner && !owner.isDestroyed()),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      partition: options.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  return loginWindow
}

export type MusicLoginWindowResult =
  | { ok: true; cookie: string; reused?: boolean; partial?: boolean }
  | { ok: false; cancelled?: boolean; message?: string; error?: string }

export async function openNeteaseMusicLoginWindow(
  owner: BrowserWindow | null
): Promise<MusicLoginWindowResult> {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION)
  const initialCookie = await readNeteaseLoginCookieHeader(cookieSession)
  if (neteaseCookieHasLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true }

  return new Promise((resolve) => {
    let settled = false
    let pollTimer: NodeJS.Timeout | null = null
    const loginWindow = createLoginWindow(owner, {
      width: 900,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      title: '网易云音乐登录',
      partition: NETEASE_LOGIN_PARTITION
    })

    const finish = (result: MusicLoginWindowResult): void => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      if (!loginWindow.isDestroyed()) loginWindow.close()
      resolve(result)
    }

    const checkCookies = async (): Promise<void> => {
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession)
        if (neteaseCookieHasLogin(cookie)) finish({ ok: true, cookie })
      } catch (error) {
        console.warn('Netease login cookie check failed:', (error as Error).message)
      }
    }

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i.test(url)) {
        void loginWindow.loadURL(url).catch((error) =>
          console.warn('Netease login popup navigation failed:', error.message)
        )
      } else {
        void shell.openExternal(url).catch(() => {})
      }
      return { action: 'deny' }
    })

    loginWindow.webContents.on('did-finish-load', () => {
      void checkCookies()
      void loginWindow.webContents
        .executeJavaScript(
          `
        setTimeout(() => {
          const docs = [document];
          try { if (document.documentElement) docs.push(document.documentElement); } catch (_) {}
          for (const doc of docs) {
            const nodes = Array.from(doc.querySelectorAll('a, button, span, div'));
            const loginNode = nodes.find((node) => {
              const text = (node.textContent || '').trim();
              if (!/登录|立即登录/.test(text)) return false;
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            if (loginNode) { loginNode.click(); return true; }
          }
          return false;
        }, 900);
      `,
          true
        )
        .catch(() => {})
    })

    loginWindow.on('ready-to-show', () => loginWindow.show())
    loginWindow.on('closed', async () => {
      if (settled) return
      if (pollTimer) clearInterval(pollTimer)
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession)
        resolve(
          neteaseCookieHasLogin(cookie)
            ? { ok: true, cookie }
            : { ok: false, cancelled: true, message: '网易云登录窗口已关闭' }
        )
      } catch (error) {
        resolve({ ok: false, error: (error as Error).message || '网易云登录窗口已关闭' })
      }
    })

    pollTimer = setInterval(() => {
      void checkCookies()
    }, 1200)
    void loginWindow
      .loadURL(NETEASE_LOGIN_URL)
      .catch((error) => finish({ ok: false, error: error.message }))
  })
}

export async function openQQMusicLoginWindow(owner: BrowserWindow | null): Promise<MusicLoginWindowResult> {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION)
  const initialCookie = await readQQLoginCookieHeader(cookieSession)
  if (qqCookieHasPlaybackLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true }

  return new Promise((resolve) => {
    let settled = false
    let pollTimer: NodeJS.Timeout | null = null
    let warmupStarted = false
    const loginWindow = createLoginWindow(owner, {
      width: 900,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      title: 'QQ 音乐登录',
      partition: QQ_LOGIN_PARTITION
    })

    const finish = (result: MusicLoginWindowResult): void => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      if (!loginWindow.isDestroyed()) loginWindow.close()
      resolve(result)
    }

    const checkCookies = async (): Promise<void> => {
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession)
        if (qqCookieHasPlaybackLogin(cookie)) {
          finish({ ok: true, cookie })
        } else if (qqCookieHasLogin(cookie) && !warmupStarted) {
          warmupStarted = true
          setTimeout(() => {
            if (!settled && !loginWindow.isDestroyed()) {
              void loginWindow
                .loadURL('https://y.qq.com/n/ryqq/player')
                .catch((error) => console.warn('QQ login warmup navigation failed:', error.message))
            }
          }, 900)
        }
      } catch (error) {
        console.warn('QQ login cookie check failed:', (error as Error).message)
      }
    }

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void loginWindow.loadURL(url).catch((error) =>
          console.warn('QQ login popup navigation failed:', error.message)
        )
      } else {
        void shell.openExternal(url).catch(() => {})
      }
      return { action: 'deny' }
    })

    loginWindow.webContents.on('did-finish-load', () => {
      void checkCookies()
      void loginWindow.webContents
        .executeJavaScript(
          `
        setTimeout(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
          const loginNode = nodes.find((node) => {
            const text = (node.textContent || '').trim();
            if (!/登录|登陆/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (loginNode) loginNode.click();
        }, 700);
      `,
          true
        )
        .catch(() => {})
    })

    loginWindow.on('ready-to-show', () => loginWindow.show())
    loginWindow.on('closed', async () => {
      if (settled) return
      if (pollTimer) clearInterval(pollTimer)
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession)
        resolve(
          qqCookieHasLogin(cookie)
            ? { ok: true, cookie, partial: !qqCookieHasPlaybackLogin(cookie) }
            : { ok: false, cancelled: true, message: 'QQ 音乐登录窗口已关闭' }
        )
      } catch (error) {
        resolve({ ok: false, error: (error as Error).message || 'QQ 音乐登录窗口已关闭' })
      }
    })

    pollTimer = setInterval(() => {
      void checkCookies()
    }, 1200)
    void loginWindow.loadURL(QQ_LOGIN_URL).catch((error) => finish({ ok: false, error: error.message }))
  })
}

export async function clearMusicLoginSession(provider: 'netease' | 'qq'): Promise<void> {
  const partition = provider === 'netease' ? NETEASE_LOGIN_PARTITION : QQ_LOGIN_PARTITION
  const cookieSession = session.fromPartition(partition)
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage']
  })
}
