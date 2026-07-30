# Web Adapter Feature Modules

This directory holds the Web implementations of `TeachingSystemApi` methods
that are backed by StudiumX-Server HTTP endpoints. The composer
(`../web-teaching-system.ts`) auto-discovers every file here via
`import.meta.glob('./features/*.ts', { eager: true })` and merges them **over**
the throwing base, so future phases add Web support **without** editing the
composer.

## Feature-module contract

A feature module is a file `<name>.ts` (e.g. `analytics.ts`, `study-planning.ts`)
that **must** export exactly:

```ts
import type { TeachingSystemApi } from '@shared/teaching-types/system-api'
import { apiGet, apiPut } from '../api/http'

export const feature: Partial<TeachingSystemApi> = {
  // Implement only this feature's web-supported methods. Each calls the
  // authenticated HTTP client in ../api/http; auth/401-refresh is handled there.
  async getLearningAnalytics(request) {
    return apiGet('/analytics/summary', { range: request.range })
  }
}
```

### Rules

- **Export shape:** `export const feature: Partial<TeachingSystemApi>`. Only the
  `feature` named export is consumed; other exports are ignored.
- **Only web-supported methods:** implement methods whose data source is a
  StudiumX-Server HTTP endpoint (plan §4.1). Do NOT implement any method listed
  in plan §4.2 / the Phase 3 hard constraints (`generateLesson`,
  `generateLessonStream`, `agentChatStream`, `cancelAgentChatStream`,
  `createWorkspace`, `importWorkspace`, `readWorkspaceMarkdown`,
  `saveWorkspaceMarkdown`, `pickDirectory`, `openPath`, `openExternal`,
  `probeProvider`, `listUpstreamModels`, `listGitWorktrees`, `switchGitBranch`,
  `controlWindow`, `mcp*`) - those stay not-supported and throw
  `WebNotSupportedError` via the base.
- **Never read tokens directly:** all HTTP calls go through `../api/http`
  (`apiGet` / `apiPost` / `apiPut`), which injects the `Authorization` header
  and handles 401 refresh/retry. Feature modules must not touch
  `studiumx.accessToken` / `studiumx.refreshToken`.
- **Override semantics:** if two feature modules define the same method, the
  last-discovered module wins (load order is `Object.values` over the glob
  result - keep one method per module to avoid ambiguity).
- **`platform` is reserved:** the composer always returns `'web'` for
  `platform`; feature modules must not set it.

## Current state (Phase 3)

No feature modules exist yet. The adapter is therefore entirely
not-supported: `platform === 'web'` and every method throws
`WebNotSupportedError`. Phases 4/5/6 add feature files here:

- Phase 4: `analytics.ts` (`getLearningAnalytics`, `exportLearningAnalytics`,
  `clearLearningAnalytics` via `/analytics/summary`).
- Phase 5: `study-planning.ts` (`readStudyPlanning`, `applyStudyPlanning` via
  `/study-planning`).
- Phase 6: `lessons.ts` / `conversations.ts` (`readLesson`, etc.).
