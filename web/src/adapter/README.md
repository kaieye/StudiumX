# Web Adapter

Home for the Web `TeachingSystemApi` HTTP adapter.

- `web-teaching-system.ts` - exports `createWebTeachingSystem(): TeachingSystemApi`.
  Composes a throwing base (`platform` -> 'web', every method throws
  `WebNotSupportedError`) with feature overrides auto-discovered from
  `./features/*.ts` merged over it. Phases 4/5/6 add feature modules without
  editing this composer.
- `features/` - one file per feature (`analytics.ts`, `study-planning.ts`, ...),
  each exporting `feature: Partial<TeachingSystemApi>`. See `features/README.md`
  for the contract. Phase 3 ships with none, so the adapter is entirely
  not-supported.
- HTTP calls go through `../api/http` (`apiGet` / `apiPost` / `apiPut`), which
  handles auth injection and 401 refresh/retry.

The Web app is NOT a teaching execution engine: no model keys, no agent loop, no
workspace file writes (plan §9 / AGENTS.md red lines).
