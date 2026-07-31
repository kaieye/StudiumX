/**
 * Startup session validation for the desktop sync account.
 *
 * Validates the persisted access token against /auth/me; on 401 it tries to
 * rotate the refresh token. Mirrors the Livo `checkSession` flow but stays
 * renderer-side and reuses the StudiumX sync-store. Best-effort: any network
 * error leaves the existing (possibly still-valid) token untouched so offline
 * startup does not log the user out.
 */

import { createSyncApiClient, SyncUnauthorizedError } from './sync-api-client'
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
    // Access token expired/invalid -> try refresh.
    if (!st.refreshToken) {
      clearSyncAuth()
      return { isValid: false, reason: 'unauthorized' }
    }
    try {
      const refreshed = await client.refresh(st.refreshToken)
      setSyncAuth({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        user: refreshed.user ?? st.user,
      })
      return { isValid: true }
    } catch {
      clearSyncAuth()
      return { isValid: false, reason: 'refresh_failed' }
    }
  }
}
