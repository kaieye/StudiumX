/**
 * App-level auth gate.
 *
 * Mirrors Livo's AuthGuard: on mount it validates the persisted session, and
 * while no valid session exists it shows the LoginScreen instead of the app.
 *
 * - `checkSyncSession` only contacts the server when a token is already
 *   present (first launch = no network call), so the splash is skipped for
 *   not-yet-logged-in users - they go straight to the login card.
 * - Reactive to the sync store: logging in hides the gate; logging out
 *   immediately re-shows it.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GraduationCap, Loader2 } from 'lucide-react'
import { checkSyncSession } from './session-check'
import { useSyncState } from './sync-store'
import { LoginScreen } from './LoginScreen'

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const syncState = useSyncState()
  // Only show the validation splash when there is a persisted token to check.
  const initialHasToken = useRef(Boolean(syncState.accessToken)).current
  const [checking, setChecking] = useState(initialHasToken)

  useEffect(() => {
    if (!initialHasToken) return
    let cancelled = false
    void (async () => {
      try {
        await checkSyncSession()
      } catch {
        // Best-effort: a network/server error leaves any existing token
        // untouched so offline startup still works.
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialHasToken])

  if (checking) {
    return (
      <div className="auth-screen auth-screen--splash" role="status" aria-live="polite">
        <div className="auth-screen-splash">
          <span className="auth-screen-logo auth-screen-logo--splash">
            <GraduationCap size={40} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <span className="auth-screen-splash-text">
            <Loader2 size={16} className="auth-screen-spinner" aria-hidden="true" />
            {t('auth.checking', { defaultValue: '正在检查登录状态…' })}
          </span>
        </div>
      </div>
    )
  }

  const authenticated = Boolean(syncState.accessToken)
  if (!authenticated) {
    return <LoginScreen />
  }

  return <>{children}</>
}
