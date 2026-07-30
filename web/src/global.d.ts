/// <reference types="vite/client" />

import type { TeachingSystemApi } from '@shared/teaching-types/system-api'

/**
 * The Web app injects `window.teachingSystem` before first render (Phase 1:
 * throwing stub; Phase 3: HTTP adapter). The desktop preload exposes the same
 * global via the Electron contextBridge, so shared renderer components keep
 * calling `window.teachingSystem.*` unchanged.
 */
declare global {
  interface Window {
    teachingSystem: TeachingSystemApi
  }
}

/** Re-exported for discoverability; the runtime class lives in `./errors`. */
export type { WebNotSupportedError } from './errors'
