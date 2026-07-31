/**
 * Auth context + provider for the StudiumX Web app.
 *
 * Exposes `{ user, status, login, logout }` where `status` is one of
 * `'loading' | 'authenticated' | 'unauthenticated'`. The protected app shell
 * (App.tsx) gates rendering on `status`.
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
  type AuthUser
} from './auth-client'
import { clearTokens, hasRefreshToken, setTokens } from './tokens'

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

  // Restore any persisted session on mount.
  useEffect(() => {
    let cancelled = false
    async function restore(): Promise<void> {
      if (!hasRefreshToken()) {
        if (!cancelled) setState({ user: null, status: 'unauthenticated' })
        return
      }
      try {
        const me = await fetchMe()
        if (cancelled) return
        setState({
          user: { id: me.user.id, nickname: null, avatarUrl: null },
          status: 'authenticated'
        })
      } catch {
        if (cancelled) return
        clearTokens()
        setState({ user: null, status: 'unauthenticated' })
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (code: string): Promise<void> => {
    const session = await loginWithWeChatCode(code)
    setTokens(session.accessToken, session.refreshToken)
    setState({ user: session.user, status: 'authenticated' })
  }, [])

  const loginWithChallenge = useCallback(async (loginId: string): Promise<void> => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < 5 * 60 * 1000) {
      const result = await pollWeChatLoginChallenge(loginId)
      if ('accessToken' in result) {
        setTokens(result.accessToken, result.refreshToken)
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
