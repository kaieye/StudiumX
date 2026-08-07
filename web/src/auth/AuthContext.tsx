/**
 * Auth context + provider for the StudiumX Web app.
 *
 * Exposes `{ user, status, login, logout }` where `status` is one of
 * `'loading' | 'authenticated' | 'unauthenticated'`. The application remains
 * available in local mode; status is used by explicitly protected features
 * and the account settings login flow.
 *
 * Lifecycle:
 *   - On mount: if `hasRefreshToken()`, call `fetchMe()` (which transparently
 *     rotates on 401) to restore the user -> `authenticated`; otherwise
 *     `unauthenticated`. A failed restore clears tokens -> `unauthenticated`.
 *   - `login(code)`: `loginWithWeChatCode` -> `setTokens` -> user from the
 *     session DTO (full nickname/avatarUrl).
 *   - `logout()`: `logoutServer()` (best-effort) -> `clearTokens` ->
 *     `unauthenticated`.
 *
 * Note on `/auth/me` (contract §1d): it returns only `{ user: { id, deviceId } }`
 * (from the access-token payload), NOT the full PublicUser DTO. So a session
 * restored purely via `fetchMe` has `nickname`/`avatarUrl` as `null` until the
 * next login/refresh surfaces the full profile. This is acceptable for Phase 2
 * (the gate only needs `id` + authenticated status).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  fetchMe,
  loginWithWeChatCode,
  pollWeChatLoginChallenge,
  logoutServer,
  AuthError,
  type AuthUser
} from './auth-client'
import { clearTokens, getAccessToken, getRefreshToken, hasRefreshToken, setTokens } from './tokens'
import { clearSyncAuth, setSyncAuth, useSyncState } from '@renderer/sync/sync-store'

// Keep the renderer's canonical sync auth store in lockstep with the Web
// session so the shared desktop App can reuse its existing AuthGate.
// This only mirrors the server-issued JWT pair; it does not enable desktop
// teaching execution in the browser adapter.

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthState {
  user: AuthUser | null
  status: AuthStatus
}

export interface AuthContextValue extends AuthState {
  /** Exchange a WeChat `code` for a session and authenticate. */
  login: (code: string) => Promise<void>
  /** Poll a server-owned WeChat QR challenge and authenticate. */
  loginWithChallenge: (loginId: string) => Promise<void>
  /** End the server session (best-effort) and clear local tokens. */
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, status: 'loading' })
  const syncState = useSyncState()

  // The shared desktop renderer owns the account/settings surface and clears
  // the canonical sync store when its logout action is used. Mirror that
  // transition back into the browser auth context so Web tokens cannot remain
  // persisted after the user logs out from the shared UI.
  useEffect(() => {
    if (state.status !== 'authenticated' || syncState.accessToken) return
    clearTokens()
    setState({ user: null, status: 'unauthenticated' })
  }, [state.status, syncState.accessToken])

  // Restore any persisted session on mount. Only a definitive rejection
  // (AuthError 401) wipes the stored session; transient server/network
  // failures retry with backoff while staying 'loading', so a backend restart
  // or a momentary outage cannot force a re-login. If the retry budget runs
  // out the login screen is shown with the tokens intact — a reload retries.
  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const MAX_RESTORE_ATTEMPTS = 3
    async function restore(): Promise<void> {
      if (!hasRefreshToken()) {
        if (!cancelled) setState({ user: null, status: 'unauthenticated' })
        return
      }
      try {
        const me = await fetchMe()
        if (cancelled) return
        attempts = 0
        const accessToken = getAccessToken()
        const refreshToken = getRefreshToken()
        if (accessToken && refreshToken) {
          setSyncAuth({
            accessToken,
            refreshToken,
            user: {
              id: me.user.id,
              nickname: me.user.nickname ?? undefined,
              avatarUrl: me.user.avatarUrl ?? undefined,
            },
          })
        }
        setState({ user: me.user, status: 'authenticated' })
      } catch (err) {
        if (cancelled) return
        if (err instanceof AuthError && err.status === 401) {
          // Definitive: the session can no longer be renewed.
          clearTokens()
          clearSyncAuth()
          setState({ user: null, status: 'unauthenticated' })
          return
        }
        // Transient — retry with backoff (1s / 2s / 4s).
        attempts += 1
        if (attempts <= MAX_RESTORE_ATTEMPTS) {
          window.setTimeout(() => {
            void restore()
          }, 1000 * 2 ** (attempts - 1))
          return
        }
        clearSyncAuth()
        setState({ user: null, status: 'unauthenticated' })
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  // A desktop login revokes this browser's refresh session on the server.
  // Poll /auth/me so an already-open web tab transitions to the login screen
  // promptly instead of waiting for the short-lived access JWT to expire.
  useEffect(() => {
    if (state.status !== 'authenticated') return
    let cancelled = false
    const checkSession = async () => {
      try {
        await fetchMe()
      } catch (err) {
        // Do not turn a transient network outage or server 5xx into a local
        // logout. Only a definitive rejection (AuthError with status 401 —
        // revoked/expired refresh token) ends the session.
        if (cancelled || !(err instanceof AuthError) || err.status !== 401) return
        clearTokens()
        clearSyncAuth()
        setState({ user: null, status: 'unauthenticated' })
      }
    }
    const timer = window.setInterval(() => {
      void checkSession()
    }, 15_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [state.status])

  const login = useCallback(async (code: string): Promise<void> => {
    const session = await loginWithWeChatCode(code)
    setTokens(session.accessToken, session.refreshToken)
    setSyncAuth({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: { id: session.user.id, nickname: session.user.nickname ?? undefined, avatarUrl: session.user.avatarUrl ?? undefined } })
    setState({ user: session.user, status: 'authenticated' })
  }, [])

  const loginWithChallenge = useCallback(async (loginId: string): Promise<void> => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < 5 * 60 * 1000) {
      const result = await pollWeChatLoginChallenge(loginId)
      if ('accessToken' in result) {
        setTokens(result.accessToken, result.refreshToken)
        setSyncAuth({ accessToken: result.accessToken, refreshToken: result.refreshToken, user: { id: result.user.id, nickname: result.user.nickname ?? undefined, avatarUrl: result.user.avatarUrl ?? undefined } })
        setState({ user: result.user, status: 'authenticated' })
        return
      }
      if (result.status === 'expired') throw new Error('二维码已过期，请重新扫码。')
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1500))
    }
    throw new Error('登录等待超时，请重新扫码。')
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutServer()
    } catch {
      /* best-effort: clear locally regardless */
    }
    clearTokens()
    clearSyncAuth()
    setState({ user: null, status: 'unauthenticated' })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, loginWithChallenge, logout }),
    [state, login, loginWithChallenge, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Access the auth context; throws if used outside an `AuthProvider`. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
