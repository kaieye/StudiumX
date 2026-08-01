# Web Views

The authenticated Web application does **not** mount a second route-based
Dashboard. After Web authentication it renders the exact desktop renderer
`App` from `src/renderer/src/App.tsx`; the browser-safe `TeachingSystemApi`
adapter only supplies the capabilities that are safe to use on the Web.

The files kept under this directory are legacy feature prototypes and adapter
contract fixtures from the earlier Web-only route plan. They are intentionally
not imported by `web/src/App.tsx`. New authenticated UI must be implemented in
the shared renderer tree so Electron and Web cannot drift apart. The Web login
surface remains here because authentication is browser-specific.
