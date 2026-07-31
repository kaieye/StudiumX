/**
 * Auth-gate "continue local" preference store.
 *
 * StudiumX is local-first: teaching authority always lives in workspace
 * files, never on the server. The login screen is therefore *optional* -
 * the user may dismiss it and use the app fully offline. This module holds
 * that "continue in local mode" choice so the gate does not nag on every
 * launch, and so a logout (which clears this flag) can return the user to
 * the login screen.
 *
 * Reuses the same useSyncExternalStore pattern as sync-store. Persisted to
 * localStorage under `studiumx.auth.continueLocal`. No remote telemetry.
 */

import { useSyncExternalStore } from 'react'

export const CONTINUE_LOCAL_KEY = 'studiumx.auth.continueLocal'

let continueLocal = readContinueLocal()

function readContinueLocal(): boolean {
  try {
    return localStorage.getItem(CONTINUE_LOCAL_KEY) === '1'
  } catch {
    return false
  }
}

function persist(value: boolean): void {
  try {
    if (value) localStorage.setItem(CONTINUE_LOCAL_KEY, '1')
    else localStorage.removeItem(CONTINUE_LOCAL_KEY)
  } catch {
    /* ignore quota / private-mode errors */
  }
}

const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((listener) => listener())
}

export function getContinueLocal(): boolean {
  return continueLocal
}

export function subscribeContinueLocal(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useContinueLocal(): boolean {
  return useSyncExternalStore(subscribeContinueLocal, getContinueLocal, getContinueLocal)
}

/** User dismissed the login screen to use the app in local (offline) mode. */
export function setContinueLocal(value: boolean): void {
  if (continueLocal === value) return
  continueLocal = value
  persist(continueLocal)
  emit()
}

/**
 * Clear the continue-local flag. Called on explicit logout so the login
 * screen re-appears (mirrors Livo's logout -> AuthLoginPage behaviour).
 */
export function clearContinueLocal(): void {
  setContinueLocal(false)
}
