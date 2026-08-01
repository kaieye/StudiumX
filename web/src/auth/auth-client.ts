/**
 * StudiumX-Server auth HTTP client.
 *
 * Implements the four auth endpoints from the verified server contract
 * (`/tmp/studiumx-agents/server-contracts.md` §1) and WECHAT_AUTH.md:
 *   - POST /auth/wechat/login  { code, platform: 'web' } -> session (public)
 *   - POST /auth/refresh       { refreshToken }          -> rotated session (public)
 *   - POST /auth/logout        { refreshToken } + Bearer -> { revoked } (best-effort)
 *   - GET  /auth/me            Bearer                    -> { user: { id, deviceId } }
 *
 * Token security (plan §9.3): access token in localStorage (15 min), refresh
 * token in localStorage (30 d, rotated). WeChat credentials are NEVER stored.
 *
 * API base URL is the single `API_BASE` exported by web/src/api/http.ts
 * (`import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'`).
 */

import { getAccessToken, getRefreshToken, setTokens } from './tokens'
import { API_BASE } from '../api/http'

/** Public user DTO returned by login/refresh (`toPublicUser`). */
export interface AuthUser {
  id: string
  nickname: string | null
  avatarUrl: string | null
}

/** Full session returned by login + refresh (rotated pair + user). */
export interface AuthSession {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

export interface WeChatLoginChallenge {
  url: string
  loginId: string
  state: string
}

export type WeChatPollResult =
  | { status: 'pending' | 'expired' }
  | AuthSession

/** Shape returned by GET /auth/me (id + deviceId from the access-token payload). */
export interface MeResponse {
  user: { id: string; deviceId: string }
}

/**
 * Normalized error carrying the server's `error.code` and HTTP status, so the
 * UI can branch on `UNAUTHORIZED` vs `WECHAT_API_ERROR` etc. The server error
 * envelope is `{ error: { code, message } }` (contract §0).
 */
export class AuthError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AuthError'
    this.status = status
    this.code = code
    Object.setPrototypeOf(this, AuthError.prototype)
  }
}

/** Request init restricted to plain header records (all callers use objects). */
interface JsonRequestInit extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
}

/** Parse the normalized server error envelope and throw `AuthError`. */
async function parseError(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`
  let message = res.statusText || 'request failed'
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    if (body?.error?.code) code = body.error.code
    if (body?.error?.message) message = body.error.message
  } catch {
    /* non-JSON error body; keep defaults */
  }
  throw new AuthError(res.status, code, message)
}

/** JSON request helper that throws `AuthError` on non-2xx. */
async function request<T>(path: string, init: JsonRequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  })
  if (!res.ok) await parseError(res)
  return (await res.json()) as T
}

/**
 * Exchange a WeChat authorization `code` for a StudiumX session.
 *
 * Server flow (WECHAT_AUTH.md): code2session(code) -> openid/unionid -> upsert
 * user by wechat_openid -> issue JWT pair + device row. No Bearer required.
 */
export async function loginWithWeChatCode(code: string): Promise<AuthSession> {
  return request<AuthSession>('/auth/wechat/login', {
    method: 'POST',
    body: JSON.stringify({ code, platform: 'web' })
  })
}

/** Start the server-owned WeChat QR flow using its registered callback URL. */
export async function createWeChatLoginChallenge(): Promise<WeChatLoginChallenge> {
  return request<WeChatLoginChallenge>('/auth/wechat/login-url?client=web', {
    method: 'GET'
  })
}

/** Poll a server-owned QR challenge until it returns the browser session. */
export async function pollWeChatLoginChallenge(loginId: string): Promise<WeChatPollResult> {
  return request<WeChatPollResult>(
    `/auth/desktop/poll?loginId=${encodeURIComponent(loginId)}`,
    { method: 'GET' }
  )
}

/**
 * Rotate the refresh token. Reads the current refresh token from storage, posts
 * it to `/auth/refresh`, and persists the newly rotated pair (the old refresh
 * token is revoked server-side). No Bearer required. Throws `AuthError(401)`
 * if there is no refresh token or the server rejects the rotation.
 */
export async function refreshTokens(): Promise<AuthSession> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    throw new AuthError(401, 'NO_REFRESH_TOKEN', 'no refresh token available')
  }
  const session = await request<AuthSession>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken })
  })
  setTokens(session.accessToken, session.refreshToken)
  return session
}

/**
 * End the server session. Sends the Bearer access token (web auth contract)
 * and the refresh token body (server `/auth/logout` revokes by refresh token,
 * contract §1c). Best-effort: network/HTTP failures are swallowed so callers
 * can always clear local tokens afterwards.
 */
export async function logoutServer(): Promise<void> {
  const accessToken = getAccessToken()
  const refreshToken = getRefreshToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  try {
    await fetch(API_BASE + '/auth/logout', {
      method: 'POST',
      headers,
      body: JSON.stringify({ refreshToken: refreshToken ?? '' })
    })
  } catch {
    /* network failure during logout is non-fatal */
  }
}

/**
 * Fetch the current user from `/auth/me`. On 401 (expired access token) it
 * rotates via `refreshTokens()` and retries exactly once. If there is no
 * access token at all (e.g. page reload with only a refresh token), it rotates
 * first then probes. Throws `AuthError` if the refresh also fails.
 */
export async function fetchMe(): Promise<MeResponse> {
  const fetchWith = (token: string): Promise<MeResponse> =>
    request<MeResponse>('/auth/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    })

  const accessToken = getAccessToken()
  if (!accessToken) {
    const session = await refreshTokens()
    return fetchWith(session.accessToken)
  }
  try {
    return await fetchWith(accessToken)
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) {
      const session = await refreshTokens()
      return fetchWith(session.accessToken)
    }
    throw err
  }
}
