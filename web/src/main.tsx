import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createWebTeachingSystem } from './adapter/web-teaching-system'
import { API_BASE } from './api/http'
import { setSyncBaseUrl } from '@renderer/sync/sync-store'
import './styles.css'
import '../../src/renderer/src/i18n'
import '../../src/renderer/src/styles.css'
import '../../src/renderer/src/settings-extra.css'

/**
 * Inject the Web `TeachingSystemApi` adapter before first render.
 *
 * The desktop app receives this global from the Electron preload
 * contextBridge. The Web app has no main process, so it injects an HTTP adapter
 * (plan §6.1 / §8 Phase 3): `platform` is 'web', the read-only subset maps to
 * StudiumX-Server endpoints via `./api/http`, and every desktop-only capability
 * throws `WebNotSupportedError`.
 *
 * Hard constraint: the Web app is NOT a teaching execution engine - no model
 * keys, no agent loop, no workspace file writes (plan §9 / AGENTS.md red lines).
 */
window.teachingSystem = createWebTeachingSystem()

// The Web app is a thin client for ONE StudiumX-Server: the same base URL
// serves login (web/src/auth) and the shared renderer's sync traffic
// (study-room presence, session check, sync client). The desktop derives both
// from the sync-store default; the Web shell must pin the sync-store base to
// the Web API base so the study-room presence calls the same server that
// issued the access token. Otherwise join/heartbeat/members all 401 and the
// Web study room never syncs with the desktop.
setSyncBaseUrl(API_BASE)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
