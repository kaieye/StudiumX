/**
 * Startup session validation for the desktop sync account.
 *
 * Validates the persisted access token against /auth/me; on 401 it tries to
 * rotate the refresh token. Mirrors the Livo `checkSession` flow but stays
 * renderer-side and reuses the StudiumX sync-store. Best-effort: any network
 * error leaves the existing (possibly still-valid) token untouched so offline
 * startup does not log the user out.
 */

import { createSyncApiClient, refreshSessionTokens, SyncUnauthorizedError } from './sync-api-client'
import { clearSyncAuth, getSyncState, setSyncAuth } from './sync-store'

export type SessionCheckResult =
  | { isValid: true }
  | { isValid: false; reason: 'no_token' | 'refresh_failed' | 'unauthorized' }

export async function checkSyncSession(): Promise<SessionCheckResult> {
  const st = getSyncState()
  if (!st.accessToken) return { isValid: false, reason: 'no_token' }

  const client = createSyncApiClient({
    baseUrl: st.baseUrl,
    getAccessToken: () => st.accessToken,
  })

  try {
    await client.getMe()
    return { isValid: true }
  } catch (err) {
    if (!(err instanceof SyncUnauthorizedError)) {
      // Network/server error - keep existing token, assume valid for offline use.
      return { isValid: true }
    }
    // Access token expired/invalid -> try refresh. Uses the same single-flight
    // rotation as the authenticated sync calls so the startup check and a
    // concurrent heartbeat never race the server-side token rotation.
    if (!st.refreshToken) {
      clearSyncAuth()
      return { isValid: false, reason: 'unauthorized' }
    }
    const outcome = await refreshSessionTokens({
      baseUrl: st.baseUrl,
      getRefreshToken: () => st.refreshToken,
      onTokenRefreshed: (accessToken, refreshToken) =>
        setSyncAuth({ accessToken, refreshToken, user: getSyncState().user }),
    })
    if (!outcome.ok && outcome.reason === 'rejected') {
      // A rejected refresh token means this local session is no longer valid.
      clearSyncAuth()
      return { isValid: false, reason: 'refresh_failed' }
    }
    // A successful rotation already persisted the new pair via
    // onTokenRefreshed. Network failures and 5xx responses are transient;
    // preserving the stored session lets startup and hot reload work while
    // offline or when the backend is being restarted during development.
    return { isValid: true }
  }
}
