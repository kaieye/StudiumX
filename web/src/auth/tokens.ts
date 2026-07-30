/**
 * localStorage-backed JWT token helpers for the StudiumX Web app.
 *
 * Conventions (shared with the adapter/api layer, plan §6.2 / §9.3):
 *   - access token key:  `studiumx.accessToken`  (short-lived, ~15 min)
 *   - refresh token key: `studiumx.refreshToken` (30 d, rotated server-side)
 *
 * Security red lines (WECHAT_AUTH.md / plan §9.3): WeChat `access_token` /
 * `openid` are NEVER stored here - only the StudiumX-Server-issued JWT pair.
 * The refresh token is the only long-lived credential; access tokens are
 * short-lived and refreshed transparently (see `auth-client.ts`).
 *
 * Every helper is defensive against `localStorage` being unavailable (private
 * mode / sandbox): a failed read returns `null`, a failed write is swallowed
 * so an in-memory session can still proceed.
 */

const ACCESS_TOKEN_KEY = 'studiumx.accessToken'
const REFRESH_TOKEN_KEY = 'studiumx.refreshToken'

/** Read the current access token, or `null` if absent / unreadable. */
export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY)
  } catch {
    return null
  }
}

/** Read the current refresh token, or `null` if absent / unreadable. */
export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY)
  } catch {
    return null
  }
}

/** Persist a freshly issued / rotated JWT pair. */
export function setTokens(accessToken: string, refreshToken: string): void {
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  } catch {
    /* storage unavailable (e.g. private mode); session cannot persist */
  }
}

/** Remove both tokens (called on logout / failed restore). */
export function clearTokens(): void {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/** Whether a refresh token exists (i.e. a persisted session might be restorable). */
export function hasRefreshToken(): boolean {
  return getRefreshToken() !== null
}
