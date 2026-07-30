# Web Views

Reserved for Web-specific view components (Phase 4+).

The Web app reuses desktop renderer views via `window.teachingSystem` adapter
injection (plan §5.1). Web-only shells (e.g. `Login.tsx`, `Dashboard.tsx`)
land here in later phases. Phase 1 ships only the placeholder routes in
`web/src/App.tsx`.
