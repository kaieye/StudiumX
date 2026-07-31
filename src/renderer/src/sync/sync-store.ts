/**
 * Small sync state store (module state + useSyncExternalStore hook).
 *
 * Holds {baseUrl, accessToken, refreshToken, deviceId, user, enabled}.
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
  enabled: boolean
}

const DEFAULT_STATE: SyncState = {
  baseUrl: resolveDefaultSyncApiBase(),
  accessToken: null,
  refreshToken: null,
  deviceId: null,
  user: null,
  enabled: false
}

const listeners = new Set<() => void>()
let state: SyncState = loadState()

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
    const parsed = JSON.parse(raw) as Partial<SyncState>
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
  setState({ accessToken: auth.accessToken, refreshToken: auth.refreshToken, user: auth.user ?? null })
}

export function clearSyncAuth(): void {
  setState({ accessToken: null, refreshToken: null, user: null })
}

export function ensureDeviceId(): string {
  if (state.deviceId && state.deviceId.trim().length > 0) return state.deviceId
  const id = generateDeviceId()
  setState({ deviceId: id })
  return id
}

export function setSyncEnabled(enabled: boolean): void {
  setState({ enabled })
}

export function setSyncBaseUrl(baseUrl: string): void {
  const trimmed = baseUrl.trim()
  setState({ baseUrl: trimmed || resolveDefaultSyncApiBase() })
}
