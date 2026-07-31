import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createWebTeachingSystem } from './adapter/web-teaching-system'
import './styles.css'

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

createRoot(document.getElementById('root')!).render(<App />)
