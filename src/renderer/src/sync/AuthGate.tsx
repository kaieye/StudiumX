/**
 * Auth gate for an explicitly protected feature.
 *
 * The application itself is usable in local mode. Callers mount this gate
 * only around features that require an account, such as the online study
 * room. It validates a persisted session before exposing its children and
 * otherwise presents the existing login flow.
 *
 * - `checkSyncSession` only contacts the server when a token is already
 *   present, so a guest does not cause an auth-related network request.
 * - Reactive to the sync store: logging in exposes the feature; logging out
 *   returns to its login prompt.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { checkSyncSession } from './session-check'
import { useSyncState } from './sync-store'
import { LoginScreen } from './LoginScreen'
import { AuthLoadingScreen } from '../ui/AuthLoadingScreen'

export function AuthGate({ children, onCancel }: { children: ReactNode; onCancel?: () => void }) {
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
    return <AuthLoadingScreen />
  }

  const authenticated = Boolean(syncState.accessToken)
  if (!authenticated) {
    return <LoginScreen onCancel={onCancel} />
  }

  return <>{children}</>
}
