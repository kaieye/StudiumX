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
import { checkSyncSession } from './session-check'
import { useSyncState } from './sync-store'
import { LoginScreen } from './LoginScreen'
import { AuthLoadingScreen } from '../ui/AuthLoadingScreen'

export function AuthGate({ children }: { children: ReactNode }) {
  const syncState = useSyncState()
  // The browser shell owns authentication in `web/src/auth/AuthContext`.
  // Mounting the desktop session validator here as well would issue a second
  // request through the Electron sync client (whose default endpoint is the
  // production sync service), briefly race the web auth mirror, and can show
  // the desktop login screen over an already-authenticated web session. The
  // outer web gate only mounts the shared renderer after its token pair has
  // been validated, so the inner desktop gate is intentionally a no-op on
  // Web while retaining the original behavior for Electron.
  const isWeb = window.teachingSystem?.platform === 'web'
  if (isWeb) return <>{children}</>

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
    return <AuthLoadingScreen />
  }

  const authenticated = Boolean(syncState.accessToken)
  if (!authenticated) {
    return <LoginScreen />
  }

  return <>{children}</>
}
