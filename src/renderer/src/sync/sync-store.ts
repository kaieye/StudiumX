/**
 * Small sync state store (module state + useSyncExternalStore hook).
 *
 * Holds {baseUrl, accessToken, refreshToken, deviceId, user}.
 * Persisted to localStorage under key `studiumx.sync`.
 * Sync is user-initiated + login-gated; no default remote telemetry.
 * Tokens never leave this module into logs/public DTO.
 */

import { useSyncExternalStore } from 'react'
import { resolveDefaultSyncApiBase } from './sync-api-client'

export const SYNC_STORAGE_KEY = 'studiumx.sync'

// Before July 31, 2026, production builds used this development-only URL as
// their implicit default. Existing profiles persist the resolved URL, so they
// do not automatically pick up a later default change.
const LEGACY_LOCAL_SYNC_API_BASE = 'http://localhost:3000'

export type SyncAuthUser = {
  id?: string
  nickname?: string
  avatarUrl?: string
  [key: string]: unknown
}

export type SyncState = {
  baseUrl: string
  accessToken: string | null
  refreshToken: string | null
  deviceId: string | null
  user: SyncAuthUser | null
  /**
   * User consent for "学习分析同步" (MASTER_PLAN §5.4): uploads the derived
   * today summary and enables the peers-today leaderboard. Default OFF;
   * reset when a different user signs in.
   */
  analyticsSyncEnabled: boolean
}

const DEFAULT_STATE: SyncState = {
  baseUrl: resolveDefaultSyncApiBase(),
  accessToken: null,
  refreshToken: null,
  deviceId: null,
  user: null,
  analyticsSyncEnabled: false
}

const listeners = new Set<() => void>()
let state: SyncState = loadState()

// Push persisted token to main process on startup (for system-default MCP auth).
if (state.accessToken) {
  queueMicrotask(pushAccessTokenToMain)
}

function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function loadState(): SyncState {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    const { enabled: _legacyEnabled, ...parsed } = JSON.parse(raw) as Partial<SyncState> & {
      enabled?: boolean
    }
    const configuredDefault = resolveDefaultSyncApiBase()
    const storedBaseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : ''
    const migratedLegacyDefault =
      storedBaseUrl === LEGACY_LOCAL_SYNC_API_BASE &&
      configuredDefault !== LEGACY_LOCAL_SYNC_API_BASE
    const next = {
      ...DEFAULT_STATE,
      ...parsed,
      baseUrl: migratedLegacyDefault
        ? configuredDefault
        : storedBaseUrl || configuredDefault
    }

    // Persist the one-time migration immediately. Without this, the stale
    // localhost value would return after a reload and keep the login gate
    // permanently disconnected from the production API.
    if (migratedLegacyDefault) persist(next)
    return next
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function persist(next: SyncState): void {
  try {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / serialization errors */
  }
}

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  persist(state)
  listeners.forEach((listener) => listener())
}

/**
 * Push the current access token to the main process for system-default MCP
 * server authentication. Called on login, refresh, logout, and app startup.
 */
function pushAccessTokenToMain(): void {
  const token = state.accessToken
  // teachingSystem is exposed via preload; may be undefined in tests/SSR.
  const api = (globalThis as { teachingSystem?: { mcpSetStudiumxAccessToken?: (token: string | null) => Promise<void> } }).teachingSystem
  try {
    const result = api?.mcpSetStudiumxAccessToken?.(token)
    result?.catch?.(() => {})
  } catch {
    // Browser adapters intentionally throw for desktop-only capabilities.
    // Auth state must remain usable even when the optional main-process bridge
    // is unavailable.
  }
}

export function getSyncState(): SyncState {
  return state
}

export function getSyncAccessToken(): string | null {
  return state.accessToken
}

export function subscribeSyncState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState)
}

export function setSyncAuth(auth: {
  accessToken: string
  refreshToken: string
  user?: SyncAuthUser | null
}): void {
  // setSyncAuth also runs on every token refresh (~15 min TTL). Consent must
  // survive refreshes for the same user but never leak to a different one.
  const userChanged = Boolean(auth.user?.id) && state.user?.id !== auth.user?.id
  setState(
    userChanged
      ? { accessToken: auth.accessToken, refreshToken: auth.refreshToken, user: auth.user ?? null, analyticsSyncEnabled: false }
      : { accessToken: auth.accessToken, refreshToken: auth.refreshToken, user: auth.user ?? null }
  )
  pushAccessTokenToMain()
}

export function setAnalyticsSyncEnabled(enabled: boolean): void {
  setState({ analyticsSyncEnabled: enabled })
}

export function clearSyncAuth(): void {
  setState({ accessToken: null, refreshToken: null, user: null })
  pushAccessTokenToMain()
}

export function ensureDeviceId(): string {
  if (state.deviceId && state.deviceId.trim().length > 0) return state.deviceId
  const id = generateDeviceId()
  setState({ deviceId: id })
  return id
}

export function setSyncBaseUrl(baseUrl: string): void {
  const trimmed = baseUrl.trim()
  setState({ baseUrl: trimmed || resolveDefaultSyncApiBase() })
}
