import type { TeachingSystemApi } from '@shared/teaching-types/system-api'
import { WebNotSupportedError } from '../errors'

/**
 * Web `TeachingSystemApi` adapter (plan §6.1 / §8 Phase 3).
 *
 * The Web app is NOT a teaching execution engine (plan §9 / AGENTS.md red
 * lines): no model keys, no agent loop, no workspace file writes. The adapter
 * therefore exposes `platform: 'web'`, implements only the read-only subset
 * that maps to StudiumX-Server HTTP endpoints, and throws `WebNotSupportedError`
 * for every capability that requires the Electron desktop runtime.
 *
 * Feature methods are auto-discovered from `./features/*.ts` so that Phases
 * 4/5/6 add web support by dropping in a feature module WITHOUT editing this
 * composer. With zero feature modules (Phase 3) every method is not-supported.
 */

/**
 * Auto-discovered feature adapter modules. Each `./features/<name>.ts` exports
 * `feature: Partial<TeachingSystemApi>` implementing that feature's
 * web-supported methods over `../api/http`. Eager-loaded at bundle time.
 */
const featureModules = import.meta.glob('./features/*.ts', { eager: true }) as Record<
  string,
  { feature: Partial<TeachingSystemApi> }
>

/** Merge every discovered feature partial into a single override map. */
function composeFeatureOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {}
  for (const mod of Object.values(featureModules)) {
    // Defensive: a helper module dropped into features/ without a `feature`
    // export must be skipped, not crash the whole adapter (every feature module
    // is eager-loaded, so a crash here blanks the entire web app).
    if (!mod.feature) continue
    const partial = mod.feature as Record<string, unknown>
    for (const key of Object.keys(partial)) {
      overrides[key] = partial[key]
    }
  }
  return overrides
}

/**
 * Throwing base (reused from the Phase 1 `main.tsx` stub): `platform` -> 'web',
 * every other property access returns a function that throws
 * `WebNotSupportedError`. This is the fallback for any method a feature module
 * has not implemented.
 */
function createBaseProxy(): TeachingSystemApi {
  const handler: ProxyHandler<TeachingSystemApi> = {
    get(_target, property) {
      if (property === 'platform') {
        return 'web'
      }
      const methodName = String(property)
      return () => {
        throw new WebNotSupportedError(methodName)
      }
    }
  }
  return new Proxy({} as unknown as TeachingSystemApi, handler)
}

/**
 * Compose the Web `TeachingSystemApi`: feature overrides merged OVER the
 * throwing base. `platform` is always 'web'; an implemented feature method runs
 * via `../api/http`; every other method throws `WebNotSupportedError`. With no
 * feature modules the adapter is entirely not-supported (correct for Phase 3).
 */
export function createWebTeachingSystem(): TeachingSystemApi {
  const base = createBaseProxy()
  const featureMap = composeFeatureOverrides()
  const handler: ProxyHandler<TeachingSystemApi> = {
    get(_target, property) {
      const key = String(property)
      if (key in featureMap) {
        return featureMap[key]
      }
      // Delegate to the throwing base: platform -> 'web', else WebNotSupportedError.
      return Reflect.get(base, property)
    }
  }
  return new Proxy({} as unknown as TeachingSystemApi, handler)
}
